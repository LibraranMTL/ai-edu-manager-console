const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('AndroidBridge', {
  copyText(value) {
    ipcRenderer.send('bridge:copyText', value);
  },
  exportTextFile(filename, content) {
    return ipcRenderer.sendSync('bridge:exportTextFile', filename, content);
  },
  importFiles(studentName) {
    return ipcRenderer.sendSync('bridge:importFiles', studentName);
  },
  initStudentWorkspace(studentName, agentMd, indexMd, logMd) {
    return ipcRenderer.sendSync('bridge:initStudentWorkspace', studentName, agentMd, indexMd, logMd);
  },
  openApp(app) {
    return ipcRenderer.sendSync('bridge:openApp', app);
  },
  openExternalUrl(url) {
    return ipcRenderer.sendSync('bridge:openExternalUrl', url);
  },
  getAppStatus() {
    return ipcRenderer.sendSync('bridge:getAppStatus');
  },
  getStorageConfig() {
    return ipcRenderer.sendSync('bridge:getStorageConfig');
  },
  getAgentToolInstallStatus() {
    return ipcRenderer.sendSync('bridge:getAgentToolInstallStatus');
  },
  checkUpdate(manifestUrl, currentVersionCode) {
    return ipcRenderer.sendSync('bridge:checkUpdate', manifestUrl, currentVersionCode);
  },
  downloadAndInstallUpdate(apkUrl) {
    return ipcRenderer.sendSync('bridge:downloadAndInstallUpdate', apkUrl);
  },
  pickArchiveRoot() {
    return ipcRenderer.sendSync('bridge:pickArchiveRoot');
  },
  getArchiveRootStatus() {
    return ipcRenderer.sendSync('bridge:getArchiveRootStatus');
  },
  listMarkdownFiles(studentName) {
    return ipcRenderer.sendSync('bridge:listMarkdownFiles', studentName);
  },
  readMarkdownFile(documentId) {
    return ipcRenderer.sendSync('bridge:readMarkdownFile', documentId);
  },
  syncStudents(studentsJson) {
    return ipcRenderer.sendSync('bridge:syncStudents', studentsJson);
  },
  selectKnowledgeBaseRoot() {
    return ipcRenderer.sendSync('bridge:selectKnowledgeBaseRoot');
  },
  scanKnowledgeBase(rootPath, studentName) {
    return ipcRenderer.sendSync('bridge:scanKnowledgeBase', rootPath, studentName);
  },
  ensureAdoptedKnowledgeBase(optionsJson) {
    return ipcRenderer.sendSync('bridge:ensureAdoptedKnowledgeBase', optionsJson);
  },
  getHostServiceStatus() {
    return ipcRenderer.sendSync('bridge:getHostServiceStatus');
  },
  getHostServiceDiagnostics() {
    return ipcRenderer.sendSync('bridge:getHostServiceDiagnostics');
  },
  repairHostService() {
    return ipcRenderer.sendSync('bridge:repairHostService');
  },
  startHostService() {
    return ipcRenderer.sendSync('bridge:startHostService');
  },
  stopHostService() {
    return ipcRenderer.sendSync('bridge:stopHostService');
  },
  setHostServicePort(port) {
    return ipcRenderer.sendSync('bridge:setHostServicePort', port);
  },
  getHostConnectionInfo() {
    return ipcRenderer.sendSync('bridge:getHostConnectionInfo');
  },
  getHostDevices() {
    return ipcRenderer.sendSync('bridge:getHostDevices');
  },
  getHostUploadRecords() {
    return ipcRenderer.sendSync('bridge:getHostUploadRecords');
  },
  exportHostUploadRecords() {
    return ipcRenderer.sendSync('bridge:exportHostUploadRecords');
  },
  openHostUploadRecord(recordId) {
    return ipcRenderer.sendSync('bridge:openHostUploadRecord', recordId);
  },
  clearHostUploadRecords() {
    return ipcRenderer.sendSync('bridge:clearHostUploadRecords');
  },
  setHostUploadRecordStatus(recordId, status) {
    return ipcRenderer.sendSync('bridge:setHostUploadRecordStatus', recordId, status);
  },
  markStudentDigestSubmitted(studentId) {
    return ipcRenderer.sendSync('bridge:markStudentDigestSubmitted', studentId);
  },
  syncStudentDigestResult(studentId) {
    return ipcRenderer.sendSync('bridge:syncStudentDigestResult', studentId);
  },
  getHostTimeline() {
    return ipcRenderer.sendSync('bridge:getHostTimeline');
  },
  backupHostData() {
    return ipcRenderer.sendSync('bridge:backupHostData');
  },
  restoreHostData() {
    return ipcRenderer.sendSync('bridge:restoreHostData');
  },
  resetHostApiToken() {
    return ipcRenderer.sendSync('bridge:resetHostApiToken');
  },
  exportHostLogs() {
    return ipcRenderer.sendSync('bridge:exportHostLogs');
  },
  openStudentRawDir(studentId) {
    return ipcRenderer.sendSync('bridge:openStudentRawDir', studentId);
  },
  migrateStudentWorkspace(studentId, newName) {
    return ipcRenderer.sendSync('bridge:migrateStudentWorkspace', studentId, newName);
  },
  renameHostDevice(deviceId, name) {
    return ipcRenderer.sendSync('bridge:renameHostDevice', deviceId, name);
  },
  revokeHostDevice(deviceId) {
    return ipcRenderer.sendSync('bridge:revokeHostDevice', deviceId);
  },
  setHostDeviceStudentAccess(deviceId, studentIdsJson) {
    return ipcRenderer.sendSync('bridge:setHostDeviceStudentAccess', deviceId, studentIdsJson);
  },
  setHostDeviceAccessMode(deviceId, optionsJson) {
    return ipcRenderer.sendSync('bridge:setHostDeviceAccessMode', deviceId, optionsJson);
  },
});
