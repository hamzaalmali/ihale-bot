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

    // AI durumunu görünür kıl
    if (cfg.aiEnabled && cfg.aiApiKey) {
      log(`🤖 AI filtre aktif: ${cfg.aiProvider || 'gemini'} · ${cfg.aiModel || '(model seçilmedi)'} · min güven ${cfg.aiMinConfidence ?? 0.5}`);
    } else if (cfg.aiEnabled && !cfg.aiApiKey) {
      log(`⚠ AI açık ama API anahtarı boş — kelime filtresine düşüldü`, 'warn');
    } else {
      log(`AI filtre KAPALI (sadece kelime/blacklist filtresi)`);
    }

    // 1) Candidate toplama (kelime + blacklist + dedupe filtreleri)
    const candidates = []; // { tender, kw, dedupeKey }
    let totalFromEkap = 0;
    let filteredOut = 0;
    let skippedSeen = 0;

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
        totalFromEkap += tenders.length;
        log(`  ${tenders.length} sonuç (EKAP toplam: ${result.total_count ?? '?'})`);

        for (const tender of tenders) {
          if (cfg.strictTitleMatch !== false && !matchesKeywordInTitle(tender, kw)) {
            filteredOut++; continue;
          }
          if (hitsBlacklist(tender, cfg.blacklist)) {
            filteredOut++; continue;
          }
          const dedupeKey = tender.ikn
            || _norm(tender.name || '').slice(0, 160)
            || String(tender.id || '');
          if (!dedupeKey) { filteredOut++; continue; }
          if (seen.has(dedupeKey)) { skippedSeen++; continue; }
          // İlk gören anahtarın geçtiği versiyonu sakla; aynı dedupeKey tekrar eklenmesin
          if (candidates.find((c) => c.dedupeKey === dedupeKey)) continue;
          candidates.push({ tender, kw, dedupeKey });
        }
      } catch (err) {
        log(`  "${kw}" hatası: ${err.message}`, 'error');
      }
    }

    log(`Aday: ${candidates.length} ihale (EKAP: ${totalFromEkap}, kelime/blacklist eledi: ${filteredOut}, daha önce: ${skippedSeen})`);

    // 2) AI batch sınıflandırma (varsa)
    let approved = candidates;
    let aiSkipped = 0;
    let aiRejected = 0;
    if (cfg.aiEnabled && cfg.aiApiKey && candidates.length > 0) {
      const provider = cfg.aiProvider || 'gemini';
      const model = cfg.aiModel || (provider === 'groq' ? 'llama-3.3-70b-versatile' : 'gemini-2.0-flash-lite');
      const minConf = typeof cfg.aiMinConfidence === 'number' ? cfg.aiMinConfidence : 0.5;
      const chunkSize = 25;
      const verdicts = []; // {idx (global), relevant, confidence, reason}
      let aiDisabled = false;
      log(`🤖 AI toplu değerlendirme başlıyor: ${candidates.length} aday → ${Math.ceil(candidates.length / chunkSize)} parti (${provider}/${model})`);

      for (let off = 0; off < candidates.length; off += chunkSize) {
        if (aiDisabled) break;
        const slice = candidates.slice(off, off + chunkSize);
        try {
          const partial = await ai.classifyBatch({
            provider,
            apiKey: cfg.aiApiKey,
            model,
            businessContext: cfg.aiBusinessContext,
            keywords: cfg.keywords,
            tenders: slice.map((c) => c.tender),
          });
          // partial[i].idx slice içindeki index — global'e dönüştür
          for (const v of partial) {
            const localIdx = Number(v.idx);
            if (Number.isInteger(localIdx) && localIdx >= 0 && localIdx < slice.length) {
              verdicts[off + localIdx] = v;
            }
          }
          log(`  🤖 parti ${Math.floor(off / chunkSize) + 1}: ${partial.length} sonuç döndü`);
        } catch (err) {
          if (err.code === 'RATE_LIMIT') {
            aiDisabled = true;
            log(`  🤖 ${provider} kotası doldu — geri kalan ${candidates.length - off} aday AI olmadan WhatsApp'a gönderilecek`, 'warn');
          } else if (err.code === 'AUTH') {
            aiDisabled = true;
            log(`  🤖 API anahtarı geçersiz — AI devre dışı, kelime filtresiyle gönderilecek`, 'error');
          } else if (err.code === 'MODEL_NOT_FOUND') {
            aiDisabled = true;
            log(`  🤖 Model bulunamadı (${model}) — AI devre dışı`, 'error');
          } else {
            log(`  🤖 AI hatası: ${err.message}`, 'warn');
          }
        }
        // Sağlayıcı rate limit
        if (!aiDisabled && off + chunkSize < candidates.length) {
          await new Promise((r) => setTimeout(r, provider === 'groq' ? 2200 : 4500));
        }
      }

      // Verdict'lere göre filtrele
      approved = [];
      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        const v = verdicts[i];
        if (!v) {
          // AI bu adayı değerlendirmedi (kotada düştü vs); kelime filtresine güven, gönder
          if (cfg.aiEnabled && !v) aiSkipped++;
          c.ai = null;
          approved.push(c);
          continue;
        }
        const conf = typeof v.confidence === 'number' ? v.confidence : 1;
        if (v.relevant && conf >= minConf) {
          c.ai = v;
          approved.push(c);
          log(`  ✓ ${c.tender.name?.slice(0, 80)} (güven %${Math.round(conf * 100)})`);
        } else {
          aiRejected++;
          log(`  ✗ ${c.tender.name?.slice(0, 80)} — ${v.reason || 'alakasız'}`);
          // Reddedilenler: seen'e ekle, tekrar değerlendirilmesin
          seen.add(c.dedupeKey);
          newIkns.push(c.dedupeKey);
        }
      }
      log(`🤖 AI sonucu: ${approved.length} onay · ${aiRejected} red · ${aiSkipped} değerlendirilemedi`);
    }

    // 3) WhatsApp'a gönderim
    log(`📤 Gönderim aşaması: ${approved.length} ihale, ${cfg.recipients?.length || 0} alıcı`);
    for (const c of approved) {
      const { tender, kw, dedupeKey, ai: aiVerdict } = c;
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
        log(`  ⚠ WhatsApp hazır değil — "${tender.name?.slice(0, 60)}" mesajı atlandı`, 'warn');
      } else {
        log(`  ⚠ Alıcı yok — kayıt tutuldu, mesaj gitmedi`, 'warn');
      }

      storage.addMatch(record);
      emitMatch(record);
    }

    if (newIkns.length) storage.addSeen(newIkns);
    state.lastRun = new Date().toISOString();
    state.error = null;
    log(`✅ Tarama bitti — ${approved.length} mesaj, ${aiRejected} AI eledi, ${filteredOut} kelime eledi, ${skippedSeen} duplikat`);
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
