const api = require('./core/api');
const wa = require('./whatsapp');
const storage = require('./storage');
const ai = require('./ai');

let timer = null;
let running = false;
let inFlight = false;
let state = { running: false, lastRun: null, nextRun: null, error: null };
const listeners = { log: [], match: [] };

function log(msg, level = 'info') {
  const entry = { ts: new Date().toISOString(), level, msg };
  for (const fn of listeners.log) {
    try { fn(entry); } catch (_) {}
  }
}
function emitMatch(m) {
  for (const fn of listeners.match) {
    try { fn(m); } catch (_) {}
  }
}

function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── Basit Türkçe stem + eşleşme kontrolü ──────────────────────────────────
function _norm(s) {
  return String(s || '').toLocaleLowerCase('tr-TR');
}
function _tokenize(s) {
  return _norm(s).split(/[^a-z0-9çğıöşü]+/i).filter(Boolean);
}
function _stem(w) {
  // Son 2 ek karakterini at (Türkçe çekimler için genelde yeterli)
  return w.length > 5 ? w.slice(0, w.length - 2) : w;
}
function matchesKeywordInTitle(tender, kw) {
  // Sadece ihale adı — idare adı yaygın kelimeler içerir (belediye, müdürlük vs),
  // gürültü yapıyor. Filtre daha sıkı olsun.
  const hay = _norm(tender.name || '');
  const tokens = _tokenize(kw);
  if (!tokens.length) return true;
  return tokens.every((t) => hay.includes(_stem(t)));
}
function hitsBlacklist(tender, blacklist) {
  if (!blacklist || !blacklist.length) return null;
  const hay = _norm(tender.name || '');
  for (const b of blacklist) {
    const nb = _norm(b);
    if (nb && hay.includes(nb)) return b;
  }
  return null;
}

function formatMessage(tender, keyword, template) {
  const vars = {
    keyword,
    title: tender.name || '(başlık yok)',
    authority: tender.authority || '-',
    province: tender.province || '-',
    tenderDate: tender.tender_datetime || '-',
    ikn: tender.ikn || '-',
    type: tender.type?.description || '-',
    status: tender.status?.description || '-',
    method: tender.method || '-',
    url: tender.document_url || '',
  };
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}

async function runOnce() {
  if (inFlight) {
    log('Önceki tarama hala sürüyor, atlandı', 'warn');
    return;
  }
  inFlight = true;
  try {
    const cfg = storage.getConfig();
    if (!cfg.keywords?.length) {
      log('Anahtar kelime tanımlı değil', 'warn');
      return;
    }

    const today = new Date();
    const from = new Date(today.getTime() - (cfg.lookbackDays || 3) * 86400000);
    const startDate = ymd(from);
    const endDate = ymd(today);

    const seen = new Set(storage.getSeen());
    const newIkns = [];

    log(`Tarama başladı — ${cfg.keywords.length} anahtar · ${startDate}…${endDate}`);

    let aiDisabledThisRun = false; // 429/403 alırsak bu tarama içinde AI'yı kapat

    for (const kw of cfg.keywords) {
      try {
        log(`🔍 "${kw}"`);
        const result = await api.searchTenders({
          searchText: kw,
          announcementDateStart: startDate,
          announcementDateEnd: endDate,
          orderBy: 'ihaleTarihi',
          sortOrder: 'desc',
          searchType: cfg.searchType || 'TumKelimeler',
          limit: cfg.perKeywordLimit || 30,
          tenderTypes: cfg.tenderTypes?.length ? cfg.tenderTypes : null,
          provinces: cfg.provincePlates?.length ? cfg.provincePlates : null,
        });

        if (result.error) {
          log(`  "${kw}" hatası: ${result.error} — ${result.message || ''}`, 'error');
          continue;
        }

        const tenders = result.tenders || [];
        log(`  ${tenders.length} sonuç (toplam: ${result.total_count ?? '?'})`);
        // filteredOut sayısı post-loop log'da raporlanır

        let filteredOut = 0;
        let skippedSeen = 0;
        let aiRejected = 0;
        for (const tender of tenders) {
          // Lokal filtre: başlıkta anahtar kelimenin kökü geçmeli
          if (cfg.strictTitleMatch !== false && !matchesKeywordInTitle(tender, kw)) {
            filteredOut++;
            continue;
          }
          // Kara liste: başlıkta engellenen kelime var mı?
          const blHit = hitsBlacklist(tender, cfg.blacklist);
          if (blHit) {
            filteredOut++;
            continue;
          }

          // Dedupe yalnızca IKN'ye (veya IKN yoksa normalize edilmiş başlığa) dayansın —
          // aynı ihale birden fazla anahtar kelimeye eşleşse bile tek mesaj gider.
          const dedupeKey = tender.ikn
            || _norm(tender.name || '').slice(0, 160)
            || String(tender.id || '');
          if (!dedupeKey) { filteredOut++; continue; }
          if (seen.has(dedupeKey)) { skippedSeen++; continue; }

          // ── Yapay zeka ön-filtre (Google Gemini) ──
          let aiVerdict = null;
          if (cfg.aiEnabled && cfg.aiApiKey && !aiDisabledThisRun) {
            try {
              aiVerdict = await ai.classifyTender({
                tender,
                businessContext: cfg.aiBusinessContext,
                keywords: cfg.keywords,
                apiKey: cfg.aiApiKey,
                model: cfg.aiModel || 'gemini-1.5-flash',
              });
              const minConf = typeof cfg.aiMinConfidence === 'number' ? cfg.aiMinConfidence : 0.5;
              if (!aiVerdict.relevant || (aiVerdict.confidence !== null && aiVerdict.confidence < minConf)) {
                aiRejected++;
                log(`  🤖 atladı: ${tender.name?.slice(0, 70)} — ${aiVerdict.reason}`);
                seen.add(dedupeKey);
                newIkns.push(dedupeKey);
                continue;
              }
              log(`  🤖 onayladı: ${tender.name?.slice(0, 70)} (güven %${Math.round((aiVerdict.confidence || 0) * 100)})`);
            } catch (err) {
              if (err.code === 'RATE_LIMIT') {
                aiDisabledThisRun = true;
                log(`  🤖 Gemini kotası doldu — bu tarama AI olmadan devam ediyor (kelime filtresine göre)`, 'warn');
              } else if (err.code === 'AUTH') {
                aiDisabledThisRun = true;
                log(`  🤖 Gemini API anahtarı geçersiz — AI devre dışı bırakıldı`, 'error');
              } else if (err.code === 'MODEL_NOT_FOUND') {
                aiDisabledThisRun = true;
                log(`  🤖 Model bulunamadı (${cfg.aiModel}) — Ayarlar'dan farklı model seçin`, 'error');
              } else {
                log(`  🤖 AI hatası, kelime filtresine güveniyoruz: ${err.message}`, 'warn');
              }
            }
            // Gemini free tier rate limit (15 RPM = ~4sn)
            if (!aiDisabledThisRun) await new Promise((r) => setTimeout(r, 4500));
          }

          seen.add(dedupeKey);
          newIkns.push(dedupeKey);

          const message = formatMessage(tender, kw, cfg.messageTemplate);
          const record = { keyword: kw, ikn: tender.ikn, tender, message, sent: [], ai: aiVerdict };

          if (wa.isReady() && cfg.recipients?.length) {
            for (const rcpt of cfg.recipients) {
              try {
                await wa.sendMessage(rcpt, message);
                record.sent.push({ to: rcpt, ok: true });
                log(`  ✔ ${rcpt} · ${tender.ikn || tender.name}`);
                await new Promise((r) => setTimeout(r, 1500));
              } catch (err) {
                record.sent.push({ to: rcpt, ok: false, error: err.message });
                log(`  ✘ ${rcpt}: ${err.message}`, 'error');
              }
            }
          } else if (!wa.isReady()) {
            log('  WhatsApp hazır değil, mesaj atlandı', 'warn');
          } else {
            log('  Alıcı yok, kayıt tutuldu', 'warn');
          }

          storage.addMatch(record);
          emitMatch(record);
        }
        if (filteredOut > 0 || skippedSeen > 0 || aiRejected > 0) {
          const parts = [];
          if (filteredOut > 0) parts.push(`${filteredOut} başlık/blacklist eledi`);
          if (skippedSeen > 0) parts.push(`${skippedSeen} daha önce bildirilmiş`);
          if (aiRejected > 0) parts.push(`${aiRejected} AI eledi`);
          log('  ' + parts.join(' · '));
        }
      } catch (err) {
        log(`  "${kw}" hatası: ${err.message}`, 'error');
      }
    }

    if (newIkns.length) storage.addSeen(newIkns);
    state.lastRun = new Date().toISOString();
    state.error = null;
    log(`Tarama bitti — ${newIkns.length} yeni kayıt`);
  } catch (err) {
    state.error = err.message;
    log(`Tarama hatası: ${err.message}`, 'error');
  } finally {
    inFlight = false;
  }
}

function start() {
  if (running) return state;
  running = true;
  state.running = true;
  state.error = null;
  const cfg = storage.getConfig();
  const intervalMs = Math.max(5, cfg.intervalMinutes || 30) * 60 * 1000;
  log(`Zamanlayıcı başlatıldı (her ${cfg.intervalMinutes}dk)`);

  const loop = async () => {
    if (!running) return;
    await runOnce();
    if (!running) return;
    state.nextRun = new Date(Date.now() + intervalMs).toISOString();
    timer = setTimeout(loop, intervalMs);
  };
  loop();
  return state;
}

function stop() {
  running = false;
  state.running = false;
  state.nextRun = null;
  if (timer) clearTimeout(timer);
  timer = null;
  log('Zamanlayıcı durduruldu');
  return state;
}

exports.start = start;
exports.stop = stop;
exports.runOnce = runOnce;
exports.getStatus = () => ({ ...state });
exports.onLog = (fn) => listeners.log.push(fn);
exports.onMatch = (fn) => listeners.match.push(fn);
