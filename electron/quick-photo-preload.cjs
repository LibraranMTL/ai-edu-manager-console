'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const invoke = (action, input) => ipcRenderer.invoke('quick-photo:action', action, input).then(value => typeof value === 'string' ? JSON.parse(value) : value);
contextBridge.exposeInMainWorld('QuickPhoto', {
  context: () => invoke('context'),
  camera: () => invoke('camera'),
  save: input => invoke('save', input),
  close: () => invoke('close'),
});
