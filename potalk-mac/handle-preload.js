const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('peekPm', {
  toggle: () => ipcRenderer.send('peek:toggle'),
  onState: f => ipcRenderer.on('peek:state', (_e, s) => f(s)),
  onTheme: f => ipcRenderer.on('handle:theme', (_e, t) => f(t)),
});
