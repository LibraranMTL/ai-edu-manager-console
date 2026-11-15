const { app, BrowserWindow, clipboard, desktopCapturer, dialog, ipcMain, nativeImage, screen, shell } = require('electron');
const crypto = require('crypto');
const { captureControlBounds, loadVisibleCaptureControlWindow } = require('./capture-control-window.cjs');
const dgram = require('dgram');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
function packagedCandidateTag() {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    return String(manifest.eduCandidateTag || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  } catch {
    return '';
  }
}

// Candidate packages must never be captured by a previously launched candidate.
// Formal packages retain the established user-data location and behaviour.
const candidateRuntimeTag = packagedCandidateTag();
const isolatedUserData = app.commandLine.getSwitchValue('user-data-dir');
if (isolatedUserData) {
  if (!path.isAbsolute(isolatedUserData) || path.resolve(isolatedUserData) === path.parse(path.resolve(isolatedUserData)).root) throw Error('隔离用户目录必须为非根目录的绝对路径');
  fs.mkdirSync(isolatedUserData, { recursive: true });
  app.setPath('userData', path.resolve(isolatedUserData));
} else if (candidateRuntimeTag) {
  const candidateUserData = path.join(app.getPath('appData'), 'AI Education Student Terminal Candidates', candidateRuntimeTag);
  fs.mkdirSync(candidateUserData, { recursive: true });
  app.setPath('userData', candidateUserData);
}
const { WebContentsView, session } = require('electron');
const {
  coursePartition,
  installCourseGuards,
  secureCourseWebPreferences,
} = require('./course-browser.cjs');
const { loadCourseTrustPolicy } = require('./course-trust-policy.cjs');
const { validateStudentCourseProjection, isCourseStartFallbackAllowed } = require('./student-course-trust.cjs');
const { parseGrowthIndexMarkdown } = require('./growth-markdown-summary.cjs');
const {
  buildTargetUploadPath,
  isTerminalUploadFile,
  normalizeHostUrl,
  normalizeUploadTarget,
  projectsForStudent,
  publicTerminalUploadQueue,
  readTerminalUploadQueue,
  recoverTerminalUploadQueue,
  stageTerminalUpload,
  stableUploadId,
  terminalUploadAcknowledgement,
  terminalUploadNextAction,
  verifyTerminalStagedCopy,
  writeTerminalUploadQueue,
} = require('./terminal-upload.cjs');
const { createPairRequest, machineCode } = require('./pairing-protocol.cjs');
const { lanDiscoveryBroadcastTargets } = require('./lan-discovery.cjs');
const {
  HOST_DISCOVERY_PORT,
  HOST_DISCOVERY_REQUEST_V1,
  HOST_DISCOVERY_REQUEST_V2,
  HOST_PAIR_INVITE,
  filterDiscoveredHosts,
  hostUrlFromDiscovery,
  normalizeDiscoveredHost,
} = require('./terminal-lan-pairing.cjs');
const { parseConnectionPayload } = require('./terminal-connection.cjs');
const {
  TAILSCALE_WINDOWS_DOWNLOAD_URL,
  findWindowsTailscaleInstall,
} = require('./windows-tailscale.cjs');
const {
  detectLifecycleAgents,
  drainTerminalLifecycleQueue,
  reconcileTerminalLifecycle,
  setTerminalLifecycleDescriptorEnabled,
  terminalLifecyclePaths,
} = require('./student-agent-lifecycle.cjs');
const { AUTO_CAPTURE_AGENT_IDS } = require('./agent-adapter-registry.cjs');
const { captureSaveDecision, normalizeCaptureOptions } = require('./capture-protocol.cjs');
const { createTerminalAgentBridge } = require('./terminal-agent-bridge.cjs');
const {
  ACTIONS: COMPANION_ACTIONS,
  MODE_GROUPS: COMPANION_MODE_GROUPS,
  createCompanionPromptPacket,
} = require('./companion-toolbar.cjs');

app.setName('AI Education Student Terminal');

const TERMINAL_VERSION = app.getVersion();
const terminalUserData = () => app.getPath('userData');
const configPath = () => path.join(terminalUserData(), 'terminal-config.json');
const deliveryPath = () => path.join(terminalUserData(), 'delivery-ledger.json');
const terminalUploadQueuePath = () => path.join(terminalUserData(), 'terminal-upload-queue.json');
const terminalUploadStagingRoot = () => path.join(terminalUserData(), 'terminal-upload-staging');
const practiceAttemptQueuePath = () => path.join(terminalUserData(), 'practice-attempt-queue.json');
const courseProjectionCachePath = () => path.join(terminalUserData(), 'course-projection-cache-v2.json');
const courseTrustPolicy = loadCourseTrustPolicy({
  resourceRoots: [path.join(__dirname, '..', 'dist'), path.join(__dirname, '..', 'public')],
});
const captureRoot = () => path.join(terminalUserData(), 'screen-captures');
const capturedMediaRoot = () => path.join(terminalUserData(), 'captured-media');
const conversationImportQueuePath = () => path.join(terminalUserData(), 'conversation-import-drafts.json');
const captureDeliveryQueuePath = () => path.join(terminalUserData(), 'capture-delivery-queue.json');
const captureSampleLogPath = (session) => path.join(String(session?.folder || ''), 'capture-samples.jsonl');
const captureSampleIndexPath = (session) => path.join(String(session?.folder || ''), 'capture-samples.index.json');
let mainWindow = null;
let autoDeliveryTimer = null;
let autoDeliveryBusy = false;
let terminalUploadTimer = null;
let terminalUploadBusy = false;
let terminalUploadMutation = Promise.resolve();
let captureDeliveryTimer = null;
let captureDeliveryBusy = false;
let activeCapture = null;
let captureControlWindow = null;
let companionWindow = null;
let companionPopoverWindow = null;
let companionPopoverMode = '';
let companionPopoverLoaded = false;
let companionSelectedProjectId = '';
let courseView = null;
let activeCourse = null;
let courseViewTop = 300;
let courseLearningFullscreen = false;
let effectiveCourseCache = [];
let effectiveProjectCache = [];
let terminalDiscoverySocket = null;
let terminalDiscoveryError = '';
let lastHostDiscoveryAt = '';
let pairStatusTimer = null;
let pairStatusBusy = false;
let agentCaptureDrainTimer = null;
let agentCaptureInstallTimer = null;
let agentCaptureBusy = false;
let agentCaptureRetryAt = 0;
let agentCaptureRetryDelayMs = 2000;
let terminalAgentBridge = null;
const pendingConversationImports = [];
const discoveredLanHosts = new Map();
const CAPTURE_DELIVERY_RETRY_DELAYS = [60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000];
const SENSITIVE_CAPTURE_SOURCE_PATTERN = /password|credential|secret|token|authenticator|1password|bitwarden|keepass|微信|wechat|qq|钉钉|dingtalk|飞书|lark|telegram|whatsapp|mail|邮箱|邮件/i;

function isSensitiveCaptureSourceName(value = '') {
  return SENSITIVE_CAPTURE_SOURCE_PATTERN.test(String(value || ''));
}

function deidentifyCaptureSourceName(value = '', sourceType = 'screen') {
  if (sourceType === 'screen') return '已授权屏幕';
  const compact = String(value || '').replace(/[\r\n\t]+/g, ' ').trim();
  const application = compact.split(/\s[-—|]\s/).at(-1)?.trim();
  return application && application.length <= 48 ? application : '已授权应用窗口';
}

function readJson(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

function appendCaptureSample(session, input = {}) {
  if (!session?.folder || !session?.id) return null;
  const sampledAt = String(input.sampledAt || new Date().toISOString());
  const sample = {
    schema: 'edu-manager.capture-sample.v1',
    platform: 'windows-student-terminal',
    deviceId: String(deviceId() || ''),
    studentId: String(session.studentId || ''),
    sessionId: String(session.id),
    sourceType: String(session.sourceType || 'screen'),
    sampledAt,
    decision: String(input.decision || 'unknown'),
    difference: Number.isFinite(Number(input.difference)) ? Number(input.difference) : null,
    captureItemId: String(input.captureItemId || ''),
    paused: Boolean(input.paused),
  };
  if (sample.captureItemId) {
    sample.hashAlgorithm = String(input.hashAlgorithm || '');
    sample.contentHash = String(input.contentHash || '');
    sample.path = String(input.path || '');
  }
  fs.mkdirSync(session.folder, { recursive: true });
  fs.appendFileSync(captureSampleLogPath(session), `${JSON.stringify(sample)}\n`, 'utf8');
  session.sampleCount = Number(session.sampleCount || 0) + 1;
  session.lastSampledAt = sampledAt;
  if (!sample.paused && !['paused', 'source_unavailable', 'capture_error'].includes(sample.decision)) session.lastTrustedSampleAt = sampledAt;
  return sample;
}

function readCaptureSamples(session) {
  const logPath = captureSampleLogPath(session);
  try {
    return fs.readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter((sample) => sample && String(sample.sessionId || '') === String(session?.id || ''));
  } catch { return []; }
}

function writeCaptureSampleIndex(session) {
  const samples = readCaptureSamples(session);
  const target = captureSampleIndexPath(session);
  writeJson(target, {
    schema: 'edu-manager.capture-sample-index.v1',
    platform: 'windows-student-terminal',
    deviceId: String(deviceId() || ''),
    studentId: String(session?.studentId || ''),
    sessionId: String(session?.id || ''),
    sourceType: String(session?.sourceType || 'screen'),
    startedAt: String(session?.startedAt || ''),
    endedAt: String(session?.endedAt || ''),
    endReason: String(session?.endReason || ''),
    capturePolicy: {
      mode: String(session?.options?.mode || ''),
      sampleIntervalMs: Number(session?.options?.sampleIntervalMs || 0),
      maximumSaveIntervalMs: Number(session?.options?.maximumSaveIntervalMs || 0),
    },
    counts: {
      screenshotCount: Number(session?.count || session?.files?.length || 0),
      candidateFrameCount: Number(session?.candidateFrameCount || 0),
      deduplicatedCount: Number(session?.deduplicatedCount || 0),
      sampleCount: samples.length,
    },
    items: (Array.isArray(session?.items) ? session.items : []).map((item) => ({
      captureItemId: String(item.id || ''),
      capturedAt: String(item.capturedAt || ''),
      hashAlgorithm: String(item.hashAlgorithm || ''),
      contentHash: String(item.contentHash || ''),
      path: String(item.path || ''),
    })),
    samples,
    generatedAt: new Date().toISOString(),
  });
  return target;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temporary, filePath);
}

function remoteStateCachePath() {
  return path.join(terminalUserData(), 'remote-state-cache.json');
}

function projectMaterialCachePath() {
  return path.join(terminalUserData(), 'project-material-view-cache.json');
}

function cacheScope(config = readConfig()) {
  return { hostId: String(config.hostScope?.hostId || ''),
    dataGeneration: String(config.hostScope?.dataGeneration || ''),
    studentId: String(config.currentStudent?.id || '') };
}

function sameCacheScope(left, right) {
  return Boolean(left?.hostId && left?.dataGeneration && left?.studentId
    && left.hostId === right.hostId && left.dataGeneration === right.dataGeneration
    && left.studentId === right.studentId);
}

function cacheFallbackAllowed(error) {
  return !Number(error?.status) || Number(error.status) >= 500;
}

function saveRemoteStateCache(payload, config = readConfig()) {
  const scope = cacheScope(config);
  if (!scope.hostId || !scope.dataGeneration || !scope.studentId) return;
  writeJson(remoteStateCachePath(), { version: 1, scope, cachedAt: new Date().toISOString(),
    payload: { students: payload.students || (payload.student ? [payload.student] : []),
      projects: payload.projects || [], student: payload.student || config.currentStudent || null,
      device: payload.device || null } });
}

function loadRemoteStateCache(config = readConfig()) {
  const cached = readJson(remoteStateCachePath(), null);
  if (!cached || cached.version !== 1 || !sameCacheScope(cached.scope, cacheScope(config))) return null;
  const age = Date.now() - Date.parse(cached.cachedAt || '');
  if (!Number.isFinite(age) || age < 0 || age > 24 * 60 * 60 * 1000) return null;
  return cached;
}

function projectViewCacheKey(projectId, query, config = readConfig()) {
  const scope = cacheScope(config);
  return JSON.stringify([scope.hostId, scope.dataGeneration, scope.studentId, String(projectId),
    String(query?.view || 'materials'), String(query?.search || ''), String(query?.categoryId || ''),
    Number(query?.offset ?? 0), Number(query?.limit ?? 50)]);
}

function saveProjectMaterialViewCache(projectId, query, payload, config = readConfig()) {
  if (!['materials', 'pending', 'knowledge'].includes(String(query?.view || 'materials'))) return;
  const scope = cacheScope(config);
  if (!scope.hostId || !scope.dataGeneration || !scope.studentId) return;
  const store = readJson(projectMaterialCachePath(), { version: 1, entries: [] });
  const key = projectViewCacheKey(projectId, query, config);
  const entries = (Array.isArray(store.entries) ? store.entries : []).filter((item) => item.key !== key);
  entries.push({ key, scope, cachedAt: new Date().toISOString(), payload });
  writeJson(projectMaterialCachePath(), { version: 1, entries: entries.slice(-80) });
}

function loadProjectMaterialViewCache(projectId, query, config = readConfig()) {
  if (!['materials', 'pending', 'knowledge'].includes(String(query?.view || 'materials'))) return null;
  const store = readJson(projectMaterialCachePath(), { entries: [] });
  const key = projectViewCacheKey(projectId, query, config);
  const found = (Array.isArray(store.entries) ? store.entries : []).find((item) => item.key === key
    && sameCacheScope(item.scope, cacheScope(config)));
  if (!found) return null;
  const age = Date.now() - Date.parse(found.cachedAt || '');
  if (!Number.isFinite(age) || age < 0 || age > 24 * 60 * 60 * 1000) return null;
  return found;
}

function deviceId() {
  const config = readConfig();
  if (config.deviceId) return config.deviceId;
  const value = `windows-terminal-${crypto.randomUUID()}`;
  writeConfig({ ...config, deviceId: value });
  return value;
}

function readConfig() {
  return {
    version: 2,
    hostUrl: '',
    token: '',
    sessionToken: '',
    terminalMode: 'shared',
    currentStudent: null,
    deviceId: '',
    deviceName: `${os.hostname()} · Windows 学生终端`,
    autoDelivery: { enabled: false, folder: '', target: null },
    agentCapture: { enabled: false, registrations: {}, warnings: [], pending: 0 },
    ...readJson(configPath(), {}),
  };
}

function writeConfig(value) {
  const next = { ...readConfig(), ...value, updatedAt: new Date().toISOString() };
  writeJson(configPath(), next);
  try { sendTerminalCompanionState(); } catch {}
  return next;
}

function publicConfig() {
  const config = readConfig();
  const { pendingPairRequest: _pendingPairRequest, pendingPairInvite: _pendingPairInvite, ...safeConfig } = config;
  const terminalDeviceId = deviceId();
  return {
    ...safeConfig,
    deviceId: terminalDeviceId,
    machineCode: machineCode('tablet', terminalDeviceId),
    token: config.token ? `${config.token.slice(0, 7)}…${config.token.slice(-5)}` : '',
    sessionToken: '',
    connected: Boolean(config.hostUrl && config.token),
    studentSessionActive: Boolean(config.sessionToken && config.currentStudent?.id),
    version: TERMINAL_VERSION,
  };
}

function terminalIdentity() {
  const config = readConfig();
  const terminalDeviceId = deviceId();
  return {
    deviceId: terminalDeviceId,
    machineCode: machineCode('tablet', terminalDeviceId),
    displayName: String(config.deviceName || `${os.hostname()} · Windows 学生终端`).trim().slice(0, 80) || 'Windows 学生终端',
  };
}

function publicPendingPairRequest(request) {
  if (!request) return null;
  const { requestToken: _requestToken, ...safe } = request;
  return safe;
}

function publicPendingPairInvite(invite) {
  if (!invite) return null;
  const { requestToken: _requestToken, ...safe } = invite;
  return safe;
}

function activeDiscoveredHosts() {
  const cutoff = Date.now() - 5 * 60 * 1000;
  return [...discoveredLanHosts.values()]
    .filter((host) => Date.parse(host.lastSeenAt || 0) >= cutoff)
    .sort((a, b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)));
}

function terminalPairingState(query = '') {
  let config = readConfig();
  if (config.pendingPairInvite?.expiresAt && Date.parse(config.pendingPairInvite.expiresAt) <= Date.now()) {
    config = writeConfig({
      pendingPairInvite: null,
      lastPairingResult: { status: 'expired', message: '主机连接邀请已超时，请重新扫描或让主机再次邀请。', updatedAt: new Date().toISOString() },
    });
  }
  return {
    discoveryRunning: Boolean(terminalDiscoverySocket),
    discoveryPort: HOST_DISCOVERY_PORT,
    discoveryError: terminalDiscoveryError,
    lastHostDiscoveryAt,
    terminalIdentity: terminalIdentity(),
    discoveredHosts: filterDiscoveredHosts(activeDiscoveredHosts(), query),
    pendingRequest: publicPendingPairRequest(config.pendingPairRequest),
    pendingInvite: publicPendingPairInvite(config.pendingPairInvite),
    lastResult: config.lastPairingResult || null,
  };
}

function notifyPairingChanged() {
  notify('terminal:pairing-changed', { state: terminalPairingState(), config: publicConfig() });
}

function notify(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function parseExternalConversationImport(argv = []) {
  for (const raw of argv.map(String)) {
    if (raw.startsWith('ai-education-student://')) {
      try {
        const url = new URL(raw);
        if (url.hostname !== 'import-conversation') continue;
        const link = String(url.searchParams.get('url') || '').trim();
        const text = String(url.searchParams.get('text') || '').trim();
        if (link.startsWith('https://')) return { source: 'protocol', link, text: text.slice(0, 60_000) };
        if (text) return { source: 'protocol', link: '', text: text.slice(0, 60_000) };
      } catch {}
    }
    if (raw.startsWith('--import-conversation=')) {
      const value = raw.slice('--import-conversation='.length).trim().replace(/^"|"$/g, '');
      if (value.startsWith('https://')) return { source: 'command-line', link: value, text: '' };
      if (fs.existsSync(value) && fs.statSync(value).isFile() && /\.(txt|md|json)$/i.test(value) && fs.statSync(value).size <= 5 * 1024 * 1024) {
        return { source: 'command-line-file', link: '', text: fs.readFileSync(value, 'utf8').slice(0, 60_000), name: path.basename(value) };
      }
      if (value) return { source: 'command-line', link: '', text: value.slice(0, 60_000) };
    }
  }
  return null;
}

function queueExternalConversationImport(argv) {
  const payload = parseExternalConversationImport(argv);
  if (!payload) return false;
  pendingConversationImports.push({ ...payload, draftId: `windows-share-${crypto.randomUUID()}`, receivedAt: new Date().toISOString() });
  if (pendingConversationImports.length > 20) pendingConversationImports.splice(0, pendingConversationImports.length - 20);
  writeJson(conversationImportQueuePath(), { version: 1, drafts: pendingConversationImports });
  notify('terminal:conversation-import', pendingConversationImports.at(-1));
  if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); }
  return true;
}

async function requestJson(route, options = {}) {
  const config = readConfig();
  const hostUrl = normalizeHostUrl(options.hostUrl || config.hostUrl);
  if (!hostUrl) throw new Error('尚未设置有效的主机地址。');
  const response = await fetch(`${hostUrl}${route}`, {
    method: options.method || 'GET',
    headers: {
      ...(options.token || (options.deviceToken ? config.token : (config.sessionToken || config.token)) ? { Authorization: `Bearer ${options.token || (options.deviceToken ? config.token : (config.sessionToken || config.token))}` } : {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    ...(options.timeoutMs ? { signal: AbortSignal.timeout(Number(options.timeoutMs)) } : {}),
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; }
  catch { payload = { ok: false, message: text || `HTTP ${response.status}` }; }
  if (response.status === 304 && options.allowNotModified === true) return { __notModified: true, __etag: response.headers.get('etag') || '' };
  if (!response.ok || payload.ok === false) {
    const error = new Error(payload.message || `HTTP ${response.status}`);
    error.status = response.status;
    error.code = String(payload.code || '');
    error.retryable = payload.retryable;
    error.payload = payload;
    throw error;
  }
  return options.returnResponseMeta ? { ...payload, __etag: response.headers.get('etag') || '' } : payload;
}

function normalizedHostScope(value = {}, hostUrl = '') {
  return {
    hostId: String(value.hostId || '').trim(),
    dataGeneration: String(value.dataGeneration || '').trim(),
    hostUrl: normalizeHostUrl(hostUrl || value.hostUrl),
    observedAt: String(value.observedAt || ''),
  };
}

async function observeHostScope(hostUrl = readConfig().hostUrl) {
  const normalizedUrl = normalizeHostUrl(hostUrl);
  if (!normalizedUrl) throw new Error('尚未设置有效的主机地址。');
  const health = await requestJson('/api/health', { hostUrl: normalizedUrl, timeoutMs: 10000 });
  const scope = normalizedHostScope({
    hostId: health.hostId,
    dataGeneration: health.dataGeneration || (health.hostId ? 'legacy-unverified' : ''),
    observedAt: new Date().toISOString(),
  }, normalizedUrl);
  if (!scope.hostId) {
    const error = new Error('当前主机不提供可核实的固定身份；旧上传方式仍需在升级主机后才能安全进入持久队列。');
    error.code = 'upload_queue_unsupported';
    throw error;
  }
  return scope;
}

async function bindCurrentHostScope(hostUrl, expectedHostId = '') {
  const observed = await observeHostScope(hostUrl);
  if (expectedHostId && observed.hostId !== String(expectedHostId)) {
    const error = new Error('连接响应与主机身份不一致，未更新上传目标。');
    error.code = 'host_identity_changed';
    throw error;
  }
  writeConfig({ hostScope: observed, observedHostScope: observed });
  return observed;
}

async function hostScopeAfterPairing(hostUrl, expectedHostId = '') {
  try { return await bindCurrentHostScope(hostUrl, expectedHostId); }
  catch (error) {
    const fallback = normalizedHostScope({ hostId: expectedHostId,
      dataGeneration: expectedHostId ? 'legacy-unverified' : '' }, hostUrl);
    writeConfig({ hostScope: fallback, observedHostScope: fallback,
      uploadQueueWarning: `主机身份或资料代次尚未核实：${error.message}` });
    return fallback;
  }
}

async function inspectCurrentHostScope(options = {}) {
  const config = readConfig();
  const observed = await observeHostScope(config.hostUrl);
  const bound = normalizedHostScope(config.hostScope, config.hostUrl);
  if (!bound.hostId && options.adoptIfMissing !== false) {
    writeConfig({ hostScope: observed, observedHostScope: observed });
    return { bound: observed, observed, changed: false, adopted: true };
  }
  writeConfig({ observedHostScope: observed });
  return {
    bound,
    observed,
    changed: Boolean(bound.hostId && (bound.hostId !== observed.hostId || bound.dataGeneration !== observed.dataGeneration)),
    hostChanged: Boolean(bound.hostId && bound.hostId !== observed.hostId),
    generationChanged: Boolean(bound.hostId === observed.hostId && bound.dataGeneration !== observed.dataGeneration),
  };
}

function withTerminalUploadMutation(operation) {
  const next = terminalUploadMutation.then(operation, operation);
  terminalUploadMutation = next.catch(() => {});
  return next;
}

function currentStudentUploadQueue() {
  const config = readConfig();
  const studentId = String(config.currentStudent?.id || '');
  const queue = readTerminalUploadQueue(terminalUploadQueuePath());
  const scopedItems = studentId ? queue.items.filter((item) => item.studentId === studentId) : [];
  const unscopedLegacy = studentId ? queue.items.filter((item) => !item.studentId && item.migrationIssues?.length)
    .map((item) => ({ ...item, filename: '旧上传记录（归属待补充）', target: normalizeUploadTarget({}),
      lastError: '旧上传记录缺少学生或目标归属，已暂停且未删除；请由原使用者或主机管理员核对。' })) : [];
  const scoped = { ...queue, items: [...scopedItems, ...unscopedLegacy] };
  return {
    ...publicTerminalUploadQueue(scoped),
    hostScope: normalizedHostScope(config.hostScope, config.hostUrl),
    observedHostScope: normalizedHostScope(config.observedHostScope, config.hostUrl),
  };
}

function notifyTerminalUploadQueue() {
  notify('terminal:upload-queue-changed', currentStudentUploadQueue());
}

async function mutateTerminalUploadQueue(update) {
  return withTerminalUploadMutation(async () => {
    const queue = readTerminalUploadQueue(terminalUploadQueuePath());
    const result = await update(queue);
    writeTerminalUploadQueue(terminalUploadQueuePath(), queue);
    notifyTerminalUploadQueue();
    return result;
  });
}

async function acknowledgeCurrentHostGeneration() {
  const state = await inspectCurrentHostScope({ adoptIfMissing: false });
  if (state.bound.hostId && state.bound.hostId !== state.observed.hostId) {
    throw new Error('当前连接的是另一台主机，请重新配对；旧待上传资料不会自动改投。');
  }
  writeConfig({ hostScope: state.observed, observedHostScope: state.observed, uploadQueueWarning: '' });
  notifyTerminalUploadQueue();
  return { ok: true, queue: currentStudentUploadQueue(),
    message: '已确认当前主机资料代次。旧代次中结果不明的记录仍保留，不会自动重放。' };
}

function publicAgentCaptureState(config = readConfig()) {
  const capture = config.agentCapture || {};
  const registrations = capture.registrations && typeof capture.registrations === 'object' ? capture.registrations : {};
  return {
    enabled: Boolean(capture.enabled),
    active: Boolean(
      capture.enabled
      && config.terminalMode === 'personal'
      && config.sessionToken
      && config.currentStudent?.id
    ),
    registrations,
    warnings: Array.isArray(capture.warnings) ? capture.warnings : [],
    installedCount: Object.values(registrations).filter((item) => item?.installed).length,
    connectedCount: Object.values(registrations).filter((item) => item?.connected).length,
    pending: Math.max(0, Number(capture.pending || 0)),
    lastSyncAt: String(capture.lastSyncAt || ''),
    message: String(capture.message || ''),
  };
}

function notifyAgentCaptureChanged(config = readConfig()) {
  notify('terminal:agent-capture-changed', publicAgentCaptureState(config));
}

function updateLocalAgentCapture(patch = {}) {
  const config = readConfig();
  const next = writeConfig({
    agentCapture: {
      ...(config.agentCapture || {}),
      ...patch,
      updatedAt: new Date().toISOString(),
    },
  });
  notifyAgentCaptureChanged(next);
  return next;
}

function detectedAgentCaptureRegistrations(existing = {}, preserveConnections = false) {
  const detected = detectLifecycleAgents();
  return Object.fromEntries(AUTO_CAPTURE_AGENT_IDS.map((agentId) => {
    const installed = Boolean(detected[agentId]?.installed);
    const previous = existing[agentId] || {};
    return [agentId, {
      installed,
      connected: Boolean(preserveConnections && installed && previous.connected),
      ...(previous.warning ? { warning: String(previous.warning) } : {}),
    }];
  }));
}

function refreshLocalAgentCaptureInventory(config = readConfig()) {
  const registrations = detectedAgentCaptureRegistrations(config.agentCapture?.registrations, false);
  if (JSON.stringify(registrations) === JSON.stringify(config.agentCapture?.registrations || {})) return config;
  return updateLocalAgentCapture({ registrations });
}

function reconcilePersonalAgentCapture(config = readConfig()) {
  if (
    config.terminalMode !== 'personal'
    || !config.sessionToken
    || !config.currentStudent?.id
    || !config.agentCapture?.enabled
    || !config.agentCapture?.captureEpoch
    || !config.agentCapture?.authorizedAt
  ) {
    setTerminalLifecycleDescriptorEnabled(terminalUserData(), false);
    return { enabled: false, registrations: config.agentCapture?.registrations || {}, warnings: [] };
  }
  const result = reconcileTerminalLifecycle({
    userDataDir: terminalUserData(),
    hookSourcePath: path.join(__dirname, 'agent-lifecycle-hook.ps1'),
    studentId: String(config.currentStudent.id),
    deviceId: deviceId(),
    enabled: true,
    captureEpoch: config.agentCapture.captureEpoch,
    authorizedAt: config.agentCapture.authorizedAt,
    detectedAgents: detectLifecycleAgents(),
  });
  updateLocalAgentCapture({
    registrations: result.registrations,
    warnings: result.warnings,
    message: result.warnings.length
      ? `部分 Agent 暂未接入：${result.warnings.join('；')}`
      : '已写入受支持 Agent 的接入配置；Codex 需在客户端信任 Hook，请用新会话确认实际送达。',
  });
  return result;
}

async function authorizePersonalAgentCapture(enabled) {
  agentCaptureRetryAt = 0;
  agentCaptureRetryDelayMs = 2000;
  const { config, studentId } = currentStudentSession();
  if (config.terminalMode !== 'personal') throw new Error('只有个人终端可以启用自动会话采集。');
  if (!enabled) {
    reconcileTerminalLifecycle({
      userDataDir: terminalUserData(),
      hookSourcePath: path.join(__dirname, 'agent-lifecycle-hook.ps1'),
      studentId,
      deviceId: deviceId(),
      enabled: false,
      captureEpoch: '',
      authorizedAt: '',
      detectedAgents: detectLifecycleAgents(),
    });
    updateLocalAgentCapture({
      enabled: false,
      captureEpoch: '',
      authorizedAt: '',
      registrations: detectedAgentCaptureRegistrations({}, false),
      warnings: [],
      pending: 0,
      message: '此个人终端已停止采集；已有归档不会删除。',
    });
    const remote = await requestJson('/api/student-session/agent-memory/capture', {
      method: 'POST',
      token: config.sessionToken,
      body: { enabled: false },
    });
    return { ...publicAgentCaptureState(), message: remote.message || publicAgentCaptureState().message };
  }
  let remote;
  try {
    remote = await requestJson('/api/student-session/agent-memory/capture', {
      method: 'POST',
      token: config.sessionToken,
      body: { enabled: true },
    });
  } catch (error) {
    const status = Number(error.status || 0);
    const detail = status === 404
      ? '当前 Windows 主机版本不支持个人终端自动会话采集，请将主机升级到 0.16.10 或更高版本。'
      : `未能从主机取得采集授权：${error.message}`;
    updateLocalAgentCapture({
      enabled: false,
      registrations: detectedAgentCaptureRegistrations({}, false),
      warnings: [detail],
      message: detail,
    });
    const failure = new Error(detail);
    failure.status = status;
    throw failure;
  }
  if (!remote.capture?.captureEpoch || !remote.capture?.authorizedAt) {
    setTerminalLifecycleDescriptorEnabled(terminalUserData(), false);
    updateLocalAgentCapture({ enabled: false, captureEpoch: '', authorizedAt: '' });
    throw new Error('当前 Windows 主机尚不支持旧会话授权后续采集，请升级主机后重试。');
  }
  const next = updateLocalAgentCapture({
    enabled: true,
    captureEpoch: remote.capture.captureEpoch,
    authorizedAt: remote.capture.authorizedAt,
    message: remote.message || '已授权此个人终端采集后续轮次。',
  });
  reconcilePersonalAgentCapture(next);
  await runAgentCaptureDrain();
  return { ...publicAgentCaptureState(), message: remote.message || publicAgentCaptureState().message };
}

async function refreshPersonalAgentCapture() {
  const config = readConfig();
  if (
    config.terminalMode !== 'personal'
    || !config.sessionToken
    || !config.currentStudent?.id
    || !config.agentCapture?.enabled
  ) {
    setTerminalLifecycleDescriptorEnabled(terminalUserData(), false);
    return publicAgentCaptureState(config.terminalMode === 'personal'
      ? refreshLocalAgentCaptureInventory(config)
      : config);
  }
  try {
    const remote = await requestJson('/api/student-session/agent-memory/capture', { token: config.sessionToken });
    if (!remote.capture?.enabled) {
      setTerminalLifecycleDescriptorEnabled(terminalUserData(), false);
      updateLocalAgentCapture({ enabled: false, captureEpoch: '', authorizedAt: '', message: '主机已停止此个人终端的自动会话采集，请重新授权后再使用。' });
      return publicAgentCaptureState();
    }
    if (!remote.capture?.captureEpoch || !remote.capture?.authorizedAt) {
      setTerminalLifecycleDescriptorEnabled(terminalUserData(), false);
      updateLocalAgentCapture({ enabled: false, captureEpoch: '', authorizedAt: '', message: '当前 Windows 主机尚不支持旧会话授权后续采集，请升级主机后重新授权。' });
      return publicAgentCaptureState();
    }
    if (
      String(config.agentCapture?.captureEpoch || '') !== String(remote.capture.captureEpoch)
      || String(config.agentCapture?.authorizedAt || '') !== String(remote.capture.authorizedAt)
    ) updateLocalAgentCapture({ captureEpoch: remote.capture.captureEpoch, authorizedAt: remote.capture.authorizedAt });
    reconcilePersonalAgentCapture(readConfig());
    await runAgentCaptureDrain();
    return publicAgentCaptureState();
  } catch (error) {
    const status = Number(error.status || 0);
    if (status === 404) {
      const detail = '当前 Windows 主机版本不支持个人终端自动会话采集，请将主机升级到 0.16.10 或更高版本。';
      setTerminalLifecycleDescriptorEnabled(terminalUserData(), false);
      updateLocalAgentCapture({
        enabled: false,
        registrations: detectedAgentCaptureRegistrations({}, false),
        warnings: [detail],
        message: detail,
      });
    } else if ([401, 403].includes(status)) {
      setTerminalLifecycleDescriptorEnabled(terminalUserData(), false);
      updateLocalAgentCapture({ enabled: false, warnings: [String(error.message || error)], message: `主机已拒绝或撤销自动会话采集授权：${error.message}` });
    } else {
      updateLocalAgentCapture({ warnings: [String(error.message || error)], message: `主机暂不可达，已授权的后续会话事件保留在本机队列：${error.message}` });
    }
    return publicAgentCaptureState();
  }
}

async function runAgentCaptureDrain() {
  if (agentCaptureBusy) return publicAgentCaptureState();
  if (Date.now() < agentCaptureRetryAt) return publicAgentCaptureState();
  const config = readConfig();
  if (
    config.terminalMode !== 'personal'
    || !config.sessionToken
    || !config.currentStudent?.id
    || !config.agentCapture?.enabled
    || !config.agentCapture?.captureEpoch
    || !config.agentCapture?.authorizedAt
  ) return publicAgentCaptureState(config);
  agentCaptureBusy = true;
  try {
    let rejectedAuthorization = '';
    const result = await drainTerminalLifecycleQueue({
      queueDir: terminalLifecyclePaths(terminalUserData()).queueDir,
      studentId: String(config.currentStudent.id),
      deviceId: deviceId(),
      captureEpoch: String(config.agentCapture.captureEpoch || ''),
      postEnvelope: async (envelope) => {
        try {
          return await requestJson('/api/student-session/agent-memory/events', {
            method: 'POST',
            token: config.sessionToken,
            body: envelope,
          });
        } catch (error) {
          if ([401, 403].includes(Number(error.status || 0))) rejectedAuthorization = String(error.message || error);
          throw error;
        }
      },
    });
    if (rejectedAuthorization) {
      setTerminalLifecycleDescriptorEnabled(terminalUserData(), false);
      agentCaptureRetryAt = 0;
      agentCaptureRetryDelayMs = 2000;
      return publicAgentCaptureState(updateLocalAgentCapture({
        enabled: false,
        captureEpoch: '',
        authorizedAt: '',
        pending: result.pending,
        warnings: [rejectedAuthorization],
        message: `主机已拒绝自动会话采集授权：${rejectedAuthorization}`,
      }));
    }
    agentCaptureRetryAt = result.deferred ? Date.now() + agentCaptureRetryDelayMs : 0;
    agentCaptureRetryDelayMs = result.deferred ? Math.min(agentCaptureRetryDelayMs * 2, 60_000) : 2000;
    const next = updateLocalAgentCapture({
      pending: result.pending,
      lastSyncAt: result.processed ? new Date().toISOString() : String(config.agentCapture?.lastSyncAt || ''),
      message: result.deferred
        ? '主机暂不可达，已授权的后续会话事件保留在本机等待补交。'
        : (result.processed ? `已向主机补交 ${result.processed} 条会话事件。` : String(config.agentCapture?.message || '自动会话采集运行中。')),
    });
    return publicAgentCaptureState(next);
  } finally {
    agentCaptureBusy = false;
  }
}

function terminalDiscoveryPayload(protocolVersion = 2) {
  const identity = terminalIdentity();
  return {
    type: 'AI_EDU_MANAGER_DISCOVERY',
    protocolVersion,
    role: 'tablet',
    platform: 'windows',
    deviceId: identity.deviceId,
    machineCode: identity.machineCode,
    displayName: identity.displayName,
    appVersion: TERMINAL_VERSION,
    discoveryPort: HOST_DISCOVERY_PORT,
    capabilities: protocolVersion >= 2 ? ['pair-request-v2', 'bidirectional-discovery-v2', 'student-session-v1', 'agent-lifecycle-capture-v1'] : [],
  };
}

function sendTerminalDiscoveryResponse(socket, remote, protocolVersion = 2) {
  const response = Buffer.from(JSON.stringify(terminalDiscoveryPayload(protocolVersion)), 'utf8');
  socket.send(response, remote.port, remote.address, () => {});
}

function rememberDiscoveredHost(payload, remote) {
  const host = normalizeDiscoveredHost(payload, remote);
  if (!host) return false;
  const existing = discoveredLanHosts.get(host.identityKey);
  discoveredLanHosts.set(host.identityKey, { ...existing, ...host });
  return true;
}

function handleTerminalDiscoveryMessage(socket, message, remote) {
  const text = String(message || '').trim();
  if (text === HOST_DISCOVERY_REQUEST_V1) {
    sendTerminalDiscoveryResponse(socket, remote, 1);
    return;
  }
  let payload;
  try { payload = JSON.parse(text); } catch { return; }
  if (payload.type === HOST_PAIR_INVITE && Number(payload.protocolVersion || 0) >= 2) {
    rememberIncomingPairInvite(payload, remote);
    return;
  }
  if (payload.type === HOST_DISCOVERY_REQUEST_V2 && Number(payload.protocolVersion || 0) >= 2) {
    if (['tablet', 'terminal', 'all'].includes(String(payload.searchRole || 'host'))) {
      sendTerminalDiscoveryResponse(socket, remote, 2);
    }
    return;
  }
  if (rememberDiscoveredHost(payload, remote)) notifyPairingChanged();
}

function rememberIncomingPairInvite(payload, remote) {
  const identity = terminalIdentity();
  const currentConfig = readConfig();
  if (currentConfig.hostUrl && currentConfig.token) return false;
  const targetId = String(payload.targetTabletId || '');
  const targetCode = String(payload.targetTabletMachineCode || identity.machineCode).toUpperCase();
  if (targetId !== identity.deviceId || targetCode !== identity.machineCode || !payload.requestId || !payload.requestToken) return false;
  const hostUrl = hostUrlFromDiscovery(payload, remote.address);
  if (!hostUrl) return false;
  writeConfig({
    pendingPairInvite: {
      requestId: String(payload.requestId),
      requestToken: String(payload.requestToken),
      status: 'pending_tablet_accept',
      hostId: String(payload.hostId || ''),
      hostMachineCode: String(payload.hostMachineCode || '').toUpperCase(),
      hostName: String(payload.hostName || 'AI教育管家主机').slice(0, 80),
      hostUrl,
      createdAt: new Date().toISOString(),
      expiresAt: String(payload.expiresAt || ''),
    },
    lastPairingResult: null,
  });
  notifyPairingChanged();
  return true;
}

function startTerminalDiscovery() {
  if (terminalDiscoverySocket) return;
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  terminalDiscoverySocket = socket;
  socket.on('message', (message, remote) => handleTerminalDiscoveryMessage(socket, message, remote));
  socket.on('error', (error) => {
    terminalDiscoveryError = error.code === 'EADDRINUSE'
      ? `局域网发现端口 ${HOST_DISCOVERY_PORT} 已被占用。请不要在同一台电脑同时运行主机版和学生端，并检查防火墙。`
      : `局域网发现服务异常：${error.message}`;
    try { socket.close(); } catch {}
    if (terminalDiscoverySocket === socket) terminalDiscoverySocket = null;
    notifyPairingChanged();
  });
  socket.bind(HOST_DISCOVERY_PORT, '0.0.0.0', () => {
    terminalDiscoveryError = '';
    try { socket.setBroadcast(true); } catch {}
    notifyPairingChanged();
  });
}

function stopTerminalDiscovery() {
  const socket = terminalDiscoverySocket;
  terminalDiscoverySocket = null;
  if (!socket) return;
  try { socket.close(); } catch {}
}

function findLanHosts(query = '') {
  if (!terminalDiscoverySocket) startTerminalDiscovery();
  if (!terminalDiscoverySocket) return { ok: false, message: terminalDiscoveryError || '局域网发现服务未启动。', state: terminalPairingState(query) };
  discoveredLanHosts.clear();
  lastHostDiscoveryAt = new Date().toISOString();
  const identity = terminalIdentity();
  const v2 = Buffer.from(JSON.stringify({
    type: HOST_DISCOVERY_REQUEST_V2,
    protocolVersion: 2,
    requestId: `discover-${crypto.randomUUID()}`,
    searchRole: 'host',
    requesterRole: 'tablet',
    requesterDeviceId: identity.deviceId,
    targetMachineCode: String(query || '').trim().toUpperCase(),
  }), 'utf8');
  const v1 = Buffer.from(HOST_DISCOVERY_REQUEST_V1, 'utf8');
  const targets = lanDiscoveryBroadcastTargets();
  try {
    for (const target of targets) {
      terminalDiscoverySocket.send(v2, HOST_DISCOVERY_PORT, target, () => {});
      terminalDiscoverySocket.send(v1, HOST_DISCOVERY_PORT, target, () => {});
    }
    return { ok: true, message: `正在通过 ${targets.length} 个局域网地址查找主机。`, broadcastTargets: targets, state: terminalPairingState(query) };
  } catch (error) {
    terminalDiscoveryError = `发送主机发现广播失败：${error.message}`;
    return { ok: false, message: terminalDiscoveryError, state: terminalPairingState(query) };
  }
}

async function requestHostPair(hostDeviceId) {
  const host = activeDiscoveredHosts().find((item) => String(item.deviceId) === String(hostDeviceId));
  if (!host) throw new Error('未找到该主机，请重新扫描局域网。');
  if (host.protocolVersion < 2 || !/^H-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/.test(host.machineCode)) {
    throw new Error('该主机版本较旧，请使用下方六位配对码或粘贴连接信息。');
  }
  const identity = terminalIdentity();
  const created = createPairRequest({
    initiator: 'tablet',
    hostId: host.deviceId,
    tabletId: identity.deviceId,
    hostMachineCode: host.machineCode,
    tabletMachineCode: identity.machineCode,
    hostName: host.displayName,
    tabletName: identity.displayName,
    hostAddress: host.hostUrl,
    tabletAddress: '',
  });
  const payload = await requestJson('/api/pair/request', {
    hostUrl: host.hostUrl,
    method: 'POST',
    body: {
      requestId: created.record.requestId,
      requestToken: created.requestToken,
      hostId: host.deviceId,
      hostMachineCode: host.machineCode,
      tabletId: identity.deviceId,
      tabletMachineCode: identity.machineCode,
      tabletName: identity.displayName,
      platform: 'windows',
      role: 'terminal',
      capabilities: ['student-session-v1', 'windows-terminal-v1', 'agent-lifecycle-capture-v1'],
    },
  });
  writeConfig({
    pendingPairRequest: {
      requestId: created.record.requestId,
      requestToken: created.requestToken,
      status: payload.request?.status || 'pending_host_accept',
      hostId: host.deviceId,
      hostMachineCode: host.machineCode,
      hostName: host.displayName,
      hostUrl: host.hostUrl,
      createdAt: created.record.createdAt,
      expiresAt: payload.request?.expiresAt || created.record.expiresAt,
    },
    lastPairingResult: null,
  });
  notifyPairingChanged();
  void pollPendingPairRequest();
  return { ok: true, message: payload.message || '连接申请已发送，请在主机端点击接受。', state: terminalPairingState() };
}

async function pollPendingPairRequest() {
  if (pairStatusBusy) return;
  const config = readConfig();
  const pending = config.pendingPairRequest;
  if (!pending?.requestId || !pending?.requestToken || !pending?.hostUrl) return;
  if (Date.parse(pending.expiresAt || 0) <= Date.now()) {
    writeConfig({ pendingPairRequest: null, lastPairingResult: { status: 'expired', message: '连接申请已超时，请重新扫描主机。', updatedAt: new Date().toISOString() } });
    notifyPairingChanged();
    return;
  }
  pairStatusBusy = true;
  try {
    const payload = await requestJson(`/api/pair/status?requestId=${encodeURIComponent(pending.requestId)}&requestToken=${encodeURIComponent(pending.requestToken)}`, { hostUrl: pending.hostUrl });
    const status = String(payload.request?.status || pending.status || '');
    if (status === 'accepted' && payload.token) {
      writeConfig({
        hostUrl: pending.hostUrl,
        token: payload.token,
        sessionToken: '',
        currentStudent: null,
        pendingPairRequest: null,
        lastPairingResult: { status: 'accepted', message: '主机已接受连接。', updatedAt: new Date().toISOString() },
      });
      await hostScopeAfterPairing(pending.hostUrl, pending.hostId);
    } else if (['rejected', 'cancelled', 'expired'].includes(status)) {
      writeConfig({
        pendingPairRequest: null,
        lastPairingResult: { status, message: status === 'rejected' ? '主机已拒绝连接申请。' : status === 'expired' ? '连接申请已超时。' : '连接申请已取消。', updatedAt: new Date().toISOString() },
      });
    } else if (status && status !== pending.status) {
      writeConfig({ pendingPairRequest: { ...pending, status } });
    }
    notifyPairingChanged();
  } catch (error) {
    terminalDiscoveryError = `暂时无法读取主机确认状态：${error.message}`;
    notifyPairingChanged();
  } finally {
    pairStatusBusy = false;
  }
}

async function cancelPendingPairRequest() {
  const config = readConfig();
  const pending = config.pendingPairRequest;
  if (!pending?.requestId || !pending?.requestToken || !pending?.hostUrl) return { ok: false, message: '当前没有等待确认的连接申请。', state: terminalPairingState() };
  try {
    await requestJson('/api/pair/cancel', {
      hostUrl: pending.hostUrl,
      method: 'POST',
      body: { requestId: pending.requestId, requestToken: pending.requestToken },
    });
  } catch {}
  writeConfig({ pendingPairRequest: null, lastPairingResult: { status: 'cancelled', message: '连接申请已取消。', updatedAt: new Date().toISOString() } });
  notifyPairingChanged();
  return { ok: true, message: '连接申请已取消。', state: terminalPairingState() };
}

async function acceptPendingPairInvite() {
  const config = readConfig();
  const invite = config.pendingPairInvite;
  if (!invite?.requestId || !invite?.requestToken || !invite?.hostUrl) return { ok: false, message: '当前没有等待处理的主机邀请。', state: terminalPairingState() };
  const identity = terminalIdentity();
  const payload = await requestJson('/api/pair/tablet-accept', {
    hostUrl: invite.hostUrl,
    method: 'POST',
    body: {
      requestId: invite.requestId,
      requestToken: invite.requestToken,
      tabletId: identity.deviceId,
      tabletMachineCode: identity.machineCode,
      tabletName: identity.displayName,
      platform: 'windows',
      role: 'terminal',
      capabilities: ['student-session-v1', 'windows-terminal-v1', 'agent-lifecycle-capture-v1'],
    },
  });
  writeConfig({
    hostUrl: invite.hostUrl,
    token: payload.token,
    sessionToken: '',
    currentStudent: null,
    pendingPairInvite: null,
    pendingPairRequest: null,
    lastPairingResult: { status: 'accepted', message: '已接受主机邀请并完成连接。', updatedAt: new Date().toISOString() },
  });
  await hostScopeAfterPairing(invite.hostUrl, invite.hostId);
  notifyPairingChanged();
  return { ok: true, message: payload.message || '已接受主机邀请并完成连接。', state: terminalPairingState(), config: publicConfig() };
}

async function rejectPendingPairInvite() {
  const config = readConfig();
  const invite = config.pendingPairInvite;
  if (!invite?.requestId || !invite?.requestToken || !invite?.hostUrl) return { ok: false, message: '当前没有等待处理的主机邀请。', state: terminalPairingState() };
  try {
    await requestJson('/api/pair/reject', {
      hostUrl: invite.hostUrl,
      method: 'POST',
      body: { requestId: invite.requestId, requestToken: invite.requestToken },
    });
  } finally {
    writeConfig({ pendingPairInvite: null, lastPairingResult: { status: 'rejected', message: '已拒绝主机连接邀请。', updatedAt: new Date().toISOString() } });
    notifyPairingChanged();
  }
  return { ok: true, message: '已拒绝主机连接邀请。', state: terminalPairingState() };
}

async function pairWithHost(input = {}) {
  const parsed = parseConnectionPayload(input.connectionText, input.hostUrl, input.pairCode, input.connectionMethod);
  if (!parsed.hostUrl) {
    throw new Error(parsed.connectionMethod === 'tailscale'
      ? '未找到 Tailscale 主机地址。请粘贴主机连接信息，或填写主机提供的 Tailscale 地址。'
      : '未找到局域网主机地址。请扫描附近主机，或填写局域网地址。');
  }
  if (!/^\d{6}$/.test(parsed.pairCode)) throw new Error('请输入主机当前显示的六位配对码。');
  const config = readConfig();
  const payload = await requestJson('/api/pair/confirm', {
    hostUrl: parsed.hostUrl,
    method: 'POST',
    body: {
      pairCode: parsed.pairCode,
      deviceId: deviceId(),
      deviceName: String(input.deviceName || config.deviceName || `${os.hostname()} · Windows 学生终端`).slice(0, 80),
      platform: 'windows',
      role: 'terminal',
      capabilities: ['student-session-v1', 'windows-terminal-v1', 'agent-lifecycle-capture-v1'],
    },
  });
  writeConfig({
    hostUrl: parsed.hostUrl,
    token: payload.token,
    sessionToken: '',
    currentStudent: null,
    agentCapture: { enabled: false, registrations: {}, warnings: [], pending: 0 },
    pendingPairRequest: null,
    pendingPairInvite: null,
    terminalMode: payload.device?.terminalMode || 'shared',
    deviceName: input.deviceName || config.deviceName,
  });
  await hostScopeAfterPairing(parsed.hostUrl);
  return { ...payload, config: publicConfig() };
}

async function setTerminalMode(terminalMode) {
  const requested = terminalMode === 'personal' ? 'personal' : 'shared';
  if (terminalAgentBridge) await terminalAgentBridge.stop();
  effectiveProjectCache = [];
  const payload = await requestJson('/api/device/mode', { method: 'POST', body: { terminalMode: requested }, deviceToken: true });
  const config = readConfig();
  const autoDelivery = requested === 'shared' ? { ...(config.autoDelivery || {}), enabled: false } : config.autoDelivery;
  if (requested === 'shared' && config.currentStudent?.id) {
    try {
      reconcileTerminalLifecycle({
        userDataDir: terminalUserData(),
        hookSourcePath: path.join(__dirname, 'agent-lifecycle-hook.ps1'),
        studentId: String(config.currentStudent.id),
        deviceId: deviceId(),
        enabled: false,
        detectedAgents: detectLifecycleAgents(),
      });
    } catch {
      setTerminalLifecycleDescriptorEnabled(terminalUserData(), false);
    }
  } else if (requested === 'shared') {
    setTerminalLifecycleDescriptorEnabled(terminalUserData(), false);
  }
  writeConfig({
    terminalMode: requested,
    sessionToken: '',
    currentStudent: null,
    autoDelivery,
    agentCapture: requested === 'shared'
      ? { enabled: false, registrations: {}, warnings: [], pending: 0, message: '共享终端不启用自动会话采集。' }
      : config.agentCapture,
  });
  return { ...payload, config: publicConfig() };
}

async function loginStudent(loginId) {
  if (terminalAgentBridge) await terminalAgentBridge.stop();
  const payload = await requestJson('/api/student-session/login', { method: 'POST', body: { loginId }, deviceToken: true });
  effectiveProjectCache = Array.isArray(payload.projects) ? payload.projects : [];
  const next = writeConfig({ sessionToken: payload.token, currentStudent: payload.student || null, terminalMode: payload.terminalMode || readConfig().terminalMode });
  if (next.terminalMode === 'personal' && next.agentCapture?.enabled) void refreshPersonalAgentCapture();
  void runTerminalUploadQueue();
  return { ...payload, config: publicConfig() };
}

async function autoLoginStudent() {
  if (terminalAgentBridge) await terminalAgentBridge.stop();
  const payload = await requestJson('/api/student-session/auto', { method: 'POST', body: {}, deviceToken: true });
  effectiveProjectCache = Array.isArray(payload.projects) ? payload.projects : [];
  const next = writeConfig({ sessionToken: payload.token, currentStudent: payload.student || null, terminalMode: 'personal' });
  if (next.agentCapture?.enabled) void refreshPersonalAgentCapture();
  void runTerminalUploadQueue();
  return { ...payload, config: publicConfig() };
}

async function logoutStudent() {
  if (terminalAgentBridge) await terminalAgentBridge.stop();
  closeTerminalCourse('student_logout');
  effectiveCourseCache = [];
  effectiveProjectCache = [];
  const config = readConfig();
  if (config.sessionToken) {
    try { await requestJson('/api/student-session/logout', { method: 'POST', body: {}, token: config.sessionToken }); }
    catch {}
  }
  setTerminalLifecycleDescriptorEnabled(terminalUserData(), false);
  writeConfig({ sessionToken: '', currentStudent: null });
  return { ok: true, config: publicConfig() };
}

async function loadRemoteState() {
  let config = readConfig();
  try { await inspectCurrentHostScope({ adoptIfMissing: true }); config = readConfig(); }
  catch (error) { writeConfig({ uploadQueueWarning: `上传队列暂未核实主机状态：${error.message}` }); }
  let modePayload;
  try { modePayload = await requestJson('/api/device/mode', { deviceToken: true }); }
  catch (error) {
    const cached = cacheFallbackAllowed(error) ? loadRemoteStateCache(config) : null;
    if (cached && config.sessionToken && config.currentStudent?.id) {
      effectiveProjectCache = cached.payload.projects || [];
      return { ok: true, ...cached.payload,
        offline: true, cachedAt: cached.cachedAt, message: '主机当前不可达，显示24小时内的只读授权缓存；分类、下载和证据确认已停用。',
        config: publicConfig() };
    }
    throw error;
  }
  const terminalMode = modePayload.device?.terminalMode || config.terminalMode || 'shared';
  if (terminalMode !== config.terminalMode) config = writeConfig({ terminalMode, sessionToken: '', currentStudent: null });
  if (!config.sessionToken && terminalMode === 'personal' && modePayload.device?.boundStudentId) {
    try { return await autoLoginStudent(); }
    catch {}
  }
  if (!config.sessionToken) {
    effectiveProjectCache = [];
    return { ok: true, requiresLogin: true, students: [], projects: [], device: modePayload.device || null, config: publicConfig() };
  }
  try {
    const payload = await requestJson('/api/student-session/me', { token: config.sessionToken });
    if (payload.student) {
      const next = writeConfig({ currentStudent: payload.student });
      if (next.terminalMode === 'personal' && next.agentCapture?.enabled) void refreshPersonalAgentCapture();
      void runTerminalUploadQueue();
    }
    const result = { ...payload, students: payload.students || (payload.student ? [payload.student] : []),
      projects: payload.projects || [], device: modePayload.device || null };
    effectiveProjectCache = result.projects;
    saveRemoteStateCache(result, readConfig());
    return { ...result, config: publicConfig() };
  } catch (error) {
    const cached = cacheFallbackAllowed(error) ? loadRemoteStateCache(config) : null;
    if (cached) {
      effectiveProjectCache = cached.payload.projects || [];
      return { ok: true, ...cached.payload, offline: true, cachedAt: cached.cachedAt,
        message: '主机当前不可达，显示24小时内的只读授权缓存；分类、下载和证据确认已停用。',
        config: publicConfig() };
    }
    if ([401, 403].includes(Number(error?.status))) writeConfig({ sessionToken: '', currentStudent: null });
    return { ok: true, requiresLogin: true, students: [], projects: [], device: modePayload.device || null, config: publicConfig(), message: error.message };
  }
}

function currentStudentSession() {
  const config = readConfig();
  const studentId = String(config.currentStudent?.id || '').trim();
  if (!config.sessionToken || !studentId) throw new Error('请先扫码或输入学生 ID。');
  return { config, studentId };
}

function currentTerminalAgentScope() {
  const config = readConfig();
  return {
    studentId: String(config.currentStudent?.id || ''),
    deviceId: String(config.deviceId || ''),
    hostId: String(config.hostScope?.hostId || ''),
    dataGeneration: String(config.hostScope?.dataGeneration || ''),
    terminalMode: String(config.terminalMode || 'shared'),
  };
}

function getTerminalAgentBridge() {
  if (!terminalAgentBridge) terminalAgentBridge = createTerminalAgentBridge({
    root: path.join(terminalUserData(), 'student-agent-bridge'),
    currentScope: currentTerminalAgentScope,
    invoke: async (input, grantedScope) => {
      const current = currentTerminalAgentScope();
      for (const key of ['studentId', 'deviceId', 'hostId', 'dataGeneration']) {
        if (!current[key] || current[key] !== grantedScope[key]) throw Object.assign(new Error('学生、设备或主机范围已经变化，请重新授权。'), { code: 'SCOPE_CHANGED' });
      }
      if (current.terminalMode !== 'personal') throw Object.assign(new Error('只有个人终端可以连接外部 Agent。'), { code: 'PERSONAL_TERMINAL_REQUIRED' });
      if (input.action === 'trajectory') return { ok: true, studentId: current.studentId, ...await loadLearningTrajectory() };
      if (input.action !== 'query' || !String(input.question || '').trim()) throw Object.assign(new Error('请输入要查询的教育问题。'), { code: 'INVALID_QUERY' });
      const { config } = currentStudentSession();
      return requestJson('/api/agent/knowledge/query', { method: 'POST', token: config.sessionToken, body: { scopeType: 'student', scopeId: current.studentId, scopePolicy: 'fixed_student', question: String(input.question).trim().slice(0, 2000), limit: 8 } });
    },
  });
  return terminalAgentBridge;
}

async function setTerminalAgentBridge(enabled) {
  const bridge = getTerminalAgentBridge();
  if (!enabled) return bridge.stop();
  const scope = currentTerminalAgentScope();
  if (scope.terminalMode !== 'personal') throw new Error('只有个人终端可以授权外部 Agent 查询。');
  if (!scope.studentId || !scope.deviceId || !scope.hostId || !scope.dataGeneration) throw new Error('主机身份和当前学生尚未核实。');
  return bridge.start(scope);
}

function copyTerminalAgentBridgeConfig() {
  const state = getTerminalAgentBridge().snapshot();
  if (!state.enabled) throw new Error('请先启用外部 Agent 查询。');
  const bridgeRoot = path.join(terminalUserData(), 'student-agent-bridge');
  fs.mkdirSync(bridgeRoot, { recursive: true });
  const durableMcpScript = path.join(bridgeRoot, 'terminal-agent-mcp.cjs');
  const temporaryMcpScript = `${durableMcpScript}.tmp`;
  fs.writeFileSync(temporaryMcpScript, fs.readFileSync(path.join(__dirname, 'terminal-agent-mcp.cjs')));
  fs.copyFileSync(temporaryMcpScript, durableMcpScript);
  fs.unlinkSync(temporaryMcpScript);
  const stableExecutable = path.resolve(process.env.PORTABLE_EXECUTABLE_FILE || process.execPath);
  const config = { mcpServers: { 'ai-education-student': { command: stableExecutable, args: [durableMcpScript, state.descriptorFile], env: { ELECTRON_RUN_AS_NODE: '1' } } } };
  const value = JSON.stringify(config, null, 2);
  clipboard.writeText(value);
  return { ok: true, message: '当前学生的 MCP 配置已复制。该授权只在本学生端运行期间有效。', config: value };
}

async function loadTerminalLearningCapabilities() {
  const { config } = currentStudentSession();
  try { return await requestJson('/api/student-session/capabilities', { token: config.sessionToken }); }
  catch (error) {
    if(error.status===404)return {ok:true,capabilities:{}};
    if(cacheFallbackAllowed(error)){
      const drafts=await require('./terminal-practice-drafts.cjs').createTerminalPracticeDrafts(path.join(terminalUserData(),'practice-drafts')).list(cacheScope(config));
      if(drafts.length)return {ok:true,capabilities:{publications:true},offline:true};
    }
    throw error;
  }
}

async function loadTerminalPractice() {
  const { config } = currentStudentSession();
  const synchronization = await drainPracticeAttemptQueue().catch(error => ({ pending: 0, warning: error.message }));
  return { ...await requestJson('/api/student-session/practice', { token: config.sessionToken }), synchronization };
}

function practiceScope(config, studentId) {
  const hostId = String(config.hostScope?.hostId || '');
  const dataGeneration = String(config.hostScope?.dataGeneration || '');
  if (!hostId || !dataGeneration || !studentId) throw new Error('主机身份或学生范围尚未核实，不能暂存作答。');
  return `${hostId}:${dataGeneration}:${studentId}`;
}

function readPracticeAttemptQueue() {
  const value = readJson(practiceAttemptQueuePath(), { version: 1, items: [] });
  if (value.version !== 1 || !Array.isArray(value.items)) throw new Error('练习提交队列格式无效');
  return value;
}

function savePracticeAttemptQueue(queue) { writeJson(practiceAttemptQueuePath(), queue); }

async function drainPracticeAttemptQueue() {
  const { config, studentId } = currentStudentSession();
  const scope = practiceScope(config, studentId);
  const queue = readPracticeAttemptQueue();
  for (const item of queue.items.filter(item => item.scope === scope && !item.rejected)) {
    try {
      await requestJson(`/api/student-session/practice/${encodeURIComponent(item.cardId)}/attempt`, {
        method: 'POST', body: item.input, token: config.sessionToken, timeoutMs: 30000,
      });
      queue.items = queue.items.filter(current => current.input.attemptId !== item.input.attemptId);
      savePracticeAttemptQueue(queue);
    } catch (error) {
      if (error.status === 400) {
        item.rejected = true;
        item.error = String(error.message || '主机拒绝了暂存作答').slice(0, 240);
        savePracticeAttemptQueue(queue);
      }
      break;
    }
  }
  return { pending: queue.items.filter(item => item.scope === scope && !item.rejected).length,
    rejected: queue.items.filter(item => item.scope === scope && item.rejected).map(item => ({ attemptId: item.input.attemptId,
      cardId: item.cardId, answer: item.input.answer, error: item.error })) };
}

async function startTerminalPractice(cardId) {
  const { config } = currentStudentSession();
  if (!/^[0-9a-f-]{36}$/i.test(String(cardId || ''))) throw new Error('卡片编号无效');
  return requestJson(`/api/student-session/practice/${encodeURIComponent(cardId)}/start`, {
    method: 'POST', body: {}, token: config.sessionToken,
  });
}

async function submitTerminalPractice(cardId, input) {
  const { config, studentId } = currentStudentSession();
  if (!/^[0-9a-f-]{36}$/i.test(String(cardId || ''))) throw new Error('卡片编号无效');
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(String(input?.attemptId || '')) || typeof input?.answer !== 'string' || !input.answer.trim() || input.answer.length > 10000) throw new Error('请填写有效作答。');
  const scope = practiceScope(config, studentId);
  const queue = readPracticeAttemptQueue();
  const existing = queue.items.find(item => item.input.attemptId === input.attemptId);
  if (existing && (existing.scope !== scope || existing.cardId !== cardId || JSON.stringify(existing.input) !== JSON.stringify(input))) throw new Error('提交编号已用于其他作答。');
  if (!existing) {
    if (queue.items.length >= 20) throw new Error('本机待确认练习达到上限，请先连接主机同步。');
    queue.items.push({ scope, cardId, input, createdAt: new Date().toISOString() });
    savePracticeAttemptQueue(queue);
  }
  try {
    const result = await requestJson(`/api/student-session/practice/${encodeURIComponent(cardId)}/attempt`, {
      method: 'POST', body: input, token: config.sessionToken, timeoutMs: 30000,
    });
    queue.items = queue.items.filter(item => item.input.attemptId !== input.attemptId);
    savePracticeAttemptQueue(queue);
    return result;
  } catch (error) {
    if (error.status === 400) {
      queue.items = queue.items.filter(item => item.input.attemptId !== input.attemptId);
      savePracticeAttemptQueue(queue);
      throw error;
    }
    return { ok: true, studentId, pending: true, message: '作答已保存在本机，连接恢复后按同一提交编号核对。' };
  }
}

async function loadTerminalPlanning(kind) {
  const { config } = currentStudentSession();
  if (!['guidance', 'topics', 'competitions'].includes(kind)) throw new Error('不支持的规划内容');
  return requestJson(`/api/student-session/planning/${kind}`, { token: config.sessionToken });
}

async function loadTerminalPlanningFavorites(kind) {
  const { config } = currentStudentSession();
  if (!['topics', 'competitions'].includes(kind)) throw new Error('不支持的收藏类型');
  return requestJson(`/api/student-session/planning-favorites/${kind}`, { token: config.sessionToken });
}

async function setTerminalPlanningFavorite(kind, versionId, candidateId, saved) {
  const { config } = currentStudentSession();
  if (!['topics', 'competitions'].includes(kind)) throw new Error('不支持的收藏类型');
  return requestJson(`/api/student-session/planning-favorites/${kind}`, {
    method: 'POST', token: config.sessionToken, body: { versionId, candidateId, saved },
  });
}

async function loadTerminalInbox() {
  const { config } = currentStudentSession();
  return requestJson('/api/student-session/inbox', { token: config.sessionToken });
}

async function submitTerminalInbox(input) {
  const { config } = currentStudentSession();
  return requestJson('/api/student-session/inbox', { method: 'POST', token: config.sessionToken, body: input });
}

async function loadEffectiveCourses() {
  const { config, studentId } = currentStudentSession();
  const hostId = String(config.hostScope?.hostId || '');
  if (!hostId) throw new Error('主机身份尚未核实，不能读取课程投影。');
  const namespace = JSON.stringify([hostId, studentId]);
  const cache = readJson(courseProjectionCachePath(), { schema: 'edu-manager.course-projection-cache.v2', entries: {} });
  const cached = cache?.entries?.[namespace];
  let payload;
  try {
    const remote = await requestJson(`/api/v2/students/${encodeURIComponent(studentId)}/courses`, {
      token: config.sessionToken,
      headers: cached?.etag ? { 'If-None-Match': cached.etag } : {},
      allowNotModified: true,
      returnResponseMeta: true,
    });
    if (remote.__notModified) payload = cached?.projection;
    else {
      const { __etag: _etag, ...projection } = remote;
      payload = projection;
    }
    if (!payload) throw new Error('主机返回304但当前主机和学生没有投影缓存。');
    validateCourseProjection(payload, hostId, studentId);
    if (!remote.__notModified) {
      cache.schema = 'edu-manager.course-projection-cache.v2';
      cache.entries = cache.entries && typeof cache.entries === 'object' ? cache.entries : {};
      cache.entries[namespace] = { hostId, studentId, etag: remote.__etag || `"${payload.projectionRevision}"`, projection: payload, cachedAt: new Date().toISOString() };
      writeJson(courseProjectionCachePath(), cache);
    }
  } catch (error) {
    payload = cached?.projection;
    if (!payload) throw error;
    try { validateCourseProjection(payload, hostId, studentId); } catch { throw error; }
  }
  effectiveCourseCache = Array.isArray(payload.courses) ? payload.courses : [];
  return payload;
}

function validateCourseProjection(payload, hostId, studentId) {
  return validateStudentCourseProjection(payload, { hostId, studentId }, courseTrustPolicy);
}

function terminalCourseViewBounds() {
  const focused = courseLearningFullscreen;
  const inset = focused ? 0 : 24;
  const minimumTop = focused ? 52 : 96;
  const minimumHeight = focused ? 160 : 260;
  if (!mainWindow || mainWindow.isDestroyed()) return { x: inset, y: courseViewTop, width: 1000 - inset * 2, height: Math.max(minimumHeight, 738 - courseViewTop - inset) };
  const [width, height] = mainWindow.getContentSize();
  const top = Math.min(Math.max(minimumTop, Math.round(courseViewTop)), Math.max(minimumTop, height - minimumHeight));
  return { x: inset, y: top, width: Math.max(360, width - inset * 2), height: Math.max(minimumHeight, height - top - inset) };
}

function setTerminalCourseLearningFullscreen(enabled) {
  if (!mainWindow || mainWindow.isDestroyed() || !courseView) return { ok: false, message: '当前没有可全屏显示的课程。' };
  courseLearningFullscreen = Boolean(enabled);
  courseViewTop = courseLearningFullscreen ? 52 : 96;
  mainWindow.setFullScreen(courseLearningFullscreen);
  courseView.setBounds(terminalCourseViewBounds());
  notify('terminal:course-learning-fullscreen', { enabled: courseLearningFullscreen });
  return { ok: true, enabled: courseLearningFullscreen };
}

function closeTerminalCourse(reason = 'user') {
  if (courseView && mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.contentView.removeChildView(courseView); } catch {}
    try { courseView.webContents.close(); } catch {}
  }
  courseView = null;
  courseViewTop = 300;
  const wasFullscreen = courseLearningFullscreen;
  courseLearningFullscreen = false;
  if (wasFullscreen && mainWindow && !mainWindow.isDestroyed()) mainWindow.setFullScreen(false);
  const closed = activeCourse;
  activeCourse = null;
  if (wasFullscreen) notify('terminal:course-learning-fullscreen', { enabled: false });
  notify('terminal:course-browser-changed', { open: false, reason, courseId: closed?.courseId || '' });
  return { ok: true, open: false };
}

async function openTerminalCourse(courseId) {
  const { studentId, config } = currentStudentSession();
  const payload = await loadEffectiveCourses();
  let course = (payload.courses || []).find((item) => item.courseId === String(courseId || ''));
  if (!course || String(payload.studentId || '') !== studentId) throw new Error('该课程未分配给当前学生或已下架。');
  const leaseUntil = Date.parse(String(course.offlineOpenUntil || ''));
  if (!Number.isFinite(leaseUntil) || leaseUntil <= Date.now()) throw new Error('课程离线打开租约已到期，请联网刷新后重试。');
  const courseUrl = new URL(String(course.url || ''));
  if (courseUrl.protocol !== 'https:' || courseUrl.username || courseUrl.password) throw new Error('课程入口不是受信任的 HTTPS 地址。');
  // The signed course projection is the authority for the navigation target.
  // `course-start` only records the launch on the host; it must never replace
  // the already-validated URL (older hosts serialized https as `https\\://`).
  const trustedCourseUrl = courseUrl.toString();
  const trustedAllowedHosts = Array.isArray(course.allowedHosts) ? [...course.allowedHosts] : [];
  try {
    const pinned = await requestJson('/api/student-session/course-start', { method: 'POST', body: { courseId }, token: config.sessionToken });
    course = { ...course, ...(pinned?.course || {}), url: trustedCourseUrl, allowedHosts: trustedAllowedHosts };
  }
  catch(error){if(!isCourseStartFallbackAllowed(error))throw error;}
  if(currentStudentSession().config.sessionToken!==config.sessionToken)throw Error('学生已切换，请重新打开课程');
  closeTerminalCourse('switch');
  courseLearningFullscreen = false;
  const partition = coursePartition(course.courseId);
  const courseSession = session.fromPartition(partition, { cache: true });
  courseView = new WebContentsView({ webPreferences: secureCourseWebPreferences(partition) });
  installCourseGuards(courseView.webContents, course, courseSession, (blocked) => {
    notify('terminal:course-browser-changed', { open: true, blocked: true, courseId: course.courseId, ...blocked });
  });
  mainWindow.contentView.addChildView(courseView);
  courseView.setBounds(terminalCourseViewBounds());
  courseView.setBackgroundColor('#ffffff');
  activeCourse = { ...course, startedAt: new Date().toISOString(), currentUrl: course.url };
  courseView.webContents.on('did-navigate', (_event, url) => {
    if (activeCourse?.courseId === course.courseId) activeCourse.currentUrl = url;
  });
  courseView.webContents.on('did-navigate-in-page', (_event, url) => {
    if (activeCourse?.courseId === course.courseId) activeCourse.currentUrl = url;
  });
  courseView.webContents.on('before-input-event', (event, input) => {
    if (courseLearningFullscreen && input.type === 'keyDown' && input.key === 'Escape') {
      event.preventDefault();
      setTerminalCourseLearningFullscreen(false);
    }
  });
  courseView.webContents.on('render-process-gone', () => closeTerminalCourse('render_process_gone'));
  await courseView.webContents.loadURL(course.url);
  if (captureControlWindow && !captureControlWindow.isDestroyed()) {
    captureControlWindow.setAlwaysOnTop(true, 'screen-saver');
    captureControlWindow.moveTop();
    captureControlWindow.showInactive();
  }
  notify('terminal:course-browser-changed', { open: true, courseId: course.courseId, name: course.name, url: course.url });
  return { ok: true, open: true, course };
}

async function loadLearningReports() {
  const { config, studentId } = currentStudentSession();
  return requestJson(`/api/students/${encodeURIComponent(studentId)}/reports`, { token: config.sessionToken });
}

async function loadLearningStatus() {
  const { config } = currentStudentSession();
  return requestJson('/api/student-session/learning-status', { token: config.sessionToken });
}

async function submitLearningStatus(input) {
  const { config } = currentStudentSession();
  return requestJson('/api/student-session/learning-status', { method: 'POST', token: config.sessionToken, body: input });
}

async function loadProjectComprehensiveReport(projectId) {
  const { config, studentId } = currentStudentSession();
  const project = (loadRemoteStateCache(config)?.payload?.projects || []).find((item) => String(item.id) === String(projectId));
  if (project && !Array.isArray(project.studentIds)) throw new Error('项目范围无效');
  if (project && !(project.studentIds || []).map(String).includes(studentId)) throw new Error('当前学生没有关联该项目');
  return requestJson(`/api/student-session/projects/${encodeURIComponent(projectId)}/comprehensive-report`, { token: config.sessionToken });
}

async function listKnowledgeGrowthWeeks() {
  const { config } = currentStudentSession();
  return requestJson('/api/student-session/knowledge-growth/weeks', { token: config.sessionToken });
}

async function loadKnowledgeGrowthImage(week) {
  const { config } = currentStudentSession();
  if (!/^\d{4}-W\d{2}$/.test(String(week || ''))) throw new Error('周次无效');
  return requestJson(`/api/student-session/knowledge-growth/${encodeURIComponent(week)}/image`, { token: config.sessionToken });
}

async function loadLearningTrajectory() {
  const { config } = currentStudentSession();
  return requestJson('/api/student-session/learning-trajectory', { token: config.sessionToken });
}

function decodeCapturedMedia(input = {}) {
  const kind = String(input.kind || '');
  const allowed = kind === 'photo'
    ? new Map([['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp']])
    : kind === 'audio'
      ? new Map([['audio/webm', 'webm'], ['audio/ogg', 'ogg'], ['audio/wav', 'wav'], ['audio/mp4', 'm4a']])
      : null;
  const mimeType = String(input.mimeType || '').split(';')[0].toLowerCase();
  if (!allowed?.has(mimeType)) throw new Error('采集资料格式不受支持。');
  const encoded = String(input.base64 || '').replace(/^data:[^;]+;base64,/, '');
  if (!encoded || !/^[a-zA-Z0-9+/=\r\n]+$/.test(encoded)) throw new Error('采集资料内容无效。');
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error('单次采集资料必须小于 20 MB。');
  return { kind, mimeType, extension: allowed.get(mimeType), bytes };
}

async function uploadCapturedMedia(input, target) {
  const { studentId } = currentStudentSession();
  const media = decodeCapturedMedia(input);
  const folder = path.join(capturedMediaRoot(), studentId);
  fs.mkdirSync(folder, { recursive: true });
  const id = crypto.randomUUID();
  const label = media.kind === 'photo' ? '照片' : '录音';
  const filePath = path.join(folder, `${label}-${Date.now()}-${id.slice(0, 8)}.${media.extension}`);
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, media.bytes, { flag: 'wx' });
  fs.renameSync(temporary, filePath);
  const result = await uploadPaths([filePath], target, {
    sourceType: media.kind === 'photo' ? 'windows_terminal_photo' : 'windows_terminal_audio',
    capturedAt: new Date().toISOString(),
    mediaMimeType: media.mimeType,
    sourceEventId: String(input.sourceEventId || `${media.kind}:${id}`),
  });
  return { ...result, localRecoveryPath: result.failed ? filePath : '' };
}

async function takeQuickScreenshot(sourceId, target) {
  const source = (await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 1920, height: 1080 } }))
    .find((item) => item.id === String(sourceId || ''));
  if (!source) throw new Error('截屏来源已经变化，请重新选择。');
  const type = source.id.startsWith('screen:') ? 'screen' : 'window';
  if (type === 'window' && isSensitiveCaptureSourceName(source.name)) throw new Error('该窗口可能包含敏感信息，不能截取。');
  const image = source.thumbnail;
  if (!image || image.isEmpty()) throw new Error('没有取得可保存的截屏画面。');
  const { studentId } = currentStudentSession();
  const folder = path.join(capturedMediaRoot(), studentId);
  fs.mkdirSync(folder, { recursive: true });
  const filePath = path.join(folder, `快速截屏-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.png`);
  fs.writeFileSync(filePath, image.toPNG(), { flag: 'wx' });
  return uploadPaths([filePath], target, {
    sourceType: 'windows_terminal_quick_screenshot',
    capturedAt: new Date().toISOString(),
    sourceName: deidentifyCaptureSourceName(source.name, type),
    captureSourceType: type,
  });
}

async function exportKnowledgeGrowthImage(input = {}, action = 'save', label = '知识增长图') {
  const week = String(input.week || '');
  if (!/^\d{4}-W\d{2}$/.test(week)) throw new Error('周次无效');
  const mimeType = String(input.mimeType || '').split(';')[0].toLowerCase();
  const extension = mimeType === 'image/svg+xml' ? 'svg' : mimeType === 'image/png' ? 'png' : '';
  if (!extension) throw new Error(`${label}格式不受支持。`);
  const bytes = Buffer.from(String(input.imageBase64 || ''), 'base64');
  if (!bytes.length || bytes.length > 12 * 1024 * 1024) throw new Error(`${label}内容无效。`);
  if (action === 'copy') {
    const image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty()) throw new Error('当前图片格式不能直接复制，请保存后分享。');
    clipboard.writeImage(image);
    return { ok: true, action, message: `${label}已复制到剪贴板。` };
  }
  const result = await dialog.showSaveDialog(mainWindow, {
    title: `导出${label}`,
    defaultPath: `${label}-${week}.${extension}`,
    filters: [{ name: label, extensions: [extension] }],
  });
  if (result.canceled || !result.filePath) return { ok: false, cancelled: true };
  fs.writeFileSync(result.filePath, bytes);
  if (action === 'share') shell.showItemInFolder(result.filePath);
  return { ok: true, action, path: result.filePath, message: action === 'share' ? `${label}已导出并定位，可选择应用发送。` : `${label}已导出。` };
}

function exportStudentMaterialStatsImage(input = {}, action = 'save') {
  return exportKnowledgeGrowthImage(input, action, '学生资料统计图');
}

async function chooseConversationFile() {
  const selected = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: '对话文本', extensions: ['txt', 'md', 'json'] }] });
  if (selected.canceled || !selected.filePaths[0]) return { cancelled: true };
  const file = selected.filePaths[0];
  const stat = fs.statSync(file);
  if (stat.size > 5 * 1024 * 1024) throw new Error('对话文件超过 5 MB');
  return { cancelled: false, name: path.basename(file), text: fs.readFileSync(file, 'utf8') };
}

async function previewConversationLink(url) {
  const { config } = currentStudentSession();
  return requestJson('/api/student-session/conversation-link/preview', { method: 'POST', token: config.sessionToken, body: { url } });
}

async function submitTerminalConversation(input = {}) {
  const { config, studentId } = currentStudentSession();
  const text = String(input.text || '').trim();
  if (!text || text.length > 60000) throw new Error('对话正文不能为空且不能超过 60000 字');
  const target = input.target || { type: 'student', id: studentId, studentId };
  if (!['student', 'project'].includes(target.type) || !target.id || String(target.studentId || studentId) !== studentId) throw new Error('对话目标无效');
  const digest = crypto.createHash('sha256').update(text).digest('hex');
  const submissionId = String(input.submissionId || `windows-conversation-${crypto.randomUUID()}`);
  return requestJson('/api/agent/conversation/submit', { method: 'POST', token: config.sessionToken, timeoutMs: 30000, body: {
    schema: 'edu-manager.agent-conversation-submission.v1', sourceAgent: 'windows-student-import', sourceNodeId: deviceId(),
    submissionId, sessionId: submissionId, title: String(input.title || '导入对话').slice(0, 240),
    scopeType: target.type, scopeId: target.id, studentHint: studentId,
    ...(target.type === 'project' ? { targetProject: target.id } : {}),
    messages: [{ messageId: `windows-message-${digest.slice(0, 24)}`, role: 'unknown', content: text }],
    submittedAt: new Date().toISOString(), idempotencyKey: `windows-conversation-${digest.slice(0, 32)}-${target.type}-${target.id}`,
  } });
}

function semanticVersionParts(value) {
  return String(value || '').split('.').map((part) => Number(part) || 0).slice(0, 4);
}

function newerSemanticVersion(candidate, current) {
  const left = semanticVersionParts(candidate), right = semanticVersionParts(current);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if ((left[index] || 0) !== (right[index] || 0)) return (left[index] || 0) > (right[index] || 0);
  }
  return false;
}

async function checkTerminalUpdate() {
  const response = await fetch('https://www.greatbg.com/download/edu-manager-version.json', { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`更新服务 HTTP ${response.status}`);
  const manifest = await response.json();
  const versionName = String(manifest.windowsTerminalVersionName || '');
  return { ok: true, available: newerSemanticVersion(versionName, TERMINAL_VERSION), currentVersion: TERMINAL_VERSION,
    versionName, url: String(manifest.windowsTerminalUrl || ''), sha256: String(manifest.windowsTerminalSha256 || ''),
    size: Number(manifest.windowsTerminalSize || 0), notes: String(manifest.windowsTerminalNotes || manifest.notes || '') };
}

async function downloadTerminalUpdate(update) {
  const url = String(update?.url || '');
  if (!/^https:\/\//i.test(url)) throw new Error('更新下载地址无效');
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`下载更新 HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
  if (update.sha256 && actual !== String(update.sha256).toUpperCase()) throw new Error('更新文件 SHA-256 校验失败');
  const target = path.join(app.getPath('downloads'), path.basename(new URL(url).pathname) || `AI-edu-manager-student-terminal-${update.versionName}.exe`);
  fs.writeFileSync(target, bytes);
  await shell.openPath(target);
  return { ok: true, path: target, sha256: actual };
}

async function loadGrowthSummary() {
  const { config, studentId } = currentStudentSession();
  try {
    return await requestJson(`/api/students/${encodeURIComponent(studentId)}/growth-summary`, { token: config.sessionToken });
  } catch (directError) {
    try {
      const listing = await requestJson(`/api/students/${encodeURIComponent(studentId)}/archive/files`, { token: config.sessionToken });
      const growthFile = (Array.isArray(listing?.files) ? listing.files : []).find((item) => {
        const relativePath = String(item?.path || '').replace(/\\/g, '/').toLowerCase();
        return relativePath.endsWith('成长模型/growth-index.md') || relativePath.endsWith('/growth-index.md');
      });
      if (!growthFile?.path) throw new Error('主机尚未生成成长模型索引。');
      const file = await requestJson(
        `/api/students/${encodeURIComponent(studentId)}/archive/file?path=${encodeURIComponent(growthFile.path)}`,
        { token: config.sessionToken },
      );
      return parseGrowthIndexMarkdown(file?.content || '');
    } catch (fallbackError) {
      if (/尚未生成成长模型索引/.test(String(fallbackError?.message || ''))) throw fallbackError;
      throw directError;
    }
  }
}

async function loadLearningReport(reportId) {
  const { config, studentId } = currentStudentSession();
  const normalizedReportId = String(reportId || '').trim();
  if (!normalizedReportId) throw new Error('请选择学情报告。');
  return requestJson(`/api/students/${encodeURIComponent(studentId)}/reports/${encodeURIComponent(normalizedReportId)}`, { token: config.sessionToken });
}

async function loadArchiveFiles() {
  const { config, studentId } = currentStudentSession();
  return requestJson(`/api/students/${encodeURIComponent(studentId)}/archive/files`, { token: config.sessionToken });
}

async function loadArchiveFile(relativePath) {
  const { config, studentId } = currentStudentSession();
  const normalizedPath = String(relativePath || '').trim();
  if (!normalizedPath) throw new Error('请选择教育档案。');
  return requestJson(`/api/students/${encodeURIComponent(studentId)}/archive/file?path=${encodeURIComponent(normalizedPath)}`, { token: config.sessionToken });
}

async function loadProjectKnowledgeFiles(projectId) {
  const { config } = currentStudentSession();
  const normalizedProjectId = String(projectId || '').trim();
  if (!normalizedProjectId) throw new Error('请选择关联项目。');
  return requestJson(`/api/projects/${encodeURIComponent(normalizedProjectId)}/archive/files`, { token: config.sessionToken });
}

async function loadProjectKnowledgeFile(projectId, relativePath) {
  const { config } = currentStudentSession();
  const normalizedProjectId = String(projectId || '').trim();
  const normalizedPath = String(relativePath || '').trim();
  if (!normalizedProjectId) throw new Error('请选择关联项目。');
  if (!normalizedPath) throw new Error('请选择项目知识。');
  return requestJson(`/api/projects/${encodeURIComponent(normalizedProjectId)}/archive/file?path=${encodeURIComponent(normalizedPath)}`, { token: config.sessionToken });
}

function projectMaterialRoute(projectId, suffix = '') {
  const normalizedProjectId = String(projectId || '').trim();
  if (!normalizedProjectId) throw new Error('请选择关联项目。');
  return `/api/projects/${encodeURIComponent(normalizedProjectId)}${suffix}`;
}

async function loadProjectMaterialView(projectId, query = {}) {
  const { config } = currentStudentSession();
  const params = new URLSearchParams({
    view: String(query?.view || 'materials'), offset: String(query?.offset ?? 0),
    limit: String(query?.limit ?? 50), search: String(query?.search || ''),
    categoryId: String(query?.categoryId || ''),
  });
  try {
    const payload = await requestJson(`${projectMaterialRoute(projectId, '/material-views')}?${params}`, { token: config.sessionToken });
    saveProjectMaterialViewCache(projectId, query, payload, config);
    return payload;
  } catch (error) {
    const cached = cacheFallbackAllowed(error) ? loadProjectMaterialViewCache(projectId, query, config) : null;
    if (!cached) throw error;
    return { ...cached.payload, cached: true, cachedAt: cached.cachedAt,
      message: '主机当前不可达，显示24小时内的只读授权缓存。' };
  }
}

async function readProjectKnowledgeDocument(projectId, documentId) {
  const { config } = currentStudentSession();
  const normalizedDocumentId = String(documentId || '').trim();
  if (!normalizedDocumentId) throw new Error('请选择项目知识。');
  return requestJson(`${projectMaterialRoute(projectId, '/knowledge/document')}?documentId=${encodeURIComponent(normalizedDocumentId)}`,
    { token: config.sessionToken });
}

async function loadProjectClassificationSuggestions(projectId, query = {}) {
  const { config } = currentStudentSession();
  const params = new URLSearchParams({ status: String(query?.status || 'pending'),
    offset: String(query?.offset ?? 0), limit: String(query?.limit ?? 50) });
  return requestJson(`${projectMaterialRoute(projectId, '/materials/classification-suggestions')}?${params}`,
    { token: config.sessionToken });
}

async function submitProjectClassificationSuggestions(projectId, input = {}) {
  const { config } = currentStudentSession();
  return requestJson(projectMaterialRoute(projectId, '/materials/classification-suggestions'), {
    token: config.sessionToken, method: 'POST', body: input,
  });
}

async function applyRemoteProjectClassifications(projectId, input = {}) {
  const { config } = currentStudentSession();
  return requestJson(projectMaterialRoute(projectId, '/materials/classifications:batch'), {
    token: config.sessionToken, method: 'POST', body: input,
  });
}

async function loadProjectMaterialOrganization(projectId) {
  const { config } = currentStudentSession();
  return requestJson(projectMaterialRoute(projectId, '/materials/organization'), {
    token: config.sessionToken,
  });
}

async function runRemoteProjectMaterialOrganization(projectId, input = {}) {
  const { config } = currentStudentSession();
  return requestJson(projectMaterialRoute(projectId, '/materials/organization:run'), {
    token: config.sessionToken, method: 'POST', body: input,
  });
}

async function retryRemoteProjectMaterialOrganization(projectId, operationId, input = {}) {
  const { config } = currentStudentSession();
  const normalizedOperationId = String(operationId || '').trim();
  if (!normalizedOperationId) throw new Error('请选择自动整理操作。');
  return requestJson(projectMaterialRoute(projectId,
    `/materials/organization/${encodeURIComponent(normalizedOperationId)}/retry`), {
    token: config.sessionToken, method: 'POST', body: input,
  });
}

async function downloadProjectMaterialVersion(projectId, materialId, version, title) {
  const { config } = currentStudentSession();
  const normalizedMaterialId = String(materialId || '').trim();
  const normalizedVersion = Number(version);
  if (!normalizedMaterialId || !Number.isSafeInteger(normalizedVersion) || normalizedVersion < 1) {
    throw new Error('资料身份或版本无效。');
  }
  const hostUrl = normalizeHostUrl(config.hostUrl);
  const route = projectMaterialRoute(projectId,
    `/materials/${encodeURIComponent(normalizedMaterialId)}/versions/${normalizedVersion}/download`);
  const response = await fetch(`${hostUrl}${route}`, { headers: { Authorization: `Bearer ${config.sessionToken}` } });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || `下载失败（HTTP ${response.status}）。`);
  }
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > 128 * 1024 * 1024) {
    throw new Error('资料副本超过Windows轻终端本次下载上限。');
  }
  if (String(response.headers.get('x-edu-material-id') || '') !== normalizedMaterialId
    || Number(response.headers.get('x-edu-material-version')) !== normalizedVersion) {
    throw new Error('主机返回的资料身份或版本与请求不一致。');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (contentLength && bytes.length !== contentLength) throw new Error('资料副本接收不完整。');
  const declaredHash = String(response.headers.get('x-edu-material-sha256') || '');
  const actualHash = crypto.createHash('sha256').update(bytes).digest('hex');
  if (!/^[a-f0-9]{64}$/.test(declaredHash) || actualHash !== declaredHash) {
    throw new Error('资料副本校验失败，未保存。');
  }
  const sourceName = path.basename(String(title || `项目资料-${normalizedMaterialId}`)).replace(/[\r\n]/g, '_');
  const extension = path.extname(sourceName);
  const suggestedName = `${path.basename(sourceName, extension)}-本地副本-v${normalizedVersion}${extension}`;
  const selection = await dialog.showSaveDialog(mainWindow, { title: '保存项目资料本地副本',
    defaultPath: suggestedName, buttonLabel: '保存本地副本' });
  if (selection.canceled || !selection.filePath) return { ok: false, canceled: true, message: '已取消下载。' };
  const handle = await fs.promises.open(selection.filePath, 'wx');
  try { await handle.writeFile(bytes); await handle.sync(); }
  finally { await handle.close(); }
  shell.showItemInFolder(selection.filePath);
  return { ok: true, materialId: normalizedMaterialId, version: normalizedVersion, sha256: actualHash,
    message: '已保存本地副本；编辑此副本不会自动同步或覆盖主机原文。' };
}

function uploadFile(filePath, target, metadata = {}) {
  return new Promise((resolve, reject) => {
    try {
      const config = readConfig();
      const hostUrl = normalizeHostUrl(config.hostUrl);
      if (!hostUrl || !config.sessionToken || !config.currentStudent?.id) throw new Error('请先扫码或输入学生 ID。');
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || !isTerminalUploadFile(filePath)) throw new Error(`不支持上传该文件：${path.basename(filePath)}`);
      if (stat.size > 100 * 1024 * 1024) throw new Error(`文件超过 100 MB：${path.basename(filePath)}`);
      const uploadId = metadata.uploadId || stableUploadId({ path: filePath, size: stat.size, mtimeMs: stat.mtimeMs }, target);
      const route = buildTargetUploadPath(target, path.basename(filePath), { ...metadata, uploadId });
      const url = new URL(`${hostUrl}${route}`);
      const client = url.protocol === 'https:' ? https : http;
      const request = client.request(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.sessionToken}`,
          'Content-Type': 'application/octet-stream',
          'Content-Length': stat.size,
          'X-Upload-Id': uploadId,
          ...(metadata.sha256 ? { 'X-Edu-Content-Sha256': String(metadata.sha256) } : {}),
          ...(metadata.dataGeneration ? { 'X-Edu-Data-Generation': String(metadata.dataGeneration) } : {}),
          'User-Agent': `AI-Education-Windows-Terminal/${TERMINAL_VERSION}`,
        },
      }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let payload = {};
          try { payload = raw ? JSON.parse(raw) : {}; }
          catch { payload = { ok: false, message: raw || `HTTP ${response.statusCode}` }; }
          if ((response.statusCode || 500) >= 400 || payload.ok === false) {
            const error = new Error(payload.message || `HTTP ${response.statusCode}`);
            error.status = response.statusCode;
            error.code = String(payload.code || '');
            error.retryable = payload.retryable;
            error.payload = payload;
            reject(error);
            return;
          }
          const acknowledgement = terminalUploadAcknowledgement({
            hostId: metadata.hostId,
            dataGeneration: metadata.dataGeneration,
            target,
            studentId: metadata.studentId || target.studentId || (target.type === 'student' ? target.id : ''),
            uploadId,
            size: stat.size,
            sha256: metadata.sha256,
          }, payload, { source: 'upload' });
          if (!acknowledgement.ok) {
            const legacy = acknowledgement.code === 'legacy_upload_result_unverifiable';
            const error = new Error(legacy
              ? '旧版主机返回了成功状态，但没有可核对的逐文件回执；结果保留为待核对。'
              : `上传响应缺少或不匹配可核对回执（${acknowledgement.code}）；结果保留为待核对。`);
            error.code = acknowledgement.code;
            error.payload = payload;
            error.receiptUnverified = true;
            reject(error);
            return;
          }
          resolve({ ...payload, uploadId, verifiedReceipt: acknowledgement.receipt });
        });
      });
      request.on('error', reject);
      request.setTimeout(120000, () => request.destroy(Object.assign(new Error('上传等待主机响应超时，接收结果需要核对。'), { code: 'upload_timeout' })));
      fs.createReadStream(filePath).on('error', reject).pipe(request);
    } catch (error) {
      reject(error);
    }
  });
}

function uploadReceiptRoute(item) {
  const params = new URLSearchParams({
    targetType: item.target.type,
    targetId: item.target.id,
    studentId: item.studentId,
    uploadId: item.uploadId,
  });
  return `/api/uploads/receipt?${params.toString()}`;
}

function terminalUploadRetryAt(attempt) {
  const delays = [15_000, 60_000, 5 * 60_000, 15 * 60_000];
  return new Date(Date.now() + delays[Math.min(Math.max(0, Number(attempt || 1) - 1), delays.length - 1)]).toISOString();
}

function terminalReceiptNeedsManualReview(code) {
  const value = String(code || '');
  return ['host_identity_changed', 'host_data_generation_changed', 'receipt_query_unsupported'].includes(value)
    || /^receipt_.*_(?:missing|mismatch|ambiguous)$/.test(value);
}

async function updateTerminalUploadItem(identity, patch) {
  return mutateTerminalUploadQueue((queue) => {
    const index = queue.items.findIndex((item) => item.queueId === identity.queueId
      && item.hostId === identity.hostId && item.dataGeneration === identity.dataGeneration);
    if (index < 0) return null;
    queue.items[index] = { ...queue.items[index], ...patch, updatedAt: new Date().toISOString() };
    return queue.items[index];
  });
}

function cleanupReceivedUploadCopy(item) {
  const root = path.resolve(terminalUploadStagingRoot());
  const target = path.resolve(String(item.stagingPath || ''));
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false;
  const verified = verifyTerminalStagedCopy(item);
  if (!verified.ok) return false;
  try {
    fs.unlinkSync(target);
    return true;
  } catch {
    return false;
  }
}

async function verifyQueuedUploadReceipt(item) {
  const config = readConfig();
  return requestJson(uploadReceiptRoute(item), { token: config.sessionToken, timeoutMs: 15000 });
}

async function runTerminalUploadQueue(options = {}) {
  if (terminalUploadBusy) return { ok: true, skipped: true, reason: 'busy' };
  const config = readConfig();
  const currentStudentId = String(config.currentStudent?.id || '');
  if (!config.hostUrl || !config.sessionToken || !currentStudentId) return { ok: true, skipped: true, reason: 'no_session' };
  terminalUploadBusy = true;
  try {
    let scopeState;
    try {
      scopeState = await inspectCurrentHostScope({ adoptIfMissing: true });
    } catch (error) {
      return { ok: false, offline: true, message: error.message };
    }
    const explicitIds = new Set((options.queueIds || []).map(String));
    const queue = readTerminalUploadQueue(terminalUploadQueuePath());
    const candidates = queue.items.filter((item) => item.state !== 'received'
      && item.studentId === currentStudentId
      && (!explicitIds.size || explicitIds.has(item.queueId))
      && (explicitIds.size || (Date.parse(item.nextAttemptAt || '') || 0) <= Date.now()));
    const outcomes = [];
    for (const item of candidates) {
      if (item.migrationIssues?.length || item.pauseCode === 'legacy_queue_incomplete') {
        outcomes.push({ queueId: item.queueId, state: 'receipt_unknown', code: 'legacy_queue_incomplete' });
        continue;
      }
      const stagedVerification = verifyTerminalStagedCopy(item);
      if (!stagedVerification.ok) {
        const missing = stagedVerification.code === 'staging_copy_missing';
        await updateTerminalUploadItem(item, { state: 'receipt_unknown', pauseCode: stagedVerification.code,
          lastError: missing
            ? '本机待上传副本缺失，请重新选择原文件；记录未自动删除。'
            : stagedVerification.code === 'staging_copy_changed'
              ? '本机稳定待上传副本的大小或 SHA-256 已变化，未读取原文件替代，也未自动上传。'
              : `本机稳定待上传副本暂不可读取：${stagedVerification.message || '未知错误'}`,
          nextAttemptAt: '' });
        outcomes.push({ queueId: item.queueId, state: 'receipt_unknown', code: stagedVerification.code });
        continue;
      }
      if (item.hostId !== scopeState.observed.hostId) {
        await updateTerminalUploadItem(item, { state: 'receipt_unknown', pauseCode: 'host_identity_changed',
          lastError: '当前连接的主机与排队时不同，未自动重放。', nextAttemptAt: '' });
        outcomes.push({ queueId: item.queueId, state: 'receipt_unknown', code: 'host_identity_changed' });
        continue;
      }

      const generationChanged = item.dataGeneration !== scopeState.observed.dataGeneration;
      const mustCheckReceipt = generationChanged || item.state === 'receipt_unknown' || item.state === 'uploading' || item.attempt > 0;
      if (mustCheckReceipt) {
        try {
          const receipt = await verifyQueuedUploadReceipt(item);
          const decision = terminalUploadNextAction(item, scopeState.observed, receipt);
          if (decision.code === 'host_identity_changed') {
            await updateTerminalUploadItem(item, { state: 'receipt_unknown', pauseCode: 'host_identity_changed',
              lastError: '回执来自不同主机，未自动重放。', nextAttemptAt: '' });
            outcomes.push({ queueId: item.queueId, state: 'receipt_unknown', code: 'host_identity_changed' });
            continue;
          }
          const verifiedReceipt = terminalUploadAcknowledgement(item, receipt, { source: 'query' });
          if (decision.action === 'received' && verifiedReceipt.ok) {
            await updateTerminalUploadItem(item, { state: 'received', pauseCode: '', lastError: '',
              receivedAt: String(verifiedReceipt.receipt.receivedAt || new Date().toISOString()), nextAttemptAt: '',
              receipt: verifiedReceipt.receipt });
            cleanupReceivedUploadCopy(item);
            outcomes.push({ queueId: item.queueId, state: 'received', receiptChecked: true });
            continue;
          }
          if (decision.action !== 'upload') {
            const code = decision.code;
            await updateTerminalUploadItem(item, { state: 'receipt_unknown', pauseCode: code,
              lastError: code === 'host_data_generation_changed'
                ? '主机资料代次已变化，原回执未能核实；请在上传记录中核对后决定。'
                : '主机回执尚不能核实接收字节，未自动重传。',
              nextAttemptAt: terminalReceiptNeedsManualReview(code) ? '' : terminalUploadRetryAt(item.attempt + 1) });
            outcomes.push({ queueId: item.queueId, state: 'receipt_unknown', code });
            continue;
          }
        } catch (error) {
          if ([404, 405, 501].includes(Number(error.status))) error.code = 'receipt_query_unsupported';
          const decision = terminalUploadNextAction(item, scopeState.observed, null, error);
          const code = decision.code;
          await updateTerminalUploadItem(item, { state: 'receipt_unknown', pauseCode: code,
            lastError: code === 'host_data_generation_changed'
              ? '主机资料代次已变化且原回执暂无法核对，未自动重放。'
              : code === 'receipt_query_unsupported'
                ? '旧版主机不支持逐文件回执查询；结果保留为人工待核对，且不会自动重传。'
              : `接收结果暂无法核对：${error.message}`,
            nextAttemptAt: terminalReceiptNeedsManualReview(code)
              ? '' : terminalUploadRetryAt(item.attempt + 1) });
          outcomes.push({ queueId: item.queueId, state: 'receipt_unknown', code });
          continue;
        }
      }

      const attempt = Number(item.attempt || 0) + 1;
      await updateTerminalUploadItem(item, { state: 'uploading', pauseCode: '', lastError: '', attempt,
        lastAttemptAt: new Date().toISOString(), nextAttemptAt: '' });
      try {
        const response = await uploadFile(item.stagingPath, item.target, {
          ...item.metadata,
          uploadId: item.uploadId,
          sourceType: item.sourceType,
          sha256: item.sha256,
          hostId: item.hostId,
          dataGeneration: item.dataGeneration,
          studentId: item.studentId,
        });
        const verified = terminalUploadAcknowledgement(item, response, { source: 'upload' });
        if (!verified.ok) {
          const error = new Error(`上传响应回执不能完整核对（${verified.code}）。`);
          error.code = verified.code;
          error.receiptUnverified = true;
          throw error;
        }
        await updateTerminalUploadItem(item, { state: 'received', pauseCode: '', lastError: '',
          receivedAt: String(verified.receipt.receivedAt || new Date().toISOString()), nextAttemptAt: '',
          receipt: verified.receipt });
        cleanupReceivedUploadCopy(item);
        outcomes.push({ queueId: item.queueId, state: 'received' });
      } catch (error) {
        const pause = ['host_data_generation_changed', 'host_identity_changed', 'project_unavailable', 'student_unavailable'].includes(error.code);
        await updateTerminalUploadItem(item, { state: 'receipt_unknown', pauseCode: String(error.code || 'upload_response_unknown'),
          lastError: error.code === 'legacy_upload_result_unverifiable'
            ? '旧版主机返回了成功状态但没有可核对回执；保留本机副本并等待人工核对。'
            : String(error.message || error),
          nextAttemptAt: pause ? '' : terminalUploadRetryAt(attempt) });
        outcomes.push({ queueId: item.queueId, state: 'receipt_unknown', code: error.code || 'upload_response_unknown' });
      }
    }
    return { ok: outcomes.every((item) => item.state === 'received'), outcomes };
  } finally {
    terminalUploadBusy = false;
    notifyTerminalUploadQueue();
  }
}

async function uploadPaths(paths, target, metadata = {}) {
  const normalizedTarget = normalizeUploadTarget(target);
  const files = (Array.isArray(paths) ? paths : []).filter((filePath) => isTerminalUploadFile(filePath));
  const results = [];
  let config = readConfig();
  if (!config.hostScope?.hostId || !config.hostScope?.dataGeneration) {
    try { await inspectCurrentHostScope({ adoptIfMissing: true }); config = readConfig(); }
    catch (error) {
      return { ok: false, success: 0, failed: files.length, pending: 0, total: files.length,
        results: files.map((filePath) => ({ ok: false, filename: path.basename(filePath), message: error.message })) };
    }
  }
  const hostScope = normalizedHostScope(config.hostScope, config.hostUrl);
  const observedScope = normalizedHostScope(config.observedHostScope, config.hostUrl);
  if (observedScope.hostId && (observedScope.hostId !== hostScope.hostId
    || observedScope.dataGeneration !== hostScope.dataGeneration)) {
    const reason = observedScope.hostId !== hostScope.hostId
      ? '当前连接的主机身份与原绑定不同，请重新配对；文件尚未加入新主机队列。'
      : '主机资料代次已变化，请先在“资料上传记录”核对并确认当前代次。';
    return { ok: false, success: 0, failed: files.length, pending: 0, total: files.length,
      results: files.map((filePath) => ({ ok: false, filename: path.basename(filePath), message: reason })) };
  }
  for (let index = 0; index < files.length; index += 1) {
    const filePath = files[index];
    const captureItem = Array.isArray(metadata.captureItems)
      ? metadata.captureItems.find((item) => path.resolve(String(item.path || '')) === path.resolve(filePath))
      : null;
    notify('terminal:upload-progress', { status: 'queued', current: index + 1, total: files.length, filename: path.basename(filePath) });
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > 100 * 1024 * 1024) throw new Error(`文件超过 100 MB：${path.basename(filePath)}`);
      const itemMetadata = {
        ...metadata,
        captureItems: undefined,
        captureSamples: undefined,
        capturePolicy: undefined,
        captureItemId: captureItem?.id || (metadata.captureSessionId ? `${metadata.captureSessionId}-${index + 1}` : metadata.captureItemId),
        capturedAt: captureItem?.capturedAt || metadata.capturedAt || '',
        captureSequence: captureItem?.sequence || index + 1,
        captureHighlighted: Boolean(captureItem?.highlighted),
      };
      const uploadId = metadata.uploadId && files.length === 1
        ? String(metadata.uploadId)
        : stableUploadId({ path: filePath, size: stat.size, mtimeMs: stat.mtimeMs }, normalizedTarget);
      const queued = await withTerminalUploadMutation(() => stageTerminalUpload({
        sourcePath: filePath,
        queuePath: terminalUploadQueuePath(),
        stagingDir: terminalUploadStagingRoot(),
        target: normalizedTarget,
        hostId: hostScope.hostId,
        dataGeneration: hostScope.dataGeneration,
        hostUrl: hostScope.hostUrl,
        deviceId: deviceId(),
        studentId: String(config.currentStudent?.id || normalizedTarget.studentId || ''),
        uploadId,
        sourceType: metadata.sourceType,
        metadata: itemMetadata,
      }));
      results.push({
        ok: true,
        queueId: queued.queueId,
        filename: queued.filename,
      });
    } catch (error) {
      results.push({ ok: false, filename: path.basename(filePath), message: error.message });
    }
  }
  notifyTerminalUploadQueue();
  const queueIds = results.filter((item) => item.ok).map((item) => item.queueId);
  if (queueIds.length) await runTerminalUploadQueue({ queueIds });
  const queueAfter = readTerminalUploadQueue(terminalUploadQueuePath());
  const finalById = new Map(queueAfter.items.map((item) => [item.queueId, item]));
  const success = results.filter((item) => item.ok && finalById.get(item.queueId)?.state === 'received').length;
  const pending = results.filter((item) => item.ok && finalById.get(item.queueId)?.state !== 'received').length;
  const failed = results.filter((item) => !item.ok).length;
  let completion = null;
  if (success === results.length && metadata.captureSessionId) {
    try {
      completion = await notifyCaptureSessionComplete(normalizedTarget, metadata);
    } catch (error) {
      completion = { ok: false, message: error.message };
    }
  }
  const summary = {
    ok: success === results.length && (!metadata.captureSessionId || completion?.ok),
    success,
    failed,
    pending,
    total: results.length,
    results: results.map((item) => ({ ...item, state: item.ok ? finalById.get(item.queueId)?.state || 'queued' : 'failed' })),
    completion,
  };
  notify('terminal:upload-progress', { status: summary.ok ? 'succeeded' : pending ? 'receipt_unknown' : 'failed', ...summary });
  return summary;
}

function postHostJson(route, payload) {
  return new Promise((resolve, reject) => {
    const config = readConfig();
    const hostUrl = normalizeHostUrl(config.hostUrl);
    if (!hostUrl || !config.sessionToken || !config.currentStudent?.id) {
      reject(new Error('学生会话尚未连接主机。'));
      return;
    }
    const url = new URL(`${hostUrl}${route}`);
    const content = Buffer.from(JSON.stringify(payload || {}), 'utf8');
    const client = url.protocol === 'https:' ? https : http;
    const request = client.request(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.sessionToken}`,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': content.length,
        'User-Agent': `AI-Education-Windows-Terminal/${TERMINAL_VERSION}`,
      },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let result = {};
        try { result = raw ? JSON.parse(raw) : {}; }
        catch { result = { ok: false, message: raw || `HTTP ${response.statusCode}` }; }
        if ((response.statusCode || 500) >= 400 || result.ok === false) reject(new Error(result.message || `HTTP ${response.statusCode}`));
        else resolve(result);
      });
    });
    request.setTimeout(30_000, () => request.destroy(new Error('通知主机会话完成超时。')));
    request.on('error', reject);
    request.end(content);
  });
}

function notifyCaptureSessionComplete(target, metadata = {}) {
  const config = readConfig();
  const studentId = String(config.currentStudent?.id || target.studentId || (target.type === 'student' ? target.id : ''));
  if (!studentId || !metadata.captureSessionId) return Promise.reject(new Error('采集会话缺少明确学生归属。'));
  return postHostJson(`/api/students/${encodeURIComponent(studentId)}/capture-sessions/${encodeURIComponent(metadata.captureSessionId)}/complete`, {
    projectId: target.type === 'project' ? String(target.id || '') : '',
    expectedItemCount: Number(metadata.expectedItemCount || metadata.captureItems?.length || 0),
    startedAt: String(metadata.startedAt || metadata.courseStartedAt || ''),
    endedAt: String(metadata.endedAt || metadata.courseCompletedAt || ''),
    sourceType: String(metadata.sourceType || 'windows_terminal_course_capture'),
    sourceName: deidentifyCaptureSourceName(metadata.sourceName || '', metadata.captureSourceType || 'screen'),
    courseId: String(metadata.courseId || ''),
    courseUrl: String(metadata.courseUrl || ''),
    courseStartedAt: String(metadata.courseStartedAt || ''),
    courseCompletedAt: String(metadata.courseCompletedAt || ''),
    platform: 'windows-student-terminal',
    deviceId: String(deviceId() || ''),
    captureMode: String(metadata.capturePolicy?.mode || ''),
    capturePolicy: metadata.capturePolicy || null,
    captureSamples: Array.isArray(metadata.captureSamples) ? metadata.captureSamples : [],
  });
}

function readCaptureDeliveryQueue() {
  const value = readJson(captureDeliveryQueuePath(), { version: 1, items: [] });
  return { version: 1, items: Array.isArray(value.items) ? value.items : [] };
}

function writeCaptureDeliveryQueue(queue) {
  writeJson(captureDeliveryQueuePath(), { version: 1, updatedAt: new Date().toISOString(), items: queue.items || [] });
}

function queueCaptureDelivery(session, options = {}) {
  if (!session?.id || !session?.target || !Array.isArray(session.files) || !session.files.length) return null;
  const queue = readCaptureDeliveryQueue();
  const id = String(session.id);
  const item = {
    id,
    target: normalizeUploadTarget(session.target),
    files: session.files.map(String),
    captureItems: (session.items || []).map((entry) => ({
      id: String(entry.id || ''),
      path: String(entry.path || ''),
      capturedAt: String(entry.capturedAt || ''),
      sequence: Number(entry.sequence || 0),
      highlighted: Boolean(entry.highlighted),
    })),
    captureSamples: Array.isArray(session.captureSamples) ? session.captureSamples : readCaptureSamples(session),
    capturePolicy: {
      mode: String(session.options?.mode || ''),
      sampleIntervalMs: Number(session.options?.sampleIntervalMs || 0),
      maximumSaveIntervalMs: Number(session.options?.maximumSaveIntervalMs || 0),
    },
    sourceType: 'windows_terminal_course_capture',
    sourceName: deidentifyCaptureSourceName(session.sourceName, session.sourceType),
    captureSourceType: String(session.sourceType || 'screen'),
    captureSessionId: id,
    expectedItemCount: session.items?.length || session.files.length,
    startedAt: String(session.startedAt || ''),
    endedAt: String(session.endedAt || ''),
    courseId: String(session.courseId || ''),
    courseUrl: String(session.courseUrl || ''),
    courseStartedAt: String(session.courseStartedAt || ''),
    courseCompletedAt: String(session.courseCompletedAt || ''),
    attempt: Math.max(0, Number(options.attempt || 0)),
    nextRetryAt: String(options.nextRetryAt || new Date().toISOString()),
    lastError: '',
  };
  const index = queue.items.findIndex((entry) => String(entry.id) === id);
  if (index >= 0) queue.items[index] = { ...queue.items[index], ...item, attempt: options.resetAttempt ? 0 : Number(queue.items[index].attempt || 0) };
  else queue.items.push(item);
  writeCaptureDeliveryQueue(queue);
  return item;
}

async function runCaptureDeliveryQueue() {
  if (captureDeliveryBusy) return { ok: true, skipped: true };
  const config = readConfig();
  if (!config.hostUrl || !config.sessionToken || !config.currentStudent?.id) return { ok: true, skipped: true };
  const queue = readCaptureDeliveryQueue();
  const now = Date.now();
  const item = queue.items
    .filter((entry) => (Date.parse(entry.nextRetryAt || '') || 0) <= now)
    .sort((left, right) => (Date.parse(left.nextRetryAt || '') || 0) - (Date.parse(right.nextRetryAt || '') || 0))[0];
  if (!item) return { ok: true, skipped: true };
  captureDeliveryBusy = true;
  try {
    const result = await uploadPaths(item.files, item.target, item);
    const latest = readCaptureDeliveryQueue();
    const index = latest.items.findIndex((entry) => String(entry.id) === String(item.id));
    if (result.ok) {
      if (index >= 0) latest.items.splice(index, 1);
      writeCaptureDeliveryQueue(latest);
      notify('terminal:capture-changed', { id: item.id, status: 'delivered', delivery: result });
      return result;
    }
    const attempt = Number(item.attempt || 0) + 1;
    const delay = CAPTURE_DELIVERY_RETRY_DELAYS[Math.min(attempt - 1, CAPTURE_DELIVERY_RETRY_DELAYS.length - 1)];
    if (index >= 0) latest.items[index] = {
      ...latest.items[index],
      attempt,
      nextRetryAt: new Date(Date.now() + delay).toISOString(),
      lastError: String(result.completion?.message || result.results?.find((entry) => !entry.ok)?.message || '送达未完成'),
    };
    writeCaptureDeliveryQueue(latest);
    notify('terminal:capture-changed', { id: item.id, status: 'delivery_retry_scheduled', nextRetryAt: latest.items[index]?.nextRetryAt, message: '采集资料将在后台自动重试，无需人工恢复。' });
    return result;
  } finally {
    captureDeliveryBusy = false;
  }
}

function listFolderFiles(root, limit = 1000) {
  const files = [];
  const walk = (folder) => {
    if (files.length >= limit || !fs.existsSync(folder)) return;
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.isFile() && isTerminalUploadFile(fullPath)) files.push(fullPath);
      if (files.length >= limit) break;
    }
  };
  walk(root);
  return files;
}

async function runAutoDelivery() {
  if (autoDeliveryBusy) return;
  const config = readConfig();
  const auto = config.autoDelivery || {};
  if (config.terminalMode !== 'personal' || !auto.enabled || !auto.folder || !auto.target || !config.hostUrl || !config.sessionToken) return;
  autoDeliveryBusy = true;
  try {
    const ledger = readJson(deliveryPath(), { version: 1, delivered: {}, failures: {} });
    const candidates = listFolderFiles(auto.folder).map((filePath) => {
      const stat = fs.statSync(filePath);
      return { path: filePath, size: stat.size, mtimeMs: stat.mtimeMs, uploadId: stableUploadId({ path: filePath, size: stat.size, mtimeMs: stat.mtimeMs }, auto.target) };
    }).filter((file) => !ledger.delivered[file.uploadId]);
    notify('terminal:auto-delivery', { status: candidates.length ? 'uploading' : 'idle', pending: candidates.length, folder: auto.folder });
    let failed = 0;
    for (const file of candidates) {
      try {
        const result = await uploadPaths([file.path], auto.target, { uploadId: file.uploadId, sourceType: 'windows_terminal_auto_folder' });
        if (result.success === 1) {
          ledger.delivered[file.uploadId] = { path: file.path, deliveredAt: new Date().toISOString(), uploadId: file.uploadId };
          delete ledger.failures[file.uploadId];
        } else {
          failed += 1;
          ledger.failures[file.uploadId] = { path: file.path, failedAt: new Date().toISOString(),
            message: result.pending ? '已保留稳定副本，接收结果待核对。' : result.results?.[0]?.message || '投递未完成' };
        }
      } catch (error) {
        failed += 1;
        ledger.failures[file.uploadId] = { path: file.path, failedAt: new Date().toISOString(), message: error.message };
      }
      writeJson(deliveryPath(), { ...ledger, updatedAt: new Date().toISOString() });
    }
    notify('terminal:auto-delivery', { status: failed ? 'failed' : 'succeeded', delivered: candidates.length - failed, failed, pending: 0, folder: auto.folder });
  } finally {
    autoDeliveryBusy = false;
  }
}

function captureSignature(image) {
  const bitmap = image.resize({ width: 16, height: 16, quality: 'good' }).toBitmap();
  const signature = [];
  for (let offset = 0; offset + 3 < bitmap.length; offset += 4) {
    signature.push(Math.round((bitmap[offset + 2] * 0.299) + (bitmap[offset + 1] * 0.587) + (bitmap[offset] * 0.114)));
  }
  return signature;
}

function publicCaptureSession(session) {
  if (!session) return null;
  return { ...session, timer: undefined, stopTimer: undefined, lastSavedSignature: undefined };
}

async function captureFrame(session, input = {}) {
  if (!session || session !== activeCapture) return false;
  try {
    if (session.status === 'paused') {
      appendCaptureSample(session, { decision: 'paused', paused: true });
      session.updatedAt = new Date().toISOString();
      return false;
    }
    if (session.status !== 'capturing') return false;
    const sources = await desktopCapturer.getSources({ types: [session.sourceType], thumbnailSize: { width: 1600, height: 900 } });
    const source = sources.find((item) => item.id === session.sourceId);
    if (!source || source.thumbnail.isEmpty()) {
      appendCaptureSample(session, { decision: 'source_unavailable' });
      return false;
    }
    const now = Date.now();
    const signature = captureSignature(source.thumbnail);
    const decision = captureSaveDecision(session, {
      now,
      signature,
      force: Boolean(input.force),
      highlight: Boolean(input.highlight),
      options: session.options,
    });
    session.candidateFrameCount += 1;
    if (!decision.save) {
      appendCaptureSample(session, { sampledAt: new Date(now).toISOString(), decision: decision.reason, difference: decision.difference });
      session.deduplicatedCount += 1;
      session.lastDecision = decision.reason;
      session.updatedAt = new Date(now).toISOString();
      return false;
    }
    const capturedAt = new Date(now).toISOString();
    const content = source.thumbnail.toJPEG(84);
    const contentHash = crypto.createHash('sha1').update(content).digest('hex');
    const itemId = `${session.id}-${session.items.length + 1}`;
    const filename = `capture-${capturedAt.replace(/\D/g, '').slice(0, 14)}-${session.items.length + 1}.jpg`;
    const target = path.join(session.folder, filename);
    fs.writeFileSync(target, content);
    session.files.push(target);
    session.items.push({ id: itemId, path: target, filename, capturedAt, sequence: session.items.length + 1, highlighted: Boolean(input.highlight), reason: decision.reason, hashAlgorithm: 'sha1', contentHash });
    appendCaptureSample(session, {
      sampledAt: capturedAt,
      decision: decision.reason === 'initial' ? 'initial' : 'saved',
      difference: decision.difference,
      captureItemId: itemId,
      hashAlgorithm: 'sha1',
      contentHash,
      path: target,
    });
    session.lastContentHash = contentHash;
    session.lastSavedSignature = signature;
    session.lastSavedAt = now;
    session.lastDecision = decision.reason;
    session.count = session.files.length;
    session.updatedAt = new Date().toISOString();
    notify('terminal:capture-changed', publicCaptureSession(session));
    updateCaptureControlWindow();
    return true;
  } catch (error) {
    try { appendCaptureSample(session, { decision: 'capture_error' }); } catch { /* The sample log itself may be unavailable. */ }
    session.lastDecision = 'capture_error';
    session.lastError = String(error?.message || error || 'capture_error');
    session.updatedAt = new Date().toISOString();
    return false;
  }
}

async function startCapture(input = {}) {
  if (activeCapture) throw new Error('已有屏幕采集正在运行。');
  const sourceId = String(input.sourceId || '');
  const sourceType = input.sourceType === 'window' ? 'window' : 'screen';
  if (!sourceId) throw new Error('请选择需要采集的屏幕或窗口。');
  const config = readConfig();
  if (!config.currentStudent?.id || String(input.studentId || '') !== String(config.currentStudent.id)) throw new Error('屏幕采集只能属于当前登录学生。');
  const target = normalizeUploadTarget(input.target);
  if (!target || String(target.studentId || '') !== String(config.currentStudent.id)) throw new Error('请先选择当前学生本人或其关联项目作为资料目标。');
  if (target.type === 'project' && String(target.id || '') !== String(input.projectId || '')) throw new Error('采集项目目标不一致，请重新选择。');
  const availableSources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 1, height: 1 } });
  const selectedSource = availableSources.find((source) => source.id === sourceId);
  if (!selectedSource) throw new Error('所选采集来源已不可用，请重新选择。');
  if (sourceType === 'window' && isSensitiveCaptureSourceName(selectedSource.name)) throw new Error('该窗口可能包含密码、凭据或私人通信，已自动排除。');
  const id = `windows-terminal-capture-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const folder = path.join(captureRoot(), id);
  fs.mkdirSync(folder, { recursive: true });
  const options = normalizeCaptureOptions(input);
  const startedAt = new Date().toISOString();
  const session = {
    id,
    status: 'capturing',
    sourceId,
    sourceType,
    sourceName: deidentifyCaptureSourceName(selectedSource.name || input.sourceName, sourceType),
    studentId: String(input.studentId || ''),
    projectId: String(input.projectId || ''),
    target,
    folder,
    files: [],
    items: [],
    count: 0,
    startedAt,
    plannedEndAt: new Date(Date.now() + (options.durationMinutes * 60 * 1000)).toISOString(),
    options,
    candidateFrameCount: 0,
    deduplicatedCount: 0,
    highlightedCount: 0,
    sampleCount: 0,
    lastSampledAt: '',
    lastTrustedSampleAt: '',
    sampleLogPath: captureSampleLogPath({ folder }),
    courseId: activeCourse?.courseId || '',
    courseProvider: activeCourse?.provider || '',
    courseUrl: activeCourse?.currentUrl || activeCourse?.url || '',
    courseStartedAt: activeCourse?.startedAt || '',
  };
  activeCapture = session;
  await captureFrame(session, { force: true });
  session.timer = setInterval(() => { void captureFrame(session); }, options.sampleIntervalMs);
  session.stopTimer = setTimeout(() => { stopCapture('duration_complete'); }, Math.max(1000, Date.parse(session.plannedEndAt) - Date.now()));
  updateCaptureControlWindow();
  return publicCaptureSession(session);
}

function stopCapture(reason = 'manual') {
  if (!activeCapture) return null;
  clearInterval(activeCapture.timer);
  clearTimeout(activeCapture.stopTimer);
  activeCapture.status = 'completed';
  activeCapture.endedAt = new Date().toISOString();
  activeCapture.courseCompletedAt = activeCapture.endedAt;
  activeCapture.endReason = reason;
  try {
    activeCapture.sampleIndexPath = writeCaptureSampleIndex(activeCapture);
    activeCapture.sampleIndexStatus = 'written';
  } catch (error) {
    activeCapture.sampleIndexStatus = 'write_failed';
    activeCapture.sampleIndexError = String(error?.message || error || 'sample_index_write_failed');
  }
  const result = publicCaptureSession(activeCapture);
  activeCapture = null;
  updateCaptureControlWindow();
  const queued = queueCaptureDelivery(result, { resetAttempt: true });
  notify('terminal:capture-changed', { ...result, deliveryStatus: queued ? 'queued' : 'empty' });
  if (queued) void runCaptureDeliveryQueue();
  return { ...result, deliveryStatus: queued ? 'queued' : 'empty' };
}

function captureControlHtml(session) {
  const paused = session.status === 'paused';
  const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const sourceName = escapeHtml(session.sourceName || '已授权屏幕');
  const policyName = escapeHtml(session.options?.policyName || '智能混合');
  return `<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;font-family:"Microsoft YaHei",sans-serif;background:transparent;color:#172a27}.bar{height:72px;padding:10px 12px;display:flex;align-items:center;gap:10px;background:#fbfaff;border:1px solid #d9ccff;border-left:4px solid #7c3aed;border-radius:10px;box-shadow:0 12px 30px rgba(56,35,91,.22);-webkit-app-region:drag}.state{min-width:0;flex:1;display:grid;gap:3px}.state strong{font-size:13px}.state span{font-size:11px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dot{width:9px;height:9px;border-radius:50%;background:${paused ? '#d97706' : '#ef4444'};box-shadow:0 0 0 4px ${paused ? 'rgba(217,119,6,.12)' : 'rgba(239,68,68,.12)'}}button{width:34px;height:34px;border:1px solid #d9ccff;background:white;color:#6d28d9;border-radius:7px;font-size:15px;cursor:pointer;-webkit-app-region:no-drag}button:hover{background:#f1eaff}button.end{color:#b42318;border-color:#fecaca}</style></head><body><div class="bar"><i class="dot"></i><div class="state"><strong>${paused ? '采集已暂停' : '正在采集'} · ${session.count || 0} 张</strong><span>${sourceName} · ${policyName}</span></div><button title="重点截取" id="highlight">★</button><button title="${paused ? '继续采集' : '暂停采集'}" id="pause">${paused ? '▶' : 'Ⅱ'}</button><button title="打开采集箱" id="folder">▣</button><button class="end" title="结束并整理" id="stop">■</button></div><script>const call=(action)=>window.terminalBridge.captureControl(action);document.getElementById('highlight').onclick=()=>call('highlight');document.getElementById('pause').onclick=()=>call('${paused ? 'resume' : 'pause'}');document.getElementById('folder').onclick=()=>call('folder');document.getElementById('stop').onclick=()=>call('stop');</script></body></html>`;
}

function updateCaptureControlWindow() {
  if (!activeCapture) {
    if (captureControlWindow && !captureControlWindow.isDestroyed()) captureControlWindow.close();
    captureControlWindow = null;
    return;
  }
  if (!captureControlWindow || captureControlWindow.isDestroyed()) {
    const display = mainWindow && !mainWindow.isDestroyed()
      ? screen.getDisplayMatching(mainWindow.getBounds())
      : screen.getPrimaryDisplay();
    captureControlWindow = new BrowserWindow({
      ...captureControlBounds(display.workArea, 460, 72),
      frame: false,
      transparent: true,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      webPreferences: { preload: path.join(__dirname, 'terminal-preload.cjs'), contextIsolation: true, nodeIntegration: false },
    });
    captureControlWindow.setAlwaysOnTop(true, 'screen-saver');
    captureControlWindow.on('closed', () => { captureControlWindow = null; });
  }
  const window = captureControlWindow;
  loadVisibleCaptureControlWindow(window, captureControlHtml(activeCapture),
    () => captureControlWindow === window && Boolean(activeCapture),
    (error) => console.warn('学生端屏幕采集控制条加载失败：', error));
}

function publicTailscaleStatus(status = findWindowsTailscaleInstall()) {
  return {
    installed: Boolean(status.installed),
    canOpen: Boolean(status.canOpen),
    version: String(status.version || ''),
    downloadUrl: TAILSCALE_WINDOWS_DOWNLOAD_URL,
  };
}

function terminalCompanionProjects() {
  const config = readConfig();
  const cached = loadRemoteStateCache(config);
  const studentId = String(config.currentStudent?.id || '');
  const projects = effectiveProjectCache.length ? effectiveProjectCache : (cached?.payload?.projects || []);
  return projects.filter((project) => Array.isArray(project.studentIds)
    && project.studentIds.map(String).includes(studentId) && String(project.status || '') !== 'sealed')
    .map((project) => ({ id: String(project.id || ''), name: String(project.name || '未命名项目') }))
    .filter((project) => project.id);
}

function terminalCompanionPopoverState() {
  const projects = terminalCompanionProjects();
  if (!projects.some((project) => project.id === companionSelectedProjectId)) companionSelectedProjectId = projects[0]?.id || '';
  return {
    mode: companionPopoverMode,
    modeGroups: COMPANION_MODE_GROUPS,
    actions: Object.fromEntries(Object.entries(COMPANION_ACTIONS).map(([id, item]) => [id, {
      label: item.label,
      summary: String(item.summary || item.task || '').slice(0, 52),
      configMode: item.configMode || (COMPANION_MODE_GROUPS.some((group) => ['verify', 'plan'].includes(group.id) && group.actions.includes(id)) ? 'goal' : 'session'),
    }])),
    projects,
    projectId: companionSelectedProjectId,
    projectActions: [
      { id: 'tutor', label: '项目引导', summary: '一次一个问题，围绕项目证据推进' },
      { id: 'digest', label: '资料梳理', summary: '整理当前项目资料与待核实项' },
      { id: 'learning_plan', label: '项目计划', summary: '形成有证据和节点的下一步计划' },
      { id: 'learning_summary', label: '项目复盘', summary: '区分成果、问题、证据与下一步' },
    ],
  };
}

function sendTerminalCompanionPopoverState() {
  if (companionPopoverLoaded && companionPopoverWindow && !companionPopoverWindow.isDestroyed()) {
    companionPopoverWindow.webContents.send('companion-popover:state', terminalCompanionPopoverState());
  }
  sendTerminalCompanionState();
}

function closeTerminalCompanionPopover() {
  companionPopoverMode = '';
  const window = companionPopoverWindow;
  companionPopoverWindow = null;
  companionPopoverLoaded = false;
  if (window && !window.isDestroyed()) window.close();
  sendTerminalCompanionState();
}

function showTerminalCompanionPopover(mode) {
  if (!companionWindow || companionWindow.isDestroyed()) return { ok: false, message: '学习工具条窗口已失效。' };
  if (!['learning', 'project-tutor'].includes(mode)) return { ok: false, message: '未知工具条面板。' };
  if (companionPopoverWindow && !companionPopoverWindow.isDestroyed() && companionPopoverMode === mode) {
    companionPopoverWindow.show();
    companionPopoverWindow.focus();
    sendTerminalCompanionPopoverState();
    return { ok: true };
  }
  closeTerminalCompanionPopover();
  companionPopoverMode = mode;
  const anchor = companionWindow.getBounds();
  const area = screen.getDisplayMatching(anchor).workArea;
  const size = mode === 'learning' ? { width: 370, height: 350 } : { width: 360, height: 300 };
  const below = anchor.y + anchor.height + 6;
  const y = below + size.height <= area.y + area.height ? below : Math.max(area.y, anchor.y - size.height - 6);
  const x = Math.max(area.x, Math.min(anchor.x, area.x + area.width - size.width));
  const window = new BrowserWindow({
    x, y, ...size, frame: false, transparent: true, resizable: false, alwaysOnTop: true,
    skipTaskbar: true, show: false, parent: companionWindow,
    webPreferences: {
      preload: path.join(__dirname, 'companion-popover-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: 'terminal-companion-panels',
    },
  });
  companionPopoverWindow = window;
  window.setAlwaysOnTop(true, 'screen-saver');
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('did-finish-load', () => {
    if (companionPopoverWindow !== window) return;
    companionPopoverLoaded = true;
    sendTerminalCompanionPopoverState();
    window.show();
    window.focus();
  });
  window.on('closed', () => {
    if (companionPopoverWindow === window) {
      companionPopoverWindow = null;
      companionPopoverLoaded = false;
      companionPopoverMode = '';
      sendTerminalCompanionState();
    }
  });
  void window.loadFile(path.join(__dirname, 'companion-popover.html')).catch(() => closeTerminalCompanionPopover());
  return { ok: true };
}

function copyTerminalCompanionPrompt(actionId, config = {}) {
  const current = readConfig();
  const student = current.currentStudent;
  if (!student?.id) return { ok: false, message: '请先进入学生空间。' };
  const projects = terminalCompanionProjects();
  const project = companionPopoverMode === 'project-tutor'
    ? projects.find((item) => item.id === companionSelectedProjectId)
    : null;
  if (companionPopoverMode === 'project-tutor' && !project) return { ok: false, message: '请选择当前学生的关联项目。' };
  try {
    const target = { id: 'generic', kind: 'generic', displayName: '当前 Agent', verified: false, capabilities: { copy: true, open: false, query: false, archive: false } };
    const packet = createCompanionPromptPacket({ actionId, student, target, scope: project ? 'project' : 'student', project, config });
    clipboard.writeText(packet.promptText);
    const ok = clipboard.readText().replace(/\r\n/g, '\n') === packet.promptText.replace(/\r\n/g, '\n');
    return { ok, message: ok ? (project ? `已复制“${project.name}”项目导师提示词。` : '已复制学习模式提示词，可粘贴到当前 Agent。') : '剪贴板写入后校验失败，请重试。' };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

function terminalCompanionState() {
  const config = readConfig();
  return {
    visible: Boolean(companionWindow && !companionWindow.isDestroyed() && companionWindow.isVisible()),
    connected: Boolean(config.hostUrl && config.sessionToken && config.currentStudent?.id),
    studentId: String(config.currentStudent?.id || ''),
    studentName: String(config.currentStudent?.name || '').slice(0, 24),
    terminalMode: String(config.terminalMode || 'shared'),
    agentCaptureEnabled: Boolean(config.agentCapture?.enabled),
    popoverMode: companionPopoverMode,
  };
}

function sendTerminalCompanionState() {
  if (companionWindow && !companionWindow.isDestroyed()) companionWindow.webContents.send('terminal-companion:state', terminalCompanionState());
}

async function showTerminalCompanion() {
  if (!companionWindow || companionWindow.isDestroyed()) {
    const display = screen.getDisplayMatching(mainWindow?.getBounds() || screen.getPrimaryDisplay().workArea);
    const width = 590, height = 54;
    companionWindow = new BrowserWindow({
      width, height,
      x: display.workArea.x + Math.max(0, Math.round((display.workArea.width - width) / 2)),
      y: display.workArea.y + 74,
      minWidth: 420,
      minHeight: 54,
      maxHeight: 54,
      frame: false,
      transparent: true,
      resizable: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'terminal-companion-preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    companionWindow.setAlwaysOnTop(true, 'screen-saver');
    companionWindow.on('closed', () => { closeTerminalCompanionPopover(); companionWindow = null; });
    try {
      await companionWindow.loadFile(path.join(__dirname, 'terminal-companion.html'));
    } catch (error) {
      if (companionWindow && !companionWindow.isDestroyed()) companionWindow.close();
      return { ok: false, message: `学习工具条加载失败：${error.message}` };
    }
  }
  if (!companionWindow || companionWindow.isDestroyed()) return { ok: false, message: '学习工具条窗口已失效。' };
  companionWindow.show();
  companionWindow.focus();
  sendTerminalCompanionState();
  return { ok: true, state: terminalCompanionState() };
}

async function showTerminalCompanionPanel(mode) {
  // Do not create the child panel until the toolbar document and preload have
  // finished loading. This removes the first-click race that made both mentor
  // buttons look unresponsive on a fresh student-terminal launch.
  const shown = await showTerminalCompanion();
  if (!shown.ok) return shown;
  return showTerminalCompanionPopover(mode);
}

function registerIpc() {
  ipcMain.handle('terminal:get-config', () => publicConfig());
  ipcMain.handle('terminal:get-tailscale-status', () => publicTailscaleStatus());
  ipcMain.handle('terminal:open-tailscale', async () => {
    const status = findWindowsTailscaleInstall();
    if (!status.canOpen) {
      return {
        ok: false,
        message: status.installed
          ? '已检测到 Tailscale，但未找到可启动入口；请从 Windows 开始菜单打开或重新安装。'
          : '尚未安装 Tailscale，请先下载安装。',
        status: publicTailscaleStatus(status),
      };
    }
    const error = await shell.openPath(status.launchPath);
    return {
      ok: !error,
      message: error ? `打开 Tailscale 失败：${error}` : '已打开 Tailscale。',
      status: publicTailscaleStatus(status),
    };
  });
  ipcMain.handle('terminal:download-tailscale', async () => {
    await shell.openExternal(TAILSCALE_WINDOWS_DOWNLOAD_URL);
    return { ok: true, message: '已打开 Tailscale Windows 官方下载页。', url: TAILSCALE_WINDOWS_DOWNLOAD_URL };
  });
  ipcMain.handle('terminal:get-pairing-state', (_event, query) => terminalPairingState(query));
  ipcMain.handle('terminal:find-lan-hosts', (_event, query) => findLanHosts(query));
  ipcMain.handle('terminal:request-host-pair', (_event, hostDeviceId) => requestHostPair(hostDeviceId));
  ipcMain.handle('terminal:cancel-pair-request', () => cancelPendingPairRequest());
  ipcMain.handle('terminal:accept-pair-invite', () => acceptPendingPairInvite());
  ipcMain.handle('terminal:reject-pair-invite', () => rejectPendingPairInvite());
  ipcMain.handle('terminal:copy-machine-code', () => {
    const value = machineCode('tablet', deviceId());
    clipboard.writeText(value);
    return { ok: clipboard.readText() === value, value };
  });
  ipcMain.handle('terminal:pair', (_event, input) => pairWithHost(input));
  ipcMain.handle('terminal:load-state', () => loadRemoteState());
  ipcMain.handle('terminal:set-mode', (_event, terminalMode) => setTerminalMode(terminalMode));
  ipcMain.handle('terminal:login-student', (_event, loginId) => loginStudent(loginId));
  ipcMain.handle('terminal:logout-student', () => logoutStudent());
  ipcMain.handle('terminal:get-agent-capture', () => refreshPersonalAgentCapture());
  ipcMain.handle('terminal:set-agent-capture', (_event, enabled) => authorizePersonalAgentCapture(Boolean(enabled)));
  ipcMain.handle('terminal:run-agent-capture', () => runAgentCaptureDrain());
  ipcMain.handle('terminal:get-agent-bridge', () => getTerminalAgentBridge().snapshot());
  ipcMain.handle('terminal:set-agent-bridge', (_event, enabled) => setTerminalAgentBridge(Boolean(enabled)));
  ipcMain.handle('terminal:copy-agent-bridge-config', () => copyTerminalAgentBridgeConfig());
  ipcMain.handle('terminal:show-companion', async () => showTerminalCompanion());
  ipcMain.handle('terminal:show-companion-panel', async (_event, mode) => showTerminalCompanionPanel(String(mode || '')));
  ipcMain.handle('terminal:companion-action', (event, action) => {
    if (!companionWindow || companionWindow.isDestroyed() || event.sender !== companionWindow.webContents) throw new Error('工具条来源无效。');
    const value = String(action || '');
    if (value === 'hide') { closeTerminalCompanionPopover(); companionWindow.hide(); return { ok: true }; }
    if (value === 'learning' || value === 'project-tutor') return showTerminalCompanionPopover(value);
    if (!['collection', 'upload', 'photo', 'audio', 'screenshot', 'queue', 'agents'].includes(value)) throw new Error('未知工具条操作。');
    closeTerminalCompanionPopover();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.webContents.send('terminal:companion-navigate', { action: value });
    }
    return { ok: true };
  });
  ipcMain.handle('companion-popover:action', (event, action, input = {}) => {
    if (!companionPopoverWindow || companionPopoverWindow.isDestroyed() || event.sender !== companionPopoverWindow.webContents) {
      return { ok: false, message: '面板窗口已失效。' };
    }
    if (action === 'close') { closeTerminalCompanionPopover(); return { ok: true }; }
    if (action === 'resize') {
      if (input.mode !== companionPopoverMode || !Number.isFinite(input.height)) return { ok: false };
      const anchor = companionWindow.getBounds();
      const area = screen.getDisplayMatching(anchor).workArea;
      const bounds = companionPopoverWindow.getBounds();
      const height = Math.min(Math.max(Math.ceil(input.height), 80), area.height);
      const below = anchor.y + anchor.height + 4;
      const y = below + height <= area.y + area.height ? below : Math.max(area.y, anchor.y - height - 4);
      if (bounds.height !== height || bounds.y !== y) companionPopoverWindow.setBounds({ ...bounds, height, y });
      return { ok: true };
    }
    if (action === 'select-project') {
      const projectId = String(input.projectId || '');
      if (!terminalCompanionProjects().some((project) => project.id === projectId)) return { ok: false, message: '项目范围无效。' };
      companionSelectedProjectId = projectId;
      sendTerminalCompanionPopoverState();
      return { ok: true, message: '项目导师已切换到当前项目。' };
    }
    if (action === 'copy-mode') return copyTerminalCompanionPrompt(String(input.actionId || ''), input.config || {});
    return { ok: false, message: '未知操作。' };
  });
  ipcMain.handle('terminal:disconnect', async () => {
    if (terminalAgentBridge) await terminalAgentBridge.stop();
    closeTerminalCourse('disconnect');
    effectiveCourseCache = [];
    effectiveProjectCache = [];
    const config = readConfig();
    if (config.currentStudent?.id) {
      try {
        reconcileTerminalLifecycle({
          userDataDir: terminalUserData(),
          hookSourcePath: path.join(__dirname, 'agent-lifecycle-hook.ps1'),
          studentId: String(config.currentStudent.id),
          deviceId: deviceId(),
          enabled: false,
          detectedAgents: detectLifecycleAgents(),
        });
      } catch {
        setTerminalLifecycleDescriptorEnabled(terminalUserData(), false);
      }
    } else {
      setTerminalLifecycleDescriptorEnabled(terminalUserData(), false);
    }
    writeConfig({
      hostUrl: '', token: '', sessionToken: '', currentStudent: null,
      hostScope: null, observedHostScope: null,
      pendingPairRequest: null, pendingPairInvite: null,
      agentCapture: { enabled: false, registrations: {}, warnings: [], pending: 0, message: '已断开主机，自动会话采集已停止。' },
    });
    return { ok: true, config: publicConfig() };
  });
  ipcMain.handle('terminal:get-upload-queue', () => currentStudentUploadQueue());
  ipcMain.handle('terminal:retry-upload-queue', async () => {
    const result = await runTerminalUploadQueue({ queueIds: currentStudentUploadQueue().items
      .filter((item) => item.state !== 'received')
      .map((item) => item.queueId) });
    return { ...result, queue: currentStudentUploadQueue() };
  });
  ipcMain.handle('terminal:acknowledge-upload-generation', () => acknowledgeCurrentHostGeneration());
  ipcMain.handle('terminal:choose-files', async (_event, target) => {
    const result = await dialog.showOpenDialog(mainWindow, { title: '选择要上传到主机的学习资料', properties: ['openFile', 'multiSelections'], filters: [{ name: '学习资料', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'pdf', 'txt', 'md', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'zip'] }] });
    if (result.canceled) return { ok: false, cancelled: true, total: 0 };
    return uploadPaths(result.filePaths, target, { sourceType: 'windows_terminal_file' });
  });
  ipcMain.handle('terminal:choose-auto-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: '选择自动投递文件夹', properties: ['openDirectory', 'createDirectory'] });
    return { ok: !result.canceled, folder: result.filePaths[0] || '' };
  });
  ipcMain.handle('terminal:configure-auto-delivery', (_event, input) => {
    const config = readConfig();
    if (config.terminalMode !== 'personal') throw new Error('共享终端不能启用自动投递文件夹。');
    const autoDelivery = {
      enabled: Boolean(input?.enabled),
      folder: String(input?.folder || ''),
      target: input?.target ? normalizeUploadTarget(input.target) : null,
    };
    writeConfig({ ...config, autoDelivery });
    void runAutoDelivery();
    return { ok: true, autoDelivery };
  });
  ipcMain.handle('terminal:run-auto-delivery', async () => { await runAutoDelivery(); return { ok: true }; });
  ipcMain.handle('terminal:learning-capabilities', () => loadTerminalLearningCapabilities());
  ipcMain.handle('terminal:practice-dashboard', () => loadTerminalPractice());
  const practiceDrafts=require('./terminal-practice-drafts.cjs').createTerminalPracticeDrafts(path.join(terminalUserData(),'practice-drafts'));
  ipcMain.handle('terminal:publication-action', async (event,action,input={}) => {
    const {config,studentId}=currentStudentSession();
    const scope=cacheScope(config);
    if(input.studentId&&input.studentId!==studentId)throw Error('学生已切换，请重新打开');
    const scopeToken=crypto.createHash('sha256').update(JSON.stringify(scope)).digest('hex');
    if(action==='localDraftContext')return {scopeToken};
    if(action.startsWith('localDraft')&&input.scopeToken!==scopeToken)throw Error('主机或学生范围已变化，请重新打开卡片');
    const assertScope=()=>{const now=currentStudentSession();if(!sameCacheScope(scope,cacheScope(now.config))||now.config.sessionToken!==config.sessionToken)throw Error('学生或主机已切换，请重新打开');};
    if(action==='localDraftLoad')return {data:await practiceDrafts.load(scope,input.cardId)};
    if(action==='localDraftList')return {data:await practiceDrafts.list(scope)};
    if(action==='localDraftSave')return practiceDrafts.save(scope,input.cardId,input);
    if(action==='localDraftClear')return practiceDrafts.clear(scope,input.cardId,input.attemptId);
    if(action==='export') {
      if(!['pdf','print'].includes(input.format))throw Error('不支持的输出格式');
      const response=await requestJson('/api/student-session/publications',{method:'POST',body:{action:'printable',input:{key:input.key,cardId:input.cardId}},token:config.sessionToken,timeoutMs:90000});
      assertScope();if(response.ok===false)throw Error(response.message||'读取卡片失败');
      const value=response.data??response;
      return require('./practice-card-export.cjs').renderPracticeCard({card:value.card,htmlOverride:value.html,format:input.format,BrowserWindow,dialog,parent:BrowserWindow.fromWebContents(event.sender),tempRoot:app.getPath('temp'),assertScope});
    }
    if(!['list','detail','file','save','startResource','workspace','history','start','submit','assistance','attempts','feedback','retry','historicalFile','attachment'].includes(action))throw Error('学生端不支持此操作');
    const result=await requestJson('/api/student-session/publications',{method:'POST',body:{action,input},token:config.sessionToken,timeoutMs:30000});
    const current=currentStudentSession();
    if(current.studentId!==studentId||current.config.sessionToken!==config.sessionToken)throw Error('学生已切换，请重新打开');
    return result;
  });
  ipcMain.handle('terminal:practice-start', (_event, cardId) => startTerminalPractice(cardId));
  ipcMain.handle('terminal:practice-submit', (_event, cardId, input) => submitTerminalPractice(cardId, input));
  ipcMain.handle('terminal:planning-view', (_event, kind) => loadTerminalPlanning(kind));
  ipcMain.handle('terminal:planning-favorites', (_event, kind) => loadTerminalPlanningFavorites(kind));
  ipcMain.handle('terminal:set-planning-favorite', (_event, kind, versionId, candidateId, saved) => setTerminalPlanningFavorite(kind, versionId, candidateId, saved));
  ipcMain.handle('terminal:learning-inbox', () => loadTerminalInbox());
  ipcMain.handle('terminal:submit-learning-inbox', (_event, input) => submitTerminalInbox(input));
  ipcMain.handle('terminal:list-learning-reports', () => loadLearningReports());
  ipcMain.handle('terminal:get-learning-status', () => loadLearningStatus());
  ipcMain.handle('terminal:submit-learning-status', (_event, input) => submitLearningStatus(input));
  ipcMain.handle('terminal:get-project-comprehensive-report', (_event, projectId) => loadProjectComprehensiveReport(projectId));
  ipcMain.handle('terminal:list-knowledge-growth-weeks', () => listKnowledgeGrowthWeeks());
  ipcMain.handle('terminal:get-knowledge-growth-image', (_event, week) => loadKnowledgeGrowthImage(week));
  ipcMain.handle('terminal:get-learning-trajectory', () => loadLearningTrajectory());
  ipcMain.handle('terminal:upload-captured-media', (_event, input, target) => uploadCapturedMedia(input, target));
  ipcMain.handle('terminal:quick-screenshot', (_event, sourceId, target) => takeQuickScreenshot(sourceId, target));
  ipcMain.handle('terminal:export-knowledge-growth-image', (_event, input, action) => exportKnowledgeGrowthImage(input, action));
  ipcMain.handle('terminal:export-student-material-stats-image', (_event, input, action) => exportStudentMaterialStatsImage(input, action));
  ipcMain.handle('terminal:choose-conversation-file', () => chooseConversationFile());
  ipcMain.handle('terminal:take-conversation-import', () => {
    const draft = pendingConversationImports.shift() || null;
    writeJson(conversationImportQueuePath(), { version: 1, drafts: pendingConversationImports });
    return draft;
  });
  ipcMain.handle('terminal:preview-conversation-link', (_event, url) => previewConversationLink(url));
  ipcMain.handle('terminal:submit-conversation', (_event, input) => submitTerminalConversation(input));
  ipcMain.handle('terminal:check-update', () => checkTerminalUpdate());
  ipcMain.handle('terminal:download-update', (_event, update) => downloadTerminalUpdate(update));
  ipcMain.handle('terminal:get-growth-summary', () => loadGrowthSummary());
  ipcMain.handle('terminal:read-learning-report', (_event, reportId) => loadLearningReport(reportId));
  ipcMain.handle('terminal:list-archive-files', () => loadArchiveFiles());
  ipcMain.handle('terminal:read-archive-file', (_event, relativePath) => loadArchiveFile(relativePath));
  ipcMain.handle('terminal:list-project-knowledge-files', (_event, projectId) => loadProjectKnowledgeFiles(projectId));
  ipcMain.handle('terminal:read-project-knowledge-file', (_event, projectId, relativePath) => loadProjectKnowledgeFile(projectId, relativePath));
  ipcMain.handle('terminal:get-project-material-view', (_event, projectId, query) => loadProjectMaterialView(projectId, query));
  ipcMain.handle('terminal:read-project-knowledge-document', (_event, projectId, documentId) => readProjectKnowledgeDocument(projectId, documentId));
  ipcMain.handle('terminal:get-project-classification-suggestions', (_event, projectId, query) => loadProjectClassificationSuggestions(projectId, query));
  ipcMain.handle('terminal:submit-project-classification-suggestions', (_event, projectId, input) => submitProjectClassificationSuggestions(projectId, input));
  ipcMain.handle('terminal:apply-project-classifications', (_event, projectId, input) => applyRemoteProjectClassifications(projectId, input));
  ipcMain.handle('terminal:get-project-material-organization', (_event, projectId) => loadProjectMaterialOrganization(projectId));
  ipcMain.handle('terminal:run-project-material-organization', (_event, projectId, input) => runRemoteProjectMaterialOrganization(projectId, input));
  ipcMain.handle('terminal:retry-project-material-organization', (_event, projectId, operationId, input) =>
    retryRemoteProjectMaterialOrganization(projectId, operationId, input));
  ipcMain.handle('terminal:download-project-material-version', (_event, projectId, materialId, version, title) =>
    downloadProjectMaterialVersion(projectId, materialId, version, title));
  ipcMain.handle('terminal:list-courses', () => loadEffectiveCourses());
  ipcMain.handle('terminal:open-course', (_event, courseId) => openTerminalCourse(courseId));
  ipcMain.handle('terminal:close-course', () => closeTerminalCourse());
  ipcMain.handle('terminal:set-course-learning-fullscreen', (event, enabled) => {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) throw new Error('课程窗口来源无效。');
    return setTerminalCourseLearningFullscreen(enabled);
  });
  ipcMain.handle('terminal:set-course-view-top', (event, top) => {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) throw new Error('课程窗口来源无效。');
    const value = Number(top);
    if (!Number.isFinite(value)) throw new Error('课程视图位置无效。');
    const [, height] = mainWindow.getContentSize();
    const minimumTop = courseLearningFullscreen ? 52 : 96;
    const minimumHeight = courseLearningFullscreen ? 160 : 260;
    courseViewTop = Math.min(Math.max(minimumTop, Math.round(value)), Math.max(minimumTop, height - minimumHeight));
    if (courseView) courseView.setBounds(terminalCourseViewBounds());
    if (captureControlWindow && !captureControlWindow.isDestroyed()) {
      captureControlWindow.setAlwaysOnTop(true, 'screen-saver');
      captureControlWindow.moveTop();
    }
    return { ok: true, top: courseViewTop };
  });
  ipcMain.handle('terminal:list-capture-sources', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } });
    return sources.map((source) => {
      const type = source.id.startsWith('screen:') ? 'screen' : 'window';
      const blocked = type === 'window' && isSensitiveCaptureSourceName(source.name);
      return {
        id: source.id,
        name: blocked ? '敏感窗口（已自动排除）' : deidentifyCaptureSourceName(source.name, type),
        type,
        available: !blocked,
        blocked,
        blockReason: blocked ? '该窗口可能包含密码、凭据或私人通信，已自动排除。' : '',
      };
    });
  });
  ipcMain.handle('terminal:start-capture', (_event, input) => startCapture(input));
  ipcMain.handle('terminal:stop-capture', () => stopCapture());
  ipcMain.handle('terminal:capture-control', async (_event, action) => {
    if (!activeCapture) return { ok: false, message: '当前没有正在运行的屏幕采集。' };
    if (action === 'highlight') {
      const saved = await captureFrame(activeCapture, { force: true, highlight: true });
      if (saved) {
        activeCapture.highlightedCount += 1;
        notify('terminal:capture-changed', publicCaptureSession(activeCapture));
      }
      updateCaptureControlWindow();
      return { ok: saved, message: saved ? '已保存重点页面。' : '重点页面未保存。' };
    }
    if (action === 'pause') {
      activeCapture.status = 'paused';
      appendCaptureSample(activeCapture, { decision: 'paused', paused: true });
      activeCapture.updatedAt = new Date().toISOString();
      notify('terminal:capture-changed', publicCaptureSession(activeCapture));
      updateCaptureControlWindow();
      return { ok: true, message: '采集已暂停。' };
    }
    if (action === 'resume') {
      activeCapture.status = 'capturing';
      appendCaptureSample(activeCapture, { decision: 'resumed', paused: false });
      activeCapture.updatedAt = new Date().toISOString();
      notify('terminal:capture-changed', publicCaptureSession(activeCapture));
      updateCaptureControlWindow();
      return { ok: true, message: '采集已继续。' };
    }
    if (action === 'folder') {
      const error = await shell.openPath(activeCapture.folder);
      return { ok: !error, message: error || '已打开本次采集箱。' };
    }
    if (action === 'stop') return { ok: true, session: stopCapture('floating_control'), message: '采集已结束，正在后台送达并整理。' };
    return { ok: false, message: '未知采集控制操作。' };
  });
  ipcMain.handle('terminal:upload-capture', (_event, input) => uploadPaths(input?.files || [], input?.target, {
    sourceType: 'windows_terminal_course_capture',
    captureSessionId: input?.captureSessionId || '',
    captureItems: Array.isArray(input?.captureItems) ? input.captureItems : [],
    courseId: input?.courseId || '',
    courseUrl: input?.courseUrl || '',
    courseStartedAt: input?.courseStartedAt || '',
    courseCompletedAt: input?.courseCompletedAt || '',
    expectedItemCount: Array.isArray(input?.captureItems) ? input.captureItems.length : 0,
    captureSamples: Array.isArray(input?.captureSamples) ? input.captureSamples : [],
    capturePolicy: input?.capturePolicy || null,
    startedAt: input?.startedAt || input?.courseStartedAt || '',
    endedAt: input?.endedAt || input?.courseCompletedAt || '',
    sourceName: input?.sourceName || '',
    captureSourceType: input?.sourceType || 'screen',
  }));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 880,
    minHeight: 640,
    backgroundColor: '#f4f8f7',
    title: 'AI教育管家 · Windows 学生终端',
    webPreferences: {
      preload: path.join(__dirname, 'terminal-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const devUrl = process.env.EDU_TERMINAL_DEV_URL;
  if (devUrl) mainWindow.loadURL(devUrl);
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist-terminal', 'terminal.html'));
  mainWindow.on('resize', () => {
    if (courseView) courseView.setBounds(terminalCourseViewBounds());
  });
  mainWindow.on('leave-full-screen', () => {
    if (!courseLearningFullscreen) return;
    courseLearningFullscreen = false;
    courseViewTop = 96;
    if (courseView) courseView.setBounds(terminalCourseViewBounds());
    notify('terminal:course-learning-fullscreen', { enabled: false });
  });
  mainWindow.on('closed', () => {
    if (courseView) {
      try { courseView.webContents.close(); } catch {}
      courseView = null;
      activeCourse = null;
    }
    courseLearningFullscreen = false;
    mainWindow = null;
  });
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    queueExternalConversationImport(argv);
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
  app.on('open-url', (event, url) => {
    event.preventDefault();
    queueExternalConversationImport([url]);
  });
}

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return;
  const portableExecutable = String(process.env.PORTABLE_EXECUTABLE_FILE || '').trim();
  if (portableExecutable) app.setAsDefaultProtocolClient('ai-education-student', path.resolve(portableExecutable));
  else if (!app.isPackaged && process.argv[1]) app.setAsDefaultProtocolClient('ai-education-student', process.execPath, [path.resolve(process.argv[1])]);
  else app.setAsDefaultProtocolClient('ai-education-student');
  const savedDrafts = readJson(conversationImportQueuePath(), { drafts: [] });
  pendingConversationImports.splice(0, pendingConversationImports.length,
    ...(Array.isArray(savedDrafts.drafts) ? savedDrafts.drafts.slice(-20) : []));
  recoverTerminalUploadQueue(terminalUploadQueuePath());
  registerIpc();
  startTerminalDiscovery();
  createWindow();
  queueExternalConversationImport(process.argv);
  autoDeliveryTimer = setInterval(() => { void runAutoDelivery(); }, 15000);
  terminalUploadTimer = setInterval(() => { void runTerminalUploadQueue(); }, 15000);
  captureDeliveryTimer = setInterval(() => { void runCaptureDeliveryQueue(); }, 15000);
  pairStatusTimer = setInterval(() => { void pollPendingPairRequest(); }, 2000);
  agentCaptureDrainTimer = setInterval(() => { void runAgentCaptureDrain(); }, 2000);
  agentCaptureInstallTimer = setInterval(() => { void refreshPersonalAgentCapture(); }, 120000);
  void runAutoDelivery();
  void runTerminalUploadQueue();
  void runCaptureDeliveryQueue();
  void pollPendingPairRequest();
  void refreshPersonalAgentCapture();
});

app.on('before-quit', () => {
  if (autoDeliveryTimer) clearInterval(autoDeliveryTimer);
  if (terminalUploadTimer) clearInterval(terminalUploadTimer);
  if (captureDeliveryTimer) clearInterval(captureDeliveryTimer);
  if (pairStatusTimer) clearInterval(pairStatusTimer);
  if (agentCaptureDrainTimer) clearInterval(agentCaptureDrainTimer);
  if (agentCaptureInstallTimer) clearInterval(agentCaptureInstallTimer);
  if (activeCapture?.timer) clearInterval(activeCapture.timer);
  if (companionPopoverWindow && !companionPopoverWindow.isDestroyed()) companionPopoverWindow.destroy();
  if (companionWindow && !companionWindow.isDestroyed()) companionWindow.destroy();
  if (terminalAgentBridge) void terminalAgentBridge.stop();
  stopTerminalDiscovery();
});

app.on('window-all-closed', () => app.quit());
