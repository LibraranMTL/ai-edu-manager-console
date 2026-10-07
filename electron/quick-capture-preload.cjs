'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const result = value => typeof value === 'string' ? JSON.parse(value) : value;

contextBridge.exposeInMainWorld('QuickCapture', {
  invoke(action, input) { return ipcRenderer.invoke('quick-capture:action', String(action || ''), input).then(result); },
  onState(callback) {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('quick-capture:state', listener);
    return () => ipcRenderer.removeListener('quick-capture:state', listener);
  },
});
