const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('AndroidBridge', {
  showQuickCapture() { return ipcRenderer.invoke('bridge:showQuickCapture'); },
  setQuickCaptureContext(studentId) { return ipcRenderer.invoke('bridge:setQuickCaptureContext', studentId); },
  onQuickCaptureNavigate(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('quick-capture:navigate', listener);
    return () => ipcRenderer.removeListener('quick-capture:navigate', listener);
  },
  getDownloadInboxSettings() { return ipcRenderer.invoke('bridge:getDownloadInboxSettings'); },
  smartInboxAction(action, input) { return ipcRenderer.invoke('bridge:smartInboxAction', action, input); },
  agentControlAction(action, input) { return ipcRenderer.invoke('bridge:agentControlAction', action, input); },
  onSmartInboxChanged(callback) {
    const listener = () => callback(); ipcRenderer.on('smart-inbox:changed', listener);
    return () => ipcRenderer.removeListener('smart-inbox:changed', listener);
  },
  configureDownloadInbox(action) { return ipcRenderer.invoke('bridge:configureDownloadInbox', action); },
  listDownloadInboxFiles() { return ipcRenderer.invoke('bridge:listDownloadInboxFiles'); },
  deliverDownloadInboxFiles(ids, target) { return ipcRenderer.invoke('bridge:deliverDownloadInboxFiles', ids, target); },
  trashDownloadInboxFiles(ids) { return ipcRenderer.invoke('bridge:trashDownloadInboxFiles', ids); },
  openDownloadInboxFolder() { return ipcRenderer.invoke('bridge:openDownloadInboxFolder'); },
  getPracticeDashboard(id) { return ipcRenderer.invoke('bridge:getPracticeDashboard', id); },
  practiceAction(id, action, input) { return ipcRenderer.invoke('bridge:practiceAction', id, action, input); },
  publicationAction(id, action, input) { return ipcRenderer.invoke('bridge:publicationAction', id, action, input); },
  onPracticeChanged(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('onNativePracticeChanged', listener);
    return () => ipcRenderer.removeListener('onNativePracticeChanged', listener);
  },
  cancelGuidanceResearch(id) { return ipcRenderer.invoke('bridge:cancelGuidanceResearch', id); },
  exportPracticeCard(id, cardId, format) { return ipcRenderer.invoke('bridge:exportPracticeCard', id, cardId, format); },
  savePracticePlan(id, plan) { return ipcRenderer.invoke('bridge:savePracticePlan', id, plan); },
  generatePracticeCard(id) { return ipcRenderer.invoke('bridge:generatePracticeCard', id); },
  startPracticeCard(id, cardId) { return ipcRenderer.invoke('bridge:startPracticeCard', id, cardId); },
  submitPracticeAttempt(id, cardId, input) { return ipcRenderer.invoke('bridge:submitPracticeAttempt', id, cardId, input); },
  captureInboxList(id) { return ipcRenderer.invoke('bridge:captureInboxList', id); },
  getAudioTranscriptionSettings() { return ipcRenderer.invoke('bridge:getAudioTranscriptionSettings'); },
  saveAudioTranscriptionSettings(input) { return ipcRenderer.invoke('bridge:saveAudioTranscriptionSettings', input); },
  testAudioTranscription() { return ipcRenderer.invoke('bridge:testAudioTranscription'); },
  transcribeCaptureAudio(id, itemId, consent) { return ipcRenderer.invoke('bridge:transcribeCaptureAudio', id, itemId, consent); },
  openKnowledgeObsidian(kind, id) { return ipcRenderer.invoke('bridge:openKnowledgeObsidian', kind, id); },
  captureInboxInfo(id) { return ipcRenderer.invoke('bridge:captureInboxInfo', id); },
  captureInboxOpen(id) { return ipcRenderer.invoke('bridge:captureInboxOpen', id); },
  captureInboxReceive(id, input) { return ipcRenderer.invoke('bridge:captureInboxReceive', id, input); },
  captureInboxChange(id, ids, action, target) { return ipcRenderer.invoke('bridge:captureInboxChange', id, ids, action, target); },
  getCustomSubjects(id) { return ipcRenderer.invoke('bridge:getCustomSubjects', id); },
  saveCustomSubjects(id, items) { return ipcRenderer.invoke('bridge:saveCustomSubjects', id, items); },
  listCustomAgentTools() { return ipcRenderer.invoke('bridge:listCustomAgentTools'); },
  addCustomAgentTool(input) { return ipcRenderer.invoke('bridge:addCustomAgentTool', input); },
  removeCustomAgentTool(id) { return ipcRenderer.invoke('bridge:removeCustomAgentTool', id); },
  openCustomAgentTool(id) { return ipcRenderer.invoke('bridge:openCustomAgentTool', id); },
  getProjectArchiveRecoveryStatus() {
    return ipcRenderer.invoke('bridge:getProjectArchiveRecoveryStatus');
  },
  recoverProjectArchiveRuntime() {
    return ipcRenderer.invoke('bridge:recoverProjectArchiveRuntime');
  },
  copyText(value) {
    return ipcRenderer.invoke('bridge:copyText', value);
  },
  exportTextFile(filename, content) {
    return ipcRenderer.sendSync('bridge:exportTextFile', filename, content);
  },
  importFiles(studentName, targetJson) {
    return ipcRenderer.sendSync('bridge:importFiles', studentName, targetJson);
  },
  pickMaterialSourceDir() {
    return ipcRenderer.sendSync('bridge:pickMaterialSourceDir');
  },
  scanMaterialSources(studentId, sourcesJson) {
    return ipcRenderer.invoke('bridge:scanMaterialSources', studentId, sourcesJson);
  },
  importMaterialSourceFiles(studentId, pathsJson, targetJson) {
    return ipcRenderer.invoke('bridge:importMaterialSourceFiles', studentId, pathsJson, targetJson);
  },
  getMaterialImportRecords(studentId) {
    return ipcRenderer.sendSync('bridge:getMaterialImportRecords', studentId);
  },
  removeMaterialImportRecords(studentId, recordIdsJson) {
    return ipcRenderer.sendSync('bridge:removeMaterialImportRecords', studentId, recordIdsJson);
  },
  getCaptureCenterState() {
    return ipcRenderer.sendSync('bridge:getCaptureCenterState');
  },
  setCaptureVisionConsent(inputJson) {
    return ipcRenderer.sendSync('bridge:setCaptureVisionConsent', inputJson);
  },
  onCaptureChanged(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('capture:changed', listener);
    return () => ipcRenderer.removeListener('capture:changed', listener);
  },
  listCaptureSources() {
    return ipcRenderer.invoke('bridge:listCaptureSources');
  },
  getCaptureSessionSummaries(inputJson) {
    return ipcRenderer.invoke('bridge:getCaptureSessionSummaries', inputJson);
  },
  getCaptureTimelineDates(inputJson) {
    return ipcRenderer.invoke('bridge:getCaptureTimelineDates', inputJson);
  },
  getCaptureTimeline(inputJson) {
    return ipcRenderer.invoke('bridge:getCaptureTimeline', inputJson);
  },
  getCaptureTimelineSegments(inputJson) {
    return ipcRenderer.invoke('bridge:getCaptureTimelineSegments', inputJson);
  },
  getLearningAnalytics(inputJson) {
    return ipcRenderer.invoke('bridge:getLearningAnalytics', inputJson);
  },
  getCaptureTimelineProcessingState(inputJson) {
    return ipcRenderer.invoke('bridge:getCaptureTimelineProcessingState', inputJson);
  },
  retryCaptureTimelineProcessing(inputJson) {
    return ipcRenderer.invoke('bridge:retryCaptureTimelineProcessing', inputJson);
  },
  reportCaptureTimelinePerformance(inputJson) {
    return ipcRenderer.invoke('bridge:reportCaptureTimelinePerformance', inputJson);
  },
  getCaptureTimelineKnowledgeLinks(inputJson) {
    return ipcRenderer.invoke('bridge:getCaptureTimelineKnowledgeLinks', inputJson);
  },
  getCaptureThumbnail(inputJson) {
    return ipcRenderer.invoke('bridge:getCaptureThumbnail', inputJson);
  },
  openCaptureOriginal(inputJson) {
    return ipcRenderer.invoke('bridge:openCaptureOriginal', inputJson);
  },
  rebuildCaptureTimeline(inputJson) {
    return ipcRenderer.invoke('bridge:rebuildCaptureTimeline', inputJson);
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
  promoteCaptureSession(sessionId, targetMode) {
    return ipcRenderer.invoke('bridge:promoteCaptureSession', sessionId, targetMode);
  },
  deleteCaptureSession(sessionId) {
    return ipcRenderer.invoke('bridge:deleteCaptureSession', sessionId);
  },
  openCaptureInbox(sessionId) {
    return ipcRenderer.sendSync('bridge:openCaptureInbox', sessionId);
  },
  getAssetIndex() {
    return ipcRenderer.invoke('bridge:getAssetIndex');
  },
  rebuildAssetIndex() {
    return ipcRenderer.invoke('bridge:rebuildAssetIndex');
  },
  analyzeAssetGovernance() {
    return ipcRenderer.invoke('bridge:analyzeAssetGovernance');
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
    return ipcRenderer.invoke('bridge:getProjects');
  },
  getTopicSuggestions(studentId) {
    return ipcRenderer.invoke('bridge:getTopicSuggestions', studentId);
  },
  getPlanningFavorites(studentId, kind) { return ipcRenderer.invoke('bridge:getPlanningFavorites', studentId, kind); },
  setPlanningFavorite(studentId, kind, versionId, candidateId, saved) { return ipcRenderer.invoke('bridge:setPlanningFavorite', studentId, kind, versionId, candidateId, saved); },
  getCompetitionRecommendations(studentId) { return ipcRenderer.invoke('bridge:getCompetitionRecommendations', studentId); },
  refreshCompetitionRecommendations(studentId) { return ipcRenderer.invoke('bridge:refreshCompetitionRecommendations', studentId); },
  cancelCompetitionResearch(studentId) { return ipcRenderer.invoke('bridge:cancelCompetitionResearch', studentId); },
  saveCompetitionPreferences(studentId, json) { return ipcRenderer.invoke('bridge:saveCompetitionPreferences', studentId, json); },
  preparePlanningShare(studentId, kind) { return ipcRenderer.invoke('bridge:preparePlanningShare', studentId, kind); },
  publishPlanningShare(studentId, kind, expectedHash) { return ipcRenderer.invoke('bridge:publishPlanningShare', studentId, kind, expectedHash); },
  refreshTopicSuggestions(studentId, requestJson = '{}') {
    return ipcRenderer.invoke('bridge:refreshTopicSuggestions', studentId, requestJson);
  },
  prepareProjectDraftFromSuggestion(studentId, suggestionId, versionId) {
    return ipcRenderer.invoke('bridge:prepareProjectDraftFromSuggestion', studentId, suggestionId, versionId);
  },
  getGuidancePlan(studentId) {
    return ipcRenderer.invoke('bridge:getGuidancePlan', studentId);
  },
  refreshGuidancePlan(studentId, requestJson = '{}') {
    return ipcRenderer.invoke('bridge:refreshGuidancePlan', studentId, requestJson);
  },
  getGuidanceHistory(studentId) {
    return ipcRenderer.invoke('bridge:getGuidanceHistory', studentId);
  },
  saveGuidancePreferences(studentId, preferencesJson = '{}') {
    return ipcRenderer.invoke('bridge:saveGuidancePreferences', studentId, preferencesJson);
  },
  getResearchCapabilityStatus() {
    return ipcRenderer.invoke('bridge:getResearchCapabilityStatus');
  },
  getStudentOverview() {
    return ipcRenderer.invoke('bridge:getStudentOverview');
  },
  createProject(optionsJson) {
    return ipcRenderer.sendSync('bridge:createProject', optionsJson);
  },
  updateProjectMetadata(projectId, metadataJson) {
    return ipcRenderer.sendSync('bridge:updateProjectMetadata', projectId, metadataJson);
  },
  previewLearningProjectRemoval(projectId) {
    return ipcRenderer.sendSync('bridge:previewLearningProjectRemoval', projectId);
  },
  removeProjectRecord(projectId) {
    return ipcRenderer.sendSync('bridge:removeProjectRecord', projectId);
  },
  deleteLearningProject(projectId) {
    return ipcRenderer.sendSync('bridge:deleteLearningProject', projectId);
  },
  relocateProjectWorkspace(projectId) {
    return ipcRenderer.sendSync('bridge:relocateProjectWorkspace', projectId);
  },
  confirmProjectWorkspaceRelocation(projectId, workspacePath) {
    return ipcRenderer.sendSync('bridge:confirmProjectWorkspaceRelocation', projectId, workspacePath);
  },
  rollbackProjectWorkspaceRelocation(projectId) {
    return ipcRenderer.sendSync('bridge:rollbackProjectWorkspaceRelocation', projectId);
  },
  rebindProjectKnowledgeSpace(projectId) {
    return ipcRenderer.sendSync('bridge:rebindProjectKnowledgeSpace', projectId);
  },
  rebindProjectRoot(projectId) {
    return ipcRenderer.sendSync('bridge:rebindProjectRoot', projectId);
  },
  rebindProjectRaw(projectId) {
    return ipcRenderer.sendSync('bridge:rebindProjectRaw', projectId);
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
  updateProjectStudentEvidenceAsync(projectId, studentId, evidenceJson, bindingId = '') {
    return ipcRenderer.invoke('bridge:updateProjectStudentEvidenceAsync', projectId, studentId, evidenceJson, bindingId);
  },
  getProjectStudentEvidencePrompt(projectId) {
    return ipcRenderer.sendSync('bridge:getProjectStudentEvidencePrompt', projectId);
  },
  getProjectCompletionWizard(projectId) {
    return ipcRenderer.sendSync('bridge:getProjectCompletionWizard', projectId);
  },
  importProjectStudentEvidenceSuggestions(projectId, pastedText = '') {
    return ipcRenderer.sendSync('bridge:importProjectStudentEvidenceSuggestions', projectId, pastedText);
  },
  buildCrossProjectKnowledgeIndex() {
    return ipcRenderer.invoke('bridge:buildCrossProjectKnowledgeIndex');
  },
  pickProjectWorkspaceDir() {
    return ipcRenderer.sendSync('bridge:pickProjectWorkspaceDir');
  },
  pickProjectKnowledgeBaseDir() {
    return ipcRenderer.sendSync('bridge:pickProjectKnowledgeBaseDir');
  },
  inspectProjectKnowledgeBase(rootPath) {
    return ipcRenderer.sendSync('bridge:inspectProjectKnowledgeBase', rootPath);
  },
  updateProjectStatus(projectId, status) {
    return ipcRenderer.sendSync('bridge:updateProjectStatus', projectId, status);
  },
  updateProjectStudents(projectId, studentIdsJson) {
    return ipcRenderer.invoke('bridge:updateProjectStudents', projectId, studentIdsJson);
  },
  applyProjectWorkspaceTemplate(projectId, templateId, foldersJson, templateName, templateV2Json) {
    return ipcRenderer.sendSync('bridge:applyProjectWorkspaceTemplate', projectId, templateId, foldersJson, templateName, templateV2Json);
  },
  openProjectSpace(projectId, space) {
    return ipcRenderer.sendSync('bridge:openProjectSpace', projectId, space);
  },
  scanProjectWorkspace(projectId, restart = false) {
    return ipcRenderer.invoke('bridge:scanProjectWorkspace', projectId, restart);
  },
  cancelProjectWorkspaceScan(projectId) {
    return ipcRenderer.invoke('bridge:cancelProjectWorkspaceScan', projectId);
  },
  relocateProjectMaterial(projectId, materialId, expectedVersion, expectedRecordRevision) {
    return ipcRenderer.invoke('bridge:relocateProjectMaterial', projectId, materialId,
      expectedVersion, expectedRecordRevision);
  },
  onProjectWorkspaceScanProgress(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('bridge:projectWorkspaceScanProgress', listener);
    return () => ipcRenderer.removeListener('bridge:projectWorkspaceScanProgress', listener);
  },
  reviewProjectStagingItems(projectId, itemIdsJson, decision, sourceStrategy, note) {
    return ipcRenderer.invoke('bridge:reviewProjectStagingItems', projectId, itemIdsJson, decision, sourceStrategy, note);
  },
  getProjectKnowledgeReview(projectId) {
    return ipcRenderer.sendSync('bridge:getProjectKnowledgeReview', projectId);
  },
  updateProjectKnowledgeReview(projectId, recordIdsJson, status, note) {
    return ipcRenderer.sendSync('bridge:updateProjectKnowledgeReview', projectId, recordIdsJson, status, note);
  },
  getProjectUnifiedReview(projectId) {
    return ipcRenderer.sendSync('bridge:getProjectUnifiedReview', projectId);
  },
  applyProjectUnifiedReview(projectId) {
    return ipcRenderer.sendSync('bridge:applyProjectUnifiedReview', projectId);
  },
  importProjectAssets(projectId, assetIdsJson) {
    return ipcRenderer.invoke('bridge:importProjectAssets', projectId, assetIdsJson);
  },
  importProjectRawFiles(projectId) {
    return ipcRenderer.invoke('bridge:importProjectRawFiles', projectId);
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
  applyProjectDigestReceiptText(projectId, rawText) {
    return ipcRenderer.sendSync('bridge:applyProjectDigestReceiptText', projectId, rawText);
  },
  importProjectStagingFiles(projectId) {
    return ipcRenderer.invoke('bridge:importProjectStagingFiles', projectId);
  },
  updateProjectStagingStatus(projectId, itemIdsJson, status) {
    return ipcRenderer.invoke('bridge:updateProjectStagingStatus', projectId, itemIdsJson, status);
  },
  promoteProjectStagingItems(projectId, itemIdsJson) {
    return ipcRenderer.invoke('bridge:promoteProjectStagingItems', projectId, itemIdsJson);
  },
  approveAndPromoteProjectStagingItems(projectId, itemIdsJson, sourceStrategy, note) {
    return ipcRenderer.invoke('bridge:approveAndPromoteProjectStagingItems', projectId, itemIdsJson, sourceStrategy, note);
  },
  previewProjectStagingAiScreening(projectId, rawText) {
    return ipcRenderer.sendSync('bridge:previewProjectStagingAiScreening', projectId, rawText);
  },
  applyProjectStagingAiScreening(projectId, rawText) {
    return ipcRenderer.sendSync('bridge:applyProjectStagingAiScreening', projectId, rawText);
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
  deliverConversationMaterials(studentId, requestJson) {
    return ipcRenderer.invoke('bridge:deliverConversationMaterials', studentId, requestJson);
  },
  manageConversationImports(studentId, requestJson) {
    return ipcRenderer.sendSync('bridge:manageConversationImports', studentId, requestJson);
  },
  manageConversationImportsAsync(studentId, requestJson) {
    return ipcRenderer.invoke('bridge:manageConversationImportsAsync', studentId, requestJson);
  },
  importConversationShareUrl(studentId, url, tool) {
    return ipcRenderer.invoke('bridge:importConversationShareUrl', studentId, url, tool);
  },
  selectAgentConversationFiles(studentId, tool) {
    return ipcRenderer.sendSync('bridge:selectAgentConversationFiles', studentId, tool);
  },
  saveConversationExtract(studentId, extractJson, tool) {
    return ipcRenderer.sendSync('bridge:saveConversationExtract', studentId, extractJson, tool);
  },
  updateConversationKnowledgeCandidate(studentId, candidateId, action, payloadJson) {
    return ipcRenderer.sendSync('bridge:updateConversationKnowledgeCandidate', studentId, candidateId, action, payloadJson);
  },
  promoteConversationKnowledgeCandidates(studentId, requestJson) {
    return ipcRenderer.sendSync('bridge:promoteConversationKnowledgeCandidates', studentId, requestJson);
  },
  rollbackConversationPromotion(studentId, transactionId) {
    return ipcRenderer.sendSync('bridge:rollbackConversationPromotion', studentId, transactionId);
  },
  ingestKnowledgeCandidateEnvelope(studentId, envelopeJson) {
    return ipcRenderer.sendSync('bridge:ingestKnowledgeCandidateEnvelope', studentId, envelopeJson);
  },
  openStudentRootDir(studentId) {
    return ipcRenderer.sendSync('bridge:openStudentRootDir', studentId);
  },
  openGrowthModelDir(studentId) {
    return ipcRenderer.sendSync('bridge:openGrowthModelDir', studentId);
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
  importLicenseFile() {
    return ipcRenderer.sendSync('bridge:importLicenseFile');
  },
  getLicenseTrustStatus() {
    return ipcRenderer.sendSync('bridge:getLicenseTrustStatus');
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
  readMarkdownFile(studentId, documentId) {
    return ipcRenderer.sendSync('bridge:readMarkdownFile', studentId, documentId);
  },
  listProjectKnowledgeFiles(projectId) {
    return ipcRenderer.sendSync('bridge:listProjectKnowledgeFiles', projectId);
  },
  readProjectKnowledgeFile(projectId, documentId) {
    return ipcRenderer.sendSync('bridge:readProjectKnowledgeFile', projectId, documentId);
  },
  readProjectKnowledgeFileAsync(projectId, documentId) {
    return ipcRenderer.invoke('bridge:readProjectKnowledgeFileAsync', projectId, documentId);
  },
  exportProjectKnowledgeSource(projectId, documentId, knowledgeHash, materialId, version) {
    return ipcRenderer.invoke('bridge:exportProjectKnowledgeSource', projectId, documentId, knowledgeHash, materialId, version);
  },
  getProjectMaterialWorkspaceView(projectId, queryJson) {
    return ipcRenderer.invoke('bridge:getProjectMaterialWorkspaceView', projectId, queryJson);
  },
  getProjectClassificationSuggestions(projectId, queryJson) {
    return ipcRenderer.invoke('bridge:getProjectClassificationSuggestions', projectId, queryJson);
  },
  generateProjectClassificationSuggestions(projectId) {
    return ipcRenderer.invoke('bridge:generateProjectClassificationSuggestions', projectId);
  },
  applyProjectMaterialClassifications(projectId, requestJson) {
    return ipcRenderer.invoke('bridge:applyProjectMaterialClassifications', projectId, requestJson);
  },
  undoProjectMaterialClassification(projectId, operationId, idempotencyKey) {
    return ipcRenderer.invoke('bridge:undoProjectMaterialClassification', projectId, operationId, idempotencyKey);
  },
  getProjectMaterialOrganizationStatus(projectId) {
    return ipcRenderer.invoke('bridge:getProjectMaterialOrganizationStatus', projectId);
  },
  configureProjectMaterialOrganization(projectId, requestJson) {
    return ipcRenderer.invoke('bridge:configureProjectMaterialOrganization', projectId, requestJson);
  },
  runProjectMaterialOrganization(projectId, requestJson) {
    return ipcRenderer.invoke('bridge:runProjectMaterialOrganization', projectId, requestJson);
  },
  retryProjectMaterialOrganization(projectId, operationId, requestJson) {
    return ipcRenderer.invoke('bridge:retryProjectMaterialOrganization', projectId, operationId, requestJson);
  },
  undoProjectMaterialOrganization(projectId, operationId, requestJson) {
    return ipcRenderer.invoke('bridge:undoProjectMaterialOrganization', projectId, operationId, requestJson);
  },
  inspectProjectMaterialCapacityCleanup(projectId) {
    return ipcRenderer.invoke('bridge:inspectProjectMaterialCapacityCleanup', projectId);
  },
  cleanupProjectMaterialCapacity(projectId, requestJson) {
    return ipcRenderer.invoke('bridge:cleanupProjectMaterialCapacity', projectId, requestJson);
  },
  getProjectMaterialMigrationStatus(projectId) {
    return ipcRenderer.invoke('bridge:getProjectMaterialMigrationStatus', projectId);
  },
  previewProjectMaterialMigration(projectId) {
    return ipcRenderer.invoke('bridge:previewProjectMaterialMigration', projectId);
  },
  executeProjectMaterialMigration(projectId, requestJson) {
    return ipcRenderer.invoke('bridge:executeProjectMaterialMigration', projectId, requestJson);
  },
  retryProjectMaterialMigration(projectId, operationId, requestJson) {
    return ipcRenderer.invoke('bridge:retryProjectMaterialMigration', projectId, operationId, requestJson);
  },
  rollbackProjectMaterialMigration(projectId, operationId, requestJson) {
    return ipcRenderer.invoke('bridge:rollbackProjectMaterialMigration', projectId, operationId, requestJson);
  },
  inspectProjectMaterialMigrationBackups(projectId) {
    return ipcRenderer.invoke('bridge:inspectProjectMaterialMigrationBackups', projectId);
  },
  cleanupProjectMaterialMigrationBackups(projectId, requestJson) {
    return ipcRenderer.invoke('bridge:cleanupProjectMaterialMigrationBackups', projectId, requestJson);
  },
  openProjectMaterialOriginal(projectId, materialId, version) {
    return ipcRenderer.invoke('bridge:openProjectMaterialOriginal', projectId, materialId, version);
  },
  listLearningReports(studentId) {
    return ipcRenderer.sendSync('bridge:listLearningReports', studentId);
  },
  cloudReportEnrollSource(input) {
    return ipcRenderer.invoke('bridge:cloudReportEnrollSource', input);
  },
  cloudReportSetUpload(studentId, enabled) {
    return ipcRenderer.invoke('bridge:cloudReportSetUpload', studentId, enabled);
  },
  cloudReportStatus(studentId) {
    return ipcRenderer.invoke('bridge:cloudReportStatus', studentId);
  },
  cloudReportSyncNow(studentId) { return ipcRenderer.invoke('bridge:cloudReportSyncNow', studentId); },
  cloudReportSettings() { return ipcRenderer.invoke('bridge:cloudReportSettings'); },
  cloudReportSaveSettings(serverUrl) { return ipcRenderer.invoke('bridge:cloudReportSaveSettings', serverUrl); },
  cloudReportCheckConnection(serverUrl) { return ipcRenderer.invoke('bridge:cloudReportCheckConnection', serverUrl); },
  cloudReportCreatePairing(serverUrl) {
    return ipcRenderer.invoke('bridge:cloudReportCreatePairing', serverUrl);
  },
  cloudReportApprovePairing(pairingCode, studentIds) {
    return ipcRenderer.invoke('bridge:cloudReportApprovePairing', pairingCode, studentIds);
  },
  cloudReportListStudents() {
    return ipcRenderer.invoke('bridge:cloudReportListStudents');
  },
  cloudReportListReports(cloudStudentId, cursor) {
    return ipcRenderer.invoke('bridge:cloudReportListReports', cloudStudentId, cursor);
  },
  cloudReportDownload(cloudStudentId, revisionId) {
    return ipcRenderer.invoke('bridge:cloudReportDownload', cloudStudentId, revisionId);
  },
  cloudReportListDocuments(cloudStudentId, cursor = '') {
    return ipcRenderer.invoke('bridge:cloudReportListDocuments', cloudStudentId, cursor);
  },
  cloudReportDownloadDocument(cloudStudentId, documentId, reveal) {
    return ipcRenderer.invoke('bridge:cloudReportDownloadDocument', cloudStudentId, documentId, reveal);
  },
  cloudReportListCachedStudents() {
    return ipcRenderer.invoke('bridge:cloudReportListCachedStudents');
  },
  cloudReportClearCache(cloudStudentId) {
    return ipcRenderer.invoke('bridge:cloudReportClearCache', cloudStudentId);
  },
  updateLearningReports(studentId) {
    return ipcRenderer.invoke('bridge:updateLearningReports', studentId);
  },
  readLearningReport(studentId, reportId) {
    return ipcRenderer.sendSync('bridge:readLearningReport', studentId, reportId);
  },
  getLearningReportEvidence(studentId, reportId) {
    return ipcRenderer.sendSync('bridge:getLearningReportEvidence', studentId, reportId);
  },
  openLearningReportEvidenceSource(studentId, reportId, evidenceId, sourceIndex) {
    return ipcRenderer.sendSync('bridge:openLearningReportEvidenceSource', studentId, reportId, evidenceId, sourceIndex);
  },
  exportEducationArchive(studentId) {
    return ipcRenderer.sendSync('bridge:exportEducationArchive', studentId);
  },
  exportLearningReport(studentId, reportId, format) {
    return ipcRenderer.invoke('bridge:exportLearningReport', studentId, reportId, format);
  },
  getEducationPublishingState(studentId, sourceType, sourceId) {
    return ipcRenderer.sendSync('bridge:getEducationPublishingState', studentId, sourceType, sourceId);
  },
  getEducationPublicationEnhancementState(studentId, optionsJson) {
    return ipcRenderer.sendSync('bridge:getEducationPublicationEnhancementState', studentId, optionsJson);
  },
  startEducationPublicationEnhancement(studentId, optionsJson) {
    return ipcRenderer.invoke('bridge:startEducationPublicationEnhancement', studentId, optionsJson);
  },
  exportEducationPublication(studentId, optionsJson) {
    return ipcRenderer.invoke('bridge:exportEducationPublication', studentId, optionsJson);
  },
  openEducationPublication(studentId, publicationId) {
    return ipcRenderer.sendSync('bridge:openEducationPublication', studentId, publicationId);
  },
  deleteEducationPublication(studentId, publicationId) {
    return ipcRenderer.sendSync('bridge:deleteEducationPublication', studentId, publicationId);
  },
  regenerateEducationPublication(studentId, publicationId) {
    return ipcRenderer.invoke('bridge:regenerateEducationPublication', studentId, publicationId);
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
  getGrowthEvidenceReviewAsync(studentId) {
    return ipcRenderer.invoke('bridge:getGrowthEvidenceReviewAsync', studentId);
  },
  getGrowthModelSnapshot(studentId) {
    return ipcRenderer.invoke('bridge:getGrowthModelSnapshot', studentId);
  },
  updateGrowthEvidenceStatus(studentId, evidenceId, status, note) {
    return ipcRenderer.sendSync('bridge:updateGrowthEvidenceStatus', studentId, evidenceId, status, note);
  },
  batchReviewGrowthEvidence(studentId) {
    return ipcRenderer.sendSync('bridge:batchReviewGrowthEvidence', studentId);
  },
  rebuildGrowthIndex(studentId) {
    return ipcRenderer.sendSync('bridge:rebuildGrowthIndex', studentId);
  },
  getGrowthIndex(studentId) {
    return ipcRenderer.sendSync('bridge:getGrowthIndex', studentId);
  },
  getGrowthIndexAsync(studentId) {
    return ipcRenderer.invoke('bridge:getGrowthIndexAsync', studentId);
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
  setHostUsageMode(mode) {
    return ipcRenderer.sendSync('bridge:setHostUsageMode', mode);
  },
  getHostServiceDiagnostics() {
    return ipcRenderer.sendSync('bridge:getHostServiceDiagnostics');
  },
  inspectProjectUploadRecovery() {
    return ipcRenderer.invoke('bridge:inspectProjectUploadRecovery');
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
  renameHostIdentity(displayName) {
    return ipcRenderer.sendSync('bridge:renameHostIdentity', displayName);
  },
  getCollaborationState() {
    return ipcRenderer.sendSync('bridge:getCollaborationState');
  },
  setStudentArchiveSyncEnabled(studentId, enabled) {
    return ipcRenderer.sendSync('bridge:setStudentArchiveSyncEnabled', studentId, enabled);
  },
  syncStudentArchiveNow(studentId) {
    return ipcRenderer.sendSync('bridge:syncStudentArchiveNow', studentId);
  },
  setTeamKnowledgePolicy(optionsJson) {
    return ipcRenderer.sendSync('bridge:setTeamKnowledgePolicy', optionsJson);
  },
  initializeCollaborationWorkspace() {
    return ipcRenderer.sendSync('bridge:initializeCollaborationWorkspace');
  },
  setCollaborationEnabled(enabled) {
    return ipcRenderer.sendSync('bridge:setCollaborationEnabled', enabled);
  },
  openCollaborationPath(kind = 'nodeRoot') {
    return ipcRenderer.sendSync('bridge:openCollaborationPath', kind);
  },
  scanCollaborationInbox() {
    return ipcRenderer.invoke('bridge:scanCollaborationInbox');
  },
  rebuildCollaborationIndex() {
    return ipcRenderer.invoke('bridge:rebuildCollaborationIndex');
  },
  backupCollaborationState() {
    return ipcRenderer.sendSync('bridge:backupCollaborationState');
  },
  restoreLatestCollaborationState() {
    return ipcRenderer.sendSync('bridge:restoreLatestCollaborationState');
  },
  updateDirectDeliveryStatus(manifestId, action) {
    return ipcRenderer.sendSync('bridge:updateDirectDeliveryStatus', manifestId, action);
  },
  getRemoteCollaborationTasks() {
    return ipcRenderer.sendSync('bridge:getRemoteCollaborationTasks');
  },
  getProjectPublicationOptions(projectId) {
    return ipcRenderer.sendSync('bridge:getProjectPublicationOptions', projectId);
  },
  publishCollaborationProject(optionsJson) {
    return ipcRenderer.invoke('bridge:publishCollaborationProject', optionsJson);
  },
  selectCollaborationTaskFiles() {
    return ipcRenderer.sendSync('bridge:selectCollaborationTaskFiles');
  },
  selectCollaborationResultFiles() {
    return ipcRenderer.sendSync('bridge:selectCollaborationResultFiles');
  },
  createRemoteCollaborationTask(optionsJson) {
    return ipcRenderer.invoke('bridge:createRemoteCollaborationTask', optionsJson);
  },
  updateRemoteCollaborationTask(taskId, type, message = '', optionsJson = '{}') {
    return ipcRenderer.invoke('bridge:updateRemoteCollaborationTask', taskId, type, message, optionsJson);
  },
  resolveCollaborationTaskAttachments(taskId, decision, targetProjectId) {
    return ipcRenderer.invoke('bridge:resolveCollaborationTaskAttachments', taskId, decision, targetProjectId);
  },
  exportCollaborationStudentStats(studentId, targetNodeId) {
    return ipcRenderer.sendSync('bridge:exportCollaborationStudentStats', studentId, targetNodeId);
  },
  createCollaborationBinding(optionsJson) {
    return ipcRenderer.sendSync('bridge:createCollaborationBinding', optionsJson);
  },
  createCollaborationDeviceInvitation() {
    return ipcRenderer.sendSync('bridge:createCollaborationDeviceInvitation');
  },
  joinCollaborationDevice(value) {
    return ipcRenderer.invoke('bridge:joinCollaborationDevice', value);
  },
  createCollaborationStudentMappingOffer(deviceBindingId, studentId) {
    return ipcRenderer.sendSync('bridge:createCollaborationStudentMappingOffer', deviceBindingId, studentId);
  },
  acceptCollaborationStudentMappingClipboard(studentId) {
    return ipcRenderer.sendSync('bridge:acceptCollaborationStudentMappingClipboard', studentId);
  },
  createManualCollaborationInvitation(studentId, localRole) {
    return ipcRenderer.sendSync('bridge:createManualCollaborationInvitation', studentId, localRole);
  },
  acceptManualCollaborationClipboard(studentId) {
    return ipcRenderer.sendSync('bridge:acceptManualCollaborationClipboard', studentId);
  },
  updateCollaborationBindingStatus(bindingId, status) {
    return ipcRenderer.sendSync('bridge:updateCollaborationBindingStatus', bindingId, status);
  },
  deleteRevokedCollaborationBindings(bindingId) {
    return ipcRenderer.sendSync('bridge:deleteRevokedCollaborationBindings', bindingId);
  },
  saveCollaborationGrant(optionsJson) {
    return ipcRenderer.sendSync('bridge:saveCollaborationGrant', optionsJson);
  },
  setCollaborationStatisticsSharing(studentId, enabled) {
    return ipcRenderer.sendSync('bridge:setCollaborationStatisticsSharing', studentId, enabled);
  },
  getCollaborationStudentMaterialStats(studentId, viewerNodeId = '', allowedProjectIdsJson = '[]') {
    return ipcRenderer.sendSync('bridge:getCollaborationStudentMaterialStats', studentId, viewerNodeId, allowedProjectIdsJson);
  },
  findLanTablets() {
    return ipcRenderer.sendSync('bridge:findLanTablets');
  },
  findLanTerminals() {
    return ipcRenderer.sendSync('bridge:findLanTerminals');
  },
  inviteLanTablet(tabletId) {
    return ipcRenderer.sendSync('bridge:inviteLanTablet', tabletId);
  },
  inviteLanTerminal(terminalId) {
    return ipcRenderer.sendSync('bridge:inviteLanTerminal', terminalId);
  },
  acceptHostPairRequest(requestId) {
    return ipcRenderer.sendSync('bridge:acceptHostPairRequest', requestId);
  },
  rejectPairRequest(requestId) {
    return ipcRenderer.sendSync('bridge:rejectPairRequest', requestId);
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
  getStudentMaterialPathIssues(studentId) {
    return ipcRenderer.sendSync('bridge:getStudentMaterialPathIssues', studentId);
  },
  retryStudentMaterialPathRecovery(studentId) {
    return ipcRenderer.sendSync('bridge:retryStudentMaterialPathRecovery', studentId);
  },
  selectStudentMaterialPath(studentId, materialId) {
    return ipcRenderer.sendSync('bridge:selectStudentMaterialPath', studentId, materialId);
  },
  syncStudentDigestResult(studentId) {
    return ipcRenderer.sendSync('bridge:syncStudentDigestResult', studentId);
  },
  supplementCompletedStudentDigestLearningEvents(studentId) {
    return ipcRenderer.invoke('bridge:supplementCompletedStudentDigestLearningEvents', studentId);
  },
  startDigestWorkflow(scopeType, scopeId, executor) {
    return ipcRenderer.invoke('bridge:startDigestWorkflow', scopeType, scopeId, executor);
  },
  getDigestWorkflowStatus(scopeType, scopeId) {
    return ipcRenderer.sendSync('bridge:getDigestWorkflowStatus', scopeType, scopeId);
  },
  getDigestWorkflowCommand(scopeType, scopeId) {
    return ipcRenderer.sendSync('bridge:getDigestWorkflowCommand', scopeType, scopeId);
  },
  retryDigestWorkflow(scopeType, scopeId, executor) {
    return ipcRenderer.invoke('bridge:retryDigestWorkflow', scopeType, scopeId, executor);
  },
  importDigestWorkflowResultText(scopeType, scopeId, content) {
    return ipcRenderer.sendSync('bridge:importDigestWorkflowResultText', scopeType, scopeId, content);
  },
  getStudentDigestAudit(studentId) {
    return ipcRenderer.sendSync('bridge:getStudentDigestAudit', studentId);
  },
  generateStudentDigestAudit(studentId, selectedIdsJson) {
    return ipcRenderer.sendSync('bridge:generateStudentDigestAudit', studentId, selectedIdsJson);
  },
  syncStudentDigestAudit(studentId) {
    return ipcRenderer.sendSync('bridge:syncStudentDigestAudit', studentId);
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
  getTaskPage(query = {}) {
    return ipcRenderer.invoke('bridge:getTaskPage', query);
  },
  getTaskDetail(taskId) {
    return ipcRenderer.invoke('bridge:getTaskDetail', String(taskId));
  },
  reopenTaskHandoff(taskId, executionId, action = 'open') {
    return ipcRenderer.invoke('bridge:reopenTaskHandoff', String(taskId), String(executionId), action);
  },
  getTaskCenterAsync(force = false, quick = false) {
    return ipcRenderer.invoke('bridge:getTaskCenterAsync', Boolean(force), Boolean(quick));
  },
  getTaskStatusesAsync(taskIds = []) {
    return ipcRenderer.invoke('bridge:getTaskStatusesAsync', taskIds);
  },
  archiveAccessRpc(requestJson) {
    return ipcRenderer.invoke('bridge:archiveAccessRpc', requestJson);
  },
  remoteArchiveAccessRpc(requestJson) {
    return ipcRenderer.invoke('bridge:remoteArchiveAccessRpc', requestJson);
  },
  queryAgentKnowledge(optionsJson) {
    return ipcRenderer.invoke('bridge:queryAgentKnowledge', optionsJson);
  },
  getAgentKnowledgeDiagnostics() {
    return ipcRenderer.sendSync('bridge:getAgentKnowledgeDiagnostics');
  },
  prepareAgentKnowledgeAccess(studentId) {
    return ipcRenderer.sendSync('bridge:prepareAgentKnowledgeAccess', studentId);
  },
  getAgentCapabilityManagement(studentId) {
    return ipcRenderer.sendSync('bridge:getAgentCapabilityManagement', studentId);
  },
  setAgentCapabilityAuthorization(studentId, action) {
    return ipcRenderer.sendSync('bridge:setAgentCapabilityAuthorization', studentId, action);
  },
  reviewAgentWriteIntent(studentId, intentId) {
    return ipcRenderer.sendSync('bridge:reviewAgentWriteIntent', studentId, intentId);
  },
  decideAgentWriteIntent(studentId, intentId, digest, action) {
    return ipcRenderer.sendSync('bridge:decideAgentWriteIntent', studentId, intentId, digest, action);
  },
  getAgentMemoryState(studentId) {
    return ipcRenderer.invoke('bridge:getAgentMemoryState', studentId);
  },
  deleteEmptyAgentMemorySessions(studentId, sessionId = '') {
    return ipcRenderer.sendSync('bridge:deleteEmptyAgentMemorySessions', studentId, sessionId);
  },
  setAgentMemoryAutomation(studentId, enabled) {
    return ipcRenderer.sendSync('bridge:setAgentMemoryAutomation', studentId, Boolean(enabled));
  },
  activateAgentMemoryCapture(studentId) {
    return ipcRenderer.sendSync('bridge:activateAgentMemoryCapture', studentId);
  },
  openCodexHookReview() {
    return ipcRenderer.sendSync('bridge:openCodexHookReview');
  },
  submitAgentConversation(requestJson) {
    return ipcRenderer.invoke('bridge:submitAgentConversation', requestJson);
  },
  getAgentConversationSubmissionState() {
    return ipcRenderer.sendSync('bridge:getAgentConversationSubmissionState');
  },
  assignAgentConversationSubmission(submissionId, scopeType, scopeId) {
    return ipcRenderer.invoke('bridge:assignAgentConversationSubmission', submissionId, scopeType, scopeId);
  },
  getTaskCenterCapabilities() {
    return ipcRenderer.sendSync('bridge:getTaskCenterCapabilities');
  },
  setTaskAutomationEnabled(enabled) {
    return ipcRenderer.sendSync('bridge:setTaskAutomationEnabled', enabled);
  },
  executeTask(taskId, executor) {
    return ipcRenderer.invoke('bridge:executeTask', taskId, executor);
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
  deleteTaskHistory(taskId) {
    return ipcRenderer.sendSync('bridge:deleteTaskHistory', taskId);
  },
  previewTaskGovernanceBatch(request) {
    return ipcRenderer.invoke('bridge:previewTaskGovernanceBatch', request);
  },
  commitTaskGovernanceBatch(request) {
    return ipcRenderer.invoke('bridge:commitTaskGovernanceBatch', request);
  },
  importTaskResult(taskId) {
    return ipcRenderer.sendSync('bridge:importTaskResult', taskId);
  },
  importTaskResultText(taskId, content) {
    return ipcRenderer.sendSync('bridge:importTaskResultText', taskId, content);
  },
  importTaskResultTextAsync(taskId, content) {
    return ipcRenderer.invoke('bridge:importTaskResultTextAsync', taskId, content);
  },
  importTaskResultFileAsync(taskId) {
    return ipcRenderer.invoke('bridge:importTaskResultFileAsync', taskId);
  },
  confirmTaskExternalStopped(taskId, executionId) {
    return ipcRenderer.invoke('bridge:confirmTaskExternalStopped', taskId, executionId);
  },
  detectWorkBuddyBackgroundAuthorization(confirmed) {
    return ipcRenderer.invoke('bridge:detectWorkBuddyBackgroundAuthorization', confirmed);
  },
  detectCodexBackgroundAuthorization(confirmed) {
    return ipcRenderer.invoke('bridge:detectCodexBackgroundAuthorization', confirmed);
  },
  syncQClawTaskResults() {
    return ipcRenderer.sendSync('bridge:syncQClawTaskResults');
  },
  syncAgentTaskResults(agentId = '') {
    return ipcRenderer.sendSync('bridge:syncAgentTaskResults', agentId);
  },
  submitDailyActionFeedback(taskId, status, note) {
    return ipcRenderer.sendSync('bridge:submitDailyActionFeedback', taskId, status, note);
  },
  openTaskCenterPath(kind, agentId = '') {
    return ipcRenderer.sendSync('bridge:openTaskCenterPath', kind, agentId);
  },
  openTaskResultPath(taskId) {
    return ipcRenderer.sendSync('bridge:openTaskResultPath', taskId);
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
  getHostMigrationPlan() {
    return ipcRenderer.invoke('bridge:getHostMigrationPlan');
  },
  createHostMigrationPackage(optionsJson) {
    return ipcRenderer.invoke('bridge:createHostMigrationPackage', optionsJson);
  },
  getStudentOfflineMigrationPlan(studentId) {
    return ipcRenderer.invoke('bridge:getStudentOfflineMigrationPlan', studentId);
  },
  createStudentOfflineMigration(studentId) {
    return ipcRenderer.invoke('bridge:createStudentOfflineMigration', studentId);
  },
  inspectHostMigrationPackage() {
    return ipcRenderer.invoke('bridge:inspectHostMigrationPackage');
  },
  restoreHostMigrationPackage(optionsJson) {
    return ipcRenderer.invoke('bridge:restoreHostMigrationPackage', optionsJson);
  },
  onHostMigrationProgress(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('host-migration:progress', listener);
    return () => ipcRenderer.removeListener('host-migration:progress', listener);
  },
  onStudentOfflineMigrationProgress(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('student-offline-migration:progress', listener);
    return () => ipcRenderer.removeListener('student-offline-migration:progress', listener);
  },
  openHostMigrationRecord() {
    return ipcRenderer.sendSync('bridge:openHostMigrationRecord');
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
  rebindAdoptedStudentWorkspace(studentId, selectionMode) {
    return ipcRenderer.invoke('bridge:rebindAdoptedStudentWorkspace', studentId, selectionMode);
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
  setHostDeviceTerminalMode(deviceId, terminalMode, boundStudentId) {
    return ipcRenderer.sendSync('bridge:setHostDeviceTerminalMode', deviceId, terminalMode, boundStudentId);
  },
  getCourseCatalogState() {
    return ipcRenderer.sendSync('bridge:getCourseCatalogState');
  },
  saveCourseInstitutionPolicy(policyJson) {
    return ipcRenderer.sendSync('bridge:saveCourseInstitutionPolicy', policyJson);
  },
  importOfflineCourseCatalog() {
    return ipcRenderer.sendSync('bridge:importOfflineCourseCatalog');
  },
  exportCustomCourseTemplate() {
    return ipcRenderer.invoke('bridge:exportCustomCourseTemplate');
  },
  importCustomCourseExcel() {
    return ipcRenderer.invoke('bridge:importCustomCourseExcel');
  },
  selectCustomCourseImage() {
    return ipcRenderer.invoke('bridge:selectCustomCourseImage');
  },
  saveDirectCustomCourse(inputJson) {
    return ipcRenderer.invoke('bridge:saveDirectCustomCourse', inputJson);
  },
  deleteCustomCourse(courseId) {
    return ipcRenderer.sendSync('bridge:deleteCustomCourse', courseId);
  },
  selectPlatformCourseImage() {
    return ipcRenderer.invoke('bridge:selectPlatformCourseImage');
  },
  savePlatformCourseDraft(inputJson) {
    return ipcRenderer.invoke('bridge:savePlatformCourseDraft', inputJson);
  },
  removePlatformCourseDraft(courseId) {
    return ipcRenderer.sendSync('bridge:removePlatformCourseDraft', courseId);
  },
  queuePlatformCourseDeletion(courseId) {
    return ipcRenderer.sendSync('bridge:queuePlatformCourseDeletion', courseId);
  },
  cancelPlatformCourseDeletion(courseId) {
    return ipcRenderer.sendSync('bridge:cancelPlatformCourseDeletion', courseId);
  },
  publishPlatformCourseCatalog(releaseNotes) {
    return ipcRenderer.sendSync('bridge:publishPlatformCourseCatalog', releaseNotes);
  },
  reExportPlatformCourseCatalog() {
    return ipcRenderer.sendSync('bridge:reExportPlatformCourseCatalog');
  },
  rollbackPlatformCourseCatalog() {
    return ipcRenderer.sendSync('bridge:rollbackPlatformCourseCatalog');
  },
  openCourseView(courseId) {
    return ipcRenderer.sendSync('bridge:openCourseView', courseId);
  },
  closeCourseView() {
    return ipcRenderer.sendSync('bridge:closeCourseView');
  },
  setCourseCaptureSetupVisible(visible) {
    return ipcRenderer.sendSync('bridge:setCourseCaptureSetupVisible', visible);
  },
  setCourseViewLayout(layoutJson) {
    return ipcRenderer.sendSync('bridge:setCourseViewLayout', layoutJson);
  },
});
