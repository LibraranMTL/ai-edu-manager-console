const { contextBridge, ipcRenderer } = require('electron');

function send(channel, ...args) {
  return ipcRenderer.sendSync(channel, ...args);
}

contextBridge.exposeInMainWorld('licenseAdmin', {
  getAppInfo() {
    return send('license:getAppInfo');
  },
  listRecords(query) {
    return send('license:listRecords', query);
  },
  issue(input) {
    return send('license:issue', input);
  },
  updateRecordStatus(id, status) {
    return send('license:updateRecordStatus', id, status);
  },
  copyText(text) {
    return send('license:copyText', text);
  },
  validateCode(code) {
    return send('license:validateCode', code);
  },
  exportCsv(query) {
    return send('license:exportCsv', query);
  },
  exportJson(query) {
    return send('license:exportJson', query);
  },
  openRecordsFolder() {
    return send('license:openRecordsFolder');
  },
  keyStatus() { return ipcRenderer.invoke('license:keyStatus'); },
  createPlatformKey(keyId) { return ipcRenderer.invoke('license:createPlatformKey', keyId); },
  importPlatformKey(keyId) { return ipcRenderer.invoke('license:importPlatformKey', keyId); },
  selectPlatformKey(keyId) { return ipcRenderer.invoke('license:selectPlatformKey', keyId); },
  exportTrustBundle() { return ipcRenderer.invoke('license:exportTrustBundle'); },
  createKeyBackup(password) { return ipcRenderer.invoke('license:createKeyBackup', password); },
  restoreKeyBackup(password, drill) { return ipcRenderer.invoke('license:restoreKeyBackup', password, drill); },
  revokePlatformKey(keyId, reason) { return ipcRenderer.invoke('license:revokePlatformKey', keyId, reason); },
});
