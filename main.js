const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const storage = require('./src/storage');
const monitor = require('./src/monitor');
const wa = require('./src/whatsapp');
const updater = require('./src/updater');

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: 'Baratoprak Enerji İhale Bot',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function sendToUI(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

app.whenReady().then(() => {
  createWindow();

  wa.onQR((qr) => sendToUI('wa:qr', qr));
  wa.onStatus((status) => sendToUI('wa:status', status));
  monitor.onLog((log) => sendToUI('monitor:log', log));
  monitor.onMatch((match) => sendToUI('monitor:match', match));

  // Güncelleme kontrolü: açılıştan 2 saniye sonra + her 4 saatte bir
  updater.onStatus((s) => sendToUI('updater:status', s));
  setTimeout(() => updater.checkForUpdates({ silent: true }).catch(() => {}), 2000);
  setInterval(() => updater.checkForUpdates({ silent: true }).catch(() => {}), 4 * 60 * 60 * 1000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', async () => {
  try { await wa.stop(); } catch (_) {}
  try { monitor.stop(); } catch (_) {}
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('config:get', () => storage.getConfig());
ipcMain.handle('config:set', (_e, cfg) => storage.setConfig(cfg));

ipcMain.handle('wa:start', () => wa.start());
ipcMain.handle('wa:stop', () => wa.stop());
ipcMain.handle('wa:status', () => wa.getStatus());
ipcMain.handle('wa:test', (_e, number, text) => wa.sendMessage(number, text));

ipcMain.handle('monitor:start', () => monitor.start());
ipcMain.handle('monitor:stop', () => monitor.stop());
ipcMain.handle('monitor:status', () => monitor.getStatus());
ipcMain.handle('monitor:runOnce', () => monitor.runOnce());
ipcMain.handle('monitor:matches', () => storage.getMatches());
ipcMain.handle('monitor:clearSeen', () => storage.clearSeen());

ipcMain.handle('updater:check', () => updater.checkForUpdates({ silent: false }));
ipcMain.handle('updater:state', () => updater.getState());
ipcMain.handle('updater:install', () => updater.installAndRestart());
ipcMain.handle('app:version', () => app.getVersion());
