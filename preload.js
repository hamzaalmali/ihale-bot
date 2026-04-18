const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (cfg) => ipcRenderer.invoke('config:set', cfg),

  startWhatsApp: () => ipcRenderer.invoke('wa:start'),
  stopWhatsApp: () => ipcRenderer.invoke('wa:stop'),
  whatsappStatus: () => ipcRenderer.invoke('wa:status'),
  testWhatsApp: (number, text) => ipcRenderer.invoke('wa:test', number, text),
  listGroups: () => ipcRenderer.invoke('wa:groups'),
  testAi: (provider, apiKey, model) => ipcRenderer.invoke('ai:test', { provider, apiKey, model }),
  listAiModels: (provider, apiKey) => ipcRenderer.invoke('ai:list-models', { provider, apiKey }),

  startMonitor: () => ipcRenderer.invoke('monitor:start'),
  stopMonitor: () => ipcRenderer.invoke('monitor:stop'),
  monitorStatus: () => ipcRenderer.invoke('monitor:status'),
  runOnce: () => ipcRenderer.invoke('monitor:runOnce'),
  getMatches: () => ipcRenderer.invoke('monitor:matches'),
  clearSeen: () => ipcRenderer.invoke('monitor:clearSeen'),
  clearMatches: () => ipcRenderer.invoke('monitor:clearMatches'),

  checkUpdates: () => ipcRenderer.invoke('updater:check'),
  updaterState: () => ipcRenderer.invoke('updater:state'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  appVersion: () => ipcRenderer.invoke('app:version'),

  onQR: (cb) => ipcRenderer.on('wa:qr', (_e, qr) => cb(qr)),
  onWAStatus: (cb) => ipcRenderer.on('wa:status', (_e, s) => cb(s)),
  onLog: (cb) => ipcRenderer.on('monitor:log', (_e, l) => cb(l)),
  onMatch: (cb) => ipcRenderer.on('monitor:match', (_e, m) => cb(m)),
  onUpdater: (cb) => ipcRenderer.on('updater:status', (_e, s) => cb(s)),
});
