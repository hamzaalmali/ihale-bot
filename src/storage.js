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
