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

    const today = new Date();
    const lastScanISO = storage.getLastScanAt();
    const lastScan = lastScanISO ? new Date(lastScanISO) : null;

    // Incremental window: ilk tarama lookbackDays kadar geri,
    // sonraki taramalar (geçen süre + 24 saat buffer) ama en fazla lookbackDays
    const maxLookbackMs = (cfg.lookbackDays || 7) * 86400000;
    let windowMs;
    let windowReason;
    if (!lastScan) {
      windowMs = maxLookbackMs;
      windowReason = `ilk tarama, son ${cfg.lookbackDays || 7} gün`;
    } else {
      const elapsedMs = today.getTime() - lastScan.getTime();
      const bufferMs = 24 * 3600000; // 24 saat güvenlik payı
      windowMs = Math.min(elapsedMs + bufferMs, maxLookbackMs);
      const hours = Math.round(windowMs / 3600000);
      windowReason = `son tarama: ${lastScan.toLocaleString('tr-TR')} → bu pencere ${hours} saat`;
    }

    const from = new Date(today.getTime() - windowMs);
    const startDate = ymd(from);
    const endDate = ymd(today);

    const seen = new Set(storage.getSeen());
    const newIkns = [];

    log(`Tarama başladı — ${windowReason} (${startDate} → ${endDate})`);

    // AI durumunu görünür kıl
    if (cfg.aiEnabled && cfg.aiApiKey) {
      log(`🤖 AI filtre aktif: ${cfg.aiProvider || 'gemini'} · ${cfg.aiModel || '(model seçilmedi)'} · min güven ${cfg.aiMinConfidence ?? 0.5}`);
    } else if (cfg.aiEnabled && !cfg.aiApiKey) {
      log(`⚠ AI açık ama API anahtarı boş`, 'warn');
    } else {
      log(`⚠ AI filtre KAPALI — eşleşmeler için AI tavsiye edilir`, 'warn');
    }

    // 1) EKAP'tan TÜM açık ihaleleri pagination ile çek
    const candidates = []; // { tender, dedupeKey }
    let totalFromEkap = 0;
    let blacklisted = 0;
    let skippedSeen = 0;

    const PAGE_SIZE = 100;
    const MAX_PAGES = 50; // emniyet
    log(`📥 EKAP'tan ihaleler çekiliyor…`);

    for (let page = 0; page < MAX_PAGES; page++) {
      let result;
      try {
        result = await api.searchTenders({
          searchText: '', // TÜM ihaleler
          announcementDateStart: startDate,
          announcementDateEnd: endDate,
          orderBy: 'ihaleTarihi',
          sortOrder: 'desc',
          searchType: 'TumKelimeler',
          tenderTypes: cfg.tenderTypes?.length ? cfg.tenderTypes : null,
          provinces: cfg.provincePlates?.length ? cfg.provincePlates : null,
          skip: page * PAGE_SIZE,
          limit: PAGE_SIZE,
        });
      } catch (err) {
        log(`EKAP sayfa ${page + 1} hatası: ${err.message}`, 'error');
        break;
      }
      if (result.error) {
        log(`EKAP sayfa ${page + 1} hatası: ${result.error}${result.message ? ' — ' + result.message : ''}`, 'error');
        break;
      }
      const tenders = result.tenders || [];
      totalFromEkap += tenders.length;
      const total = result.total_count || 0;
      log(`  sayfa ${page + 1}: ${tenders.length} ihale (toplam ${total})`);

      for (const tender of tenders) {
        if (hitsBlacklist(tender, cfg.blacklist)) { blacklisted++; continue; }
        const dedupeKey = tender.ikn
          || _norm(tender.name || '').slice(0, 160)
          || String(tender.id || '');
        if (!dedupeKey) continue;
        if (seen.has(dedupeKey)) { skippedSeen++; continue; }
        if (candidates.find((c) => c.dedupeKey === dedupeKey)) continue;
        candidates.push({ tender, dedupeKey });
      }

      if (tenders.length < PAGE_SIZE) break; // son sayfa
      if (page * PAGE_SIZE + tenders.length >= total) break;
      // EKAP rate limit dostu — sayfalar arası kısa bekleme
      await new Promise((r) => setTimeout(r, 400));
    }

    log(`Aday: ${candidates.length} yeni ihale (EKAP'tan toplam: ${totalFromEkap}, blacklist eledi: ${blacklisted}, daha önce: ${skippedSeen})`);

    // 2) AI batch sınıflandırma (varsa)
    let approved = candidates;
    let aiSkipped = 0;
    let aiRejected = 0;
    if (cfg.aiEnabled && cfg.aiApiKey && candidates.length > 0) {
      const provider = cfg.aiProvider || 'gemini';
      const model = cfg.aiModel || (provider === 'groq' ? 'llama-3.1-8b-instant' : 'gemini-2.0-flash-lite');
      const minConf = typeof cfg.aiMinConfidence === 'number' ? cfg.aiMinConfidence : 0.5;
      const chunkSize = cfg.aiBatchSize || 10;
      const verdicts = []; // {idx (global), relevant, confidence, reason}
      let aiDisabled = false;
      log(`🤖 AI toplu değerlendirme başlıyor: ${candidates.length} aday → ${Math.ceil(candidates.length / chunkSize)} parti × ${chunkSize} (${provider}/${model})`);

      const callBatch = async (slice) => ai.classifyBatch({
        provider,
        apiKey: cfg.aiApiKey,
        model,
        businessContext: cfg.aiBusinessContext,
        keywords: cfg.keywords,
        tenders: slice.map((c) => c.tender),
      });

      for (let off = 0; off < candidates.length; off += chunkSize) {
        if (aiDisabled) break;
        const slice = candidates.slice(off, off + chunkSize);
        let partial = null;
        let partRetried = false;
        while (true) {
          try {
            partial = await callBatch(slice);
            break;
          } catch (err) {
            if (err.code === 'RATE_LIMIT' && !partRetried) {
              partRetried = true;
              log(`  🤖 ${provider} TPM/kota sınırı — 60 sn beklenip tekrar denenecek`, 'warn');
              await new Promise((r) => setTimeout(r, 60_000));
              continue;
            }
            if (err.code === 'RATE_LIMIT') {
              log(`  🤖 ${provider} kota dolu — kalan ${candidates.length - off} aday değerlendirilmedi (sonraki taramada tekrar denenecek)`, 'warn');
            } else if (err.code === 'AUTH') {
              log(`  🤖 API anahtarı geçersiz — AI devre dışı`, 'error');
            } else if (err.code === 'MODEL_NOT_FOUND') {
              log(`  🤖 Model bulunamadı (${model})`, 'error');
            } else {
              log(`  🤖 AI hatası: ${err.message}`, 'warn');
            }
            aiDisabled = true;
            break;
          }
        }
        if (partial) {
          for (const v of partial) {
            const localIdx = Number(v.idx);
            if (Number.isInteger(localIdx) && localIdx >= 0 && localIdx < slice.length) {
              verdicts[off + localIdx] = v;
            }
          }
          log(`  🤖 parti ${Math.floor(off / chunkSize) + 1}: ${partial.length} sonuç döndü`);
        }
        // Partiler arası bekleme (RPM/TPM dostu)
        if (!aiDisabled && off + chunkSize < candidates.length) {
          await new Promise((r) => setTimeout(r, provider === 'groq' ? 3500 : 4500));
        }
      }

      // Verdict'lere göre filtrele
      approved = [];
      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        const v = verdicts[i];
        if (!v) {
          // AI bu adayı değerlendirmedi (kota/hata); approved'a EKLEME — sadece scanned olarak kaydet
          if (cfg.aiEnabled) aiSkipped++;
          c.ai = null;
          continue;
        }
        const conf = typeof v.confidence === 'number' ? v.confidence : 1;
        c.ai = v;
        if (v.relevant && conf >= minConf) {
          approved.push(c);
          log(`  ✓ ${c.tender.name?.slice(0, 80)} (güven %${Math.round(conf * 100)})`);
        } else {
          aiRejected++;
          log(`  ✗ ${c.tender.name?.slice(0, 80)} — ${v.reason || 'alakasız'}`);
        }
      }
      log(`🤖 AI sonucu: ${approved.length} onay · ${aiRejected} red · ${aiSkipped} değerlendirilemedi`);
    }

    // 3) Tüm aday ihaleleri scanned.json'a kaydet (Taranan İhaleler sekmesi)
    const scannedRecords = candidates.map((c) => ({
      ikn: c.tender.ikn,
      dedupeKey: c.dedupeKey,
      tender: c.tender,
      ai: c.ai || null,
      relevant: c.ai ? !!c.ai.relevant : null,
      scannedAt: new Date().toISOString(),
    }));
    storage.addScanned(scannedRecords);

    // 4) WhatsApp'a gönderim (sadece AI onaylananlar)
    log(`📤 Gönderim aşaması: ${approved.length} ihale, ${cfg.recipients?.length || 0} alıcı`);
    for (const c of approved) {
      const { tender, dedupeKey, ai: aiVerdict } = c;
      seen.add(dedupeKey);
      newIkns.push(dedupeKey);
      const message = formatMessage(tender, '', cfg.messageTemplate);
      const record = { keyword: '', ikn: tender.ikn, tender, message, sent: [], ai: aiVerdict };

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

    // Seen'e SADECE AI tarafından değerlendirilmiş (onaylı ya da reddedilmiş) adayları ekle.
    // AI değerlendiremediği (kota dolmuş) adaylar bir sonraki taramada tekrar denenecek.
    for (const c of candidates) {
      if (c.ai !== null && c.ai !== undefined) {
        seen.add(c.dedupeKey);
        newIkns.push(c.dedupeKey);
      }
    }

    if (newIkns.length) storage.addSeen(newIkns);
    storage.setLastScanAt(new Date().toISOString());
    state.lastRun = new Date().toISOString();
    state.error = null;
    log(`✅ Tarama bitti — ${approved.length} WhatsApp mesajı, ${aiRejected} AI eledi, ${blacklisted} blacklist eledi, ${skippedSeen} eski`);
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
