// electron-updater sarmalayıcı
// Dev modunda (paketlenmemiş) hiçbir şey yapmaz; paketlenmiş exe'de
// GitHub Releases'ten latest.yml'ı okur ve yeni versiyon varsa indirip kurar.

const { app } = require('electron');

let autoUpdater = null;
let listeners = { status: [] };
let state = { stage: 'idle', version: null, progress: 0, error: null, releaseNotes: null };

function emit() {
  for (const fn of listeners.status) {
    try { fn({ ...state }); } catch (_) {}
  }
}

function init() {
  if (autoUpdater) return autoUpdater;
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (e) {
    state.stage = 'disabled';
    state.error = 'electron-updater yüklü değil: ' + e.message;
    emit();
    return null;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    state = { ...state, stage: 'checking', error: null };
    emit();
  });
  autoUpdater.on('update-available', (info) => {
    state = { ...state, stage: 'available', version: info?.version, releaseNotes: info?.releaseNotes };
    emit();
  });
  autoUpdater.on('update-not-available', (info) => {
    state = { ...state, stage: 'up-to-date', version: info?.version };
    emit();
  });
  autoUpdater.on('download-progress', (p) => {
    state = { ...state, stage: 'downloading', progress: Math.round(p.percent || 0) };
    emit();
  });
  autoUpdater.on('update-downloaded', (info) => {
    state = { ...state, stage: 'downloaded', version: info?.version, progress: 100 };
    emit();
  });
  autoUpdater.on('error', (err) => {
    state = { ...state, stage: 'error', error: err?.message || String(err) };
    emit();
  });

  return autoUpdater;
}

async function checkForUpdates({ silent = false } = {}) {
  if (!app.isPackaged) {
    state = { stage: 'disabled', version: app.getVersion(), progress: 0, error: 'dev modu', releaseNotes: null };
    emit();
    return state;
  }
  const up = init();
  if (!up) return state;
  try {
    const result = await up.checkForUpdates();
    return result;
  } catch (err) {
    state = { ...state, stage: 'error', error: err.message };
    emit();
    if (!silent) throw err;
  }
}

function installAndRestart() {
  if (!autoUpdater) return;
  // true = isSilent, false = isForceRunAfter (macOS)
  autoUpdater.quitAndInstall(false, true);
}

function getState() { return { ...state, currentVersion: app.getVersion() }; }
function onStatus(fn) { listeners.status.push(fn); }

module.exports = { init, checkForUpdates, installAndRestart, getState, onStatus };
