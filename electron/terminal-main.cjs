const { app, BrowserWindow, clipboard, desktopCapturer, dialog, ipcMain, screen, shell } = require('electron');
const crypto = require('crypto');
const { captureControlBounds, loadVisibleCaptureControlWindow } = require('./capture-control-window.cjs');
const dgram = require('dgram');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const { WebContentsView, session } = require('electron');
const {
  coursePartition,
  installCourseGuards,
  secureCourseWebPreferences,
} = require('./course-browser.cjs');
const { parseGrowthIndexMarkdown } = require('./growth-markdown-summary.cjs');
const {
  buildTargetUploadPath,
  isTerminalUploadFile,
  normalizeHostUrl,
  normalizeUploadTarget,
  projectsForStudent,
  stableUploadId,
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

app.setName('AI Education Student Terminal');

const TERMINAL_VERSION = app.getVersion();
const terminalUserData = () => app.getPath('userData');
const configPath = () => path.join(terminalUserData(), 'terminal-config.json');
const deliveryPath = () => path.join(terminalUserData(), 'delivery-ledger.json');
const captureRoot = () => path.join(terminalUserData(), 'screen-captures');
const captureDeliveryQueuePath = () => path.join(terminalUserData(), 'capture-delivery-queue.json');
let mainWindow = null;
let autoDeliveryTimer = null;
let autoDeliveryBusy = false;
let captureDeliveryTimer = null;
let captureDeliveryBusy = false;
let activeCapture = null;
let captureControlWindow = null;
let courseView = null;
let activeCourse = null;
let effectiveCourseCache = [];
let terminalDiscoverySocket = null;
let terminalDiscoveryError = '';
let lastHostDiscoveryAt = '';
let pairStatusTimer = null;
let pairStatusBusy = false;
let agentCaptureDrainTimer = null;
let agentCaptureInstallTimer = null;
let agentCaptureBusy = false;
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

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temporary, filePath);
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

async function requestJson(route, options = {}) {
  const config = readConfig();
  const hostUrl = normalizeHostUrl(options.hostUrl || config.hostUrl);
  if (!hostUrl) throw new Error('尚未设置有效的主机地址。');
  const response = await fetch(`${hostUrl}${route}`, {
    method: options.method || 'GET',
    headers: {
      ...(options.token || (options.deviceToken ? config.token : (config.sessionToken || config.token)) ? { Authorization: `Bearer ${options.token || (options.deviceToken ? config.token : (config.sessionToken || config.token))}` } : {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; }
  catch { payload = { ok: false, message: text || `HTTP ${response.status}` }; }
  if (!response.ok || payload.ok === false) {
    const error = new Error(payload.message || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
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
      : '此个人终端已接入受支持 Agent；已有会话从授权后的下一条提问开始采集。',
  });
  return result;
}

async function authorizePersonalAgentCapture(enabled) {
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
  const config = readConfig();
  if (
    config.terminalMode !== 'personal'
    || !config.sessionToken
    || !config.currentStudent?.id
    || !config.agentCapture?.enabled
    || !config.agentCapture?.captureEpoch
  ) return publicAgentCaptureState(config);
  agentCaptureBusy = true;
  try {
    const result = await drainTerminalLifecycleQueue({
      queueDir: terminalLifecyclePaths(terminalUserData()).queueDir,
      studentId: String(config.currentStudent.id),
      deviceId: deviceId(),
      captureEpoch: String(config.agentCapture.captureEpoch || ''),
      postEnvelope: (envelope) => requestJson('/api/student-session/agent-memory/events', {
        method: 'POST',
        token: config.sessionToken,
        body: envelope,
      }),
    });
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
  return { ...payload, config: publicConfig() };
}

async function setTerminalMode(terminalMode) {
  const requested = terminalMode === 'personal' ? 'personal' : 'shared';
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
  const payload = await requestJson('/api/student-session/login', { method: 'POST', body: { loginId }, deviceToken: true });
  const next = writeConfig({ sessionToken: payload.token, currentStudent: payload.student || null, terminalMode: payload.terminalMode || readConfig().terminalMode });
  if (next.terminalMode === 'personal' && next.agentCapture?.enabled) void refreshPersonalAgentCapture();
  return { ...payload, config: publicConfig() };
}

async function autoLoginStudent() {
  const payload = await requestJson('/api/student-session/auto', { method: 'POST', body: {}, deviceToken: true });
  const next = writeConfig({ sessionToken: payload.token, currentStudent: payload.student || null, terminalMode: 'personal' });
  if (next.agentCapture?.enabled) void refreshPersonalAgentCapture();
  return { ...payload, config: publicConfig() };
}

async function logoutStudent() {
  closeTerminalCourse('student_logout');
  effectiveCourseCache = [];
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
  const modePayload = await requestJson('/api/device/mode', { deviceToken: true });
  const terminalMode = modePayload.device?.terminalMode || config.terminalMode || 'shared';
  if (terminalMode !== config.terminalMode) config = writeConfig({ terminalMode, sessionToken: '', currentStudent: null });
  if (!config.sessionToken && terminalMode === 'personal' && modePayload.device?.boundStudentId) {
    try { return await autoLoginStudent(); }
    catch {}
  }
  if (!config.sessionToken) {
    return { ok: true, requiresLogin: true, students: [], projects: [], device: modePayload.device || null, config: publicConfig() };
  }
  try {
    const payload = await requestJson('/api/student-session/me', { token: config.sessionToken });
    if (payload.student) {
      const next = writeConfig({ currentStudent: payload.student });
      if (next.terminalMode === 'personal' && next.agentCapture?.enabled) void refreshPersonalAgentCapture();
    }
    return { ...payload, students: payload.students || (payload.student ? [payload.student] : []), projects: payload.projects || [], device: modePayload.device || null, config: publicConfig() };
  } catch (error) {
    writeConfig({ sessionToken: '', currentStudent: null });
    return { ok: true, requiresLogin: true, students: [], projects: [], device: modePayload.device || null, config: publicConfig(), message: error.message };
  }
}

function currentStudentSession() {
  const config = readConfig();
  const studentId = String(config.currentStudent?.id || '').trim();
  if (!config.sessionToken || !studentId) throw new Error('请先扫码或输入学生 ID。');
  return { config, studentId };
}

async function loadEffectiveCourses() {
  const { config, studentId } = currentStudentSession();
  const payload = await requestJson(`/api/students/${encodeURIComponent(studentId)}/courses`, { token: config.sessionToken });
  effectiveCourseCache = Array.isArray(payload.courses) ? payload.courses : [];
  return payload;
}

function terminalCourseViewBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return { x: 24, y: 174, width: 1000, height: 564 };
  const [width, height] = mainWindow.getContentSize();
  return { x: 24, y: 174, width: Math.max(360, width - 48), height: Math.max(260, height - 198) };
}

function closeTerminalCourse(reason = 'user') {
  if (courseView && mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.contentView.removeChildView(courseView); } catch {}
    try { courseView.webContents.close(); } catch {}
  }
  courseView = null;
  const closed = activeCourse;
  activeCourse = null;
  notify('terminal:course-browser-changed', { open: false, reason, courseId: closed?.courseId || '' });
  return { ok: true, open: false };
}

async function openTerminalCourse(courseId) {
  const { studentId } = currentStudentSession();
  const payload = await loadEffectiveCourses();
  const course = (payload.courses || []).find((item) => item.courseId === String(courseId || ''));
  if (!course || String(payload.studentId || '') !== studentId) throw new Error('该课程未分配给当前学生或已下架。');
  closeTerminalCourse('switch');
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
  courseView.webContents.on('render-process-gone', () => closeTerminalCourse('render_process_gone'));
  await courseView.webContents.loadURL(course.url);
  notify('terminal:course-browser-changed', { open: true, courseId: course.courseId, name: course.name, url: course.url });
  return { ok: true, open: true, course };
}

async function loadLearningReports() {
  const { config, studentId } = currentStudentSession();
  return requestJson(`/api/students/${encodeURIComponent(studentId)}/reports`, { token: config.sessionToken });
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
          if ((response.statusCode || 500) >= 400 || payload.ok === false) reject(new Error(payload.message || `HTTP ${response.statusCode}`));
          else resolve({ ...payload, uploadId, sourcePath: filePath });
        });
      });
      request.on('error', reject);
      fs.createReadStream(filePath).on('error', reject).pipe(request);
    } catch (error) {
      reject(error);
    }
  });
}

async function uploadPaths(paths, target, metadata = {}) {
  const normalizedTarget = normalizeUploadTarget(target);
  const files = (Array.isArray(paths) ? paths : []).filter((filePath) => isTerminalUploadFile(filePath));
  const results = [];
  for (let index = 0; index < files.length; index += 1) {
    const filePath = files[index];
    const captureItem = Array.isArray(metadata.captureItems)
      ? metadata.captureItems.find((item) => path.resolve(String(item.path || '')) === path.resolve(filePath))
      : null;
    notify('terminal:upload-progress', { status: 'uploading', current: index + 1, total: files.length, filename: path.basename(filePath) });
    try {
      results.push({
        ok: true,
        filePath,
        result: await uploadFile(filePath, normalizedTarget, {
          ...metadata,
          captureItems: undefined,
          captureItemId: captureItem?.id || (metadata.captureSessionId ? `${metadata.captureSessionId}-${index + 1}` : metadata.captureItemId),
          capturedAt: captureItem?.capturedAt || metadata.capturedAt || '',
          captureSequence: captureItem?.sequence || index + 1,
          captureHighlighted: Boolean(captureItem?.highlighted),
        }),
      });
    } catch (error) {
      results.push({ ok: false, filePath, message: error.message });
    }
  }
  const success = results.filter((item) => item.ok).length;
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
    failed: results.length - success,
    total: results.length,
    results,
    completion,
  };
  notify('terminal:upload-progress', { status: summary.ok ? 'succeeded' : 'failed', ...summary });
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
        const result = await uploadFile(file.path, auto.target, { uploadId: file.uploadId, sourceType: 'windows_terminal_auto_folder' });
        ledger.delivered[file.uploadId] = { path: file.path, deliveredAt: new Date().toISOString(), result };
        delete ledger.failures[file.uploadId];
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
  if (!session || session !== activeCapture || session.status !== 'capturing') return false;
  const sources = await desktopCapturer.getSources({ types: [session.sourceType], thumbnailSize: { width: 1600, height: 900 } });
  const source = sources.find((item) => item.id === session.sourceId);
  if (!source || source.thumbnail.isEmpty()) return false;
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
  session.lastContentHash = contentHash;
  session.lastSavedSignature = signature;
  session.lastSavedAt = now;
  session.lastDecision = decision.reason;
  session.count = session.files.length;
  session.updatedAt = new Date().toISOString();
  notify('terminal:capture-changed', publicCaptureSession(session));
  updateCaptureControlWindow();
  return true;
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
    captureControlWindow.setAlwaysOnTop(true, 'floating');
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
  ipcMain.handle('terminal:disconnect', () => {
    closeTerminalCourse('disconnect');
    effectiveCourseCache = [];
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
      pendingPairRequest: null, pendingPairInvite: null,
      agentCapture: { enabled: false, registrations: {}, warnings: [], pending: 0, message: '已断开主机，自动会话采集已停止。' },
    });
    return { ok: true, config: publicConfig() };
  });
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
  ipcMain.handle('terminal:list-learning-reports', () => loadLearningReports());
  ipcMain.handle('terminal:get-growth-summary', () => loadGrowthSummary());
  ipcMain.handle('terminal:read-learning-report', (_event, reportId) => loadLearningReport(reportId));
  ipcMain.handle('terminal:list-archive-files', () => loadArchiveFiles());
  ipcMain.handle('terminal:read-archive-file', (_event, relativePath) => loadArchiveFile(relativePath));
  ipcMain.handle('terminal:list-project-knowledge-files', (_event, projectId) => loadProjectKnowledgeFiles(projectId));
  ipcMain.handle('terminal:read-project-knowledge-file', (_event, projectId, relativePath) => loadProjectKnowledgeFile(projectId, relativePath));
  ipcMain.handle('terminal:list-courses', () => loadEffectiveCourses());
  ipcMain.handle('terminal:open-course', (_event, courseId) => openTerminalCourse(courseId));
  ipcMain.handle('terminal:close-course', () => closeTerminalCourse());
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
      activeCapture.updatedAt = new Date().toISOString();
      notify('terminal:capture-changed', publicCaptureSession(activeCapture));
      updateCaptureControlWindow();
      return { ok: true, message: '采集已暂停。' };
    }
    if (action === 'resume') {
      activeCapture.status = 'capturing';
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
  mainWindow.on('closed', () => {
    if (courseView) {
      try { courseView.webContents.close(); } catch {}
      courseView = null;
      activeCourse = null;
    }
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  registerIpc();
  startTerminalDiscovery();
  createWindow();
  autoDeliveryTimer = setInterval(() => { void runAutoDelivery(); }, 15000);
  captureDeliveryTimer = setInterval(() => { void runCaptureDeliveryQueue(); }, 15000);
  pairStatusTimer = setInterval(() => { void pollPendingPairRequest(); }, 2000);
  agentCaptureDrainTimer = setInterval(() => { void runAgentCaptureDrain(); }, 2000);
  agentCaptureInstallTimer = setInterval(() => { void refreshPersonalAgentCapture(); }, 120000);
  void runAutoDelivery();
  void runCaptureDeliveryQueue();
  void pollPendingPairRequest();
  void refreshPersonalAgentCapture();
});

app.on('before-quit', () => {
  if (autoDeliveryTimer) clearInterval(autoDeliveryTimer);
  if (captureDeliveryTimer) clearInterval(captureDeliveryTimer);
  if (pairStatusTimer) clearInterval(pairStatusTimer);
  if (agentCaptureDrainTimer) clearInterval(agentCaptureDrainTimer);
  if (agentCaptureInstallTimer) clearInterval(agentCaptureInstallTimer);
  if (activeCapture?.timer) clearInterval(activeCapture.timer);
  stopTerminalDiscovery();
});

app.on('window-all-closed', () => app.quit());
