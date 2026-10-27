const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('shellPm', {
  select: t => ipcRenderer.send('shell:select', t),
  mode: () => ipcRenderer.send('shell:mode'),
  onState: f => ipcRenderer.on('shell:state', (_e, s) => f(s)),
});
