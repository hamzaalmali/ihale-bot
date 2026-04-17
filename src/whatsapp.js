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
  const digits = String(num || '').replace(/\D/g, '');
  if (!digits) throw new Error('Geçersiz numara');
  return digits + '@c.us';
}

async function sendMessage(number, text) {
  if (!client || !state.ready) throw new Error('WhatsApp bağlı değil');
  return client.sendText(toJid(number), text);
}

exports.start = start;
exports.stop = stop;
exports.sendMessage = sendMessage;
exports.getStatus = () => ({ ...state });
exports.isReady = () => state.ready;
exports.onQR = (fn) => listeners.qr.push(fn);
exports.onStatus = (fn) => listeners.status.push(fn);
