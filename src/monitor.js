const api = require('./core/api');
const wa = require('./whatsapp');
const storage = require('./storage');

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

    for (const kw of cfg.keywords) {
      try {
        log(`🔍 "${kw}"`);
        const result = await api.searchTenders({
          searchText: kw,
          announcementDateStart: startDate,
          announcementDateEnd: endDate,
          orderBy: 'ihaleTarihi',
          sortOrder: 'desc',
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

        for (const tender of tenders) {
          const dedupeKey = tender.ikn || `${kw}::${tender.name || tender.id}`;
          if (!dedupeKey || seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);
          newIkns.push(dedupeKey);

          const message = formatMessage(tender, kw, cfg.messageTemplate);
          const record = { keyword: kw, ikn: tender.ikn, tender, message, sent: [] };

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
