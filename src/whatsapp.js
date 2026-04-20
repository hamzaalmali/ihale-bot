const path = require('path');
const { app } = require('electron');

let client = null;
let starting = false;
let state = { ready: false, qr: null, status: 'idle' };
const listeners = { qr: [], status: [] };

function emit(type, data) {
  if (type === 'qr') state.qr = data;
  if (type === 'status') state.status = data;
  for (const fn of listeners[type]) {
    try { fn(data); } catch (_) {}
  }
}

function markReady(value) {
  state.ready = value;
}

async function start() {
  if (client) return state;
  if (starting) return state;
  starting = true;
  state = { ready: false, qr: null, status: 'starting' };
  emit('status', state.status);

  try {
    const wppconnect = require('@wppconnect-team/wppconnect');
    const sessionRoot = path.join(app.getPath('userData'), 'wa-tokens');

    client = await wppconnect.create({
      session: 'ihale-bot',
      folderNameToken: sessionRoot,
      headless: 'new',
      devtools: false,
      debug: false,
      disableWelcome: true,
      updatesLog: false,
      autoClose: 0,
      logQR: false,
      catchQR: (base64Qr /*, asciiQR, attempts, urlCode */) => {
        emit('qr', base64Qr);
        emit('status', 'qr-bekliyor');
      },
      statusFind: (statusSession) => {
        emit('status', statusSession);
        const ready = ['isLogged', 'inChat', 'qrReadSuccess', 'chatsAvailable', 'successChat'];
        if (ready.includes(statusSession)) {
          markReady(true);
          state.qr = null;
        }
        if (statusSession === 'browserClose' || statusSession === 'desconnectedMobile') {
          markReady(false);
        }
      },
      puppeteerOptions: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      },
    });

    markReady(true);
    emit('status', 'ready');
    state.qr = null;

    client.onStateChange((s) => {
      emit('status', 'state:' + s);
      if (['CONFLICT', 'UNLAUNCHED', 'UNPAIRED', 'UNPAIRED_IDLE'].includes(s)) {
        markReady(false);
      }
    });

    return state;
  } catch (err) {
    state = { ready: false, qr: null, status: 'error: ' + err.message };
    emit('status', state.status);
    client = null;
    throw err;
  } finally {
    starting = false;
  }
}

async function stop() {
  if (client) {
    try { await client.close(); } catch (_) {}
    client = null;
  }
  state = { ready: false, qr: null, status: 'stopped' };
  emit('status', state.status);
}

function toJid(num) {
  const s = String(num || '').trim();
  if (!s) throw new Error('Geçersiz numara');
  // Zaten JID formatında (kişi @c.us / grup @g.us)
  if (s.includes('@')) return s;
  const digits = s.replace(/\D/g, '');
  if (!digits) throw new Error('Geçersiz numara');
  return digits + '@c.us';
}

async function sendMessage(number, text) {
  if (!client || !state.ready) throw new Error('WhatsApp bağlı değil');
  return client.sendText(toJid(number), text);
}

async function listGroups() {
  if (!client || !state.ready) throw new Error('WhatsApp bağlı değil');
  // wppconnect sürümüne göre farklı API adları olabilir — hepsini dene.
  let raw = null;
  try {
    if (typeof client.getAllGroups === 'function') raw = await client.getAllGroups();
    else if (typeof client.listChats === 'function') raw = await client.listChats({ onlyGroups: true });
    else if (typeof client.getAllChats === 'function') raw = await client.getAllChats();
  } catch (err) {
    throw new Error('Grup listesi alınamadı: ' + err.message);
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((g) => {
      const id = (g && (g.id?._serialized || g.id)) || '';
      return String(id).includes('@g.us') || g.isGroup === true;
    })
    .map((g) => ({
      id: g.id?._serialized || g.id,
      name: g.name || g.formattedTitle || g.contact?.name || g.id?._serialized || g.id,
      participants: g.groupMetadata?.participants?.length || g.participants?.length || 0,
    }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'tr'));
}

async function restart() {
  emit('status', 'restarting');
  try { await stop(); } catch (_) {}
  // Puppeteer/Chromium tam kapansın diye kısa bekleme
  await new Promise((r) => setTimeout(r, 1500));
  return start();
}

exports.start = start;
exports.stop = stop;
exports.restart = restart;
exports.sendMessage = sendMessage;
exports.listGroups = listGroups;
exports.getStatus = () => ({ ...state });
exports.isReady = () => state.ready;
exports.onQR = (fn) => listeners.qr.push(fn);
exports.onStatus = (fn) => listeners.status.push(fn);
