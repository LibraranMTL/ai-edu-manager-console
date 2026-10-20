'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('CompanionPopover', {
  invoke(action, input) { return ipcRenderer.invoke('companion-popover:action', String(action || ''), input || {}); },
  onState(callback) {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('companion-popover:state', listener);
    return () => ipcRenderer.removeListener('companion-popover:state', listener);
  },
});
