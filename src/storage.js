const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULT_CONFIG = {
  keywords: [],
  recipients: [],
  intervalMinutes: 30,
  lookbackDays: 7,
  perKeywordLimit: 30,
  tenderTypes: [],      // [] = tümü, aksi halde 1=Mal, 2=Yapım, 3=Hizmet, 4=Danışmanlık
  provincePlates: [],   // plaka kodları (1-81), [] = tümü
  searchType: 'TumKelimeler',  // 'GirdigimGibi' (tam ibare) veya 'TumKelimeler' (her kelime ayrı)
  strictTitleMatch: true,  // true: anahtar kelimenin kökü ihale başlığında geçmeli
  blacklist: [],           // başlıkta bu kelimelerden biri geçerse ihaleyi at
  // Yapay zeka filtre (Google Gemini)
  aiEnabled: false,
  aiProvider: 'groq',
  aiModel: '',  // "Modelleri Yükle" ile API'den listelenip seçilecek
  aiApiKey: '',
  aiBusinessContext: 'Elektrik dağıtım şirketleri için SCADA, OG/AG pano, kontrol panosu, trafo, RMU, kesici gibi orta gerilim ve otomasyon ekipmanları üretiyor/kuruyoruz.',
  aiMinConfidence: 0.5,
  messageTemplate:
    'Yeni ihale bulundu 🔔\n\n' +
    'Anahtar: {keyword}\n' +
    'Başlık: {title}\n' +
    'İdare: {authority}\n' +
    'Şehir: {province}\n' +
    'Tür: {type}\n' +
    'Durum: {status}\n' +
    'İhale Tarihi: {tenderDate}\n' +
    'IKN: {ikn}\n\n' +
    '{url}',
};

let dataDir = null;
function dir() {
  if (!dataDir) {
    dataDir = app.getPath('userData');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  }
  return dataDir;
}
const file = (name) => path.join(dir(), name);

function readJson(name, fallback) {
  try {
    const p = file(name);
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return fallback;
  }
}
function writeJson(name, data) {
  fs.writeFileSync(file(name), JSON.stringify(data, null, 2));
}

exports.getConfig = () => ({ ...DEFAULT_CONFIG, ...readJson('config.json', {}) });
exports.setConfig = (cfg) => {
  const merged = { ...exports.getConfig(), ...cfg };
  writeJson('config.json', merged);
  return merged;
};

exports.getSeen = () => readJson('seen.json', []);
exports.addSeen = (ids) => {
  const current = new Set(exports.getSeen());
  ids.forEach((i) => current.add(i));
  writeJson('seen.json', Array.from(current).slice(-5000));
};
exports.clearSeen = () => writeJson('seen.json', []);

exports.getMatches = () => readJson('matches.json', []);
exports.addMatch = (match) => {
  const list = readJson('matches.json', []);
  list.unshift({ ...match, notifiedAt: new Date().toISOString() });
  if (list.length > 200) list.length = 200;
  writeJson('matches.json', list);
};
exports.clearMatches = () => writeJson('matches.json', []);

// Tüm taranan ihaleler (AI verdict ile birlikte) — son 1000
exports.getScanned = () => readJson('scanned.json', []);
exports.addScanned = (records) => {
  if (!records?.length) return;
  const existing = readJson('scanned.json', []);
  const seenIkns = new Set(existing.map((r) => r.ikn || r.dedupeKey));
  const fresh = records.filter((r) => {
    const k = r.ikn || r.dedupeKey;
    if (!k || seenIkns.has(k)) return false;
    seenIkns.add(k);
    return true;
  });
  const merged = [...fresh, ...existing];
  if (merged.length > 1000) merged.length = 1000;
  writeJson('scanned.json', merged);
};
exports.clearScanned = () => writeJson('scanned.json', []);
