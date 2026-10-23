const { contextBridge, ipcRenderer } = require('electron');

const invokeLegacy = (channel, ...args) => ipcRenderer.invoke('bridge:invokeLegacyAsync', channel, args);

contextBridge.exposeInMainWorld('AndroidBridge', {
  getAppBootstrap() { return ipcRenderer.invoke('bridge:getAppBootstrap'); },
  getSubsystemStatus() { return ipcRenderer.invoke('bridge:getSubsystemStatus'); },
  retrySubsystemInitialization(name) { return ipcRenderer.invoke('bridge:retrySubsystemInitialization', name); },
  onSubsystemProgress(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('subsystem:progress', listener);
    return () => ipcRenderer.removeListener('subsystem:progress', listener);
  },
  showQuickCapture() { return ipcRenderer.invoke('bridge:showQuickCapture'); },
  setQuickCaptureContext(studentId, context) { return ipcRenderer.invoke('bridge:setQuickCaptureContext', studentId, context); },
  onQuickCaptureNavigate(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('quick-capture:navigate', listener);
    return () => ipcRenderer.removeListener('quick-capture:navigate', listener);
  },
  getDownloadInboxSettings() { return ipcRenderer.invoke('bridge:getDownloadInboxSettings'); },
  smartInboxAction(action, input) { return ipcRenderer.invoke('bridge:smartInboxAction', action, input); },
  agentControlAction(action, input) { return ipcRenderer.invoke('bridge:agentControlAction', action, input); },
  skillLibraryAction(action, input) { return ipcRenderer.invoke('bridge:skillLibraryAction', action, input); },
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
    return invokeLegacy('bridge:exportTextFile', filename, content);
  },
  importFiles(studentName, targetJson) {
    return invokeLegacy('bridge:importFiles', studentName, targetJson);
  },
  pickMaterialSourceDir() {
    return invokeLegacy('bridge:pickMaterialSourceDir');
  },
  scanMaterialSources(studentId, sourcesJson) {
    return ipcRenderer.invoke('bridge:scanMaterialSources', studentId, sourcesJson);
  },
  importMaterialSourceFiles(studentId, pathsJson, targetJson) {
    return ipcRenderer.invoke('bridge:importMaterialSourceFiles', studentId, pathsJson, targetJson);
  },
  getMaterialImportRecords(studentId) {
    return invokeLegacy('bridge:getMaterialImportRecords', studentId);
  },
  removeMaterialImportRecords(studentId, recordIdsJson) {
    return invokeLegacy('bridge:removeMaterialImportRecords', studentId, recordIdsJson);
  },
  getCaptureCenterState() {
    return invokeLegacy('bridge:getCaptureCenterState');
  },
  setCaptureVisionConsent(inputJson) {
    return invokeLegacy('bridge:setCaptureVisionConsent', inputJson);
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
  listStudentKnowledgePoints(inputJson) {
    return ipcRenderer.invoke('bridge:listStudentKnowledgePoints', inputJson);
  },
  getKnowledgePointTrend(inputJson) {
    return ipcRenderer.invoke('bridge:getKnowledgePointTrend', inputJson);
  },
  getStudentKnowledgeActivitySummary(studentId, range) {
    return ipcRenderer.invoke('bridge:getStudentKnowledgeActivitySummary', studentId, range);
  },
  rebuildKnowledgeProjection(inputJson) {
    return ipcRenderer.invoke('bridge:rebuildKnowledgeProjection', inputJson);
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
    return invokeLegacy('bridge:openCaptureInbox', sessionId);
  },
  getAssetIndex() {
    return ipcRenderer.invoke('bridge:getAssetIndex');
  },
  getAssetSummary(filter) {
    return ipcRenderer.invoke('bridge:getAssetSummary', filter || {});
  },
  listAssets(request) {
    return ipcRenderer.invoke('bridge:listAssets', request || {});
  },
  searchAssets(request) {
    return ipcRenderer.invoke('bridge:searchAssets', request || {});
  },
  getAssetDetail(assetId) {
    return ipcRenderer.invoke('bridge:getAssetDetail', assetId);
  },
  rebuildAssetIndex() {
    return ipcRenderer.invoke('bridge:rebuildAssetIndex');
  },
  getAssetRebuildStatus(jobId) {
    return ipcRenderer.invoke('bridge:getAssetRebuildStatus', jobId || '');
  },
  cancelAssetIndexRebuild(jobId) {
    return ipcRenderer.invoke('bridge:cancelAssetIndexRebuild', jobId || '');
  },
  onAssetIndexProgress(callback) {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('asset-index:progress', handler);
    return () => ipcRenderer.removeListener('asset-index:progress', handler);
  },
  listDuplicateGroups(request) {
    return ipcRenderer.invoke('bridge:listDuplicateGroups', request || {});
  },
  listDuplicateCleanupOperations(request) {
    return ipcRenderer.invoke('bridge:listDuplicateCleanupOperations', request || {});
  },
  prepareDuplicateCleanup(request) {
    return ipcRenderer.invoke('bridge:prepareDuplicateCleanup', request || {});
  },
  applyDuplicateCleanup(operationId, entryIds) {
    return ipcRenderer.invoke('bridge:applyDuplicateCleanup', operationId, entryIds || []);
  },
  getDuplicateCleanupStatus(operationId) {
    return ipcRenderer.invoke('bridge:getDuplicateCleanupStatus', operationId);
  },
  restoreDuplicateCleanup(operationId, entryIds) {
    return ipcRenderer.invoke('bridge:restoreDuplicateCleanup', operationId, entryIds || []);
  },
  retryDuplicateCleanup(operationId, entryIds) {
    return ipcRenderer.invoke('bridge:retryDuplicateCleanup', operationId, entryIds || []);
  },
  onDuplicateCleanupProgress(callback) {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('asset-duplicates:progress', handler);
    return () => ipcRenderer.removeListener('asset-duplicates:progress', handler);
  },
  analyzeAssetGovernance() {
    return ipcRenderer.invoke('bridge:analyzeAssetGovernance');
  },
  cleanupAssetReferences(assetId) {
    return ipcRenderer.invoke('bridge:cleanupAssetReferences', assetId);
  },
  createAssetVersionSnapshot(assetId) {
    return ipcRenderer.invoke('bridge:createAssetVersionSnapshot', assetId);
  },
  markAssetGovernanceDecision(assetId, decision, note) {
    return ipcRenderer.invoke('bridge:markAssetGovernanceDecision', assetId, decision, note);
  },
  generateKnowledgeArchitectureReport() {
    return invokeLegacy('bridge:generateKnowledgeArchitectureReport');
  },
  getProjects(options) {
    return ipcRenderer.invoke('bridge:getProjects', options || {});
  },
  listProjects(request) {
    return ipcRenderer.invoke('bridge:listProjects', request || {});
  },
  getProjectDetail(projectId) {
    return ipcRenderer.invoke('bridge:getProjectDetail', projectId);
  },
  listProjectStagingItems(request) {
    return ipcRenderer.invoke('bridge:listProjectStagingItems', request || {});
  },
  getProjectStagingSummary(projectId) {
    return ipcRenderer.invoke('bridge:getProjectStagingSummary', projectId);
  },
  mutateProjectStagingItems(request) {
    return ipcRenderer.invoke('bridge:mutateProjectStagingItems', request || {});
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
    return invokeLegacy('bridge:createProject', optionsJson);
  },
  updateProjectMetadata(projectId, metadataJson) {
    return invokeLegacy('bridge:updateProjectMetadata', projectId, metadataJson);
  },
  previewLearningProjectRemoval(projectId) {
    return invokeLegacy('bridge:previewLearningProjectRemoval', projectId);
  },
  removeProjectRecord(projectId) {
    return invokeLegacy('bridge:removeProjectRecord', projectId);
  },
  deleteLearningProject(projectId) {
    return invokeLegacy('bridge:deleteLearningProject', projectId);
  },
  relocateProjectWorkspace(projectId) {
    return invokeLegacy('bridge:relocateProjectWorkspace', projectId);
  },
  confirmProjectWorkspaceRelocation(projectId, workspacePath) {
    return invokeLegacy('bridge:confirmProjectWorkspaceRelocation', projectId, workspacePath);
  },
  rollbackProjectWorkspaceRelocation(projectId) {
    return invokeLegacy('bridge:rollbackProjectWorkspaceRelocation', projectId);
  },
  rebindProjectKnowledgeSpace(projectId) {
    return invokeLegacy('bridge:rebindProjectKnowledgeSpace', projectId);
  },
  rebindProjectRoot(projectId) {
    return invokeLegacy('bridge:rebindProjectRoot', projectId);
  },
  rebindProjectRaw(projectId) {
    return invokeLegacy('bridge:rebindProjectRaw', projectId);
  },
  getRemovedProjects() {
    return invokeLegacy('bridge:getRemovedProjects');
  },
  restoreRemovedProject(snapshotPath) {
    return invokeLegacy('bridge:restoreRemovedProject', snapshotPath);
  },
  exportProjectPackage(projectId) {
    return invokeLegacy('bridge:exportProjectPackage', projectId);
  },
  importProjectPackage() {
    return invokeLegacy('bridge:importProjectPackage');
  },
  duplicateProject(projectId, name) {
    return invokeLegacy('bridge:duplicateProject', projectId, name);
  },
  updateProjectStudentEvidence(projectId, studentId, evidenceJson) {
    return invokeLegacy('bridge:updateProjectStudentEvidence', projectId, studentId, evidenceJson);
  },
  updateProjectStudentEvidenceAsync(projectId, studentId, evidenceJson, bindingId = '') {
    return ipcRenderer.invoke('bridge:updateProjectStudentEvidenceAsync', projectId, studentId, evidenceJson, bindingId);
  },
  getProjectStudentEvidencePrompt(projectId) {
    return invokeLegacy('bridge:getProjectStudentEvidencePrompt', projectId);
  },
  getProjectCompletionWizard(projectId) {
    return invokeLegacy('bridge:getProjectCompletionWizard', projectId);
  },
  importProjectStudentEvidenceSuggestions(projectId, pastedText = '') {
    return invokeLegacy('bridge:importProjectStudentEvidenceSuggestions', projectId, pastedText);
  },
  buildCrossProjectKnowledgeIndex() {
    return ipcRenderer.invoke('bridge:buildCrossProjectKnowledgeIndex');
  },
  pickProjectWorkspaceDir() {
    return invokeLegacy('bridge:pickProjectWorkspaceDir');
  },
  pickProjectKnowledgeBaseDir() {
    return invokeLegacy('bridge:pickProjectKnowledgeBaseDir');
  },
  inspectProjectKnowledgeBase(rootPath) {
    return invokeLegacy('bridge:inspectProjectKnowledgeBase', rootPath);
  },
  updateProjectStatus(projectId, status) {
    return invokeLegacy('bridge:updateProjectStatus', projectId, status);
  },
  updateProjectStudents(projectId, studentIdsJson) {
    return ipcRenderer.invoke('bridge:updateProjectStudents', projectId, studentIdsJson);
  },
  applyProjectWorkspaceTemplate(projectId, templateId, foldersJson, templateName, templateV2Json) {
    return invokeLegacy('bridge:applyProjectWorkspaceTemplate', projectId, templateId, foldersJson, templateName, templateV2Json);
  },
  openProjectSpace(projectId, space) {
    return invokeLegacy('bridge:openProjectSpace', projectId, space);
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
    return invokeLegacy('bridge:getProjectKnowledgeReview', projectId);
  },
  updateProjectKnowledgeReview(projectId, recordIdsJson, status, note) {
    return invokeLegacy('bridge:updateProjectKnowledgeReview', projectId, recordIdsJson, status, note);
  },
  getProjectUnifiedReview(projectId) {
    return invokeLegacy('bridge:getProjectUnifiedReview', projectId);
  },
  applyProjectUnifiedReview(projectId) {
    return invokeLegacy('bridge:applyProjectUnifiedReview', projectId);
  },
  importProjectAssets(projectId, assetIdsJson) {
    return ipcRenderer.invoke('bridge:importProjectAssets', projectId, assetIdsJson);
  },
  importProjectRawFiles(projectId) {
    return ipcRenderer.invoke('bridge:importProjectRawFiles', projectId);
  },
  getProjectDigestCommand(projectId) {
    return invokeLegacy('bridge:getProjectDigestCommand', projectId);
  },
  markProjectDigestSubmitted(projectId) {
    return invokeLegacy('bridge:markProjectDigestSubmitted', projectId);
  },
  syncProjectDigestResult(projectId) {
    return invokeLegacy('bridge:syncProjectDigestResult', projectId);
  },
  applyProjectDigestReceiptText(projectId, rawText) {
    return invokeLegacy('bridge:applyProjectDigestReceiptText', projectId, rawText);
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
    return invokeLegacy('bridge:previewProjectStagingAiScreening', projectId, rawText);
  },
  applyProjectStagingAiScreening(projectId, rawText) {
    return invokeLegacy('bridge:applyProjectStagingAiScreening', projectId, rawText);
  },
  importProjectStagingAiScreening(projectId) {
    return invokeLegacy('bridge:importProjectStagingAiScreening', projectId);
  },
  analyzeProjectStagingGovernance(projectId) {
    return invokeLegacy('bridge:analyzeProjectStagingGovernance', projectId);
  },
  generateProjectPromotion(projectId) {
    return invokeLegacy('bridge:generateProjectPromotion', projectId);
  },
  getProjectPromotionPlan(projectId) {
    return invokeLegacy('bridge:getProjectPromotionPlan', projectId);
  },
  getProjectPromotionAudit(projectId) {
    return invokeLegacy('bridge:getProjectPromotionAudit', projectId);
  },
  executeProjectPromotionPlan(projectId, planJson) {
    return invokeLegacy('bridge:executeProjectPromotionPlan', projectId, planJson);
  },
  publishProjectPromotion(projectId) {
    return invokeLegacy('bridge:publishProjectPromotion', projectId);
  },
  rollbackProjectPromotionRun(projectId, runId) {
    return invokeLegacy('bridge:rollbackProjectPromotionRun', projectId, runId);
  },
  initStudentWorkspace(studentName, agentMd, indexMd, logMd) {
    return invokeLegacy('bridge:initStudentWorkspace', studentName, agentMd, indexMd, logMd);
  },
  openApp(app) {
    return invokeLegacy('bridge:openApp', app);
  },
  openExternalUrl(url) {
    return invokeLegacy('bridge:openExternalUrl', url);
  },
  getAppStatus() {
    return invokeLegacy('bridge:getAppStatus');
  },
  getAppStatusAsync() {
    return ipcRenderer.invoke('bridge:getAppStatusAsync');
  },
  getStorageConfig() {
    return ipcRenderer.invoke('bridge:getStorageConfig');
  },
  getTemplateCenter(systemTemplatesJson) {
    return ipcRenderer.invoke('bridge:getTemplateCenter', systemTemplatesJson);
  },
  saveCustomTemplates(templatesJson) {
    return invokeLegacy('bridge:saveCustomTemplates', templatesJson);
  },
  restoreSystemTemplates(systemTemplatesJson) {
    return invokeLegacy('bridge:restoreSystemTemplates', systemTemplatesJson);
  },
  getAgentCenter(studentId) {
    return invokeLegacy('bridge:getAgentCenter', studentId);
  },
  saveAgentMemorySource(studentId, tool, content, mode) {
    return invokeLegacy('bridge:saveAgentMemorySource', studentId, tool, content, mode);
  },
  mergeAgentMemory(studentId) {
    return invokeLegacy('bridge:mergeAgentMemory', studentId);
  },
  saveUnifiedMemory(studentId, content) {
    return invokeLegacy('bridge:saveUnifiedMemory', studentId, content);
  },
  saveAgentSoulSource(studentId, tool, content) {
    return invokeLegacy('bridge:saveAgentSoulSource', studentId, tool, content);
  },
  saveUnifiedSoul(studentId, content) {
    return invokeLegacy('bridge:saveUnifiedSoul', studentId, content);
  },
  compareAgentSoulSource(studentId, tool) {
    return invokeLegacy('bridge:compareAgentSoulSource', studentId, tool);
  },
  scanAgentKnowledgeFiles(studentId) {
    return invokeLegacy('bridge:scanAgentKnowledgeFiles', studentId);
  },
  importAgentKnowledgeFile(studentId, filePath, tool, kind) {
    return invokeLegacy('bridge:importAgentKnowledgeFile', studentId, filePath, tool, kind);
  },
  getAgentRules(studentId) {
    return invokeLegacy('bridge:getAgentRules', studentId);
  },
  saveAgentRuleFile(studentId, fileName, content) {
    return invokeLegacy('bridge:saveAgentRuleFile', studentId, fileName, content);
  },
  generateAgentRuleFile(studentId, fileName) {
    return invokeLegacy('bridge:generateAgentRuleFile', studentId, fileName);
  },
  compareAgentRuleFiles(studentId, baseName, targetName) {
    return invokeLegacy('bridge:compareAgentRuleFiles', studentId, baseName, targetName);
  },
  getAgentSourceRegistry(studentId) {
    return invokeLegacy('bridge:getAgentSourceRegistry', studentId);
  },
  rollbackAgentSourceRecord(studentId, recordId) {
    return invokeLegacy('bridge:rollbackAgentSourceRecord', studentId, recordId);
  },
  getAgentConversationCenter(studentId) {
    return invokeLegacy('bridge:getAgentConversationCenter', studentId);
  },
  saveAgentConversationImport(studentId, content, tool, sourcePath) {
    return invokeLegacy('bridge:saveAgentConversationImport', studentId, content, tool, sourcePath);
  },
  deliverConversationMaterials(studentId, requestJson) {
    return ipcRenderer.invoke('bridge:deliverConversationMaterials', studentId, requestJson);
  },
  manageConversationImports(studentId, requestJson) {
    return invokeLegacy('bridge:manageConversationImports', studentId, requestJson);
  },
  manageConversationImportsAsync(studentId, requestJson) {
    return ipcRenderer.invoke('bridge:manageConversationImportsAsync', studentId, requestJson);
  },
  importConversationShareUrl(studentId, url, tool) {
    return ipcRenderer.invoke('bridge:importConversationShareUrl', studentId, url, tool);
  },
  selectAgentConversationFiles(studentId, tool) {
    return invokeLegacy('bridge:selectAgentConversationFiles', studentId, tool);
  },
  saveConversationExtract(studentId, extractJson, tool) {
    return invokeLegacy('bridge:saveConversationExtract', studentId, extractJson, tool);
  },
  updateConversationKnowledgeCandidate(studentId, candidateId, action, payloadJson) {
    return invokeLegacy('bridge:updateConversationKnowledgeCandidate', studentId, candidateId, action, payloadJson);
  },
  promoteConversationKnowledgeCandidates(studentId, requestJson) {
    return invokeLegacy('bridge:promoteConversationKnowledgeCandidates', studentId, requestJson);
  },
  rollbackConversationPromotion(studentId, transactionId) {
    return invokeLegacy('bridge:rollbackConversationPromotion', studentId, transactionId);
  },
  ingestKnowledgeCandidateEnvelope(studentId, envelopeJson) {
    return invokeLegacy('bridge:ingestKnowledgeCandidateEnvelope', studentId, envelopeJson);
  },
  openStudentRootDir(studentId) {
    return invokeLegacy('bridge:openStudentRootDir', studentId);
  },
  openGrowthModelDir(studentId) {
    return invokeLegacy('bridge:openGrowthModelDir', studentId);
  },
  checkStudentPathHealth(studentId) {
    return invokeLegacy('bridge:checkStudentPathHealth', studentId);
  },
  repairStudentStalePaths(studentId) {
    return invokeLegacy('bridge:repairStudentStalePaths', studentId);
  },
  checkAllStudentsPathHealth() {
    return invokeLegacy('bridge:checkAllStudentsPathHealth');
  },
  resolveStudentPath(studentId, logicalPath) {
    return invokeLegacy('bridge:resolveStudentPath', studentId, logicalPath);
  },
  getLicenseStatus() {
    return ipcRenderer.invoke('bridge:getLicenseStatus');
  },
  activateLicense(code) {
    return invokeLegacy('bridge:activateLicense', code);
  },
  importLicenseFile() {
    return invokeLegacy('bridge:importLicenseFile');
  },
  getLicenseTrustStatus() {
    return invokeLegacy('bridge:getLicenseTrustStatus');
  },
  deactivateLicense() {
    return invokeLegacy('bridge:deactivateLicense');
  },
  getAgentToolInstallStatus() {
    return invokeLegacy('bridge:getAgentToolInstallStatus');
  },
  checkUpdate(manifestUrl, currentVersionCode) {
    return invokeLegacy('bridge:checkUpdate', manifestUrl, currentVersionCode);
  },
  downloadAndInstallUpdate(apkUrl) {
    return invokeLegacy('bridge:downloadAndInstallUpdate', apkUrl);
  },
  pickArchiveRoot() {
    return invokeLegacy('bridge:pickArchiveRoot');
  },
  getArchiveRootStatus() {
    return invokeLegacy('bridge:getArchiveRootStatus');
  },
  listMarkdownFiles(studentName) {
    return invokeLegacy('bridge:listMarkdownFiles', studentName);
  },
  readMarkdownFile(studentId, documentId) {
    return invokeLegacy('bridge:readMarkdownFile', studentId, documentId);
  },
  listProjectKnowledgeFiles(projectId) {
    return invokeLegacy('bridge:listProjectKnowledgeFiles', projectId);
  },
  readProjectKnowledgeFile(projectId, documentId) {
    return invokeLegacy('bridge:readProjectKnowledgeFile', projectId, documentId);
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
  getProjectMaterialOverview(projectId) {
    return ipcRenderer.invoke('bridge:getProjectMaterialOverview', projectId);
  },
  listProjectMaterialExceptions(requestJson) {
    return ipcRenderer.invoke('bridge:listProjectMaterialExceptions', requestJson);
  },
  runProjectMaterialAutomation(projectId, requestJson) {
    return ipcRenderer.invoke('bridge:runProjectMaterialAutomation', projectId, requestJson);
  },
  getProjectMaterialAutomationStatus(jobId) {
    return ipcRenderer.invoke('bridge:getProjectMaterialAutomationStatus', jobId);
  },
  onProjectMaterialAutomationProgress(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('onProjectMaterialAutomationProgress', listener);
    return () => ipcRenderer.removeListener('onProjectMaterialAutomationProgress', listener);
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
    return invokeLegacy('bridge:listLearningReports', studentId);
  },
  cloudReportEnrollSource(input) {
    return ipcRenderer.invoke('bridge:cloudReportEnrollSource', input);
  },
  cloudReportSetUpload(studentId, enabled) {
    return ipcRenderer.invoke('bridge:cloudReportSetUpload', studentId, enabled);
  },
  cloudReportSetUploadScope(studentId, input) {
    return ipcRenderer.invoke('bridge:cloudReportSetUploadScope', studentId, input);
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
  cloudReportApprovePairing(pairingCode, studentIds, options) {
    return ipcRenderer.invoke('bridge:cloudReportApprovePairing', pairingCode, studentIds, options);
  },
  cloudReportListStudents() {
    return ipcRenderer.invoke('bridge:cloudReportListStudents');
  },
  cloudReportRemoveStudent(cloudStudentId) {
    return ipcRenderer.invoke('bridge:cloudReportRemoveStudent', cloudStudentId);
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
  cloudReportListMaterials(cloudStudentId, options) {
    return ipcRenderer.invoke('bridge:cloudReportListMaterials', cloudStudentId, options);
  },
  cloudReportDownloadMaterial(cloudStudentId, revisionId, reveal) {
    return ipcRenderer.invoke('bridge:cloudReportDownloadMaterial', cloudStudentId, revisionId, reveal);
  },
  cloudReportIssueRemoteAgent(input) { return ipcRenderer.invoke('bridge:cloudReportIssueRemoteAgent', input); },
  cloudReportRemoteAgentStatus(sessionId) { return ipcRenderer.invoke('bridge:cloudReportRemoteAgentStatus', sessionId); },
  cloudReportRevokeRemoteAgent(sessionId) { return ipcRenderer.invoke('bridge:cloudReportRevokeRemoteAgent', sessionId); },
  cloudReportListInbox(cursor = '', recover = false) { return ipcRenderer.invoke('bridge:cloudReportListInbox', cursor, recover); },
  cloudReportLeaseInbox(submissionId) { return ipcRenderer.invoke('bridge:cloudReportLeaseInbox', submissionId); },
  cloudReportSettleInbox(submissionId, input) { return ipcRenderer.invoke('bridge:cloudReportSettleInbox', submissionId, input); },
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
    return invokeLegacy('bridge:readLearningReport', studentId, reportId);
  },
  getLearningReportEvidence(studentId, reportId) {
    return invokeLegacy('bridge:getLearningReportEvidence', studentId, reportId);
  },
  openLearningReportEvidenceSource(studentId, reportId, evidenceId, sourceIndex) {
    return invokeLegacy('bridge:openLearningReportEvidenceSource', studentId, reportId, evidenceId, sourceIndex);
  },
  exportEducationArchive(studentId) {
    return invokeLegacy('bridge:exportEducationArchive', studentId);
  },
  exportLearningReport(studentId, reportId, format) {
    return ipcRenderer.invoke('bridge:exportLearningReport', studentId, reportId, format);
  },
  getEducationPublishingState(studentId, sourceType, sourceId) {
    return invokeLegacy('bridge:getEducationPublishingState', studentId, sourceType, sourceId);
  },
  getEducationPublicationEnhancementState(studentId, optionsJson) {
    return invokeLegacy('bridge:getEducationPublicationEnhancementState', studentId, optionsJson);
  },
  startEducationPublicationEnhancement(studentId, optionsJson) {
    return ipcRenderer.invoke('bridge:startEducationPublicationEnhancement', studentId, optionsJson);
  },
  exportEducationPublication(studentId, optionsJson) {
    return ipcRenderer.invoke('bridge:exportEducationPublication', studentId, optionsJson);
  },
  openEducationPublication(studentId, publicationId) {
    return invokeLegacy('bridge:openEducationPublication', studentId, publicationId);
  },
  deleteEducationPublication(studentId, publicationId) {
    return invokeLegacy('bridge:deleteEducationPublication', studentId, publicationId);
  },
  regenerateEducationPublication(studentId, publicationId) {
    return ipcRenderer.invoke('bridge:regenerateEducationPublication', studentId, publicationId);
  },
  ensureLearningReports(studentId) {
    return invokeLegacy('bridge:ensureLearningReports', studentId);
  },
  ensureGrowthModel(studentId) {
    return invokeLegacy('bridge:ensureGrowthModel', studentId);
  },
  getGrowthEvidenceReview(studentId) {
    return invokeLegacy('bridge:getGrowthEvidenceReview', studentId);
  },
  getGrowthEvidenceReviewAsync(studentId) {
    return ipcRenderer.invoke('bridge:getGrowthEvidenceReviewAsync', studentId);
  },
  getGrowthModelSnapshot(studentId) {
    return ipcRenderer.invoke('bridge:getGrowthModelSnapshot', studentId);
  },
  updateGrowthEvidenceStatus(studentId, evidenceId, status, note) {
    return invokeLegacy('bridge:updateGrowthEvidenceStatus', studentId, evidenceId, status, note);
  },
  batchReviewGrowthEvidence(studentId) {
    return invokeLegacy('bridge:batchReviewGrowthEvidence', studentId);
  },
  rebuildGrowthIndex(studentId) {
    return invokeLegacy('bridge:rebuildGrowthIndex', studentId);
  },
  getGrowthIndex(studentId) {
    return invokeLegacy('bridge:getGrowthIndex', studentId);
  },
  getGrowthIndexAsync(studentId) {
    return ipcRenderer.invoke('bridge:getGrowthIndexAsync', studentId);
  },
  getStudents() {
    return invokeLegacy('bridge:getStudents');
  },
  syncStudents(studentsJson) {
    return ipcRenderer.invoke('bridge:syncStudents', studentsJson);
  },
  selectKnowledgeBaseRoot() {
    return invokeLegacy('bridge:selectKnowledgeBaseRoot');
  },
  scanKnowledgeBase(rootPath, studentName) {
    return invokeLegacy('bridge:scanKnowledgeBase', rootPath, studentName);
  },
  ensureAdoptedKnowledgeBase(optionsJson) {
    return invokeLegacy('bridge:ensureAdoptedKnowledgeBase', optionsJson);
  },
  getHostServiceStatus() {
    return ipcRenderer.invoke('bridge:getHostServiceStatus');
  },
  setHostUsageMode(mode) {
    return invokeLegacy('bridge:setHostUsageMode', mode);
  },
  getHostServiceDiagnostics() {
    return invokeLegacy('bridge:getHostServiceDiagnostics');
  },
  inspectProjectUploadRecovery() {
    return ipcRenderer.invoke('bridge:inspectProjectUploadRecovery');
  },
  repairHostService() {
    return invokeLegacy('bridge:repairHostService');
  },
  startHostService() {
    return invokeLegacy('bridge:startHostService');
  },
  stopHostService() {
    return invokeLegacy('bridge:stopHostService');
  },
  setHostServicePort(port) {
    return invokeLegacy('bridge:setHostServicePort', port);
  },
  getHostConnectionInfo() {
    return invokeLegacy('bridge:getHostConnectionInfo');
  },
  getHostDevices() {
    return invokeLegacy('bridge:getHostDevices');
  },
  renameHostIdentity(displayName) {
    return invokeLegacy('bridge:renameHostIdentity', displayName);
  },
  getCollaborationState() {
    return invokeLegacy('bridge:getCollaborationState');
  },
  setStudentArchiveSyncEnabled(studentId, enabled) {
    return invokeLegacy('bridge:setStudentArchiveSyncEnabled', studentId, enabled);
  },
  syncStudentArchiveNow(studentId) {
    return invokeLegacy('bridge:syncStudentArchiveNow', studentId);
  },
  setTeamKnowledgePolicy(optionsJson) {
    return invokeLegacy('bridge:setTeamKnowledgePolicy', optionsJson);
  },
  initializeCollaborationWorkspace() {
    return invokeLegacy('bridge:initializeCollaborationWorkspace');
  },
  setCollaborationEnabled(enabled) {
    return invokeLegacy('bridge:setCollaborationEnabled', enabled);
  },
  openCollaborationPath(kind = 'nodeRoot') {
    return invokeLegacy('bridge:openCollaborationPath', kind);
  },
  scanCollaborationInbox() {
    return ipcRenderer.invoke('bridge:scanCollaborationInbox');
  },
  rebuildCollaborationIndex() {
    return ipcRenderer.invoke('bridge:rebuildCollaborationIndex');
  },
  backupCollaborationState() {
    return invokeLegacy('bridge:backupCollaborationState');
  },
  restoreLatestCollaborationState() {
    return invokeLegacy('bridge:restoreLatestCollaborationState');
  },
  updateDirectDeliveryStatus(manifestId, action) {
    return invokeLegacy('bridge:updateDirectDeliveryStatus', manifestId, action);
  },
  getRemoteCollaborationTasks() {
    return invokeLegacy('bridge:getRemoteCollaborationTasks');
  },
  getProjectPublicationOptions(projectId) {
    return invokeLegacy('bridge:getProjectPublicationOptions', projectId);
  },
  publishCollaborationProject(optionsJson) {
    return ipcRenderer.invoke('bridge:publishCollaborationProject', optionsJson);
  },
  selectCollaborationTaskFiles() {
    return invokeLegacy('bridge:selectCollaborationTaskFiles');
  },
  selectCollaborationResultFiles() {
    return invokeLegacy('bridge:selectCollaborationResultFiles');
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
    return invokeLegacy('bridge:exportCollaborationStudentStats', studentId, targetNodeId);
  },
  createCollaborationBinding(optionsJson) {
    return invokeLegacy('bridge:createCollaborationBinding', optionsJson);
  },
  createCollaborationDeviceInvitation() {
    return invokeLegacy('bridge:createCollaborationDeviceInvitation');
  },
  joinCollaborationDevice(value) {
    return ipcRenderer.invoke('bridge:joinCollaborationDevice', value);
  },
  createCollaborationStudentMappingOffer(deviceBindingId, studentId) {
    return invokeLegacy('bridge:createCollaborationStudentMappingOffer', deviceBindingId, studentId);
  },
  acceptCollaborationStudentMappingClipboard(studentId) {
    return invokeLegacy('bridge:acceptCollaborationStudentMappingClipboard', studentId);
  },
  createManualCollaborationInvitation(studentId, localRole) {
    return invokeLegacy('bridge:createManualCollaborationInvitation', studentId, localRole);
  },
  acceptManualCollaborationClipboard(studentId) {
    return invokeLegacy('bridge:acceptManualCollaborationClipboard', studentId);
  },
  updateCollaborationBindingStatus(bindingId, status) {
    return invokeLegacy('bridge:updateCollaborationBindingStatus', bindingId, status);
  },
  deleteRevokedCollaborationBindings(bindingId) {
    return invokeLegacy('bridge:deleteRevokedCollaborationBindings', bindingId);
  },
  saveCollaborationGrant(optionsJson) {
    return invokeLegacy('bridge:saveCollaborationGrant', optionsJson);
  },
  setCollaborationStatisticsSharing(studentId, enabled) {
    return invokeLegacy('bridge:setCollaborationStatisticsSharing', studentId, enabled);
  },
  getCollaborationStudentMaterialStats(studentId, viewerNodeId = '', allowedProjectIdsJson = '[]') {
    return invokeLegacy('bridge:getCollaborationStudentMaterialStats', studentId, viewerNodeId, allowedProjectIdsJson);
  },
  findLanTablets() {
    return invokeLegacy('bridge:findLanTablets');
  },
  findLanTerminals() {
    return invokeLegacy('bridge:findLanTerminals');
  },
  inviteLanTablet(tabletId) {
    return invokeLegacy('bridge:inviteLanTablet', tabletId);
  },
  inviteLanTerminal(terminalId) {
    return invokeLegacy('bridge:inviteLanTerminal', terminalId);
  },
  acceptHostPairRequest(requestId) {
    return invokeLegacy('bridge:acceptHostPairRequest', requestId);
  },
  rejectPairRequest(requestId) {
    return invokeLegacy('bridge:rejectPairRequest', requestId);
  },
  getHostUploadRecords() {
    return invokeLegacy('bridge:getHostUploadRecords');
  },
  exportHostUploadRecords() {
    return invokeLegacy('bridge:exportHostUploadRecords');
  },
  openHostUploadRecord(recordId) {
    return invokeLegacy('bridge:openHostUploadRecord', recordId);
  },
  clearHostUploadRecords() {
    return invokeLegacy('bridge:clearHostUploadRecords');
  },
  setHostUploadRecordStatus(recordId, status) {
    return invokeLegacy('bridge:setHostUploadRecordStatus', recordId, status);
  },
  markStudentDigestSubmitted(studentId) {
    return invokeLegacy('bridge:markStudentDigestSubmitted', studentId);
  },
  getStudentMaterialPathIssues(studentId) {
    return invokeLegacy('bridge:getStudentMaterialPathIssues', studentId);
  },
  retryStudentMaterialPathRecovery(studentId) {
    return invokeLegacy('bridge:retryStudentMaterialPathRecovery', studentId);
  },
  selectStudentMaterialPath(studentId, materialId) {
    return invokeLegacy('bridge:selectStudentMaterialPath', studentId, materialId);
  },
  syncStudentDigestResult(studentId) {
    return invokeLegacy('bridge:syncStudentDigestResult', studentId);
  },
  supplementCompletedStudentDigestLearningEvents(studentId) {
    return ipcRenderer.invoke('bridge:supplementCompletedStudentDigestLearningEvents', studentId);
  },
  startDigestWorkflow(scopeType, scopeId, executor) {
    return ipcRenderer.invoke('bridge:startDigestWorkflow', scopeType, scopeId, executor);
  },
  getDigestWorkflowStatus(scopeType, scopeId) {
    return invokeLegacy('bridge:getDigestWorkflowStatus', scopeType, scopeId);
  },
  getDigestWorkflowCommand(scopeType, scopeId) {
    return invokeLegacy('bridge:getDigestWorkflowCommand', scopeType, scopeId);
  },
  retryDigestWorkflow(scopeType, scopeId, executor) {
    return ipcRenderer.invoke('bridge:retryDigestWorkflow', scopeType, scopeId, executor);
  },
  importDigestWorkflowResultText(scopeType, scopeId, content) {
    return invokeLegacy('bridge:importDigestWorkflowResultText', scopeType, scopeId, content);
  },
  getStudentDigestAudit(studentId) {
    return invokeLegacy('bridge:getStudentDigestAudit', studentId);
  },
  generateStudentDigestAudit(studentId, selectedIdsJson) {
    return invokeLegacy('bridge:generateStudentDigestAudit', studentId, selectedIdsJson);
  },
  syncStudentDigestAudit(studentId) {
    return invokeLegacy('bridge:syncStudentDigestAudit', studentId);
  },
  recordScheduledTaskAction(studentId, kind, commandText) {
    return invokeLegacy('bridge:recordScheduledTaskAction', studentId, kind, commandText);
  },
  getStudentScheduleLedger(studentId) {
    return invokeLegacy('bridge:getStudentScheduleLedger', studentId);
  },
  getTaskCenter() {
    return ipcRenderer.invoke('bridge:getTaskCenter');
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
    return invokeLegacy('bridge:getAgentKnowledgeDiagnostics');
  },
  prepareAgentKnowledgeAccess(studentId) {
    return invokeLegacy('bridge:prepareAgentKnowledgeAccess', studentId);
  },
  getAgentCapabilityManagement(studentId) {
    return invokeLegacy('bridge:getAgentCapabilityManagement', studentId);
  },
  setAgentCapabilityAuthorization(studentId, action) {
    return invokeLegacy('bridge:setAgentCapabilityAuthorization', studentId, action);
  },
  reviewAgentWriteIntent(studentId, intentId) {
    return invokeLegacy('bridge:reviewAgentWriteIntent', studentId, intentId);
  },
  decideAgentWriteIntent(studentId, intentId, digest, action) {
    return invokeLegacy('bridge:decideAgentWriteIntent', studentId, intentId, digest, action);
  },
  getAgentMemoryState(studentId) {
    return ipcRenderer.invoke('bridge:getAgentMemoryState', studentId);
  },
  deleteEmptyAgentMemorySessions(studentId, sessionId = '') {
    return invokeLegacy('bridge:deleteEmptyAgentMemorySessions', studentId, sessionId);
  },
  setAgentMemoryAutomation(studentId, enabled) {
    return invokeLegacy('bridge:setAgentMemoryAutomation', studentId, Boolean(enabled));
  },
  activateAgentMemoryCapture(studentId) {
    return invokeLegacy('bridge:activateAgentMemoryCapture', studentId);
  },
  openCodexHookReview() {
    return invokeLegacy('bridge:openCodexHookReview');
  },
  submitAgentConversation(requestJson) {
    return ipcRenderer.invoke('bridge:submitAgentConversation', requestJson);
  },
  getAgentConversationSubmissionState() {
    return invokeLegacy('bridge:getAgentConversationSubmissionState');
  },
  assignAgentConversationSubmission(submissionId, scopeType, scopeId) {
    return ipcRenderer.invoke('bridge:assignAgentConversationSubmission', submissionId, scopeType, scopeId);
  },
  getTaskCenterCapabilities() {
    return ipcRenderer.invoke('bridge:getTaskCenterCapabilities');
  },
  setTaskAutomationEnabled(enabled) {
    return ipcRenderer.invoke('bridge:setTaskAutomationEnabled', enabled);
  },
  executeTask(taskId, executor) {
    return ipcRenderer.invoke('bridge:executeTask', taskId, executor);
  },
  approveTask(taskId, decision, note) {
    return ipcRenderer.invoke('bridge:approveTask', taskId, decision, note);
  },
  retryTask(taskId) {
    return ipcRenderer.invoke('bridge:retryTask', taskId);
  },
  cancelTask(taskId, note) {
    return ipcRenderer.invoke('bridge:cancelTask', taskId, note);
  },
  deleteTaskHistory(taskId) {
    return ipcRenderer.invoke('bridge:deleteTaskHistory', taskId);
  },
  previewTaskGovernanceBatch(request) {
    return ipcRenderer.invoke('bridge:previewTaskGovernanceBatch', request);
  },
  commitTaskGovernanceBatch(request) {
    return ipcRenderer.invoke('bridge:commitTaskGovernanceBatch', request);
  },
  importTaskResult(taskId) {
    return invokeLegacy('bridge:importTaskResult', taskId);
  },
  importTaskResultText(taskId, content) {
    return invokeLegacy('bridge:importTaskResultText', taskId, content);
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
    return invokeLegacy('bridge:syncQClawTaskResults');
  },
  syncAgentTaskResults(agentId = '') {
    return invokeLegacy('bridge:syncAgentTaskResults', agentId);
  },
  submitDailyActionFeedback(taskId, status, note) {
    return invokeLegacy('bridge:submitDailyActionFeedback', taskId, status, note);
  },
  openTaskCenterPath(kind, agentId = '') {
    return invokeLegacy('bridge:openTaskCenterPath', kind, agentId);
  },
  openTaskResultPath(taskId) {
    return invokeLegacy('bridge:openTaskResultPath', taskId);
  },
  generateStudentMaintenanceReport(studentId) {
    return invokeLegacy('bridge:generateStudentMaintenanceReport', studentId);
  },
  getHostTimeline() {
    return invokeLegacy('bridge:getHostTimeline');
  },
  backupHostData(studentsJson) {
    return ipcRenderer.invoke('bridge:backupHostData', studentsJson);
  },
  restoreHostData() {
    return ipcRenderer.invoke('bridge:restoreHostData');
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
    return invokeLegacy('bridge:openHostMigrationRecord');
  },
  resetHostApiToken() {
    return invokeLegacy('bridge:resetHostApiToken');
  },
  exportHostLogs() {
    return invokeLegacy('bridge:exportHostLogs');
  },
  openStudentRawDir(studentId) {
    return invokeLegacy('bridge:openStudentRawDir', studentId);
  },
  migrateStudentWorkspace(studentId, newName) {
    return invokeLegacy('bridge:migrateStudentWorkspace', studentId, newName);
  },
  rebindAdoptedStudentWorkspace(studentId, selectionMode) {
    return ipcRenderer.invoke('bridge:rebindAdoptedStudentWorkspace', studentId, selectionMode);
  },
  renameHostDevice(deviceId, name) {
    return invokeLegacy('bridge:renameHostDevice', deviceId, name);
  },
  revokeHostDevice(deviceId) {
    return invokeLegacy('bridge:revokeHostDevice', deviceId);
  },
  restoreHostDevice(deviceId) {
    return invokeLegacy('bridge:restoreHostDevice', deviceId);
  },
  deleteHostDevice(deviceId) {
    return invokeLegacy('bridge:deleteHostDevice', deviceId);
  },
  setHostDeviceStudentAccess(deviceId, studentIdsJson) {
    return invokeLegacy('bridge:setHostDeviceStudentAccess', deviceId, studentIdsJson);
  },
  setHostDeviceAccessMode(deviceId, optionsJson) {
    return invokeLegacy('bridge:setHostDeviceAccessMode', deviceId, optionsJson);
  },
  setHostDeviceTerminalMode(deviceId, terminalMode, boundStudentId) {
    return invokeLegacy('bridge:setHostDeviceTerminalMode', deviceId, terminalMode, boundStudentId);
  },
  getCourseCatalogState() {
    return ipcRenderer.invoke('bridge:getCourseCatalogState');
  },
  saveCourseInstitutionPolicy(policyJson) {
    return invokeLegacy('bridge:saveCourseInstitutionPolicy', policyJson);
  },
  importOfflineCourseCatalog() {
    return invokeLegacy('bridge:importOfflineCourseCatalog');
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
    return invokeLegacy('bridge:deleteCustomCourse', courseId);
  },
  selectPlatformCourseImage() {
    return ipcRenderer.invoke('bridge:selectPlatformCourseImage');
  },
  savePlatformCourseDraft(inputJson) {
    return ipcRenderer.invoke('bridge:savePlatformCourseDraft', inputJson);
  },
  removePlatformCourseDraft(courseId) {
    return invokeLegacy('bridge:removePlatformCourseDraft', courseId);
  },
  queuePlatformCourseDeletion(courseId) {
    return invokeLegacy('bridge:queuePlatformCourseDeletion', courseId);
  },
  cancelPlatformCourseDeletion(courseId) {
    return invokeLegacy('bridge:cancelPlatformCourseDeletion', courseId);
  },
  publishPlatformCourseCatalog(releaseNotes) {
    return invokeLegacy('bridge:publishPlatformCourseCatalog', releaseNotes);
  },
  reExportPlatformCourseCatalog() {
    return invokeLegacy('bridge:reExportPlatformCourseCatalog');
  },
  rollbackPlatformCourseCatalog() {
    return invokeLegacy('bridge:rollbackPlatformCourseCatalog');
  },
  openCourseView(courseId) {
    return invokeLegacy('bridge:openCourseView', courseId);
  },
  closeCourseView() {
    return invokeLegacy('bridge:closeCourseView');
  },
  setCourseCaptureSetupVisible(visible) {
    return invokeLegacy('bridge:setCourseCaptureSetupVisible', visible);
  },
  setCourseViewLayout(layoutJson) {
    return invokeLegacy('bridge:setCourseViewLayout', layoutJson);
  },
});
