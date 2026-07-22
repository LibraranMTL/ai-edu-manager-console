const { app, BrowserWindow, desktopCapturer, dialog, ipcMain } = require('electron');
const crypto = require('crypto');
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
  return {
    ...config,
    token: config.token ? `${config.token.slice(0, 7)}…${config.token.slice(-5)}` : '',
    sessionToken: '',
    connected: Boolean(config.hostUrl && config.token),
    studentSessionActive: Boolean(config.sessionToken && config.currentStudent?.id),
    version: TERMINAL_VERSION,
  };
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

function parseConnectionPayload(text, fallbackHostUrl = '', fallbackPairCode = '') {
  let payload = {};
  const input = String(text || '').trim();
  if (input) {
    try { payload = JSON.parse(input); }
    catch {
      if (/^https?:\/\//i.test(input)) payload.serverUrl = input;
      else if (/^\d{6}$/.test(input)) payload.pairCode = input;
    }
  }
  const candidates = [fallbackHostUrl, payload.serverUrl, ...(Array.isArray(payload.lanUrls) ? payload.lanUrls : []), payload.tailscaleUrl].filter(Boolean);
  return {
    hostUrl: candidates.map(normalizeHostUrl).find(Boolean) || '',
    pairCode: String(fallbackPairCode || payload.pairCode || '').trim(),
  };
}

async function pairWithHost(input = {}) {
  const parsed = parseConnectionPayload(input.connectionText, input.hostUrl, input.pairCode);
  if (!parsed.hostUrl || !/^\d{6}$/.test(parsed.pairCode)) throw new Error('请粘贴主机连接信息，或填写主机地址和六位配对码。');
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
  writeConfig({ hostUrl: parsed.hostUrl, token: payload.token, sessionToken: '', currentStudent: null, terminalMode: payload.device?.terminalMode || 'shared', deviceName: input.deviceName || config.deviceName });
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

function registerIpc() {
  ipcMain.handle('terminal:get-config', () => publicConfig());
  ipcMain.handle('terminal:pair', (_event, input) => pairWithHost(input));
  ipcMain.handle('terminal:load-state', () => loadRemoteState());
  ipcMain.handle('terminal:set-mode', (_event, terminalMode) => setTerminalMode(terminalMode));
  ipcMain.handle('terminal:login-student', (_event, loginId) => loginStudent(loginId));
  ipcMain.handle('terminal:logout-student', () => logoutStudent());
  ipcMain.handle('terminal:disconnect', () => {
    writeConfig({ hostUrl: '', token: '', sessionToken: '', currentStudent: null });
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
  createWindow();
  autoDeliveryTimer = setInterval(() => { void runAutoDelivery(); }, 15000);
  void runAutoDelivery();
});

app.on('before-quit', () => {
  if (autoDeliveryTimer) clearInterval(autoDeliveryTimer);
  if (activeCapture?.timer) clearInterval(activeCapture.timer);
});

app.on('window-all-closed', () => app.quit());
