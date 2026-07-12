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
  pickMaterialSourceDir() {
    return ipcRenderer.sendSync('bridge:pickMaterialSourceDir');
  },
  scanMaterialSources(studentId, sourcesJson) {
    return ipcRenderer.sendSync('bridge:scanMaterialSources', studentId, sourcesJson);
  },
  importMaterialSourceFiles(studentId, pathsJson) {
    return ipcRenderer.sendSync('bridge:importMaterialSourceFiles', studentId, pathsJson);
  },
  getMaterialImportRecords(studentId) {
    return ipcRenderer.sendSync('bridge:getMaterialImportRecords', studentId);
  },
  getAssetIndex() {
    return ipcRenderer.sendSync('bridge:getAssetIndex');
  },
  rebuildAssetIndex() {
    return ipcRenderer.sendSync('bridge:rebuildAssetIndex');
  },
  getProjects() {
    return ipcRenderer.sendSync('bridge:getProjects');
  },
  createProject(optionsJson) {
    return ipcRenderer.sendSync('bridge:createProject', optionsJson);
  },
  updateProjectStatus(projectId, status) {
    return ipcRenderer.sendSync('bridge:updateProjectStatus', projectId, status);
  },
  updateProjectStudents(projectId, studentIdsJson) {
    return ipcRenderer.sendSync('bridge:updateProjectStudents', projectId, studentIdsJson);
  },
  importProjectAssets(projectId, assetIdsJson) {
    return ipcRenderer.sendSync('bridge:importProjectAssets', projectId, assetIdsJson);
  },
  importProjectStagingFiles(projectId) {
    return ipcRenderer.sendSync('bridge:importProjectStagingFiles', projectId);
  },
  updateProjectStagingStatus(projectId, itemIdsJson, status) {
    return ipcRenderer.sendSync('bridge:updateProjectStagingStatus', projectId, itemIdsJson, status);
  },
  promoteProjectStagingItems(projectId, itemIdsJson) {
    return ipcRenderer.sendSync('bridge:promoteProjectStagingItems', projectId, itemIdsJson);
  },
  importProjectStagingAiScreening(projectId) {
    return ipcRenderer.sendSync('bridge:importProjectStagingAiScreening', projectId);
  },
  generateProjectPromotion(projectId) {
    return ipcRenderer.sendSync('bridge:generateProjectPromotion', projectId);
  },
  getProjectPromotionPlan(projectId) {
    return ipcRenderer.sendSync('bridge:getProjectPromotionPlan', projectId);
  },
  executeProjectPromotionPlan(projectId, planJson) {
    return ipcRenderer.sendSync('bridge:executeProjectPromotionPlan', projectId, planJson);
  },
  publishProjectPromotion(projectId) {
    return ipcRenderer.sendSync('bridge:publishProjectPromotion', projectId);
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
  getTemplateCenter(systemTemplatesJson) {
    return ipcRenderer.sendSync('bridge:getTemplateCenter', systemTemplatesJson);
  },
  saveCustomTemplates(templatesJson) {
    return ipcRenderer.sendSync('bridge:saveCustomTemplates', templatesJson);
  },
  restoreSystemTemplates(systemTemplatesJson) {
    return ipcRenderer.sendSync('bridge:restoreSystemTemplates', systemTemplatesJson);
  },
  getAgentCenter(studentId) {
    return ipcRenderer.sendSync('bridge:getAgentCenter', studentId);
  },
  saveAgentMemorySource(studentId, tool, content, mode) {
    return ipcRenderer.sendSync('bridge:saveAgentMemorySource', studentId, tool, content, mode);
  },
  mergeAgentMemory(studentId) {
    return ipcRenderer.sendSync('bridge:mergeAgentMemory', studentId);
  },
  saveUnifiedMemory(studentId, content) {
    return ipcRenderer.sendSync('bridge:saveUnifiedMemory', studentId, content);
  },
  saveAgentSoulSource(studentId, tool, content) {
    return ipcRenderer.sendSync('bridge:saveAgentSoulSource', studentId, tool, content);
  },
  saveUnifiedSoul(studentId, content) {
    return ipcRenderer.sendSync('bridge:saveUnifiedSoul', studentId, content);
  },
  compareAgentSoulSource(studentId, tool) {
    return ipcRenderer.sendSync('bridge:compareAgentSoulSource', studentId, tool);
  },
  scanAgentKnowledgeFiles(studentId) {
    return ipcRenderer.sendSync('bridge:scanAgentKnowledgeFiles', studentId);
  },
  importAgentKnowledgeFile(studentId, filePath, tool, kind) {
    return ipcRenderer.sendSync('bridge:importAgentKnowledgeFile', studentId, filePath, tool, kind);
  },
  getAgentRules(studentId) {
    return ipcRenderer.sendSync('bridge:getAgentRules', studentId);
  },
  saveAgentRuleFile(studentId, fileName, content) {
    return ipcRenderer.sendSync('bridge:saveAgentRuleFile', studentId, fileName, content);
  },
  generateAgentRuleFile(studentId, fileName) {
    return ipcRenderer.sendSync('bridge:generateAgentRuleFile', studentId, fileName);
  },
  compareAgentRuleFiles(studentId, baseName, targetName) {
    return ipcRenderer.sendSync('bridge:compareAgentRuleFiles', studentId, baseName, targetName);
  },
  getAgentSourceRegistry(studentId) {
    return ipcRenderer.sendSync('bridge:getAgentSourceRegistry', studentId);
  },
  rollbackAgentSourceRecord(studentId, recordId) {
    return ipcRenderer.sendSync('bridge:rollbackAgentSourceRecord', studentId, recordId);
  },
  getAgentConversationCenter(studentId) {
    return ipcRenderer.sendSync('bridge:getAgentConversationCenter', studentId);
  },
  saveAgentConversationImport(studentId, content, tool, sourcePath) {
    return ipcRenderer.sendSync('bridge:saveAgentConversationImport', studentId, content, tool, sourcePath);
  },
  selectAgentConversationFiles(studentId, tool) {
    return ipcRenderer.sendSync('bridge:selectAgentConversationFiles', studentId, tool);
  },
  saveConversationExtract(studentId, extractJson, tool) {
    return ipcRenderer.sendSync('bridge:saveConversationExtract', studentId, extractJson, tool);
  },
  openStudentRootDir(studentId) {
    return ipcRenderer.sendSync('bridge:openStudentRootDir', studentId);
  },
  getLicenseStatus() {
    return ipcRenderer.sendSync('bridge:getLicenseStatus');
  },
  activateLicense(code) {
    return ipcRenderer.sendSync('bridge:activateLicense', code);
  },
  deactivateLicense() {
    return ipcRenderer.sendSync('bridge:deactivateLicense');
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
  listLearningReports(studentId) {
    return ipcRenderer.sendSync('bridge:listLearningReports', studentId);
  },
  readLearningReport(studentId, reportId) {
    return ipcRenderer.sendSync('bridge:readLearningReport', studentId, reportId);
  },
  ensureLearningReports(studentId) {
    return ipcRenderer.sendSync('bridge:ensureLearningReports', studentId);
  },
  ensureGrowthModel(studentId) {
    return ipcRenderer.sendSync('bridge:ensureGrowthModel', studentId);
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
