const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('terminalBridge', {
  getConfig: () => ipcRenderer.invoke('terminal:get-config'),
  getTailscaleStatus: () => ipcRenderer.invoke('terminal:get-tailscale-status'),
  openTailscale: () => ipcRenderer.invoke('terminal:open-tailscale'),
  downloadTailscale: () => ipcRenderer.invoke('terminal:download-tailscale'),
  getPairingState: (query = '') => ipcRenderer.invoke('terminal:get-pairing-state', query),
  findLanHosts: (query = '') => ipcRenderer.invoke('terminal:find-lan-hosts', query),
  requestHostPair: (hostDeviceId) => ipcRenderer.invoke('terminal:request-host-pair', hostDeviceId),
  cancelPairRequest: () => ipcRenderer.invoke('terminal:cancel-pair-request'),
  acceptPairInvite: () => ipcRenderer.invoke('terminal:accept-pair-invite'),
  rejectPairInvite: () => ipcRenderer.invoke('terminal:reject-pair-invite'),
  copyMachineCode: () => ipcRenderer.invoke('terminal:copy-machine-code'),
  pair: (input) => ipcRenderer.invoke('terminal:pair', input),
  disconnect: () => ipcRenderer.invoke('terminal:disconnect'),
  loadState: () => ipcRenderer.invoke('terminal:load-state'),
  setMode: (terminalMode) => ipcRenderer.invoke('terminal:set-mode', terminalMode),
  loginStudent: (loginId) => ipcRenderer.invoke('terminal:login-student', loginId),
  logoutStudent: () => ipcRenderer.invoke('terminal:logout-student'),
  getAgentCapture: () => ipcRenderer.invoke('terminal:get-agent-capture'),
  setAgentCapture: (enabled) => ipcRenderer.invoke('terminal:set-agent-capture', enabled),
  runAgentCapture: () => ipcRenderer.invoke('terminal:run-agent-capture'),
  chooseAndUploadFiles: (target) => ipcRenderer.invoke('terminal:choose-files', target),
  chooseAutoFolder: () => ipcRenderer.invoke('terminal:choose-auto-folder'),
  configureAutoDelivery: (input) => ipcRenderer.invoke('terminal:configure-auto-delivery', input),
  runAutoDelivery: () => ipcRenderer.invoke('terminal:run-auto-delivery'),
  listLearningReports: () => ipcRenderer.invoke('terminal:list-learning-reports'),
  getGrowthSummary: () => ipcRenderer.invoke('terminal:get-growth-summary'),
  readLearningReport: (reportId) => ipcRenderer.invoke('terminal:read-learning-report', reportId),
  listArchiveFiles: () => ipcRenderer.invoke('terminal:list-archive-files'),
  readArchiveFile: (relativePath) => ipcRenderer.invoke('terminal:read-archive-file', relativePath),
  listProjectKnowledgeFiles: (projectId) => ipcRenderer.invoke('terminal:list-project-knowledge-files', projectId),
  readProjectKnowledgeFile: (projectId, relativePath) => ipcRenderer.invoke('terminal:read-project-knowledge-file', projectId, relativePath),
  listCourses: () => ipcRenderer.invoke('terminal:list-courses'),
  openCourse: (courseId) => ipcRenderer.invoke('terminal:open-course', courseId),
  closeCourse: () => ipcRenderer.invoke('terminal:close-course'),
  listCaptureSources: () => ipcRenderer.invoke('terminal:list-capture-sources'),
  startCapture: (input) => ipcRenderer.invoke('terminal:start-capture', input),
  stopCapture: () => ipcRenderer.invoke('terminal:stop-capture'),
  uploadCapture: (input) => ipcRenderer.invoke('terminal:upload-capture', input),
  onUploadProgress: (handler) => ipcRenderer.on('terminal:upload-progress', (_event, payload) => handler(payload)),
  onAutoDelivery: (handler) => ipcRenderer.on('terminal:auto-delivery', (_event, payload) => handler(payload)),
  onCaptureChanged: (handler) => ipcRenderer.on('terminal:capture-changed', (_event, payload) => handler(payload)),
  onCourseBrowserChanged: (handler) => ipcRenderer.on('terminal:course-browser-changed', (_event, payload) => handler(payload)),
  onAgentCaptureChanged: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('terminal:agent-capture-changed', listener);
    return () => ipcRenderer.removeListener('terminal:agent-capture-changed', listener);
  },
  onPairingChanged: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('terminal:pairing-changed', listener);
    return () => ipcRenderer.removeListener('terminal:pairing-changed', listener);
  },
});
