'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('learningMode', {
  info: () => ipcRenderer.invoke('learning-mode:window-info'),
  command: (action, input) => ipcRenderer.invoke('learning-mode:window-command', action, input),
});
