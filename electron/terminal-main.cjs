const { app, BrowserWindow, clipboard, desktopCapturer, dialog, ipcMain, shell } = require('electron');
const crypto = require('crypto');
const dgram = require('dgram');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
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

app.setName('AI Education Student Terminal');

const TERMINAL_VERSION = app.getVersion();
const terminalUserData = () => app.getPath('userData');
const configPath = () => path.join(terminalUserData(), 'terminal-config.json');
const deliveryPath = () => path.join(terminalUserData(), 'delivery-ledger.json');
const captureRoot = () => path.join(terminalUserData(), 'screen-captures');
let mainWindow = null;
let autoDeliveryTimer = null;
let autoDeliveryBusy = false;
let activeCapture = null;
let terminalDiscoverySocket = null;
let terminalDiscoveryError = '';
let lastHostDiscoveryAt = '';
let pairStatusTimer = null;
let pairStatusBusy = false;
const discoveredLanHosts = new Map();

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
  if (!response.ok || payload.ok === false) throw new Error(payload.message || `HTTP ${response.status}`);
  return payload;
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
    capabilities: protocolVersion >= 2 ? ['pair-request-v2', 'bidirectional-discovery-v2', 'student-session-v1'] : [],
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
      capabilities: ['student-session-v1', 'windows-terminal-v1'],
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
      capabilities: ['student-session-v1', 'windows-terminal-v1'],
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
      capabilities: ['student-session-v1'],
    },
  });
  writeConfig({
    hostUrl: parsed.hostUrl,
    token: payload.token,
    sessionToken: '',
    currentStudent: null,
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
  writeConfig({ terminalMode: requested, sessionToken: '', currentStudent: null, autoDelivery });
  return { ...payload, config: publicConfig() };
}

async function loginStudent(loginId) {
  const payload = await requestJson('/api/student-session/login', { method: 'POST', body: { loginId }, deviceToken: true });
  writeConfig({ sessionToken: payload.token, currentStudent: payload.student || null, terminalMode: payload.terminalMode || readConfig().terminalMode });
  return { ...payload, config: publicConfig() };
}

async function autoLoginStudent() {
  const payload = await requestJson('/api/student-session/auto', { method: 'POST', body: {}, deviceToken: true });
  writeConfig({ sessionToken: payload.token, currentStudent: payload.student || null, terminalMode: 'personal' });
  return { ...payload, config: publicConfig() };
}

async function logoutStudent() {
  const config = readConfig();
  if (config.sessionToken) {
    try { await requestJson('/api/student-session/logout', { method: 'POST', body: {}, token: config.sessionToken }); }
    catch {}
  }
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
    if (payload.student) writeConfig({ currentStudent: payload.student });
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

async function loadLearningReports() {
  const { config, studentId } = currentStudentSession();
  return requestJson(`/api/students/${encodeURIComponent(studentId)}/reports`, { token: config.sessionToken });
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
    notify('terminal:upload-progress', { status: 'uploading', current: index + 1, total: files.length, filename: path.basename(filePath) });
    try {
      results.push({ ok: true, filePath, result: await uploadFile(filePath, normalizedTarget, { ...metadata, captureItemId: metadata.captureSessionId ? `${metadata.captureSessionId}-${index + 1}` : metadata.captureItemId }) });
    } catch (error) {
      results.push({ ok: false, filePath, message: error.message });
    }
  }
  const success = results.filter((item) => item.ok).length;
  const summary = { ok: success === results.length, success, failed: results.length - success, total: results.length, results };
  notify('terminal:upload-progress', { status: summary.ok ? 'succeeded' : 'failed', ...summary });
  return summary;
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

async function captureFrame(session) {
  const sources = await desktopCapturer.getSources({ types: [session.sourceType], thumbnailSize: { width: 1600, height: 900 } });
  const source = sources.find((item) => item.id === session.sourceId);
  if (!source || source.thumbnail.isEmpty()) return false;
  const filename = `capture-${Date.now()}.jpg`;
  const target = path.join(session.folder, filename);
  fs.writeFileSync(target, source.thumbnail.toJPEG(84));
  session.files.push(target);
  session.count = session.files.length;
  session.updatedAt = new Date().toISOString();
  notify('terminal:capture-changed', { ...session, timer: undefined });
  return true;
}

async function startCapture(input = {}) {
  if (activeCapture) throw new Error('已有屏幕采集正在运行。');
  const sourceId = String(input.sourceId || '');
  const sourceType = input.sourceType === 'window' ? 'window' : 'screen';
  if (!sourceId) throw new Error('请选择需要采集的屏幕或窗口。');
  const id = `windows-terminal-capture-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const folder = path.join(captureRoot(), id);
  fs.mkdirSync(folder, { recursive: true });
  const session = {
    id,
    status: 'capturing',
    sourceId,
    sourceType,
    sourceName: String(input.sourceName || '屏幕'),
    studentId: String(input.studentId || ''),
    projectId: String(input.projectId || ''),
    target: normalizeUploadTarget(input.target),
    folder,
    files: [],
    count: 0,
    startedAt: new Date().toISOString(),
  };
  activeCapture = session;
  await captureFrame(session);
  session.timer = setInterval(() => { void captureFrame(session); }, Math.max(5000, Number(input.intervalSeconds || 15) * 1000));
  return { ...session, timer: undefined };
}

function stopCapture() {
  if (!activeCapture) return null;
  clearInterval(activeCapture.timer);
  activeCapture.status = 'completed';
  activeCapture.endedAt = new Date().toISOString();
  const result = { ...activeCapture, timer: undefined };
  activeCapture = null;
  notify('terminal:capture-changed', result);
  return result;
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
  ipcMain.handle('terminal:disconnect', () => {
    writeConfig({ hostUrl: '', token: '', sessionToken: '', currentStudent: null, pendingPairRequest: null, pendingPairInvite: null });
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
  ipcMain.handle('terminal:read-learning-report', (_event, reportId) => loadLearningReport(reportId));
  ipcMain.handle('terminal:list-archive-files', () => loadArchiveFiles());
  ipcMain.handle('terminal:read-archive-file', (_event, relativePath) => loadArchiveFile(relativePath));
  ipcMain.handle('terminal:list-capture-sources', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } });
    return sources.map((source) => ({ id: source.id, name: source.name, type: source.id.startsWith('screen:') ? 'screen' : 'window' }));
  });
  ipcMain.handle('terminal:start-capture', (_event, input) => startCapture(input));
  ipcMain.handle('terminal:stop-capture', () => stopCapture());
  ipcMain.handle('terminal:upload-capture', (_event, input) => uploadPaths(input?.files || [], input?.target, { sourceType: 'windows_terminal_screenshot', captureSessionId: input?.captureSessionId || '' }));
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
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  registerIpc();
  startTerminalDiscovery();
  createWindow();
  autoDeliveryTimer = setInterval(() => { void runAutoDelivery(); }, 15000);
  pairStatusTimer = setInterval(() => { void pollPendingPairRequest(); }, 2000);
  void runAutoDelivery();
  void pollPendingPairRequest();
});

app.on('before-quit', () => {
  if (autoDeliveryTimer) clearInterval(autoDeliveryTimer);
  if (pairStatusTimer) clearInterval(pairStatusTimer);
  if (activeCapture?.timer) clearInterval(activeCapture.timer);
  stopTerminalDiscovery();
});

app.on('window-all-closed', () => app.quit());
