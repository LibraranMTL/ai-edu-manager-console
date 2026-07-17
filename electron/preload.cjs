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
  getCaptureCenterState() {
    return ipcRenderer.sendSync('bridge:getCaptureCenterState');
  },
  listCaptureSources() {
    return ipcRenderer.invoke('bridge:listCaptureSources');
  },
  startCaptureSession(optionsJson) {
    return ipcRenderer.invoke('bridge:startCaptureSession', optionsJson);
  },
  pauseCaptureSession(sessionId) {
    return ipcRenderer.invoke('bridge:pauseCaptureSession', sessionId);
  },
  resumeCaptureSession(sessionId) {
    return ipcRenderer.invoke('bridge:resumeCaptureSession', sessionId);
  },
  highlightCaptureSession(sessionId) {
    return ipcRenderer.invoke('bridge:highlightCaptureSession', sessionId);
  },
  stopCaptureSession(sessionId) {
    return ipcRenderer.invoke('bridge:stopCaptureSession', sessionId);
  },
  promoteCaptureSession(sessionId) {
    return ipcRenderer.invoke('bridge:promoteCaptureSession', sessionId);
  },
  openCaptureInbox(sessionId) {
    return ipcRenderer.sendSync('bridge:openCaptureInbox', sessionId);
  },
  getAssetIndex() {
    return ipcRenderer.sendSync('bridge:getAssetIndex');
  },
  rebuildAssetIndex() {
    return ipcRenderer.sendSync('bridge:rebuildAssetIndex');
  },
  analyzeAssetGovernance() {
    return ipcRenderer.sendSync('bridge:analyzeAssetGovernance');
  },
  cleanupAssetReferences(assetId) {
    return ipcRenderer.sendSync('bridge:cleanupAssetReferences', assetId);
  },
  createAssetVersionSnapshot(assetId) {
    return ipcRenderer.sendSync('bridge:createAssetVersionSnapshot', assetId);
  },
  markAssetGovernanceDecision(assetId, decision, note) {
    return ipcRenderer.sendSync('bridge:markAssetGovernanceDecision', assetId, decision, note);
  },
  generateKnowledgeArchitectureReport() {
    return ipcRenderer.sendSync('bridge:generateKnowledgeArchitectureReport');
  },
  getProjects() {
    return ipcRenderer.sendSync('bridge:getProjects');
  },
  createProject(optionsJson) {
    return ipcRenderer.sendSync('bridge:createProject', optionsJson);
  },
  updateProjectMetadata(projectId, metadataJson) {
    return ipcRenderer.sendSync('bridge:updateProjectMetadata', projectId, metadataJson);
  },
  removeProjectRecord(projectId) {
    return ipcRenderer.sendSync('bridge:removeProjectRecord', projectId);
  },
  relocateProjectWorkspace(projectId) {
    return ipcRenderer.sendSync('bridge:relocateProjectWorkspace', projectId);
  },
  getRemovedProjects() {
    return ipcRenderer.sendSync('bridge:getRemovedProjects');
  },
  restoreRemovedProject(snapshotPath) {
    return ipcRenderer.sendSync('bridge:restoreRemovedProject', snapshotPath);
  },
  exportProjectPackage(projectId) {
    return ipcRenderer.sendSync('bridge:exportProjectPackage', projectId);
  },
  importProjectPackage() {
    return ipcRenderer.sendSync('bridge:importProjectPackage');
  },
  duplicateProject(projectId, name) {
    return ipcRenderer.sendSync('bridge:duplicateProject', projectId, name);
  },
  updateProjectStudentEvidence(projectId, studentId, evidenceJson) {
    return ipcRenderer.sendSync('bridge:updateProjectStudentEvidence', projectId, studentId, evidenceJson);
  },
  buildCrossProjectKnowledgeIndex() {
    return ipcRenderer.sendSync('bridge:buildCrossProjectKnowledgeIndex');
  },
  pickProjectWorkspaceDir() {
    return ipcRenderer.sendSync('bridge:pickProjectWorkspaceDir');
  },
  updateProjectStatus(projectId, status) {
    return ipcRenderer.sendSync('bridge:updateProjectStatus', projectId, status);
  },
  updateProjectStudents(projectId, studentIdsJson) {
    return ipcRenderer.sendSync('bridge:updateProjectStudents', projectId, studentIdsJson);
  },
  applyProjectWorkspaceTemplate(projectId, templateId, foldersJson, templateName, templateV2Json) {
    return ipcRenderer.sendSync('bridge:applyProjectWorkspaceTemplate', projectId, templateId, foldersJson, templateName, templateV2Json);
  },
  openProjectSpace(projectId, space) {
    return ipcRenderer.sendSync('bridge:openProjectSpace', projectId, space);
  },
  scanProjectWorkspace(projectId) {
    return ipcRenderer.sendSync('bridge:scanProjectWorkspace', projectId);
  },
  reviewProjectStagingItems(projectId, itemIdsJson, decision, sourceStrategy, note) {
    return ipcRenderer.sendSync('bridge:reviewProjectStagingItems', projectId, itemIdsJson, decision, sourceStrategy, note);
  },
  getProjectKnowledgeReview(projectId) {
    return ipcRenderer.sendSync('bridge:getProjectKnowledgeReview', projectId);
  },
  updateProjectKnowledgeReview(projectId, recordIdsJson, status, note) {
    return ipcRenderer.sendSync('bridge:updateProjectKnowledgeReview', projectId, recordIdsJson, status, note);
  },
  importProjectAssets(projectId, assetIdsJson) {
    return ipcRenderer.sendSync('bridge:importProjectAssets', projectId, assetIdsJson);
  },
  importProjectRawFiles(projectId) {
    return ipcRenderer.sendSync('bridge:importProjectRawFiles', projectId);
  },
  getProjectDigestCommand(projectId) {
    return ipcRenderer.sendSync('bridge:getProjectDigestCommand', projectId);
  },
  markProjectDigestSubmitted(projectId) {
    return ipcRenderer.sendSync('bridge:markProjectDigestSubmitted', projectId);
  },
  syncProjectDigestResult(projectId) {
    return ipcRenderer.sendSync('bridge:syncProjectDigestResult', projectId);
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
  analyzeProjectStagingGovernance(projectId) {
    return ipcRenderer.sendSync('bridge:analyzeProjectStagingGovernance', projectId);
  },
  generateProjectPromotion(projectId) {
    return ipcRenderer.sendSync('bridge:generateProjectPromotion', projectId);
  },
  getProjectPromotionPlan(projectId) {
    return ipcRenderer.sendSync('bridge:getProjectPromotionPlan', projectId);
  },
  getProjectPromotionAudit(projectId) {
    return ipcRenderer.sendSync('bridge:getProjectPromotionAudit', projectId);
  },
  executeProjectPromotionPlan(projectId, planJson) {
    return ipcRenderer.sendSync('bridge:executeProjectPromotionPlan', projectId, planJson);
  },
  publishProjectPromotion(projectId) {
    return ipcRenderer.sendSync('bridge:publishProjectPromotion', projectId);
  },
  rollbackProjectPromotionRun(projectId, runId) {
    return ipcRenderer.sendSync('bridge:rollbackProjectPromotionRun', projectId, runId);
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
  checkStudentPathHealth(studentId) {
    return ipcRenderer.sendSync('bridge:checkStudentPathHealth', studentId);
  },
  repairStudentStalePaths(studentId) {
    return ipcRenderer.sendSync('bridge:repairStudentStalePaths', studentId);
  },
  checkAllStudentsPathHealth() {
    return ipcRenderer.sendSync('bridge:checkAllStudentsPathHealth');
  },
  resolveStudentPath(studentId, logicalPath) {
    return ipcRenderer.sendSync('bridge:resolveStudentPath', studentId, logicalPath);
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
  getGrowthEvidenceReview(studentId) {
    return ipcRenderer.sendSync('bridge:getGrowthEvidenceReview', studentId);
  },
  updateGrowthEvidenceStatus(studentId, evidenceId, status, note) {
    return ipcRenderer.sendSync('bridge:updateGrowthEvidenceStatus', studentId, evidenceId, status, note);
  },
  rebuildGrowthIndex(studentId) {
    return ipcRenderer.sendSync('bridge:rebuildGrowthIndex', studentId);
  },
  getGrowthIndex(studentId) {
    return ipcRenderer.sendSync('bridge:getGrowthIndex', studentId);
  },
  getStudents() {
    return ipcRenderer.sendSync('bridge:getStudents');
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
  recordScheduledTaskAction(studentId, kind, commandText) {
    return ipcRenderer.sendSync('bridge:recordScheduledTaskAction', studentId, kind, commandText);
  },
  getStudentScheduleLedger(studentId) {
    return ipcRenderer.sendSync('bridge:getStudentScheduleLedger', studentId);
  },
  getTaskCenter() {
    return ipcRenderer.sendSync('bridge:getTaskCenter');
  },
  getTaskCenterCapabilities() {
    return ipcRenderer.sendSync('bridge:getTaskCenterCapabilities');
  },
  setTaskAutomationEnabled(enabled) {
    return ipcRenderer.sendSync('bridge:setTaskAutomationEnabled', enabled);
  },
  executeTask(taskId, executor) {
    return ipcRenderer.sendSync('bridge:executeTask', taskId, executor);
  },
  approveTask(taskId, decision, note) {
    return ipcRenderer.sendSync('bridge:approveTask', taskId, decision, note);
  },
  retryTask(taskId) {
    return ipcRenderer.sendSync('bridge:retryTask', taskId);
  },
  cancelTask(taskId, note) {
    return ipcRenderer.sendSync('bridge:cancelTask', taskId, note);
  },
  importTaskResult(taskId) {
    return ipcRenderer.sendSync('bridge:importTaskResult', taskId);
  },
  syncQClawTaskResults() {
    return ipcRenderer.sendSync('bridge:syncQClawTaskResults');
  },
  submitDailyActionFeedback(taskId, status, note) {
    return ipcRenderer.sendSync('bridge:submitDailyActionFeedback', taskId, status, note);
  },
  openTaskCenterPath(kind) {
    return ipcRenderer.sendSync('bridge:openTaskCenterPath', kind);
  },
  generateStudentMaintenanceReport(studentId) {
    return ipcRenderer.sendSync('bridge:generateStudentMaintenanceReport', studentId);
  },
  getHostTimeline() {
    return ipcRenderer.sendSync('bridge:getHostTimeline');
  },
  backupHostData(studentsJson) {
    return ipcRenderer.sendSync('bridge:backupHostData', studentsJson);
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
  restoreHostDevice(deviceId) {
    return ipcRenderer.sendSync('bridge:restoreHostDevice', deviceId);
  },
  deleteHostDevice(deviceId) {
    return ipcRenderer.sendSync('bridge:deleteHostDevice', deviceId);
  },
  setHostDeviceStudentAccess(deviceId, studentIdsJson) {
    return ipcRenderer.sendSync('bridge:setHostDeviceStudentAccess', deviceId, studentIdsJson);
  },
  setHostDeviceAccessMode(deviceId, optionsJson) {
    return ipcRenderer.sendSync('bridge:setHostDeviceAccessMode', deviceId, optionsJson);
  },
});
