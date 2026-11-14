'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('studentCompanion', {
  action: (action) => ipcRenderer.invoke('terminal:companion-action', action),
  onState: (handler) => {
    const listener = (_event, state) => handler(state);
    ipcRenderer.on('terminal-companion:state', listener);
    return () => ipcRenderer.removeListener('terminal-companion:state', listener);
  },
});
