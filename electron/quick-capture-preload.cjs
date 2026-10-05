'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('QuickCapture', {
  invoke(action) { return ipcRenderer.invoke('quick-capture:action', String(action || '')); },
  onState(callback) {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('quick-capture:state', listener);
    return () => ipcRenderer.removeListener('quick-capture:state', listener);
  },
});
