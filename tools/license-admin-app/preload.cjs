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
});
