const { app, BrowserWindow, clipboard, dialog, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { spawn, spawnSync, execFileSync } = require('child_process');

let mainWindow;
let qclawOpened = false;
let marvisOpened = false;
let hohuOpened = false;
let openclawOpened = false;
let codexOpened = false;
let claudeCodeOpened = false;
let obsidianOpened = false;
let hostServer = null;
let hostServiceStartedAt = '';
let hostServiceLastError = '';
let todayUploadCount = 0;
let uploadCountDate = new Date().toISOString().slice(0, 10);

const APP_VERSION = '0.5.7';
const DEFAULT_HOST_PORT = 18777;
const AGENT_TOOL_IDS = ['qclaw', 'marvis', 'hohu', 'openclaw', 'codex', 'claude-code', 'chatgpt', 'claude', 'doubao', 'coze', 'fastgpt'];
const WEB_AGENT_TOOL_URLS = {
  chatgpt: 'https://chatgpt.com/',
  claude: 'https://claude.ai/',
  doubao: 'https://www.doubao.com/',
  coze: 'https://www.coze.cn/',
  fastgpt: 'https://fastgpt.in/',
};
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp',
  '.pdf', '.txt', '.md',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.csv', '.zip',
]);
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const studentsPath = () => path.join(app.getPath('userData'), 'students.json');
const devicesPath = () => path.join(app.getPath('userData'), 'devices.json');
const uploadRecordsPath = () => path.join(app.getPath('userData'), 'upload-records.json');
const hostTimelinePath = () => path.join(app.getPath('userData'), 'host-timeline.json');
const LICENSE_SIGNING_SECRET = 'ai-edu-manager-offline-license-v1';
let activePairSession = null;

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(settings) {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), 'utf8');
}

function ensureApiToken() {
  const settings = readSettings();
  if (!settings.apiToken) {
    settings.apiToken = crypto.randomBytes(24).toString('hex');
    writeSettings(settings);
  }
  return settings.apiToken;
}

function licenseSignature(payload) {
  return crypto
    .createHash('sha256')
    .update(`${LICENSE_SIGNING_SECRET}|${payload}`)
    .digest('hex')
    .slice(0, 12)
    .toUpperCase();
}

function normalizeLicenseCode(code) {
  return String(code || '')
    .trim()
    .toUpperCase()
    .replace(/[—–]/g, '-')
    .replace(/\s+/g, '');
}

function planLabel(plan) {
  const value = String(plan || '').toUpperCase();
  if (value === 'FAMILY') return '家庭版';
  if (value === 'PRO') return '专业版';
  if (value === 'ORG') return '机构版';
  if (value === 'TRIAL') return '试用版';
  return value || '未知版本';
}

function parseLicenseCode(code) {
  const normalized = normalizeLicenseCode(code);
  const parts = normalized.split('-');
  if (parts.length !== 7 || parts[0] !== 'AIE') {
    return { ok: false, message: '激活码格式不正确。格式：AIE-套餐-到期日-学生数-设备数-随机码-签名。' };
  }
  const [, plan, expires, studentLimitRaw, deviceLimitRaw, token, signature] = parts;
  if (!/^[A-Z0-9]{3,16}$/.test(plan)) return { ok: false, message: '激活码套餐字段不正确。' };
  if (!(expires === 'PERM' || /^\d{8}$/.test(expires))) return { ok: false, message: '激活码到期日不正确。' };
  const studentLimit = Number(studentLimitRaw);
  const deviceLimit = Number(deviceLimitRaw);
  if (!Number.isInteger(studentLimit) || studentLimit < 1 || studentLimit > 9999) return { ok: false, message: '激活码学生数不正确。' };
  if (!Number.isInteger(deviceLimit) || deviceLimit < 1 || deviceLimit > 9999) return { ok: false, message: '激活码设备数不正确。' };
  if (!/^[A-Z0-9]{6,24}$/.test(token)) return { ok: false, message: '激活码随机码不正确。' };
  const payload = ['AIE', plan, expires, studentLimitRaw, deviceLimitRaw, token].join('|');
  const expected = licenseSignature(payload);
  if (signature !== expected) return { ok: false, message: '激活码校验失败，请确认是否复制完整。' };
  const expiresAt = expires === 'PERM'
    ? ''
    : `${expires.slice(0, 4)}-${expires.slice(4, 6)}-${expires.slice(6, 8)}T23:59:59.999+08:00`;
  if (expiresAt && Date.now() > new Date(expiresAt).getTime()) {
    return { ok: false, message: '激活码已过期。', expired: true };
  }
  return {
    ok: true,
    license: {
      status: 'active',
      plan,
      planLabel: planLabel(plan),
      expiresAt,
      studentLimit,
      deviceLimit,
      token,
      codeHash: crypto.createHash('sha256').update(normalized).digest('hex'),
      activatedAt: new Date().toISOString(),
    },
  };
}

function publicLicenseStatus(rawLicense) {
  const license = rawLicense || readSettings().license || null;
  if (!license) {
    return {
      status: 'inactive',
      active: false,
      planLabel: '未激活',
      message: 'Windows 主机尚未激活。平板终端会跟随主机授权状态。',
    };
  }
  const expiresAt = license.expiresAt || '';
  const expired = Boolean(expiresAt && Date.now() > new Date(expiresAt).getTime());
  return {
    ...license,
    status: expired ? 'expired' : (license.status || 'active'),
    active: !expired && (license.status || 'active') === 'active',
    planLabel: license.planLabel || planLabel(license.plan),
    expiresAt,
    codeHash: license.codeHash ? `${license.codeHash.slice(0, 8)}...${license.codeHash.slice(-6)}` : '',
    message: expired ? '许可证已过期，请续费后重新激活。' : 'Windows 主机已激活，平板终端跟随主机授权。',
  };
}

function getLicenseStatus() {
  return JSON.stringify({ ok: true, license: publicLicenseStatus() });
}

function activateLicense(code) {
  const parsed = parseLicenseCode(code);
  if (!parsed.ok) return JSON.stringify({ ok: false, message: parsed.message, license: publicLicenseStatus() });
  const settings = readSettings();
  settings.license = parsed.license;
  writeSettings(settings);
  appendHostTimeline({
    type: 'license_activated',
    title: 'License activated',
    detail: `${parsed.license.planLabel} · students ${parsed.license.studentLimit} · devices ${parsed.license.deviceLimit}`,
  });
  notify('onNativeHostServiceChanged', getHostServiceStatus());
  return JSON.stringify({ ok: true, message: '激活成功。平板终端将跟随 Windows 主机授权状态。', license: publicLicenseStatus(parsed.license), status: JSON.parse(getHostServiceStatus()) });
}

function deactivateLicense() {
  const settings = readSettings();
  delete settings.license;
  writeSettings(settings);
  appendHostTimeline({ type: 'license_deactivated', title: 'License deactivated', detail: 'Local license was removed.' });
  notify('onNativeHostServiceChanged', getHostServiceStatus());
  return JSON.stringify({ ok: true, message: '已移除本机许可证。', license: publicLicenseStatus(), status: JSON.parse(getHostServiceStatus()) });
}

function readDevices() {
  try {
    const parsed = JSON.parse(fs.readFileSync(devicesPath(), 'utf8'));
    return Array.isArray(parsed.devices) ? parsed.devices : [];
  } catch {
    return [];
  }
}

function writeDevices(devices) {
  fs.mkdirSync(path.dirname(devicesPath()), { recursive: true });
  fs.writeFileSync(devicesPath(), JSON.stringify({ devices }, null, 2), 'utf8');
}

function readUploadRecords() {
  try {
    const parsed = JSON.parse(fs.readFileSync(uploadRecordsPath(), 'utf8'));
    return Array.isArray(parsed.records) ? parsed.records : [];
  } catch {
    return [];
  }
}

function writeUploadRecords(records) {
  fs.mkdirSync(path.dirname(uploadRecordsPath()), { recursive: true });
  fs.writeFileSync(uploadRecordsPath(), JSON.stringify({ records: records.slice(0, 200) }, null, 2), 'utf8');
}

function normalizeUploadStatus(status) {
  const value = String(status || '').trim();
  if (['pending_digest', 'submitted', 'digesting', 'processed', 'failed', 'ignored'].includes(value)) return value;
  return 'pending_digest';
}

function isOpenDigestStatus(status) {
  return ['pending_digest', 'submitted', 'digesting'].includes(normalizeUploadStatus(status));
}

function studentManagerDir(student) {
  const root = student.rootPath || getStudentRootDir(student.name);
  return path.join(root, '.edu-manager');
}

function studentMaterialsPath(student) {
  return path.join(studentManagerDir(student), 'materials.json');
}

function studentDigestStatePath(student) {
  return path.join(studentManagerDir(student), 'digest-state.json');
}

function ensureStudentManagerFiles(student) {
  const managerDir = studentManagerDir(student);
  fs.mkdirSync(managerDir, { recursive: true });
  const materialsFile = studentMaterialsPath(student);
  const digestFile = studentDigestStatePath(student);
  if (!fs.existsSync(materialsFile)) {
    fs.writeFileSync(materialsFile, JSON.stringify({ version: 1, studentId: String(student.id || ''), materials: [] }, null, 2), 'utf8');
  }
  if (!fs.existsSync(digestFile)) {
    fs.writeFileSync(digestFile, JSON.stringify({
      version: 1,
      studentId: String(student.id || ''),
      status: 'idle',
      lastDigestAt: '',
      pendingCount: 0,
      submittedCount: 0,
      processedCount: 0,
      message: '尚未执行资料消化。',
    }, null, 2), 'utf8');
  }
  ensureAgentCenter(student);
}

function readStudentMaterials(student) {
  try {
    ensureStudentManagerFiles(student);
    const parsed = JSON.parse(fs.readFileSync(studentMaterialsPath(student), 'utf8'));
    return Array.isArray(parsed.materials) ? parsed.materials : [];
  } catch {
    return [];
  }
}

function writeStudentMaterials(student, materials) {
  fs.mkdirSync(studentManagerDir(student), { recursive: true });
  fs.writeFileSync(studentMaterialsPath(student), JSON.stringify({
    version: 1,
    studentId: String(student.id || ''),
    studentName: student.name || '',
    updatedAt: new Date().toISOString(),
    materials: materials.slice(0, 1000),
  }, null, 2), 'utf8');
}

function readStudentDigestState(student) {
  try {
    ensureStudentManagerFiles(student);
    return JSON.parse(fs.readFileSync(studentDigestStatePath(student), 'utf8'));
  } catch {
    return {};
  }
}

function writeStudentDigestState(student, patch) {
  fs.mkdirSync(studentManagerDir(student), { recursive: true });
  const current = readStudentDigestState(student);
  const materials = readStudentMaterials(student);
  const next = {
    version: 1,
    studentId: String(student.id || ''),
    studentName: student.name || '',
    ...current,
    ...patch,
    pendingCount: materials.filter((item) => normalizeUploadStatus(item.status) === 'pending_digest').length,
    submittedCount: materials.filter((item) => ['submitted', 'digesting'].includes(normalizeUploadStatus(item.status))).length,
    processedCount: materials.filter((item) => normalizeUploadStatus(item.status) === 'processed').length,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(studentDigestStatePath(student), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function materialRecordFromUpload(record) {
  const relativePath = record.path && record.rawPath ? path.relative(record.rawPath, record.path).replace(/\\/g, '/') : record.filename;
  return {
    id: record.id,
    fileName: record.filename,
    path: relativePath || record.filename,
    absolutePath: record.path || '',
    size: Number(record.size || 0),
    sha1: record.sha1 || '',
    uploadedAt: record.uploadedAt || new Date().toISOString(),
    sourceDevice: record.deviceName || record.deviceId || '主机控制台',
    sourceDeviceId: record.deviceId || '',
    status: normalizeUploadStatus(record.status),
    statusUpdatedAt: record.statusUpdatedAt || new Date().toISOString(),
    digestedAt: record.digestedAt || '',
    digestBatchId: record.digestBatchId || '',
  };
}

function upsertStudentMaterialsFromUploads(student, uploadRecords) {
  if (!student || !uploadRecords.length) return;
  const existing = readStudentMaterials(student);
  const byId = new Map(existing.map((item) => [String(item.id), item]));
  uploadRecords.forEach((record) => {
    byId.set(String(record.id), { ...byId.get(String(record.id)), ...materialRecordFromUpload(record) });
  });
  writeStudentMaterials(student, Array.from(byId.values()).sort((a, b) => String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || ''))));
  const openCount = Array.from(byId.values()).filter((item) => isOpenDigestStatus(item.status)).length;
  writeStudentDigestState(student, {
    status: openCount > 0 ? 'pending' : 'idle',
    message: openCount > 0 ? `有 ${openCount} 份资料等待 QClaw 消化。` : '暂无待消化资料。',
  });
}

function syncStudentMaterialsFromUploadRecords(student) {
  const records = readUploadRecords().filter((record) => String(record.studentId) === String(student.id));
  upsertStudentMaterialsFromUploads(student, records.map((record) => ({ ...record, rawPath: student.rawPath || getRawDir(student.name) })));
  return readStudentMaterials(student);
}

function sha1File(file) {
  try {
    return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return '';
  }
}

function addUploadRecords(records) {
  if (!records.length) return;
  const stamped = records.map((record) => ({
    status: 'pending_digest',
    statusUpdatedAt: new Date().toISOString(),
    ...record,
  }));
  writeUploadRecords([...stamped, ...readUploadRecords()]);
  const students = readStudentsIndex();
  const grouped = new Map();
  stamped.forEach((record) => {
    const key = String(record.studentId || '');
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(record);
  });
  grouped.forEach((items, studentId) => {
    const student = students.find((item) => String(item.id) === studentId);
    if (student) upsertStudentMaterialsFromUploads(student, items.map((item) => ({ ...item, rawPath: student.rawPath || getRawDir(student.name) })));
  });
  appendHostTimeline({
    type: 'materials_uploaded',
    title: 'Materials uploaded',
    detail: `${stamped.length} file(s) uploaded`,
    studentId: stamped[0]?.studentId || '',
    studentName: stamped[0]?.studentName || '',
    count: stamped.length,
  });
}

function readHostTimeline() {
  try {
    const parsed = JSON.parse(fs.readFileSync(hostTimelinePath(), 'utf8'));
    return Array.isArray(parsed.events) ? parsed.events : [];
  } catch {
    return [];
  }
}

function writeHostTimeline(events) {
  fs.mkdirSync(path.dirname(hostTimelinePath()), { recursive: true });
  fs.writeFileSync(hostTimelinePath(), JSON.stringify({ events: events.slice(0, 300) }, null, 2), 'utf8');
}

function appendHostTimeline(event) {
  const next = {
    id: `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    at: new Date().toISOString(),
    ...event,
  };
  writeHostTimeline([next, ...readHostTimeline()]);
  return next;
}

function getHostTimeline() {
  return JSON.stringify({ ok: true, events: readHostTimeline() });
}

function setHostUploadRecordStatus(recordId, status) {
  const nextStatus = normalizeUploadStatus(status);
  const records = readUploadRecords();
  const index = records.findIndex((item) => String(item.id) === String(recordId));
  if (index < 0) return JSON.stringify({ ok: false, message: 'Upload record not found.' });
  const now = new Date().toISOString();
  records[index] = {
    ...records[index],
    status: nextStatus,
    statusUpdatedAt: now,
    ...(nextStatus === 'processed' ? { digestedAt: now } : {}),
  };
  writeUploadRecords(records);
  const student = readStudentsIndex().find((item) => String(item.id) === String(records[index].studentId));
  if (student) upsertStudentMaterialsFromUploads(student, [{ ...records[index], rawPath: student.rawPath || getRawDir(student.name) }]);
  appendHostTimeline({
    type: 'upload_status_changed',
    title: 'Upload status changed',
    detail: `${records[index].filename || ''} -> ${nextStatus}`,
    studentId: records[index].studentId || '',
    studentName: records[index].studentName || '',
    recordId: records[index].id,
    status: nextStatus,
  });
  notify('onNativeHostServiceChanged', getHostServiceStatus());
  return JSON.stringify({ ok: true, record: records[index], status: JSON.parse(getHostServiceStatus()) });
}

function markStudentDigestSubmitted(studentId) {
  const now = new Date().toISOString();
  let updated = 0;
  const records = readUploadRecords().map((record) => {
    if (String(record.studentId) !== String(studentId) || record.status === 'processed') return record;
    updated += 1;
    return { ...record, status: 'submitted', statusUpdatedAt: now };
  });
  writeUploadRecords(records);
  const student = readStudentsIndex().find((item) => String(item.id) === String(studentId));
  if (student) {
    syncStudentMaterialsFromUploadRecords(student);
    writeStudentDigestState(student, {
      status: 'digesting',
      digestSubmittedAt: now,
      message: `已提交 QClaw 消化，等待结果同步。`,
    });
  }
  appendHostTimeline({
    type: 'digest_submitted',
    title: 'Digest command submitted',
    detail: `${updated} upload record(s) marked as submitted`,
    studentId: String(studentId || ''),
    studentName: student?.name || '',
    count: updated,
  });
  notify('onNativeHostServiceChanged', getHostServiceStatus());
  return JSON.stringify({ ok: true, updated, status: JSON.parse(getHostServiceStatus()), records });
}

function latestFileMtime(files) {
  let latest = 0;
  for (const file of files) {
    try {
      if (fs.existsSync(file)) latest = Math.max(latest, fs.statSync(file).mtimeMs);
    } catch {
      // Ignore inaccessible files.
    }
  }
  return latest;
}

function normalizeDigestStateStatus(status) {
  const value = String(status || '').toLowerCase();
  if (['completed', 'complete', 'success', 'processed', 'digested', 'done'].includes(value)) return 'completed';
  if (['failed', 'error'].includes(value)) return 'failed';
  if (['digesting', 'running', 'submitted'].includes(value)) return 'digesting';
  if (['pending', 'waiting'].includes(value)) return 'pending';
  return value || 'idle';
}

function syncStudentDigestResult(studentId, options = {}) {
  const student = readStudentsIndex().find((item) => String(item.id) === String(studentId));
  if (!student) return JSON.stringify({ ok: false, message: 'Student not found.' });
  syncStudentMaterialsFromUploadRecords(student);
  const now = new Date().toISOString();
  const state = readStudentDigestState(student);
  const digestStatus = normalizeDigestStateStatus(state.status);
  const rawPath = student.rawPath || getRawDir(student.name);
  const summaryPath = student.summaryPath || getSummaryDir(student.name);
  const digestFile = studentDigestStatePath(student);
  const latestDigestMs = Math.max(
    state.lastDigestAt ? Date.parse(state.lastDigestAt) || 0 : 0,
    latestFileMtime([
      digestFile,
      path.join(summaryPath, 'log.md'),
      path.join(summaryPath, 'index.md'),
    ]),
  );
  const digestedNames = new Set(
    []
      .concat(Array.isArray(state.digestedFiles) ? state.digestedFiles : [])
      .concat(Array.isArray(state.processedFiles) ? state.processedFiles : [])
      .map((item) => path.basename(String(item || '')).toLowerCase())
      .filter(Boolean),
  );
  let changed = 0;
  const batchId = state.digestBatchId || `digest-${Date.now()}`;
  const records = readUploadRecords().map((record) => {
    if (String(record.studentId) !== String(studentId) || normalizeUploadStatus(record.status) === 'processed') return record;
    const uploadedMs = record.uploadedAt ? Date.parse(record.uploadedAt) || 0 : 0;
    const nameMatched = digestedNames.size > 0 && digestedNames.has(path.basename(String(record.filename || '')).toLowerCase());
    const timeMatched = latestDigestMs > 0 && uploadedMs > 0 && uploadedMs <= latestDigestMs;
    const submittedMatched = options.forceSubmitted && normalizeUploadStatus(record.status) === 'submitted';
    if (digestStatus === 'failed') {
      changed += 1;
      return { ...record, status: 'failed', statusUpdatedAt: now };
    }
    if (digestStatus === 'completed' && (nameMatched || (digestedNames.size === 0 && timeMatched) || submittedMatched)) {
      changed += 1;
      return { ...record, status: 'processed', statusUpdatedAt: now, digestedAt: state.lastDigestAt || now, digestBatchId: batchId };
    }
    return record;
  });
  writeUploadRecords(records);
  syncStudentMaterialsFromUploadRecords(student);
  const openCount = records.filter((record) => String(record.studentId) === String(studentId) && isOpenDigestStatus(record.status)).length;
  const nextState = writeStudentDigestState(student, {
    status: digestStatus === 'completed' && openCount === 0 ? 'completed' : openCount > 0 ? 'pending' : 'idle',
    lastDigestAt: digestStatus === 'completed' ? (state.lastDigestAt || (latestDigestMs ? new Date(latestDigestMs).toISOString() : now)) : (state.lastDigestAt || ''),
    digestBatchId: batchId,
    message: changed > 0
      ? `已同步 QClaw 消化结果，${changed} 份资料标记为已消化。`
      : openCount > 0
        ? `仍有 ${openCount} 份资料待消化；如 QClaw 已完成，请确认 digest-state.json 或 log.md 已更新。`
        : '暂无待消化资料。',
    rawPath,
    summaryPath,
  });
  appendHostTimeline({
    type: 'digest_synced',
    title: 'Digest result synced',
    detail: nextState.message,
    studentId: String(studentId || ''),
    studentName: student.name || '',
    count: changed,
  });
  notify('onNativeHostServiceChanged', getHostServiceStatus());
  return JSON.stringify({ ok: true, updated: changed, state: nextState, records, status: JSON.parse(getHostServiceStatus()) });
}

function isAllowedUploadFile(filename) {
  const ext = path.extname(String(filename || '')).toLowerCase();
  return Boolean(ext) && ALLOWED_UPLOAD_EXTENSIONS.has(ext);
}

function assertUploadFileAllowed(filename, size) {
  if (!isAllowedUploadFile(filename)) {
    throw new Error(`Unsupported file type: ${filename || 'unnamed file'}`);
  }
  if (Number(size || 0) > MAX_UPLOAD_BYTES) {
    throw new Error(`File is too large: ${filename || 'unnamed file'}`);
  }
}

function escapeCsvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function getHostUploadRecords() {
  return JSON.stringify({ ok: true, records: readUploadRecords() });
}

function exportHostUploadRecords() {
  const records = readUploadRecords();
  const header = ['上传时间', '学生', '设备', '文件名', '大小', '文件路径'];
  const rows = records.map((record) => [
    record.uploadedAt || '',
    record.studentName || '',
    record.deviceName || '',
    record.filename || '',
    record.size || '',
    record.path || '',
  ]);
  const csv = [header, ...rows]
    .map((row) => row.map(escapeCsvCell).join(','))
    .join('\r\n');
  const filename = `AI教育管家上传记录-${new Date().toISOString().slice(0, 10)}.csv`;
  const target = path.join(downloadsDir(), filename);
  fs.writeFileSync(target, `\uFEFF${csv}`, 'utf8');
  return JSON.stringify({ ok: true, path: target, count: records.length });
}

function openHostUploadRecord(recordId) {
  const record = readUploadRecords().find((item) => String(item.id) === String(recordId));
  if (!record || !record.path) return JSON.stringify({ ok: false, message: '未找到该上传记录。' });
  if (!fs.existsSync(record.path)) return JSON.stringify({ ok: false, message: '文件已不存在或路径不可访问。' });
  shell.showItemInFolder(record.path);
  return JSON.stringify({ ok: true });
}

function clearHostUploadRecords() {
  writeUploadRecords([]);
  notify('onNativeHostServiceChanged', getHostServiceStatus());
  return JSON.stringify({ ok: true, status: JSON.parse(getHostServiceStatus()) });
}

function timestampForFilename() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function backupHostData() {
  try {
    const payload = {
      kind: 'ai-edu-manager-host-backup',
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      settings: readSettings(),
      students: readStudentsIndex(),
      devices: readDevices(),
      uploadRecords: readUploadRecords(),
      timeline: readHostTimeline(),
    };
    const target = path.join(downloadsDir(), `AI-edu-manager-host-backup-${timestampForFilename()}.json`);
    fs.writeFileSync(target, JSON.stringify(payload, null, 2), 'utf8');
    appendHostTimeline({ type: 'backup_created', title: 'Backup created', detail: target });
    return JSON.stringify({ ok: true, path: target });
  } catch (error) {
    return JSON.stringify({ ok: false, message: error.message });
  }
}

function restoreHostData() {
  try {
    const result = dialog.showOpenDialogSync(mainWindow, {
      title: 'Select host backup file',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!result || !result[0]) return JSON.stringify({ ok: false, message: 'No backup file selected.' });
    const parsed = JSON.parse(fs.readFileSync(result[0], 'utf8'));
    if (parsed.kind !== 'ai-edu-manager-host-backup') throw new Error('Unsupported backup file.');
    if (parsed.settings && typeof parsed.settings === 'object') writeSettings(parsed.settings);
    if (Array.isArray(parsed.students)) writeStudentsIndex(parsed.students.map(toHostStudent));
    if (Array.isArray(parsed.devices)) writeDevices(parsed.devices);
    if (Array.isArray(parsed.uploadRecords)) writeUploadRecords(parsed.uploadRecords);
    if (Array.isArray(parsed.timeline)) writeHostTimeline(parsed.timeline);
    appendHostTimeline({ type: 'backup_restored', title: 'Backup restored', detail: result[0] });
    notify('onNativeHostServiceChanged', getHostServiceStatus());
    return JSON.stringify({
      ok: true,
      path: result[0],
      students: Array.isArray(parsed.students) ? parsed.students.length : 0,
      devices: Array.isArray(parsed.devices) ? parsed.devices.length : 0,
      uploadRecords: Array.isArray(parsed.uploadRecords) ? parsed.uploadRecords.length : 0,
      status: JSON.parse(getHostServiceStatus()),
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: error.message });
  }
}

function resetHostApiToken() {
  const settings = readSettings();
  settings.apiToken = crypto.randomBytes(24).toString('hex');
  writeSettings(settings);
  appendHostTimeline({ type: 'api_token_reset', title: 'API token reset', detail: 'Admin API token was regenerated.' });
  notify('onNativeHostServiceChanged', getHostServiceStatus());
  return JSON.stringify({ ok: true, apiToken: settings.apiToken, status: JSON.parse(getHostServiceStatus()) });
}

function exportHostLogs() {
  try {
    const payload = {
      kind: 'ai-edu-manager-host-diagnostics',
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      status: JSON.parse(getHostServiceStatus()),
      diagnostics: JSON.parse(getHostServiceDiagnostics()),
      students: readStudentsIndex(),
      devices: readDevices().map(publicDevice),
      uploadRecords: readUploadRecords(),
      timeline: readHostTimeline(),
      paths: {
        userData: app.getPath('userData'),
        studentBaseDir: defaultStudentBaseDir(),
      },
    };
    const target = path.join(downloadsDir(), `AI-edu-manager-host-diagnostics-${timestampForFilename()}.json`);
    fs.writeFileSync(target, JSON.stringify(payload, null, 2), 'utf8');
    return JSON.stringify({ ok: true, path: target });
  } catch (error) {
    return JSON.stringify({ ok: false, message: error.message });
  }
}

function openStudentRawDir(studentId) {
  const student = readStudentsIndex().find((item) => String(item.id) === String(studentId));
  if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
  const target = student.rawPath || getRawDir(student.name);
  fs.mkdirSync(target, { recursive: true });
  shell.openPath(target);
  return JSON.stringify({ ok: true, path: target });
}

function migrateStudentWorkspace(studentId, newName) {
  try {
    const students = readStudentsIndex();
    const index = students.findIndex((item) => String(item.id) === String(studentId));
    if (index < 0) return JSON.stringify({ ok: false, message: '未找到学生。' });
    const student = students[index];
    const cleanName = sanitizeName(newName || student.name);
    const oldRoot = student.rootPath || getStudentRootDir(student.name);
    const oldRaw = student.rawPath || getRawDir(student.name);
    const oldSummary = student.summaryPath || getSummaryDir(student.name);
    const newRoot = getStudentRootDir(cleanName);
    const newRaw = getRawDir(cleanName);
    const newSummary = getSummaryDir(cleanName);

    if (path.resolve(oldRoot) !== path.resolve(newRoot)) {
      if (fs.existsSync(newRoot)) return JSON.stringify({ ok: false, message: `目标知识库目录已存在：${newRoot}` });
      fs.mkdirSync(path.dirname(newRoot), { recursive: true });
      if (fs.existsSync(oldRoot)) fs.renameSync(oldRoot, newRoot);
      else fs.mkdirSync(newRoot, { recursive: true });
    }

    const movedOldRaw = path.join(newRoot, path.basename(oldRaw));
    const movedOldSummary = path.join(newRoot, path.basename(oldSummary));
    if (path.resolve(movedOldRaw) !== path.resolve(newRaw) && fs.existsSync(movedOldRaw) && !fs.existsSync(newRaw)) {
      fs.renameSync(movedOldRaw, newRaw);
    }
    if (path.resolve(movedOldSummary) !== path.resolve(newSummary) && fs.existsSync(movedOldSummary) && !fs.existsSync(newSummary)) {
      fs.renameSync(movedOldSummary, newSummary);
    }
    fs.mkdirSync(newRaw, { recursive: true });
    fs.mkdirSync(newSummary, { recursive: true });

    students[index] = { ...student, name: cleanName, rootPath: newRoot, rawPath: newRaw, summaryPath: newSummary };
    writeStudentsIndex(students);
    notify('onNativeHostServiceChanged', getHostServiceStatus());
    return JSON.stringify({ ok: true, name: cleanName, rootPathLabel: newRoot, rawPath: newRaw, summaryPath: newSummary });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `迁移知识库目录失败：${error.message}` });
  }
}

function hashDeviceToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function createDeviceToken() {
  return `edt_${crypto.randomBytes(24).toString('hex')}`;
}

function publicDevice(device) {
  const records = readUploadRecords().filter((record) => String(record.deviceId || '') === String(device.id || ''));
  const lastSeenAt = device.lastSeenAt || '';
  const lastSeenMs = lastSeenAt ? Date.now() - Date.parse(lastSeenAt) : 0;
  return {
    id: device.id,
    name: device.name || '平板设备',
    tokenPreview: device.tokenPreview || '',
    allowedStudentIds: Array.isArray(device.allowedStudentIds) ? device.allowedStudentIds : [],
    allowedAllStudents: Boolean(device.allowedAllStudents),
    autoAuthorizeNewStudents: Boolean(device.autoAuthorizeNewStudents),
    revoked: Boolean(device.revoked),
    createdAt: device.createdAt || '',
    lastSeenAt,
    lastSeenAgoMs: Number.isFinite(lastSeenMs) ? lastSeenMs : 0,
    online: Boolean(!device.revoked && Number.isFinite(lastSeenMs) && lastSeenMs >= 0 && lastSeenMs <= 2 * 60 * 1000),
    lastIp: device.lastIp || '',
    lastUserAgent: device.lastUserAgent || '',
    uploadCount: records.length,
    lastUploadAt: records[0]?.uploadedAt || '',
  };
}

function createPairCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function getPairSession(forceNew = false) {
  const now = Date.now();
  if (!forceNew && activePairSession && activePairSession.expiresAtMs > now) return activePairSession;
  activePairSession = {
    pairCode: createPairCode(),
    createdAt: new Date(now).toISOString(),
    expiresAtMs: now + 10 * 60 * 1000,
  };
  activePairSession.expiresAt = new Date(activePairSession.expiresAtMs).toISOString();
  return activePairSession;
}

function getPairPayload() {
  const info = getConnectionInfo();
  const session = getPairSession();
  return {
    type: 'AI_EDU_MANAGER_PAIR',
    version: APP_VERSION,
    serverUrl: info.serverUrl,
    lanUrls: info.lanUrls,
    tailscaleUrl: info.tailscaleUrl,
    tailscaleUrls: info.tailscaleUrls,
    connectionMode: info.connectionMode,
    port: info.port,
    pairCode: session.pairCode,
    expiresAt: session.expiresAt,
  };
}

function deviceByBearerToken(token) {
  const tokenHash = hashDeviceToken(token);
  return readDevices().find((device) => device.tokenHash === tokenHash && !device.revoked);
}

function requestClientIp(request) {
  const forwarded = String(request?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  const remote = String(request?.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  return forwarded || remote;
}

function requestUserAgent(request) {
  return String(request?.headers?.['user-agent'] || '').slice(0, 160);
}

function touchDevice(deviceId, request) {
  const devices = readDevices();
  const index = devices.findIndex((device) => device.id === deviceId);
  if (index < 0) return;
  const lastIp = requestClientIp(request);
  const lastUserAgent = requestUserAgent(request);
  devices[index] = {
    ...devices[index],
    lastSeenAt: new Date().toISOString(),
    lastIp: lastIp || devices[index].lastIp || '',
    lastUserAgent: lastUserAgent || devices[index].lastUserAgent || '',
  };
  writeDevices(devices);
}

function getHostDevices() {
  return JSON.stringify({ ok: true, devices: readDevices().map(publicDevice) });
}

function revokeHostDevice(deviceId) {
  const devices = readDevices();
  const index = devices.findIndex((device) => String(device.id) === String(deviceId));
  if (index < 0) return JSON.stringify({ ok: false, message: '未找到设备。' });
  devices[index] = { ...devices[index], revoked: true, revokedAt: new Date().toISOString() };
  writeDevices(devices);
  notify('onNativeHostServiceChanged', getHostServiceStatus());
  return JSON.stringify({ ok: true, devices: devices.map(publicDevice), status: JSON.parse(getHostServiceStatus()) });
}

function renameHostDevice(deviceId, name) {
  const cleanName = String(name || '').trim().slice(0, 40);
  if (!cleanName) return JSON.stringify({ ok: false, message: '设备名称不能为空。' });
  const devices = readDevices();
  const index = devices.findIndex((device) => String(device.id) === String(deviceId));
  if (index < 0) return JSON.stringify({ ok: false, message: '未找到设备。' });
  devices[index] = { ...devices[index], name: cleanName };
  writeDevices(devices);
  notify('onNativeHostServiceChanged', getHostServiceStatus());
  return JSON.stringify({ ok: true, devices: devices.map(publicDevice), status: JSON.parse(getHostServiceStatus()) });
}

function setHostDeviceStudentAccess(deviceId, studentIdsJson) {
  let studentIds = [];
  try {
    const parsed = JSON.parse(studentIdsJson || '[]');
    studentIds = Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return JSON.stringify({ ok: false, message: '学生授权范围格式错误。' });
  }
  const validIds = new Set(readStudentsIndex().map((student) => String(student.id)));
  const allowedStudentIds = studentIds.filter((id) => validIds.has(String(id)));
  const devices = readDevices();
  const index = devices.findIndex((device) => String(device.id) === String(deviceId));
  if (index < 0) return JSON.stringify({ ok: false, message: '未找到设备。' });
  devices[index] = { ...devices[index], allowedStudentIds };
  writeDevices(devices);
  notify('onNativeHostServiceChanged', getHostServiceStatus());
  return JSON.stringify({ ok: true, devices: devices.map(publicDevice), status: JSON.parse(getHostServiceStatus()) });
}

function setHostDeviceAccessMode(deviceId, optionsJson) {
  let options = {};
  try {
    options = JSON.parse(optionsJson || '{}');
  } catch {
    return JSON.stringify({ ok: false, message: '设备授权选项格式错误。' });
  }
  const devices = readDevices();
  const index = devices.findIndex((device) => String(device.id) === String(deviceId));
  if (index < 0) return JSON.stringify({ ok: false, message: '未找到设备。' });
  const validIds = readStudentsIndex().map((student) => String(student.id));
  const allowedAllStudents = Boolean(options.allowedAllStudents);
  const autoAuthorizeNewStudents = Boolean(options.autoAuthorizeNewStudents);
  devices[index] = {
    ...devices[index],
    allowedAllStudents,
    autoAuthorizeNewStudents,
    allowedStudentIds: allowedAllStudents || autoAuthorizeNewStudents ? validIds : (Array.isArray(devices[index].allowedStudentIds) ? devices[index].allowedStudentIds : []),
  };
  writeDevices(devices);
  notify('onNativeHostServiceChanged', getHostServiceStatus());
  return JSON.stringify({ ok: true, devices: devices.map(publicDevice), status: JSON.parse(getHostServiceStatus()) });
}

function getHostServicePort() {
  const settings = readSettings();
  const port = Number(settings.hostServicePort || DEFAULT_HOST_PORT);
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : DEFAULT_HOST_PORT;
}

function setHostServicePort(port) {
  const nextPort = Number(port);
  if (!Number.isInteger(nextPort) || nextPort < 1024 || nextPort > 65535) {
    return JSON.stringify({ ok: false, message: '端口必须是 1024-65535 之间的数字' });
  }
  const settings = readSettings();
  settings.hostServicePort = nextPort;
  writeSettings(settings);
  if (hostServer) {
    const server = hostServer;
    hostServer = null;
    server.close(() => {
      startHostService();
    });
    return JSON.stringify({ ok: true, status: JSON.parse(getHostServiceStatus()), message: '端口已保存，主机服务正在重启。' });
  }
  return JSON.stringify({ ok: true, status: JSON.parse(getHostServiceStatus()) });
}

function sanitizeName(value) {
  return String(value || '学生').trim().replace(/[\\/:*?"<>|]/g, '').slice(0, 24) || '学生';
}

function notify(callbackName, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.executeJavaScript(
    `window.${callbackName} && window.${callbackName}(${JSON.stringify(payload)})`,
  ).catch(() => {});
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title: 'AI教育管家控制台',
    backgroundColor: '#f6f8f7',
    icon: path.join(__dirname, '..', 'dist', 'brand', 'robogala.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

function downloadsDir() {
  return app.getPath('downloads') || path.join(os.homedir(), 'Downloads');
}

function defaultStudentBaseDir() {
  const settings = readSettings();
  if (settings.studentBaseDir) return settings.studentBaseDir;
  return process.platform === 'win32'
    ? 'D:\\学生资料'
    : path.join(app.getPath('documents') || path.join(os.homedir(), 'Documents'), '学生资料');
}

function setStudentBaseDir(dir) {
  const settings = readSettings();
  settings.studentBaseDir = dir;
  settings.archiveRoot = dir;
  writeSettings(settings);
}

function getStorageConfig() {
  const baseDir = defaultStudentBaseDir();
  try {
    fs.mkdirSync(baseDir, { recursive: true });
  } catch {
    // The UI can still show the intended directory; writes report detailed errors later.
  }
  return JSON.stringify({
    platform: process.platform === 'win32' ? 'windows' : process.platform,
    baseDir,
    usesAbsolutePaths: true,
    pathSeparator: path.sep,
    hostServicePort: getHostServicePort(),
  });
}

function getStudentRootDir(studentName) {
  return path.join(defaultStudentBaseDir(), `${sanitizeName(studentName)}知识库`);
}

function getRawDir(studentName) {
  const cleanName = sanitizeName(studentName);
  return path.join(getStudentRootDir(cleanName), `${cleanName}原始资料库`);
}

function getSummaryDir(studentName) {
  const cleanName = sanitizeName(studentName);
  return path.join(getStudentRootDir(cleanName), `${cleanName}学情分析汇总`);
}

function templateLibraryDir() {
  return path.join(defaultStudentBaseDir(), '模板库');
}

function templateSystemDir() {
  return path.join(templateLibraryDir(), 'system');
}

function templateCustomDir() {
  return path.join(templateLibraryDir(), 'custom', 'current');
}

function templateMetaPath() {
  return path.join(templateCustomDir(), 'template-meta.json');
}

function templateFileKeys() {
  return ['AGENT.md', 'Soul.md', 'Memory.md', 'init-step-1.md', 'init-step-2.md', 'digest-prompt.md', 'consult-prompt.md'];
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeTemplateFiles(dir, templates, overwrite) {
  fs.mkdirSync(dir, { recursive: true });
  for (const key of templateFileKeys()) {
    const file = path.join(dir, key);
    if (!overwrite && fs.existsSync(file)) continue;
    fs.writeFileSync(file, String(templates[key] || ''), 'utf8');
  }
}

function readTemplateFiles(dir) {
  const templates = {};
  for (const key of templateFileKeys()) {
    const file = path.join(dir, key);
    templates[key] = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  }
  return templates;
}

function ensureTemplateLibrary(systemTemplates) {
  fs.mkdirSync(templateLibraryDir(), { recursive: true });
  writeTemplateFiles(templateSystemDir(), systemTemplates || {}, true);
  fs.mkdirSync(templateCustomDir(), { recursive: true });
}

function getTemplateCenter(systemTemplatesJson) {
  try {
    const systemTemplates = parseJsonObject(systemTemplatesJson);
    ensureTemplateLibrary(systemTemplates);
    const settings = readSettings();
    const activeTemplate = settings.activeTemplate === 'custom' ? 'custom' : 'system';
    return JSON.stringify({
      ok: true,
      activeTemplate,
      templateRoot: templateLibraryDir(),
      systemPath: templateSystemDir(),
      customPath: templateCustomDir(),
      system: readTemplateFiles(templateSystemDir()),
      custom: readTemplateFiles(templateCustomDir()),
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `读取模板库失败：${error.message}` });
  }
}

function saveCustomTemplates(templatesJson) {
  try {
    const templates = parseJsonObject(templatesJson);
    ensureTemplateLibrary(templates);
    writeTemplateFiles(templateCustomDir(), templates, true);
    fs.writeFileSync(templateMetaPath(), JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString(),
      keys: templateFileKeys(),
    }, null, 2), 'utf8');
    const settings = readSettings();
    settings.activeTemplate = 'custom';
    writeSettings(settings);
    return JSON.stringify({ ok: true, activeTemplate: 'custom', customPath: templateCustomDir(), message: '已保存为当前自定义模板。' });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `保存模板失败：${error.message}` });
  }
}

function restoreSystemTemplates(systemTemplatesJson) {
  try {
    const systemTemplates = parseJsonObject(systemTemplatesJson);
    ensureTemplateLibrary(systemTemplates);
    const settings = readSettings();
    settings.activeTemplate = 'system';
    writeSettings(settings);
    return JSON.stringify({ ok: true, activeTemplate: 'system', systemPath: templateSystemDir(), message: '已恢复系统默认模板。' });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `恢复默认模板失败：${error.message}` });
  }
}

function agentMemoryDir(student) {
  return path.join(student.rootPath || getStudentRootDir(student.name), 'Agent记忆');
}

function agentSoulDir(student) {
  return path.join(student.rootPath || getStudentRootDir(student.name), 'Agent设定');
}

function agentRulesDir(student) {
  return path.join(student.rootPath || getStudentRootDir(student.name), 'Agent规则');
}

function agentKnowledgeCenterDir(student) {
  return path.join(student.rootPath || getStudentRootDir(student.name), 'Agent知识管理');
}

function agentSourceRegistryDir(student) {
  return path.join(agentKnowledgeCenterDir(student), '来源记录');
}

function agentSourceRegistryPath(student) {
  return path.join(agentSourceRegistryDir(student), 'source-registry.json');
}

function agentConversationDir(student) {
  return path.join(agentKnowledgeCenterDir(student), '对话历史');
}

function agentConversationImportsDir(student) {
  return path.join(agentConversationDir(student), 'imports');
}

function agentConversationExtractsDir(student) {
  return path.join(agentConversationDir(student), 'extracts');
}

function agentMemoryUnifiedPath(student) {
  return path.join(agentMemoryDir(student), 'UnifiedMemory.md');
}

function agentSoulUnifiedPath(student) {
  return path.join(agentSoulDir(student), 'UnifiedSoul.md');
}

function agentSourceDir(baseDir, tool) {
  return path.join(baseDir, 'sources', AGENT_TOOL_IDS.includes(tool) ? tool : 'qclaw');
}

function sha1Text(value) {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex');
}

function snapshotCurrentFile(file, snapshotsDir) {
  if (!fs.existsSync(file)) return '';
  fs.mkdirSync(snapshotsDir, { recursive: true });
  const target = path.join(snapshotsDir, `${timestampForFilename()}-${path.basename(file)}`);
  fs.copyFileSync(file, target);
  return target;
}

function defaultRuleFileContent(student, fileName) {
  const cleanName = sanitizeName(student.name);
  const agentPath = student.agentPath || path.join(student.rootPath || getStudentRootDir(cleanName), 'AGENT.md');
  const lower = String(fileName || '').toLowerCase();
  if (lower === 'agent.md' && fs.existsSync(agentPath)) return fs.readFileSync(agentPath, 'utf8');
  return `# ${cleanName} ${fileName}\n\n## 工作规则\n\n该 Agent 的工作协议使用：${agentPath}\n后续所有学习资料消化都围绕该学生知识库执行。\n\n## 规则说明\n\n请将本文件作为该学生智能体的规则性 Markdown 文件维护。若当前 Agent 工具支持多个规则文件，可把本文件内容同步到对应工具的规则、系统提示词或项目指令中。\n`;
}

function defaultUnifiedMemory(student) {
  const cleanName = sanitizeName(student.name);
  return `# ${cleanName} AI教育管家 UnifiedMemory\n\n## 学生画像\n\n- 姓名：${cleanName}\n- 年级：${student.grade || ''}\n- 学校：${student.school || ''}\n- 当前核心目标：${student.goal || ''}\n\n## 长期观察\n\n- 待补充。\n`;
}

function defaultUnifiedSoul(student) {
  const cleanName = sanitizeName(student.name);
  const agentPath = student.agentPath || path.join(student.rootPath || getStudentRootDir(cleanName), 'AGENT.md');
  return `# ${cleanName} AI教育管家 UnifiedSoul\n\n你是「${cleanName} AI教育管家」，负责长期维护该学生学情档案，并把零散学习资料沉淀为可追溯、可复用的学情知识库。\n\n## 工作规则\n\n该 Agent 的工作协议使用：${agentPath}\n后续所有学习资料消化都围绕该学生知识库执行。\n`;
}

function writeJsonFile(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}

function readJsonFile(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function extractJsonLikeText(value) {
  const text = String(value || '')
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    .trim();
  if (!text) return '';
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const firstObject = text.indexOf('{');
  const lastObject = text.lastIndexOf('}');
  const firstArray = text.indexOf('[');
  const lastArray = text.lastIndexOf(']');
  if (firstObject >= 0 && lastObject > firstObject) return text.slice(firstObject, lastObject + 1);
  if (firstArray >= 0 && lastArray > firstArray) return text.slice(firstArray, lastArray + 1);
  return text;
}

function appendAgentSourceRecord(student, record) {
  try {
    fs.mkdirSync(agentSourceRegistryDir(student), { recursive: true });
    const file = agentSourceRegistryPath(student);
    const existing = readJsonFile(file, { version: 1, records: [] });
    const records = Array.isArray(existing.records) ? existing.records : [];
    const now = new Date().toISOString();
    records.unshift({
      id: record.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      studentId: String(student.id || ''),
      assetType: record.assetType || 'memory',
      tool: AGENT_TOOL_IDS.includes(record.tool) ? record.tool : 'qclaw',
      sourceType: record.sourceType || 'manualPaste',
      sourcePath: record.sourcePath || '',
      targetPath: record.targetPath || '',
      importedAt: record.importedAt || now,
      hash: record.hash || '',
      confidence: Number.isFinite(Number(record.confidence)) ? Number(record.confidence) : undefined,
      confirmed: record.confirmed !== false,
      notes: record.notes || '',
    });
    writeJsonFile(file, { version: 1, updatedAt: now, records: records.slice(0, 500) });
  } catch {
    // Source registry should never block the primary user action.
  }
}

function getAgentSourceRegistry(studentId) {
  try {
    const student = findStudentByKey(studentId);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    fs.mkdirSync(agentSourceRegistryDir(student), { recursive: true });
    const registry = readJsonFile(agentSourceRegistryPath(student), { version: 1, records: [] });
    return JSON.stringify({
      ok: true,
      path: agentSourceRegistryPath(student),
      records: Array.isArray(registry.records) ? registry.records : [],
      message: '已读取来源记录。',
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `读取来源记录失败：${error.message}` });
  }
}

function ensureAgentCenter(student) {
  const memoryDir = agentMemoryDir(student);
  const soulDir = agentSoulDir(student);
  fs.mkdirSync(memoryDir, { recursive: true });
  fs.mkdirSync(soulDir, { recursive: true });
  for (const tool of AGENT_TOOL_IDS) {
    fs.mkdirSync(path.join(agentSourceDir(memoryDir, tool), 'snapshots'), { recursive: true });
    fs.mkdirSync(path.join(agentSourceDir(soulDir, tool), 'snapshots'), { recursive: true });
  }
  if (!fs.existsSync(agentMemoryUnifiedPath(student))) {
    fs.writeFileSync(agentMemoryUnifiedPath(student), defaultUnifiedMemory(student), 'utf8');
  }
  if (!fs.existsSync(agentSoulUnifiedPath(student))) {
    fs.writeFileSync(agentSoulUnifiedPath(student), defaultUnifiedSoul(student), 'utf8');
  }
  importExistingAgentFile(student, 'Memory.md', memoryDir, 'current.Memory.md');
  importExistingAgentFile(student, 'Soul.md', soulDir, 'current.Soul.md');
  refreshAgentCenterIndexes(student);
}

function importExistingAgentFile(student, filename, baseDir, currentName) {
  const tool = AGENT_TOOL_IDS.includes(student.agentTool) ? student.agentTool : 'qclaw';
  const source = path.join(student.rootPath || getStudentRootDir(student.name), filename);
  const target = path.join(agentSourceDir(baseDir, tool), currentName);
  if (fs.existsSync(source) && !fs.existsSync(target)) {
    fs.copyFileSync(source, target);
  }
}

function listSourceEntries(baseDir, currentName, mode) {
  return AGENT_TOOL_IDS.map((tool) => {
    const currentPath = path.join(agentSourceDir(baseDir, tool), currentName);
    const content = fs.existsSync(currentPath) ? fs.readFileSync(currentPath, 'utf8') : '';
    return {
      tool,
      mode,
      currentPath,
      lastSyncedAt: fs.existsSync(currentPath) ? fs.statSync(currentPath).mtime.toISOString() : '',
      hash: content ? sha1Text(content) : '',
      exists: Boolean(content),
    };
  });
}

function refreshAgentCenterIndexes(student) {
  const memorySources = listSourceEntries(agentMemoryDir(student), 'current.Memory.md', 'paste');
  const soulSources = listSourceEntries(agentSoulDir(student), 'current.Soul.md', 'paste');
  writeJsonFile(path.join(agentMemoryDir(student), 'memory-index.json'), {
    version: 1,
    studentId: String(student.id || ''),
    unifiedMemoryPath: agentMemoryUnifiedPath(student),
    sources: memorySources,
    updatedAt: new Date().toISOString(),
  });
  writeJsonFile(path.join(agentSoulDir(student), 'soul-index.json'), {
    version: 1,
    studentId: String(student.id || ''),
    unifiedSoulPath: agentSoulUnifiedPath(student),
    sources: soulSources,
    updatedAt: new Date().toISOString(),
  });
}

function mergeMemoryContents(chunks) {
  const seenLines = new Set();
  const merged = ['# 统一学生记忆', '', '## 合并记忆'];
  const conflicts = [];
  for (const chunk of chunks) {
    const lines = String(chunk.content || '').split(/\r?\n/).map((line) => line.trimEnd());
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || /^#\s/.test(trimmed)) continue;
      const key = trimmed.replace(/\s+/g, ' ').toLowerCase();
      if (seenLines.has(key)) continue;
      seenLines.add(key);
      if (/冲突|不一致|待确认/.test(trimmed)) conflicts.push(`- [${chunk.tool}] ${trimmed}`);
      else merged.push(line);
    }
  }
  if (conflicts.length) {
    merged.push('', '## 待确认冲突', ...conflicts);
  }
  return `${merged.join('\n').trim()}\n`;
}

function getAgentCenter(studentId) {
  try {
    const student = findStudentByKey(studentId);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    ensureAgentCenter(student);
    const memoryIndex = readJsonFile(path.join(agentMemoryDir(student), 'memory-index.json'), {});
    const soulIndex = readJsonFile(path.join(agentSoulDir(student), 'soul-index.json'), {});
    return JSON.stringify({
      ok: true,
      memoryDir: agentMemoryDir(student),
      soulDir: agentSoulDir(student),
      unifiedMemoryPath: agentMemoryUnifiedPath(student),
      unifiedSoulPath: agentSoulUnifiedPath(student),
      unifiedMemory: fs.readFileSync(agentMemoryUnifiedPath(student), 'utf8'),
      unifiedSoul: fs.readFileSync(agentSoulUnifiedPath(student), 'utf8'),
      memoryIndex,
      soulIndex,
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `读取 Agent 中枢失败：${error.message}` });
  }
}

function saveAgentMemorySource(studentId, tool, content, mode) {
  try {
    const student = findStudentByKey(studentId);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    ensureAgentCenter(student);
    const safeTool = AGENT_TOOL_IDS.includes(tool) ? tool : 'qclaw';
    const dir = agentSourceDir(agentMemoryDir(student), safeTool);
    const file = path.join(dir, 'current.Memory.md');
    const snapshot = snapshotCurrentFile(file, path.join(dir, 'snapshots'));
    fs.writeFileSync(file, String(content || ''), 'utf8');
    appendAgentSourceRecord(student, {
      assetType: 'memory',
      tool: safeTool,
      sourceType: mode === 'file' ? 'fileImport' : 'manualPaste',
      targetPath: file,
      hash: sha1Text(content || ''),
      confidence: mode === 'file' ? 80 : 70,
      notes: '保存来源 Memory',
    });
    refreshAgentCenterIndexes(student);
    return JSON.stringify({ ok: true, currentPath: file, snapshot, hash: sha1Text(content || ''), message: '已保存来源 Memory。' });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `保存来源 Memory 失败：${error.message}` });
  }
}

function mergeAgentMemory(studentId) {
  try {
    const student = findStudentByKey(studentId);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    ensureAgentCenter(student);
    const chunks = [];
    for (const tool of AGENT_TOOL_IDS) {
      const file = path.join(agentSourceDir(agentMemoryDir(student), tool), 'current.Memory.md');
      if (fs.existsSync(file)) chunks.push({ tool, content: fs.readFileSync(file, 'utf8') });
    }
    const unified = chunks.length ? mergeMemoryContents(chunks) : defaultUnifiedMemory(student);
    fs.writeFileSync(agentMemoryUnifiedPath(student), unified, 'utf8');
    refreshAgentCenterIndexes(student);
    return JSON.stringify({ ok: true, unifiedMemory: unified, unifiedMemoryPath: agentMemoryUnifiedPath(student), message: `已合并 ${chunks.length} 个来源 Memory。` });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `合并统一记忆失败：${error.message}` });
  }
}

function saveUnifiedMemory(studentId, content) {
  try {
    const student = findStudentByKey(studentId);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    ensureAgentCenter(student);
    fs.writeFileSync(agentMemoryUnifiedPath(student), String(content || ''), 'utf8');
    refreshAgentCenterIndexes(student);
    return JSON.stringify({ ok: true, unifiedMemoryPath: agentMemoryUnifiedPath(student), message: '已保存统一记忆。' });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `保存统一记忆失败：${error.message}` });
  }
}

function saveAgentSoulSource(studentId, tool, content) {
  try {
    const student = findStudentByKey(studentId);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    ensureAgentCenter(student);
    const safeTool = AGENT_TOOL_IDS.includes(tool) ? tool : 'qclaw';
    const dir = agentSourceDir(agentSoulDir(student), safeTool);
    const file = path.join(dir, 'current.Soul.md');
    const snapshot = snapshotCurrentFile(file, path.join(dir, 'snapshots'));
    fs.writeFileSync(file, String(content || ''), 'utf8');
    appendAgentSourceRecord(student, {
      assetType: 'persona',
      tool: safeTool,
      sourceType: 'manualPaste',
      targetPath: file,
      hash: sha1Text(content || ''),
      confidence: 70,
      notes: '保存来源 Soul',
    });
    refreshAgentCenterIndexes(student);
    return JSON.stringify({ ok: true, currentPath: file, snapshot, hash: sha1Text(content || ''), message: '已保存来源 Soul 备份。' });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `保存来源 Soul 失败：${error.message}` });
  }
}

function saveUnifiedSoul(studentId, content) {
  try {
    const student = findStudentByKey(studentId);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    ensureAgentCenter(student);
    fs.writeFileSync(agentSoulUnifiedPath(student), String(content || ''), 'utf8');
    refreshAgentCenterIndexes(student);
    return JSON.stringify({ ok: true, unifiedSoulPath: agentSoulUnifiedPath(student), message: '已保存统一 Soul。' });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `保存统一 Soul 失败：${error.message}` });
  }
}

function compareAgentSoulSource(studentId, tool) {
  try {
    const student = findStudentByKey(studentId);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    ensureAgentCenter(student);
    const safeTool = AGENT_TOOL_IDS.includes(tool) ? tool : 'qclaw';
    const sourceFile = path.join(agentSourceDir(agentSoulDir(student), safeTool), 'current.Soul.md');
    const unified = fs.existsSync(agentSoulUnifiedPath(student)) ? fs.readFileSync(agentSoulUnifiedPath(student), 'utf8') : '';
    const source = fs.existsSync(sourceFile) ? fs.readFileSync(sourceFile, 'utf8') : '';
    const unifiedLines = new Set(unified.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
    const sourceLines = new Set(source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
    const onlyUnified = Array.from(unifiedLines).filter((line) => !sourceLines.has(line)).slice(0, 80);
    const onlySource = Array.from(sourceLines).filter((line) => !unifiedLines.has(line)).slice(0, 80);
    return JSON.stringify({ ok: true, onlyUnified, onlySource, message: onlyUnified.length || onlySource.length ? '检测到差异。' : '未检测到明显差异。' });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `对比 Soul 失败：${error.message}` });
  }
}

const DEFAULT_AGENT_RULE_FILES = ['AGENT.md', 'AGENTS.md', 'CLAUDE.md', 'Claude.md', 'Claud.md', 'QClaw.md', 'OpenClaw.md', 'Marvis.md', 'Hohu.md', 'RULES.md'];

function normalizeRuleFileName(fileName) {
  const safe = path.basename(String(fileName || '').trim());
  if (!/^[^\\/:*?"<>|]+\.md$/i.test(safe)) return '';
  return safe;
}

function listAgentRuleFiles(student) {
  const root = student.rootPath || getStudentRootDir(student.name);
  const known = new Map();
  for (const fileName of DEFAULT_AGENT_RULE_FILES) known.set(fileName.toLowerCase(), fileName);
  try {
    if (fs.existsSync(root)) {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isFile() || !/\.md$/i.test(entry.name)) continue;
        const lower = entry.name.toLowerCase();
        if (
          DEFAULT_AGENT_RULE_FILES.map((item) => item.toLowerCase()).includes(lower) ||
          /(agent|claude|claud|claw|marvis|hohu|rule|rules|system|prompt|指令|规则)/i.test(entry.name)
        ) known.set(lower, entry.name);
      }
    }
  } catch {
    // Keep default entries if the directory cannot be listed.
  }
  return Array.from(known.values()).map((fileName) => {
    const filePath = path.join(root, fileName);
    const exists = fs.existsSync(filePath);
    const stat = exists ? fs.statSync(filePath) : null;
    const content = exists ? fs.readFileSync(filePath, 'utf8') : defaultRuleFileContent(student, fileName);
    return {
      fileName,
      path: filePath,
      exists,
      size: stat ? stat.size : 0,
      mtime: stat ? stat.mtime.toISOString() : '',
      content,
      hash: content ? sha1Text(content) : '',
    };
  });
}

function getAgentRules(studentId) {
  try {
    const student = findStudentByKey(studentId);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    fs.mkdirSync(agentRulesDir(student), { recursive: true });
    return JSON.stringify({
      ok: true,
      rootPath: student.rootPath || getStudentRootDir(student.name),
      rulesDir: agentRulesDir(student),
      files: listAgentRuleFiles(student),
      message: '已读取智能体规则文件。',
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `读取规则文件失败：${error.message}` });
  }
}

function saveAgentRuleFile(studentId, fileName, content) {
  try {
    const student = findStudentByKey(studentId);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    const safeName = normalizeRuleFileName(fileName);
    if (!safeName) return JSON.stringify({ ok: false, message: '规则文件名无效，只能保存当前知识库根目录下的 .md 文件。' });
    const root = student.rootPath || getStudentRootDir(student.name);
    fs.mkdirSync(root, { recursive: true });
    fs.mkdirSync(path.join(agentRulesDir(student), 'snapshots'), { recursive: true });
    const file = path.join(root, safeName);
    const snapshot = snapshotCurrentFile(file, path.join(agentRulesDir(student), 'snapshots'));
    fs.writeFileSync(file, String(content || ''), 'utf8');
    appendAgentSourceRecord(student, {
      assetType: 'rule',
      tool: student.agentTool || 'qclaw',
      sourceType: snapshot ? 'manualPaste' : 'manualPaste',
      targetPath: file,
      hash: sha1Text(content || ''),
      confidence: 100,
      notes: `保存规则文件 ${safeName}`,
    });
    return JSON.stringify({
      ok: true,
      fileName: safeName,
      path: file,
      snapshot,
      files: listAgentRuleFiles(student),
      message: `已保存规则文件 ${safeName}。`,
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `保存规则文件失败：${error.message}` });
  }
}

function ruleFileTemplateIntro(student, fileName) {
  const cleanName = sanitizeName(student.name);
  const p = {
    root: student.rootPath || getStudentRootDir(cleanName),
    raw: student.rawPath || getRawDir(cleanName),
    summary: student.summaryPath || getSummaryDir(cleanName),
    agent: student.agentPath || path.join(student.rootPath || getStudentRootDir(cleanName), 'AGENT.md'),
    output: student.outputPath || path.join(student.rootPath || getStudentRootDir(cleanName), '输出结果'),
  };
  const lower = String(fileName || '').toLowerCase();
  if (lower === 'agents.md') {
    return `# ${cleanName} 教育管家项目说明（AGENTS.md）\n\n本目录是学生「${cleanName}」的 AI 教育管家知识库，供 Codex 或其他本地项目型 Agent 使用。\n\n## 工作规则\n\n- 该 Agent 的工作协议使用：${p.agent}\n- 后续所有学习资料消化都围绕该学生知识库执行。\n- 原始资料库是输入层：${p.raw}\n- 学情分析汇总是知识层：${p.summary}\n- 输出结果是临时交付层：${p.output}\n- 所有新增、修改和总结必须遵守 AGENT.md 中的证据追溯、索引更新和 log 记录规则。\n\n`;
  }
  if (lower === 'claude.md' || lower === 'claud.md') {
    return `# ${cleanName} 教育管家 Claude Code 规则\n\n本文件用于 Claude Code 在该学生知识库目录中工作。\n\n## 工作规则\n\n该 Agent 的工作协议使用：${p.agent}\n后续所有学习资料消化都围绕该学生知识库执行。\n\n请优先读取 AGENT.md，再处理原始资料库与学情分析汇总。不要移动、删除用户原始资料。\n\n`;
  }
  return defaultRuleFileContent(student, fileName);
}

function generateAgentRuleFile(studentId, fileName) {
  try {
    const student = findStudentByKey(studentId);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    const safeName = normalizeRuleFileName(fileName);
    if (!safeName) return JSON.stringify({ ok: false, message: '规则文件名无效。' });
    const root = student.rootPath || getStudentRootDir(student.name);
    const agentPath = student.agentPath || path.join(root, 'AGENT.md');
    const agentContent = fs.existsSync(agentPath) ? fs.readFileSync(agentPath, 'utf8') : defaultRuleFileContent(student, 'AGENT.md');
    const generated = `${ruleFileTemplateIntro(student, safeName).trim()}\n\n## AGENT.md 基础协议摘录\n\n\`\`\`markdown\n${agentContent.slice(0, 12000)}\n\`\`\`\n`;
    return saveAgentRuleFile(studentId, safeName, generated);
  } catch (error) {
    return JSON.stringify({ ok: false, message: `生成规则模板失败：${error.message}` });
  }
}

function compareAgentRuleFiles(studentId, baseName, targetName) {
  try {
    const student = findStudentByKey(studentId);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    const root = student.rootPath || getStudentRootDir(student.name);
    const baseFile = path.join(root, normalizeRuleFileName(baseName) || 'AGENT.md');
    const targetFile = path.join(root, normalizeRuleFileName(targetName) || '');
    const base = fs.existsSync(baseFile) ? fs.readFileSync(baseFile, 'utf8') : '';
    const target = fs.existsSync(targetFile) ? fs.readFileSync(targetFile, 'utf8') : '';
    const baseLines = new Set(base.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
    const targetLines = new Set(target.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
    const onlyBase = Array.from(baseLines).filter((line) => !targetLines.has(line)).slice(0, 120);
    const onlyTarget = Array.from(targetLines).filter((line) => !baseLines.has(line)).slice(0, 120);
    return JSON.stringify({ ok: true, onlyBase, onlyTarget, message: onlyBase.length || onlyTarget.length ? '检测到规则差异。' : '未检测到明显差异。' });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `对比规则文件失败：${error.message}` });
  }
}

const AGENT_KNOWLEDGE_SCAN = {
  maxDepth: 6,
  maxFiles: 1200,
  maxEntries: 12000,
  maxCandidates: 80,
  maxReadBytes: 256 * 1024,
  maxImportBytes: 5 * 1024 * 1024,
};

function agentKnowledgeScanRoots() {
  const home = os.homedir();
  const roaming = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const toolNames = ['QClaw', 'OpenClaw', 'Hohu', 'Marvis', 'Codex', 'Claude'];
  const roots = [
    path.join(home, '.qclaw'),
    path.join(home, '.openclaw'),
    path.join(home, '.hohu'),
    path.join(home, '.marvis'),
    path.join(home, '.codex'),
    path.join(home, '.claude'),
  ];
  for (const base of [roaming, local]) {
    for (const toolName of toolNames) roots.push(path.join(base, toolName));
  }
  return Array.from(new Set(roots)).filter((root) => fs.existsSync(root));
}

function shouldSkipAgentScanDir(name) {
  return [
    '.git',
    'node_modules',
    'cache',
    'code cache',
    'gpucache',
    'shadercache',
    'logs',
    'log',
    'tmp',
    'temp',
    'crashpad',
    'blob_storage',
    'session storage',
    'service worker',
  ].includes(String(name || '').toLowerCase());
}

function inferAgentToolFromPath(filePath) {
  const lower = String(filePath || '').toLowerCase();
  if (lower.includes('claude-code') || lower.includes('.claude')) return 'claude-code';
  if (lower.includes('chatgpt') || lower.includes('openai')) return 'chatgpt';
  if (lower.includes('doubao') || lower.includes('豆包')) return 'doubao';
  if (lower.includes('fastgpt')) return 'fastgpt';
  if (lower.includes('coze')) return 'coze';
  if (lower.includes('claude')) return 'claude';
  if (lower.includes('codex')) return 'codex';
  if (lower.includes('openclaw')) return 'openclaw';
  if (lower.includes('marvis')) return 'marvis';
  if (lower.includes('hohu')) return 'hohu';
  if (lower.includes('qclaw')) return 'qclaw';
  return 'qclaw';
}

function inferAgentKnowledgeKind(fileName) {
  const lower = String(fileName || '').toLowerCase();
  if (/^(agents|agent|claude|claud|qclaw|openclaw|marvis|hohu|rules?)\.(md|txt)$/i.test(lower)) return 'rule';
  if (/(conversation|chat|history|transcript|对话|聊天|会话)/i.test(lower)) return 'conversation';
  if (/^(memory|long[-_ ]?term[-_ ]?memory|memories)\.(md|txt|json)$/.test(lower) || lower.includes('memory')) return 'memory';
  if (/^(soul|persona|role|system|prompt|profile)\.(md|txt|json)$/.test(lower) || /(soul|persona|role|system|人设|角色)/i.test(lower)) return 'soul';
  return '';
}

function readTextPreview(filePath, maxBytes = AGENT_KNOWLEDGE_SCAN.maxReadBytes) {
  const stat = fs.statSync(filePath);
  const bytes = Math.min(stat.size, maxBytes);
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    fs.readSync(fd, buffer, 0, bytes, 0);
    return buffer.toString('utf8').replace(/\u0000/g, '').trim();
  } finally {
    fs.closeSync(fd);
  }
}

function scoreAgentKnowledgeCandidate(student, filePath, fileName, kind, content) {
  const lowerPath = String(filePath || '').toLowerCase();
  const lowerName = String(fileName || '').toLowerCase();
  const text = String(content || '');
  const lowerText = text.toLowerCase();
  const reasons = [];
  let score = 0;
  const add = (points, reason) => {
    score += points;
    reasons.push(reason);
  };
  if (student.name && text.includes(student.name)) add(60, `内容包含学生姓名「${student.name}」`);
  if (student.agentName && text.includes(student.agentName)) add(50, '内容包含 Agent 名称');
  if (student.rootPath && text.includes(student.rootPath)) add(45, '内容包含知识库根目录');
  if (student.agentPath && text.includes(student.agentPath)) add(35, '内容包含 AGENT.md 完整路径');
  if (lowerText.includes('agent.md')) add(22, '内容提到 AGENT.md');
  if (/原始资料库|学情分析汇总|学习资料消化|知识库/.test(text)) add(20, '内容包含教育管家知识库关键词');
  if (AGENT_TOOL_IDS.some((tool) => lowerPath.includes(tool))) add(14, '路径命中 Agent 工具目录');
  if ((kind === 'memory' && lowerName === 'memory.md') || (kind === 'soul' && lowerName === 'soul.md') || (kind === 'rule' && /^(agent|agents|claude)\.md$/.test(lowerName))) add(12, '文件名为标准名称');
  if (lowerPath.includes(String(student.name || '').toLowerCase())) add(10, '路径包含学生姓名');
  return { score, reasons };
}

function walkAgentKnowledgeFiles(root, results, stats, depth = 0) {
  if (
    depth > AGENT_KNOWLEDGE_SCAN.maxDepth ||
    stats.files >= AGENT_KNOWLEDGE_SCAN.maxFiles ||
    stats.entries >= AGENT_KNOWLEDGE_SCAN.maxEntries
  ) return;
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    stats.entries += 1;
    if (stats.files >= AGENT_KNOWLEDGE_SCAN.maxFiles || stats.entries >= AGENT_KNOWLEDGE_SCAN.maxEntries) return;
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (!shouldSkipAgentScanDir(entry.name)) walkAgentKnowledgeFiles(fullPath, results, stats, depth + 1);
      continue;
    }
    if (!entry.isFile()) continue;
    const kind = inferAgentKnowledgeKind(entry.name);
    if (!kind) continue;
    stats.files += 1;
    results.push({ path: fullPath, name: entry.name, kind });
  }
}

function scanAgentKnowledgeFiles(studentId) {
  try {
    const student = findStudentByKey(studentId);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    const roots = agentKnowledgeScanRoots();
    const rawCandidates = [];
    const stats = { files: 0, entries: 0 };
    for (const root of roots) walkAgentKnowledgeFiles(root, rawCandidates, stats);
    const candidates = [];
    for (const item of rawCandidates) {
      try {
        const stat = fs.statSync(item.path);
        if (stat.size > AGENT_KNOWLEDGE_SCAN.maxImportBytes) continue;
        const preview = readTextPreview(item.path);
        const scored = scoreAgentKnowledgeCandidate(student, item.path, item.name, item.kind, preview);
        candidates.push({
          ...item,
          tool: inferAgentToolFromPath(item.path),
          score: scored.score,
          reasons: scored.reasons,
          mtime: stat.mtime.toISOString(),
          size: stat.size,
          preview: preview.slice(0, 900),
        });
      } catch {
        // Ignore files that disappear or cannot be decoded during scanning.
      }
    }
    candidates.sort((a, b) => b.score - a.score || String(b.mtime).localeCompare(String(a.mtime)));
    return JSON.stringify({
      ok: true,
      scannedRoots: roots,
      candidates: candidates.slice(0, AGENT_KNOWLEDGE_SCAN.maxCandidates),
      message: roots.length
        ? `已扫描 ${roots.length} 个工具目录，找到 ${candidates.length} 个候选记忆/人设文件。`
        : '未找到常见 Agent 工具目录，可手动粘贴导入。',
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `扫描 Agent 记忆文件失败：${error.message}` });
  }
}

function importAgentKnowledgeFile(studentId, filePath, tool, kind) {
  try {
    const student = findStudentByKey(studentId);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    const safeTool = AGENT_TOOL_IDS.includes(tool) ? tool : inferAgentToolFromPath(filePath);
    const safeKind = ['soul', 'rule', 'conversation'].includes(kind) ? kind : 'memory';
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return JSON.stringify({ ok: false, message: '候选文件不存在或不可读取。' });
    }
    const stat = fs.statSync(filePath);
    if (stat.size > AGENT_KNOWLEDGE_SCAN.maxImportBytes) {
      return JSON.stringify({ ok: false, message: '候选文件过大，请手动打开确认后粘贴导入。' });
    }
    const content = fs.readFileSync(filePath, 'utf8');
    if (safeKind === 'soul') return saveAgentSoulSource(student.id, safeTool, content);
    if (safeKind === 'rule') return saveAgentRuleFile(student.id, path.basename(filePath), content);
    if (safeKind === 'conversation') return saveAgentConversationImport(student.id, content, safeTool, filePath);
    return saveAgentMemorySource(student.id, safeTool, content, 'file');
  } catch (error) {
    return JSON.stringify({ ok: false, message: `导入 Agent 文件失败：${error.message}` });
  }
}

function conversationIndexPath(student) {
  return path.join(agentConversationDir(student), 'conversation-index.json');
}

function refreshConversationIndex(student, entry) {
  fs.mkdirSync(agentConversationDir(student), { recursive: true });
  const indexFile = conversationIndexPath(student);
  const current = readJsonFile(indexFile, { version: 1, imports: [], extracts: [] });
  if (entry?.type === 'import') current.imports = [entry, ...(Array.isArray(current.imports) ? current.imports : [])].slice(0, 200);
  if (entry?.type === 'extract') current.extracts = [entry, ...(Array.isArray(current.extracts) ? current.extracts : [])].slice(0, 200);
  current.updatedAt = new Date().toISOString();
  writeJsonFile(indexFile, current);
  return current;
}

function getAgentConversationCenter(studentId) {
  try {
    const student = findStudentByKey(studentId);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    fs.mkdirSync(agentConversationImportsDir(student), { recursive: true });
    fs.mkdirSync(agentConversationExtractsDir(student), { recursive: true });
    const index = readJsonFile(conversationIndexPath(student), { version: 1, imports: [], extracts: [] });
    return JSON.stringify({
      ok: true,
      conversationDir: agentConversationDir(student),
      importsDir: agentConversationImportsDir(student),
      extractsDir: agentConversationExtractsDir(student),
      index,
      message: '已读取对话历史中心。',
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `读取对话历史失败：${error.message}` });
  }
}

function saveAgentConversationImport(studentId, content, tool = 'qclaw', sourcePath = '') {
  try {
    const student = findStudentByKey(studentId);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    const safeTool = AGENT_TOOL_IDS.includes(tool) ? tool : 'qclaw';
    fs.mkdirSync(agentConversationImportsDir(student), { recursive: true });
    const file = path.join(agentConversationImportsDir(student), `${timestampForFilename()}-${safeTool}-conversation.md`);
    fs.writeFileSync(file, String(content || ''), 'utf8');
    const hash = sha1Text(content || '');
    refreshConversationIndex(student, {
      type: 'import',
      path: file,
      sourcePath,
      tool: safeTool,
      importedAt: new Date().toISOString(),
      hash,
      size: Buffer.byteLength(String(content || ''), 'utf8'),
    });
    appendAgentSourceRecord(student, {
      assetType: 'conversation',
      tool: safeTool,
      sourceType: sourcePath ? 'fileImport' : 'manualPaste',
      sourcePath,
      targetPath: file,
      hash,
      confidence: 70,
      notes: '导入对话历史',
    });
    return JSON.stringify({ ok: true, path: file, message: '已保存对话历史导入记录。' });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `保存对话历史失败：${error.message}` });
  }
}

function selectAgentConversationFiles(studentId, tool = 'qclaw') {
  try {
    const student = findStudentByKey(studentId);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    const safeTool = AGENT_TOOL_IDS.includes(tool) ? tool : 'qclaw';
    const result = dialog.showOpenDialogSync(mainWindow, {
      title: '选择对话历史文件',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '对话历史文件', extensions: ['md', 'txt', 'json'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (!result || result.length === 0) {
      return JSON.stringify({ ok: false, cancelled: true, message: '未选择对话历史文件。' });
    }
    const imports = [];
    const combinedParts = [];
    for (const filePath of result) {
      try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) continue;
        if (stat.size > 5 * 1024 * 1024) {
          imports.push({ ok: false, sourcePath: filePath, message: '文件超过 5MB，已跳过。' });
          continue;
        }
        const content = fs.readFileSync(filePath, 'utf8');
        const imported = JSON.parse(saveAgentConversationImport(student.id, content, safeTool, filePath));
        imports.push({ ...imported, sourcePath: filePath, size: stat.size });
        if (imported.ok) {
          combinedParts.push(`\n\n# 来源文件：${path.basename(filePath)}\n\n${content}`);
        }
      } catch (error) {
        imports.push({ ok: false, sourcePath: filePath, message: error.message });
      }
    }
    const successCount = imports.filter((item) => item.ok).length;
    return JSON.stringify({
      ok: successCount > 0,
      imports,
      combinedContent: combinedParts.join('\n\n---\n'),
      message: successCount > 0
        ? `已导入 ${successCount} 个对话历史文件。`
        : '没有可导入的对话历史文件。',
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `选择对话历史文件失败：${error.message}` });
  }
}

function appendTextSection(file, title, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const section = `\n\n## ${title}\n\n${String(content || '').trim()}\n`;
  fs.appendFileSync(file, section, 'utf8');
}

function saveConversationExtract(studentId, extractJson, tool = 'qclaw') {
  try {
    const student = findStudentByKey(studentId);
    if (!student) return JSON.stringify({ ok: false, message: '未找到学生。' });
    const safeTool = AGENT_TOOL_IDS.includes(tool) ? tool : 'qclaw';
    ensureAgentCenter(student);
    let parsed = {};
    try {
      parsed = JSON.parse(extractJsonLikeText(extractJson || '{}'));
    } catch {
      return JSON.stringify({ ok: false, message: '提取结果不是有效 JSON。请确认只粘贴 JSON，或包含 JSON 的代码块。' });
    }
    fs.mkdirSync(agentConversationExtractsDir(student), { recursive: true });
    const extractFile = path.join(agentConversationExtractsDir(student), `${timestampForFilename()}-${safeTool}-extract.json`);
    writeJsonFile(extractFile, parsed);
    const memoryItems = Array.isArray(parsed.memoryCandidates) ? parsed.memoryCandidates : Array.isArray(parsed.memories) ? parsed.memories : [];
    const soulItems = Array.isArray(parsed.soulSuggestions) ? parsed.soulSuggestions : Array.isArray(parsed.personaSuggestions) ? parsed.personaSuggestions : [];
    const qaItems = Array.isArray(parsed.qaHighlights) ? parsed.qaHighlights : Array.isArray(parsed.qa) ? parsed.qa : [];
    const todoItems = Array.isArray(parsed.todos) ? parsed.todos : Array.isArray(parsed.followUps) ? parsed.followUps : [];
    const changed = [];
    if (memoryItems.length) {
      appendTextSection(agentMemoryUnifiedPath(student), `对话提取记忆 ${new Date().toLocaleString('zh-CN')}`, memoryItems.map((item) => `- ${typeof item === 'string' ? item : JSON.stringify(item)}`).join('\n'));
      changed.push('UnifiedMemory.md');
    }
    if (soulItems.length) {
      appendTextSection(agentSoulUnifiedPath(student), `对话提取人设建议 ${new Date().toLocaleString('zh-CN')}`, soulItems.map((item) => `- ${typeof item === 'string' ? item : JSON.stringify(item)}`).join('\n'));
      changed.push('UnifiedSoul.md');
    }
    if (qaItems.length) {
      const qaDir = path.join(student.summaryPath || getSummaryDir(student.name), '咨询精华库');
      fs.mkdirSync(qaDir, { recursive: true });
      const qaFile = path.join(qaDir, `对话提取-${timestampForFilename()}.md`);
      fs.writeFileSync(qaFile, `# ${student.name} 对话咨询精华\n\n${qaItems.map((item) => `- ${typeof item === 'string' ? item : JSON.stringify(item)}`).join('\n')}\n`, 'utf8');
      changed.push(qaFile);
    }
    if (todoItems.length) {
      const todoFile = path.join(student.outputPath || path.join(student.rootPath || getStudentRootDir(student.name), '输出结果'), '待办.md');
      appendTextSection(todoFile, `对话提取待办 ${new Date().toLocaleString('zh-CN')}`, todoItems.map((item) => `- ${typeof item === 'string' ? item : JSON.stringify(item)}`).join('\n'));
      changed.push(todoFile);
    }
    refreshConversationIndex(student, {
      type: 'extract',
      path: extractFile,
      tool: safeTool,
      importedAt: new Date().toISOString(),
      hash: sha1Text(JSON.stringify(parsed)),
      memoryCount: memoryItems.length,
      soulCount: soulItems.length,
      qaCount: qaItems.length,
      todoCount: todoItems.length,
    });
    appendAgentSourceRecord(student, {
      assetType: 'extract',
      tool: safeTool,
      sourceType: 'conversationExtract',
      targetPath: extractFile,
      hash: sha1Text(JSON.stringify(parsed)),
      confidence: 80,
      notes: `对话提取写入：${changed.join('、')}`,
    });
    return JSON.stringify({ ok: true, path: extractFile, changed, message: `已保存提取结果，写入 ${changed.length} 项教育资产。` });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `保存对话提取失败：${error.message}` });
  }
}

function readStudentsIndex() {
  try {
    const parsed = JSON.parse(fs.readFileSync(studentsPath(), 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStudentsIndex(students) {
  fs.mkdirSync(path.dirname(studentsPath()), { recursive: true });
  fs.writeFileSync(studentsPath(), JSON.stringify(students, null, 2), 'utf8');
}

function findStudentByKey(studentKey) {
  const key = String(studentKey || '');
  const cleanName = sanitizeName(key);
  return readStudentsIndex().find((student) => String(student.id) === key || student.name === cleanName) || null;
}

function toHostStudent(student) {
  const cleanName = sanitizeName(student.name);
  const createdAt = student.createdAt || new Date().toISOString();
  const channel = String(student.remoteChannel || 'none').toLowerCase();
  const remoteChannel = ['none', 'wecom', 'qq', 'both'].includes(channel) ? channel : 'none';
  const bindingStatus = String(student.remoteBindingStatus || 'unbound').toLowerCase();
  const remoteBindingStatus = ['unbound', 'pending', 'bound'].includes(bindingStatus) ? bindingStatus : 'unbound';
  const tool = String(student.agentTool || 'qclaw').toLowerCase();
  const agentTool = AGENT_TOOL_IDS.includes(tool) ? tool : 'qclaw';
  const mode = String(student.knowledgeBaseMode || 'standard').toLowerCase() === 'adopted' ? 'adopted' : 'standard';
  const rootPath = student.rootPath || getStudentRootDir(cleanName);
  const rawPath = student.rawPath || getRawDir(cleanName);
  const summaryPath = student.summaryPath || getSummaryDir(cleanName);
  const agentPath = student.agentPath || path.join(rootPath, 'AGENT.md');
  const outputPath = student.outputPath || path.join(rootPath, '输出结果');
  const bindingMode = String(student.agentBindingMode || (agentTool === 'marvis' ? 'mainChat' : 'subAgent'));
  const memoryDir = path.join(rootPath, 'Agent记忆');
  const soulDir = path.join(rootPath, 'Agent设定');
  const memoryConfig = student.memoryConfig && typeof student.memoryConfig === 'object' ? student.memoryConfig : {};
  const soulConfig = student.soulConfig && typeof student.soulConfig === 'object' ? student.soulConfig : {};
  const templateProfile = student.templateProfile && typeof student.templateProfile === 'object' ? student.templateProfile : {};
  return {
    id: String(student.id || `${cleanName}-${Date.now()}`),
    name: cleanName,
    grade: String(student.grade || ''),
    school: String(student.school || ''),
    goal: String(student.goal || ''),
    digestTime: String(student.digestTime || '21:30'),
    agentTool,
    agentBindingMode: ['subAgent', 'mainChat'].includes(bindingMode) ? bindingMode : 'subAgent',
    agentName: String(student.agentName || ''),
    agentNote: String(student.agentNote || ''),
    knowledgeBaseMode: mode,
    rootPath,
    rawPath,
    summaryPath,
    agentPath,
    outputPath,
    memoryConfig: {
      unifiedMemoryPath: memoryConfig.unifiedMemoryPath || path.join(memoryDir, 'UnifiedMemory.md'),
      lastMergedAt: memoryConfig.lastMergedAt || '',
      sources: Array.isArray(memoryConfig.sources) ? memoryConfig.sources : [],
    },
    soulConfig: {
      unifiedSoulPath: soulConfig.unifiedSoulPath || path.join(soulDir, 'UnifiedSoul.md'),
      lastDistributedAt: soulConfig.lastDistributedAt || '',
      sources: Array.isArray(soulConfig.sources) ? soulConfig.sources : [],
    },
    templateProfile: {
      activeTemplate: templateProfile.activeTemplate === 'custom' ? 'custom' : 'system',
      customTemplatePath: templateProfile.customTemplatePath || '',
    },
    adoptedAt: String(student.adoptedAt || ''),
    remoteChannel,
    remoteContact: String(student.remoteContact || ''),
    remoteNote: String(student.remoteNote || ''),
    remoteBindingStatus,
    remoteBoundAt: String(student.remoteBoundAt || ''),
    createdAt,
  };
}

function syncStudentsIndex(studentsJson) {
  try {
    const parsed = JSON.parse(studentsJson || '[]');
    if (!Array.isArray(parsed)) throw new Error('学生数据格式不是数组');
    const students = parsed.map(toHostStudent);
    writeStudentsIndex(students);
    const validIds = new Set(students.map((student) => String(student.id)));
    const devices = readDevices();
    let changed = false;
    const nextDevices = devices.map((device) => {
      if (device.allowedAllStudents || device.autoAuthorizeNewStudents) {
        changed = true;
        return { ...device, allowedStudentIds: Array.from(validIds) };
      }
      if (!Array.isArray(device.allowedStudentIds)) return device;
      const allowedStudentIds = device.allowedStudentIds.filter((id) => validIds.has(String(id)));
      if (allowedStudentIds.length !== device.allowedStudentIds.length) changed = true;
      return { ...device, allowedStudentIds };
    });
    if (changed) writeDevices(nextDevices);
    return JSON.stringify({ ok: true, count: students.length });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `同步学生索引失败：${error.message}` });
  }
}

function safeFilename(filename) {
  const base = path.basename(String(filename || `资料-${Date.now()}`));
  return base.replace(/[\\/:*?"<>|]/g, '_').trim() || `资料-${Date.now()}`;
}

function uniqueTargetFile(dir, filename) {
  const parsed = path.parse(safeFilename(filename));
  let target = path.join(dir, `${parsed.name}${parsed.ext}`);
  if (!fs.existsSync(target)) return target;
  const suffix = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  target = path.join(dir, `${parsed.name}-${suffix}${parsed.ext}`);
  if (!fs.existsSync(target)) return target;
  return path.join(dir, `${parsed.name}-${suffix}-${Math.random().toString(36).slice(2, 7)}${parsed.ext}`);
}

function resolveInside(root, relativePath) {
  const rel = String(relativePath || '').replace(/\\/g, '/');
  if (!rel || rel.includes('\0') || rel.startsWith('/') || path.isAbsolute(rel) || rel.split('/').includes('..')) {
    throw new Error('非法文件路径');
  }
  const rootResolved = path.resolve(root);
  const full = path.resolve(rootResolved, rel);
  if (full !== rootResolved && !full.startsWith(`${rootResolved}${path.sep}`)) {
    throw new Error('文件路径越界');
  }
  return full;
}

function interfacePriority(name, address) {
  const lowerName = String(name || '').toLowerCase();
  const parts = String(address || '').split('.').map((part) => Number(part));
  let score = 100;
  if (parts[0] === 192 && parts[1] === 168) score = 10;
  else if (parts[0] === 10) score = 20;
  else if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) score = 30;
  else if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) score = 80;

  if (/wlan|wi-?fi|wireless|ethernet|以太/.test(lowerName)) score -= 5;
  if (/tailscale|zerotier|vEthernet|vmware|virtualbox|docker|hyper-v/i.test(String(name || ''))) score += 100;
  return score;
}

function isTailscaleInterface(name, address) {
  const lowerName = String(name || '').toLowerCase();
  const parts = String(address || '').split('.').map((part) => Number(part));
  return lowerName.includes('tailscale') || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127);
}

function getNetworkUrls(port, mode) {
  const candidates = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry && entry.family === 'IPv4' && !entry.internal) {
        const isTailscale = isTailscaleInterface(name, entry.address);
        if (mode === 'lan' && isTailscale) continue;
        if (mode === 'tailscale' && !isTailscale) continue;
        candidates.push({
          url: `http://${entry.address}:${port}`,
          score: interfacePriority(name, entry.address),
        });
      }
    }
  }
  return candidates
    .sort((a, b) => a.score - b.score || a.url.localeCompare(b.url))
    .map((item) => item.url)
    .filter((url, index, list) => list.indexOf(url) === index);
}

function getLanUrls(port) {
  return getNetworkUrls(port, 'lan');
}

function getTailscaleUrls(port) {
  return getNetworkUrls(port, 'tailscale');
}

function getHostConnectionMode() {
  const settings = readSettings();
  const mode = String(settings.hostConnectionMode || 'lan_tailscale');
  return ['lan_only', 'lan_tailscale', 'manual'].includes(mode) ? mode : 'lan_tailscale';
}

function hostStudentStats() {
  return readStudentsIndex().map((student) => {
    const rawPath = student.rawPath || getRawDir(student.name);
    const summaryPath = student.summaryPath || getSummaryDir(student.name);
    const records = readUploadRecords().filter((record) => String(record.studentId) === String(student.id));
    const state = readStudentDigestState(student);
    return {
      id: String(student.id),
      name: student.name,
      rawFileCount: countFiles(rawPath),
      archiveFileCount: countMarkdownFiles(summaryPath),
      pendingDigestCount: records.filter((record) => normalizeUploadStatus(record.status) === 'pending_digest').length,
      submittedDigestCount: records.filter((record) => ['submitted', 'digesting'].includes(normalizeUploadStatus(record.status))).length,
      processedDigestCount: records.filter((record) => normalizeUploadStatus(record.status) === 'processed').length,
      lastDigestAt: state.lastDigestAt || '',
      digestStatus: state.status || 'idle',
      digestMessage: state.message || '',
    };
  });
}

function getConnectionInfo() {
  const port = getHostServicePort();
  const lanUrls = getLanUrls(port);
  const tailscaleUrls = getTailscaleUrls(port);
  const serverUrl = lanUrls[0] || `http://127.0.0.1:${port}`;
  return {
    serverUrl,
    lanUrls,
    tailscaleUrl: tailscaleUrls[0] || '',
    tailscaleUrls,
    connectionMode: getHostConnectionMode(),
    apiToken: ensureApiToken(),
    port,
  };
}

function getHostConnectionInfo() {
  const pairPayload = getPairPayload();
  return JSON.stringify({
    ...getConnectionInfo(),
    pairCode: pairPayload.pairCode,
    pairExpiresAt: pairPayload.expiresAt,
    pairPayload,
    pairPayloadText: JSON.stringify(pairPayload),
  });
}

function initStudentWorkspace(studentName, agentMd, indexMd, logMd) {
  try {
    const cleanName = sanitizeName(studentName);
    const root = getStudentRootDir(cleanName);
    const raw = getRawDir(cleanName);
    const summary = getSummaryDir(cleanName);
    fs.mkdirSync(path.join(root, '输出结果'), { recursive: true });
    fs.mkdirSync(raw, { recursive: true });
    fs.mkdirSync(path.join(raw, '图片'), { recursive: true });
    fs.mkdirSync(summary, { recursive: true });
    fs.mkdirSync(path.join(summary, '摘要库'), { recursive: true });
    fs.mkdirSync(path.join(summary, '概念库'), { recursive: true });
    fs.mkdirSync(path.join(summary, '实体库'), { recursive: true });
    fs.mkdirSync(path.join(summary, '综合库'), { recursive: true });
    fs.mkdirSync(path.join(summary, '咨询精华库'), { recursive: true });
    fs.mkdirSync(path.join(root, '.edu-manager'), { recursive: true });
    fs.writeFileSync(path.join(root, 'AGENT.md'), agentMd || '', 'utf8');
    writeTextIfMissing(path.join(summary, 'index.md'), indexMd || '');
    writeTextIfMissing(path.join(summary, 'log.md'), logMd || '');
    const pseudoStudent = { id: cleanName, name: cleanName, rootPath: root, rawPath: raw, summaryPath: summary };
    ensureStudentManagerFiles(pseudoStudent);
    writeStudentDigestState(pseudoStudent, {
      status: 'idle',
      rawPath: raw,
      summaryPath: summary,
      message: '知识库已初始化，等待上传资料。',
    });
    return JSON.stringify({
      ok: true,
      rootPathLabel: root,
      rootPath: root,
      rawPath: raw,
      summaryPath: summary,
      agentPath: path.join(root, 'AGENT.md'),
      outputPath: path.join(root, '输出结果'),
      rawCount: countFiles(raw),
      markdownCount: countMarkdownFiles(summary),
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `初始化本机知识库失败：${error.message}` });
  }
}

function selectKnowledgeBaseRoot() {
  try {
    const selected = dialog.showOpenDialogSync(mainWindow, {
      title: '选择已有学生知识库根目录',
      properties: ['openDirectory'],
    });
    if (!selected || !selected[0]) return JSON.stringify({ ok: false, message: '未选择已有知识库目录。' });
    return JSON.stringify({ ok: true, path: selected[0] });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `选择目录失败：${error.message}` });
  }
}

function dirNameMatches(name, keywords) {
  const lower = String(name || '').toLowerCase();
  return keywords.some((keyword) => lower.includes(String(keyword).toLowerCase()));
}

function findKnowledgeDir(root, preferredName, keywords) {
  const preferred = path.join(root, preferredName);
  if (fs.existsSync(preferred) && fs.statSync(preferred).isDirectory()) return preferred;
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return '';
  }
  for (const entry of entries) {
    if (entry.isDirectory() && dirNameMatches(entry.name, keywords)) return path.join(root, entry.name);
  }
  return '';
}

function scanExistingKnowledgeBase(rootPath, studentName) {
  try {
    const cleanName = sanitizeName(studentName);
    if (!String(rootPath || '').trim()) return JSON.stringify({ ok: false, message: '请先填写已有知识库根目录。' });
    const root = path.resolve(String(rootPath || ''));
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      return JSON.stringify({ ok: false, message: `未找到已有知识库目录：${rootPath || ''}` });
    }
    const agentPath = path.join(root, 'AGENT.md');
    const rawPath = findKnowledgeDir(root, `${cleanName}原始资料库`, ['原始资料库', '原始资料', 'raw', 'materials', '资料库']);
    const summaryPath = findKnowledgeDir(root, `${cleanName}学情分析汇总`, ['学情分析汇总', '汇总', 'summary', 'report', '分析', '综合']);
    const outputPath = findKnowledgeDir(root, '输出结果', ['输出结果', '输出', 'result']);
    const indexPath = summaryPath ? path.join(summaryPath, 'index.md') : '';
    const logPath = summaryPath ? path.join(summaryPath, 'log.md') : '';
    return JSON.stringify({
      ok: true,
      rootPath: root,
      agentPath,
      rawPath,
      summaryPath,
      outputPath,
      indexPath,
      logPath,
      checks: {
        agentMd: fs.existsSync(agentPath),
        rawDir: Boolean(rawPath && fs.existsSync(rawPath)),
        summaryDir: Boolean(summaryPath && fs.existsSync(summaryPath)),
        outputDir: Boolean(outputPath && fs.existsSync(outputPath)),
        indexMd: Boolean(indexPath && fs.existsSync(indexPath)),
        logMd: Boolean(logPath && fs.existsSync(logPath)),
      },
      message: '已扫描已有知识库目录。',
    });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `扫描已有知识库失败：${error.message}` });
  }
}

function resolveAdoptedPath(root, candidate, fallbackName) {
  const rootResolved = path.resolve(root);
  const target = path.resolve(String(candidate || path.join(rootResolved, fallbackName)));
  if (target !== rootResolved && !target.startsWith(`${rootResolved}${path.sep}`)) {
    throw new Error(`路径必须位于知识库根目录内：${target}`);
  }
  return target;
}

function ensureAdoptedKnowledgeBase(optionsJson) {
  try {
    const options = JSON.parse(optionsJson || '{}');
    const cleanName = sanitizeName(options.studentName || '学生');
    if (!String(options.rootPath || '').trim()) return JSON.stringify({ ok: false, message: '请先填写已有知识库根目录。' });
    const root = path.resolve(String(options.rootPath || ''));
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      return JSON.stringify({ ok: false, message: `未找到已有知识库目录：${options.rootPath || ''}` });
    }
    const rawPath = resolveAdoptedPath(root, options.rawPath, `${cleanName}原始资料库`);
    const summaryPath = resolveAdoptedPath(root, options.summaryPath, `${cleanName}学情分析汇总`);
    const outputPath = resolveAdoptedPath(root, options.outputPath, '输出结果');
    const agentPath = resolveAdoptedPath(root, options.agentPath, 'AGENT.md');
    fs.mkdirSync(rawPath, { recursive: true });
    fs.mkdirSync(summaryPath, { recursive: true });
    fs.mkdirSync(outputPath, { recursive: true });
    fs.mkdirSync(path.join(summaryPath, '摘要库'), { recursive: true });
    fs.mkdirSync(path.join(summaryPath, '概念库'), { recursive: true });
    fs.mkdirSync(path.join(summaryPath, '实体库'), { recursive: true });
    fs.mkdirSync(path.join(summaryPath, '综合库'), { recursive: true });
    fs.mkdirSync(path.join(summaryPath, '咨询精华库'), { recursive: true });
    if (!fs.existsSync(agentPath) || options.overwriteAgent) {
      if (fs.existsSync(agentPath) && options.overwriteAgent) {
        const backup = `${agentPath}.bak-${timestampForFilename()}`;
        fs.copyFileSync(agentPath, backup);
      }
      fs.mkdirSync(path.dirname(agentPath), { recursive: true });
      fs.writeFileSync(agentPath, options.agentMd || '', 'utf8');
    }
    writeTextIfMissing(path.join(summaryPath, 'index.md'), options.indexMd || '');
    writeTextIfMissing(path.join(summaryPath, 'log.md'), options.logMd || '');
    const pseudoStudent = {
      id: cleanName,
      name: cleanName,
      rootPath: root,
      rawPath,
      summaryPath,
      agentPath,
      outputPath,
      knowledgeBaseMode: 'adopted',
    };
    ensureStudentManagerFiles(pseudoStudent);
    writeStudentDigestState(pseudoStudent, {
      status: 'idle',
      rawPath,
      summaryPath,
      message: '已接管已有知识库，等待上传资料。',
    });
    return scanExistingKnowledgeBase(root, cleanName);
  } catch (error) {
    return JSON.stringify({ ok: false, message: `补齐已有知识库失败：${error.message}` });
  }
}

function writeTextIfMissing(file, content) {
  if (fs.existsSync(file)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content || '', 'utf8');
}

function countFiles(dir) {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    count += entry.isDirectory() ? countFiles(full) : 1;
  }
  return count;
}

function countMarkdownFiles(dir) {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) count += countMarkdownFiles(full);
    else if (entry.name.toLowerCase().endsWith('.md')) count += 1;
  }
  return count;
}

function exportTextFile(filename, content) {
  const safeName = filename && filename.trim() ? filename.replace(/[\\/:*?"<>|]/g, '_') : 'AI教育管家初始化包.json';
  const dir = path.join(downloadsDir(), 'AI教育管家');
  const target = path.join(dir, safeName);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(target, content || '', 'utf8');
    return JSON.stringify({ ok: true, uri: target });
  } catch (error) {
    return JSON.stringify({ ok: false, error: error.message });
  }
}

function importFiles(studentKey) {
  const student = findStudentByKey(studentKey);
  const cleanName = sanitizeName(student?.name || studentKey);
  dialog.showOpenDialog(mainWindow, {
    title: '选择要导入的学习资料',
    properties: ['openFile', 'multiSelections'],
  }).then((result) => {
    if (result.canceled || !result.filePaths.length) {
      notify('onNativeImportResult', { ok: false, imported: 0, message: '未选择资料。' });
      return;
    }
    const targetDir = student?.rawPath || getRawDir(cleanName);
    fs.mkdirSync(targetDir, { recursive: true });
    let imported = 0;
    for (const source of result.filePaths) {
      try {
        const target = uniqueFile(targetDir, path.basename(source).replace(/[\\/:*?"<>|]/g, '_'));
        fs.copyFileSync(source, target);
        imported += 1;
      } catch {
        // Continue copying the rest.
      }
    }
    notify('onNativeImportResult', {
      ok: imported > 0,
      imported,
      message: imported > 0 ? `已导入 ${imported} 个文件到「${cleanName}原始资料库」。` : '没有文件被成功导入。',
    });
  }).catch((error) => notify('onNativeImportResult', { ok: false, imported: 0, message: `导入失败：${error.message}` }));
  return true;
}

function uniqueFile(dir, filename) {
  const initial = path.join(dir, filename);
  if (!fs.existsSync(initial)) return initial;
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  return path.join(dir, `${base}-${Date.now()}${ext}`);
}

function queryUninstallEntries() {
  if (process.platform !== 'win32') return [];
  const roots = [
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  ];
  const entries = [];
  for (const root of roots) {
    try {
      const output = execFileSync('reg', ['query', root, '/s'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 8000,
      });
      let current = null;
      for (const rawLine of output.split(/\r?\n/)) {
        const line = rawLine.trimEnd();
        if (!line) continue;
        if (/^HKEY_/i.test(line)) {
          current = { key: line };
          entries.push(current);
          continue;
        }
        const match = line.match(/^\s+([^\s]+)\s+REG_\w+\s+(.*)$/);
        if (current && match) current[match[1]] = match[2].trim();
      }
    } catch {
      // Registry access can fail on restricted machines; filesystem probing is the fallback.
    }
  }
  return entries;
}

function normalizeExePath(value) {
  if (!value) return '';
  const match = String(value).match(/"?([A-Za-z]:\\[^"]+?\.exe)"?/i);
  return match ? match[1] : '';
}

function findExecutableInPath(names) {
  for (const name of names) {
    try {
      const result = spawnSync('where.exe', [name], { encoding: 'utf8', windowsHide: true });
      const first = String(result.stdout || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean);
      if (first && fs.existsSync(first)) return first;
    } catch {
      // Ignore PATH lookup failures.
    }
  }
  return '';
}

function findAgentToolInstall(toolId) {
  const toolMeta = {
    qclaw: {
      displayNeedle: 'qclaw',
      exeNames: ['QClaw.exe'],
      roots: [
        'D:\\Program Files\\QClaw',
        'C:\\Program Files\\QClaw',
        path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'QClaw'),
        path.join(os.homedir(), 'AppData', 'Local', 'QClaw'),
      ],
    },
    marvis: {
      displayNeedle: 'marvis',
      exeNames: ['MarvisLauncher.exe', 'Marvis.exe'],
      roots: [
        'D:\\Program Files\\Tencent\\Marvis',
        'C:\\Program Files\\Tencent\\Marvis',
        'D:\\Program Files\\Marvis',
        'C:\\Program Files\\Marvis',
        path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Marvis'),
        path.join(os.homedir(), 'AppData', 'Local', 'Marvis'),
      ],
    },
    hohu: {
      displayNeedle: 'hohu',
      exeNames: ['Hohu.exe', 'HohuAI.exe', 'Hohu.ai.exe', 'HohuLauncher.exe'],
      roots: [
        'D:\\Program Files\\Hohu',
        'C:\\Program Files\\Hohu',
        'D:\\Program Files\\Hohu.ai',
        'C:\\Program Files\\Hohu.ai',
        path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Hohu'),
        path.join(os.homedir(), 'AppData', 'Local', 'Hohu'),
      ],
    },
    openclaw: {
      displayNeedle: 'openclaw',
      exeNames: ['OpenClaw.exe', 'OpenClawLauncher.exe', 'OpenClaw Launcher.exe'],
      roots: [
        'D:\\Program Files\\OpenClaw',
        'C:\\Program Files\\OpenClaw',
        path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'OpenClaw'),
        path.join(os.homedir(), 'AppData', 'Local', 'OpenClaw'),
      ],
    },
    codex: {
      displayNeedle: 'codex',
      exeNames: ['codex.cmd', 'codex.exe', 'codex'],
      roots: [
        path.join(os.homedir(), 'AppData', 'Roaming', 'npm'),
        path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'codex'),
        path.join(os.homedir(), '.codex'),
      ],
    },
    'claude-code': {
      displayNeedle: 'claude',
      exeNames: ['claude.cmd', 'claude.exe', 'claude'],
      roots: [
        path.join(os.homedir(), 'AppData', 'Roaming', 'npm'),
        path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'claude'),
        path.join(os.homedir(), '.claude'),
      ],
    },
  };
  const meta = toolMeta[toolId] || toolMeta.qclaw;
  const displayNeedle = meta.displayNeedle;
  const exeNames = meta.exeNames;
  if (toolId === 'codex' || toolId === 'claude-code') {
    const pathExe = findExecutableInPath(exeNames);
    if (pathExe) {
      return {
        installed: true,
        version: '',
        exePath: pathExe,
        installLocation: path.dirname(pathExe),
      };
    }
  }
  const registryEntries = queryUninstallEntries().filter((entry) => {
    const haystack = `${entry.DisplayName || ''} ${entry.InstallLocation || ''} ${entry.DisplayIcon || ''}`.toLowerCase();
    return haystack.includes(displayNeedle);
  });
  const roots = [];
  for (const entry of registryEntries) {
    const iconExe = normalizeExePath(entry.DisplayIcon);
    if (iconExe && exeNames.some((name) => path.basename(iconExe).toLowerCase() === name.toLowerCase()) && fs.existsSync(iconExe)) {
      return {
        installed: true,
        version: entry.DisplayVersion || '',
        exePath: iconExe,
        installLocation: entry.InstallLocation || path.dirname(iconExe),
      };
    }
    if (entry.InstallLocation) roots.push(entry.InstallLocation);
    if (iconExe) roots.push(path.dirname(iconExe));
  }
  roots.push(...meta.roots);
  for (const root of Array.from(new Set(roots.filter(Boolean)))) {
    for (const exeName of exeNames) {
      const exe = findFile(root, exeName, 5);
      if (exe) {
        const entry = registryEntries[0] || {};
        return {
          installed: true,
          version: entry.DisplayVersion || '',
          exePath: exe,
          installLocation: entry.InstallLocation || root,
        };
      }
    }
  }
  return {
    installed: registryEntries.length > 0,
    version: registryEntries[0]?.DisplayVersion || '',
    exePath: '',
    installLocation: registryEntries[0]?.InstallLocation || '',
  };
}

function findTailscaleInstall() {
  const registryEntries = queryUninstallEntries().filter((entry) => {
    const haystack = `${entry.DisplayName || ''} ${entry.InstallLocation || ''} ${entry.DisplayIcon || ''}`.toLowerCase();
    return haystack.includes('tailscale');
  });
  const exeNames = ['tailscale-ipn.exe', 'tailscale.exe', 'Tailscale.exe'];
  const roots = [
    'C:\\Program Files\\Tailscale',
    'C:\\Program Files (x86)\\Tailscale',
    path.join(os.homedir(), 'AppData', 'Local', 'Tailscale'),
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Tailscale'),
  ];
  for (const entry of registryEntries) {
    const iconExe = normalizeExePath(entry.DisplayIcon);
    if (iconExe && fs.existsSync(iconExe)) {
      return {
        installed: true,
        version: entry.DisplayVersion || '',
        exePath: iconExe,
        installLocation: entry.InstallLocation || path.dirname(iconExe),
      };
    }
    if (entry.InstallLocation) roots.unshift(entry.InstallLocation);
  }
  for (const root of Array.from(new Set(roots.filter(Boolean)))) {
    for (const exeName of exeNames) {
      const exe = findFile(root, exeName, 4);
      if (exe) {
        const entry = registryEntries[0] || {};
        return {
          installed: true,
          version: entry.DisplayVersion || '',
          exePath: exe,
          installLocation: entry.InstallLocation || root,
        };
      }
    }
  }
  return {
    installed: registryEntries.length > 0,
    version: registryEntries[0]?.DisplayVersion || '',
    exePath: '',
    installLocation: registryEntries[0]?.InstallLocation || '',
  };
}

function getAgentToolInstallStatus() {
  const qclaw = findAgentToolInstall('qclaw');
  const marvis = findAgentToolInstall('marvis');
  const hohu = findAgentToolInstall('hohu');
  const openclaw = findAgentToolInstall('openclaw');
  const codex = findAgentToolInstall('codex');
  const claudeCode = findAgentToolInstall('claude-code');
  const webTool = (url, label = '网页入口') => ({ installed: true, version: label, exePath: url, installLocation: url });
  const tailscale = findTailscaleInstall();
  return JSON.stringify({
    qclaw,
    marvis,
    hohu,
    openclaw,
    codex,
    claudeCode,
    chatgpt: webTool(WEB_AGENT_TOOL_URLS.chatgpt),
    claude: webTool(WEB_AGENT_TOOL_URLS.claude),
    doubao: webTool(WEB_AGENT_TOOL_URLS.doubao),
    coze: webTool(WEB_AGENT_TOOL_URLS.coze, '平台入口'),
    fastgpt: webTool(WEB_AGENT_TOOL_URLS.fastgpt, '平台入口'),
    tailscale,
    anyInstalled: true,
    recommendedTool: qclaw.installed ? 'qclaw' : (openclaw.installed ? 'openclaw' : (hohu.installed ? 'hohu' : (marvis.installed ? 'marvis' : (codex.installed ? 'codex' : (claudeCode.installed ? 'claude-code' : 'qclaw'))))),
  });
}

function findFile(root, filename, depth) {
  if (depth < 0 || !root || !fs.existsSync(root)) return null;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) return full;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = findFile(path.join(root, entry.name), filename, depth - 1);
    if (found) return found;
  }
  return null;
}

function openApp(appName) {
  if (appName === 'obsidian') {
    obsidianOpened = true;
    shell.openExternal('obsidian://open').catch(() => {
      shell.openPath('C:\\Program Files\\Obsidian\\Obsidian.exe').catch(() => {});
    });
    return true;
  }
  if (appName === 'qclaw') {
    const exe = findAgentToolInstall('qclaw').exePath;
    qclawOpened = true;
    if (exe && fs.existsSync(exe)) {
      spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
    } else {
      shell.openExternal('qclaw://').catch(() => shell.openExternal('https://qclaw.qq.com/').catch(() => {}));
    }
    return true;
  }
  if (appName === 'marvis') {
    const exe = findAgentToolInstall('marvis').exePath;
    marvisOpened = true;
    if (exe && fs.existsSync(exe)) {
      spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
    } else {
      shell.openExternal('https://marvis.qq.com/').catch(() => {});
    }
    return true;
  }
  if (appName === 'hohu') {
    const exe = findAgentToolInstall('hohu').exePath;
    hohuOpened = true;
    if (exe && fs.existsSync(exe)) {
      spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
    } else {
      shell.openExternal('https://hohu.ai/').catch(() => {});
    }
    return true;
  }
  if (appName === 'openclaw') {
    const exe = findAgentToolInstall('openclaw').exePath;
    openclawOpened = true;
    if (exe && fs.existsSync(exe)) {
      spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
    } else {
      shell.openExternal('openclaw://').catch(() => shell.openExternal('https://openclaw.ai/').catch(() => {}));
    }
    return true;
  }
  if (appName === 'codex') {
    codexOpened = true;
    const exe = findAgentToolInstall('codex').exePath;
    if (exe && fs.existsSync(exe)) {
      shell.openPath(defaultStudentBaseDir()).catch(() => {});
    } else {
      shell.openExternal('https://chatgpt.com/codex').catch(() => {});
    }
    return true;
  }
  if (appName === 'claude-code') {
    claudeCodeOpened = true;
    const exe = findAgentToolInstall('claude-code').exePath;
    if (exe && fs.existsSync(exe)) {
      shell.openPath(defaultStudentBaseDir()).catch(() => {});
    } else {
      shell.openExternal('https://www.anthropic.com/claude-code').catch(() => {});
    }
    return true;
  }
  if (WEB_AGENT_TOOL_URLS[appName]) {
    shell.openExternal(WEB_AGENT_TOOL_URLS[appName]).catch(() => {});
    return true;
  }
  if (appName === 'tailscale') {
    const exe = findTailscaleInstall().exePath;
    if (exe && fs.existsSync(exe)) {
      spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
    } else {
      shell.openExternal('https://tailscale.com/download/windows').catch(() => {});
    }
    return true;
  }
  return false;
}

function openExternalUrl(url) {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  shell.openExternal(url).catch(() => {});
  return true;
}

function openStudentRootDir(studentId) {
  try {
    const student = findStudentByKey(studentId);
    const dir = student?.rootPath || (student ? getStudentRootDir(student.name) : '');
    if (!dir) return JSON.stringify({ ok: false, message: '未找到学生知识库目录。' });
    fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir).catch(() => {});
    return JSON.stringify({ ok: true, path: dir, message: '已打开学生知识库目录。' });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `打开学生知识库目录失败：${error.message}` });
  }
}

function pickArchiveRoot() {
  dialog.showOpenDialog(mainWindow, {
    title: '选择学生资料根目录',
    properties: ['openDirectory'],
  }).then((result) => {
    if (result.canceled || !result.filePaths[0]) {
      notify('onNativeArchiveRootSelected', JSON.stringify({ ok: false, message: '未选择学生资料根目录' }));
      return;
    }
    setStudentBaseDir(result.filePaths[0]);
    notify('onNativeArchiveRootSelected', JSON.stringify({ ok: true, uri: result.filePaths[0] }));
  }).catch((error) => {
    notify('onNativeArchiveRootSelected', JSON.stringify({ ok: false, message: error.message }));
  });
  return true;
}

function getArchiveRootStatus() {
  const root = defaultStudentBaseDir();
  if (root && fs.existsSync(root)) return JSON.stringify({ ok: true, uri: root });
  return JSON.stringify({ ok: false, message: '尚未创建学生资料目录' });
}

function listMarkdownFiles(studentKey) {
  try {
    const student = findStudentByKey(studentKey);
    const target = student?.summaryPath || getSummaryDir(student?.name || studentKey);
    if (!fs.existsSync(target)) return JSON.stringify({ ok: false, message: `未找到 ${target}` });
    const files = [];
    collectMarkdownFiles(target, target, files, 8);
    return JSON.stringify({ ok: true, folder: target, storageMode: 'windows_documents', files });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `读取档案失败：${error.message}` });
  }
}

function collectMarkdownFiles(root, current, files, depth) {
  if (depth < 0) return;
  let entries;
  try {
    entries = fs.readdirSync(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) {
      collectMarkdownFiles(root, full, files, depth - 1);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      const stat = fs.statSync(full);
      files.push({
        id: full,
        name: entry.name,
        path: path.relative(root, full).replace(/\\/g, '/'),
        modified: stat.mtimeMs,
      });
    }
  }
}

function readMarkdownFile(documentId) {
  try {
    if (!documentId || !fs.existsSync(documentId)) return JSON.stringify({ ok: false, message: '未找到文件' });
    return JSON.stringify({ ok: true, content: fs.readFileSync(documentId, 'utf8') });
  } catch (error) {
    return JSON.stringify({ ok: false, message: `读取 Markdown 失败：${error.message}` });
  }
}

function resetUploadCounterIfNeeded() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== uploadCountDate) {
    uploadCountDate = today;
    todayUploadCount = 0;
  }
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  response.end(JSON.stringify(body));
}

function readRequestBuffer(request, maxBytes = 300 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    request.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('上传文件过大。'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function parseJsonBody(request) {
  return readRequestBuffer(request, 1024 * 1024).then((buffer) => {
    if (!buffer.length) return {};
    return JSON.parse(buffer.toString('utf8'));
  });
}

function parseMultipartFiles(buffer, contentType) {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  const boundary = boundaryMatch && (boundaryMatch[1] || boundaryMatch[2]);
  if (!boundary) throw new Error('缺少 multipart boundary。');
  const delimiter = Buffer.from(`--${boundary}`);
  const files = [];
  let cursor = 0;
  while (cursor < buffer.length) {
    const partStart = buffer.indexOf(delimiter, cursor);
    if (partStart < 0) break;
    let bodyStart = partStart + delimiter.length;
    if (buffer.slice(bodyStart, bodyStart + 2).toString() === '--') break;
    if (buffer.slice(bodyStart, bodyStart + 2).toString() === '\r\n') bodyStart += 2;
    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), bodyStart);
    if (headerEnd < 0) break;
    const headersText = buffer.slice(bodyStart, headerEnd).toString('utf8');
    let partEnd = buffer.indexOf(delimiter, headerEnd + 4);
    if (partEnd < 0) partEnd = buffer.length;
    let content = buffer.slice(headerEnd + 4, partEnd);
    if (content.slice(-2).toString() === '\r\n') content = content.slice(0, -2);
    const disposition = headersText.split(/\r\n/).find((line) => /^content-disposition:/i.test(line)) || '';
    const filenameMatch = /filename\*?=(?:UTF-8''([^;\r\n]+)|"([^"]*)"|([^;\r\n]+))/i.exec(disposition);
    const filename = filenameMatch && decodeURIComponent(filenameMatch[1] || filenameMatch[2] || filenameMatch[3] || '').trim();
    if (filename) files.push({ filename, content });
    cursor = partEnd;
  }
  return files;
}

function authContext(request) {
  const header = String(request.headers.authorization || '');
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const token = match ? match[1].trim() : '';
  if (!token) return null;
  if (token === ensureApiToken()) {
    return { type: 'admin', allowedStudentIds: null };
  }
  const device = deviceByBearerToken(token);
  if (!device) return null;
  touchDevice(device.id, request);
  return {
    type: 'device',
    deviceId: device.id,
    deviceName: device.name || '平板设备',
    allowedStudentIds: Array.isArray(device.allowedStudentIds) ? device.allowedStudentIds.map(String) : [],
    allowedAllStudents: Boolean(device.allowedAllStudents),
  };
}

function requireAuth(request, response) {
  const auth = authContext(request);
  if (!auth) {
    sendJson(response, 401, { ok: false, message: 'Unauthorized' });
    return false;
  }
  request.authContext = auth;
  return true;
}

function isStudentAllowed(request, studentId) {
  const auth = request.authContext;
  if (!auth || auth.type === 'admin') return true;
  if (auth.allowedAllStudents) return true;
  return auth.allowedStudentIds.includes(String(studentId));
}

function requireStudentAccess(request, response, studentId) {
  if (!requireAuth(request, response)) return false;
  if (!isStudentAllowed(request, studentId)) {
    sendJson(response, 403, { ok: false, message: '当前设备没有访问该学生档案的权限。' });
    return false;
  }
  return true;
}

function findStudent(studentId) {
  return readStudentsIndex().find((student) => String(student.id) === String(studentId));
}

function handleHealth(_request, response) {
  sendJson(response, 200, {
    ok: true,
    version: APP_VERSION,
    hostName: os.hostname(),
    port: getHostServicePort(),
    license: publicLicenseStatus(),
  });
}

function handleStudents(request, response) {
  if (!requireAuth(request, response)) return;
  const students = readStudentsIndex().filter((student) => isStudentAllowed(request, student.id)).map((student) => {
    const rawPath = student.rawPath || getRawDir(student.name);
    const summaryPath = student.summaryPath || getSummaryDir(student.name);
    const records = readUploadRecords().filter((record) => String(record.studentId) === String(student.id));
    const state = readStudentDigestState(student);
    return {
      ...student,
      rawFileCount: countFiles(rawPath),
      archiveFileCount: countMarkdownFiles(summaryPath),
      pendingDigestCount: records.filter((record) => normalizeUploadStatus(record.status) === 'pending_digest').length,
      submittedDigestCount: records.filter((record) => ['submitted', 'digesting'].includes(normalizeUploadStatus(record.status))).length,
      processedDigestCount: records.filter((record) => normalizeUploadStatus(record.status) === 'processed').length,
      lastDigestAt: state.lastDigestAt || '',
      digestStatus: state.status || 'idle',
      digestMessage: state.message || '',
    };
  });
  sendJson(response, 200, { ok: true, students });
}

function isPublicArchiveFile(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/').toLowerCase();
  const name = path.basename(normalized);
  if (!name.endsWith('.md')) return false;
  if (['agent.md', 'log.md', 'soul.md', 'memory.md', 'config.md', 'settings.md'].includes(name)) return false;
  if (normalized.includes('/.obsidian/') || normalized.includes('/.trash/')) return false;
  return true;
}

function handleArchiveFiles(request, response, studentId) {
  if (!requireStudentAccess(request, response, studentId)) return;
  const student = findStudent(studentId);
  if (!student) {
    sendJson(response, 404, { ok: false, message: '未找到学生' });
    return;
  }
  const summaryPath = student.summaryPath || getSummaryDir(student.name);
  if (!fs.existsSync(summaryPath)) {
    sendJson(response, 200, { ok: true, folder: summaryPath, files: [] });
    return;
  }
  const files = [];
  collectMarkdownFiles(summaryPath, summaryPath, files, 8);
  sendJson(response, 200, { ok: true, folder: summaryPath, files: files.filter((file) => isPublicArchiveFile(file.path)) });
}

function handleArchiveFile(request, response, studentId, url) {
  if (!requireStudentAccess(request, response, studentId)) return;
  const student = findStudent(studentId);
  if (!student) {
    sendJson(response, 404, { ok: false, message: '未找到学生' });
    return;
  }
  try {
    const summaryPath = student.summaryPath || getSummaryDir(student.name);
    const relativePath = url.searchParams.get('path') || '';
    if (!isPublicArchiveFile(relativePath)) throw new Error('该文件不在平板端档案浏览范围内。');
    const target = resolveInside(summaryPath, relativePath);
    if (!target.toLowerCase().endsWith('.md')) throw new Error('只允许读取 Markdown 文件');
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) throw new Error('文件不存在');
    sendJson(response, 200, {
      ok: true,
      path: path.relative(summaryPath, target).replace(/\\/g, '/'),
      content: fs.readFileSync(target, 'utf8'),
    });
  } catch (error) {
    sendJson(response, 400, { ok: false, message: error.message });
  }
}

function handleDigestStatus(request, response, studentId) {
  if (!requireStudentAccess(request, response, studentId)) return;
  const student = findStudent(studentId);
  if (!student) {
    sendJson(response, 404, { ok: false, message: 'Student not found.' });
    return;
  }
  const records = readUploadRecords().filter((record) => String(record.studentId) === String(studentId));
  const state = readStudentDigestState(student);
  sendJson(response, 200, {
    ok: true,
    studentId: String(studentId),
    pendingCount: records.filter((record) => normalizeUploadStatus(record.status) === 'pending_digest').length,
    submittedCount: records.filter((record) => ['submitted', 'digesting'].includes(normalizeUploadStatus(record.status))).length,
    processedCount: records.filter((record) => normalizeUploadStatus(record.status) === 'processed').length,
    lastUploadAt: records.map((record) => record.uploadedAt || '').sort().pop() || '',
    lastDigestAt: state.lastDigestAt || '',
    digestStatus: state.status || 'idle',
    message: state.message || '',
  });
}

async function handleMaterialUpload(request, response, studentId, url) {
  if (!requireStudentAccess(request, response, studentId)) return;
  const student = findStudent(studentId);
  if (!student) {
    sendJson(response, 404, { ok: false, message: '未找到学生' });
    return;
  }
  const rawPath = student.rawPath || getRawDir(student.name);
  fs.mkdirSync(rawPath, { recursive: true });
  try {
    const contentType = String(request.headers['content-type'] || '');
    const buffer = await readRequestBuffer(request);
    const saved = [];
    if (/multipart\/form-data/i.test(contentType)) {
      const files = parseMultipartFiles(buffer, contentType);
      if (!files.length) throw new Error('multipart request has no file parts.');
      for (const file of files) {
        assertUploadFileAllowed(file.filename, file.content.length);
        const target = uniqueTargetFile(rawPath, file.filename);
        fs.writeFileSync(target, file.content);
        saved.push({ filename: path.basename(target), path: target, size: file.content.length });
      }
    } else {
      const filename = url.searchParams.get('filename') || 'upload.bin';
      assertUploadFileAllowed(filename, buffer.length);
      const target = uniqueTargetFile(rawPath, filename);
      fs.writeFileSync(target, buffer);
      saved.push({ filename: path.basename(target), path: target, size: buffer.length });
    }
    resetUploadCounterIfNeeded();
    todayUploadCount += saved.length;
    addUploadRecords(saved.map((item) => ({
      id: `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
      studentId: String(studentId),
      studentName: student.name,
      filename: item.filename,
      size: item.size,
      path: item.path,
      rawPath,
      sha1: sha1File(item.path),
      deviceId: request.authContext?.deviceId || 'admin',
      deviceName: request.authContext?.deviceName || '主机控制台',
      uploadedAt: new Date().toISOString(),
    })));
    const rawFileCount = countFiles(rawPath);
    notify('onNativeHostServiceChanged', getHostServiceStatus());
    sendJson(response, 200, {
      ok: true,
      imported: saved.length,
      files: saved,
      filename: saved[0]?.filename,
      path: saved[0]?.path,
      size: saved.reduce((total, item) => total + item.size, 0),
      rawFileCount,
      todayUploadCount,
    });
  } catch (error) {
    sendJson(response, 400, { ok: false, message: `Save upload failed: ${error.message}` });
  }
}
/*
  stream.on('error', (error) => {
    failed = true;
    sendJson(response, 500, { ok: false, message: `保存上传资料失败：${error.message}` });
  });
  stream.on('finish', () => {
    if (failed) return;
    resetUploadCounterIfNeeded();
    todayUploadCount += 1;
    const rawFileCount = countFiles(rawPath);
    sendJson(response, 200, {
      ok: true,
      filename: path.basename(target),
      path: target,
      size,
      rawFileCount,
      todayUploadCount,
    });
  });
}

*/
async function handlePairConfirm(request, response) {
  try {
    const body = await parseJsonBody(request);
    const pairCode = String(body.pairCode || '').trim();
    const session = getPairSession();
    if (!pairCode || pairCode !== session.pairCode || session.expiresAtMs <= Date.now()) {
      sendJson(response, 403, { ok: false, message: '配对码无效或已过期。' });
      return;
    }
    const existingStudents = readStudentsIndex();
    const allowedStudentIds = Array.isArray(body.allowedStudentIds) && body.allowedStudentIds.length
      ? body.allowedStudentIds.map(String).filter((id) => existingStudents.some((student) => String(student.id) === id))
      : existingStudents.map((student) => String(student.id));
    const token = createDeviceToken();
    const device = {
      id: String(body.deviceId || `device-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`),
      name: String(body.deviceName || body.name || '平板设备').slice(0, 80),
      tokenHash: hashDeviceToken(token),
      tokenPreview: `${token.slice(0, 7)}...${token.slice(-6)}`,
      allowedStudentIds,
      allowedAllStudents: true,
      autoAuthorizeNewStudents: true,
      revoked: false,
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      lastIp: requestClientIp(request),
      lastUserAgent: requestUserAgent(request),
    };
    const devices = readDevices().filter((item) => item.id !== device.id);
    devices.push(device);
    writeDevices(devices);
    activePairSession = null;
    notify('onNativeHostServiceChanged', getHostServiceStatus());
    sendJson(response, 200, {
      ok: true,
      token,
      device: publicDevice(device),
      students: existingStudents,
    });
  } catch (error) {
    sendJson(response, 400, { ok: false, message: `Pair confirm failed: ${error.message}` });
  }
}

function handleDeviceHeartbeat(request, response) {
  if (!requireAuth(request, response)) return;
  const auth = request.authContext;
  const device = auth?.type === 'device'
    ? readDevices().find((item) => String(item.id) === String(auth.deviceId))
    : null;
  sendJson(response, 200, {
    ok: true,
    at: new Date().toISOString(),
    device: device ? publicDevice(device) : null,
    studentCount: readStudentsIndex().length,
  });
}

function handleHostRequest(request, response) {
  if (request.method === 'OPTIONS') {
    sendJson(response, 200, { ok: true });
    return;
  }
  let url;
  try {
    url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  } catch {
    sendJson(response, 400, { ok: false, message: 'Bad Request' });
    return;
  }

  const pathname = decodeURIComponent(url.pathname);
  if (request.method === 'GET' && pathname === '/api/health') {
    handleHealth(request, response);
    return;
  }
  if (request.method === 'POST' && pathname === '/api/pair/confirm') {
    handlePairConfirm(request, response);
    return;
  }
  if (request.method === 'POST' && pathname === '/api/device/heartbeat') {
    handleDeviceHeartbeat(request, response);
    return;
  }
  if (request.method === 'GET' && pathname === '/api/students') {
    handleStudents(request, response);
    return;
  }
  const materialMatch = pathname.match(/^\/api\/students\/([^/]+)\/materials$/);
  if (request.method === 'POST' && materialMatch) {
    handleMaterialUpload(request, response, materialMatch[1], url);
    return;
  }
  const archiveFilesMatch = pathname.match(/^\/api\/students\/([^/]+)\/archive\/files$/);
  if (request.method === 'GET' && archiveFilesMatch) {
    handleArchiveFiles(request, response, archiveFilesMatch[1]);
    return;
  }
  const archiveFileMatch = pathname.match(/^\/api\/students\/([^/]+)\/archive\/file$/);
  if (request.method === 'GET' && archiveFileMatch) {
    handleArchiveFile(request, response, archiveFileMatch[1], url);
    return;
  }
  const digestStatusMatch = pathname.match(/^\/api\/students\/([^/]+)\/digest-status$/);
  if (request.method === 'GET' && digestStatusMatch) {
    handleDigestStatus(request, response, digestStatusMatch[1]);
    return;
  }
  sendJson(response, 404, { ok: false, message: 'Not Found' });
}

function startHostService() {
  if (hostServer) return getHostServiceStatus();
  ensureApiToken();
  const port = getHostServicePort();
  try {
    hostServer = http.createServer(handleHostRequest);
    hostServer.on('error', (error) => {
      hostServiceLastError = error.message;
      hostServer = null;
      notify('onNativeHostServiceChanged', getHostServiceStatus());
    });
    hostServer.listen(port, '0.0.0.0', () => {
      hostServiceStartedAt = new Date().toISOString();
      hostServiceLastError = '';
      notify('onNativeHostServiceChanged', getHostServiceStatus());
    });
    return getHostServiceStatus();
  } catch (error) {
    hostServer = null;
    hostServiceLastError = error.message;
    return getHostServiceStatus();
  }
}

function stopHostService() {
  if (!hostServer) return getHostServiceStatus();
  const server = hostServer;
  hostServer = null;
  server.close(() => {
    notify('onNativeHostServiceChanged', getHostServiceStatus());
  });
  return getHostServiceStatus();
}

function repairHostService() {
  const messages = [];
  try {
    fs.mkdirSync(defaultStudentBaseDir(), { recursive: true });
    messages.push('学生资料根目录已确认。');
  } catch (error) {
    messages.push(`学生资料根目录不可写：${error.message}`);
  }
  ensureApiToken();
  messages.push('API Token 已确认。');
  if (hostServer) {
    const server = hostServer;
    hostServer = null;
    server.close(() => {
      startHostService();
      notify('onNativeHostServiceChanged', getHostServiceStatus());
    });
    return JSON.stringify({
      ok: true,
      message: `${messages.join(' ')} 主机服务正在重启，请稍后刷新状态。`,
      status: JSON.parse(getHostServiceStatus()),
    });
  }
  const status = JSON.parse(startHostService());
  return JSON.stringify({
    ok: Boolean(status.running),
    message: `${messages.join(' ')} ${status.running ? '主机服务已启动。' : '主机服务启动失败，请查看诊断结果。'}`,
    status,
  });
}

function getHostServiceStatus() {
  resetUploadCounterIfNeeded();
  const info = getConnectionInfo();
  const pairPayload = getPairPayload();
  return JSON.stringify({
    running: Boolean(hostServer),
    port: info.port,
    serverUrl: info.serverUrl,
    lanUrls: info.lanUrls,
    tailscaleUrl: info.tailscaleUrl,
    tailscaleUrls: info.tailscaleUrls,
    connectionMode: info.connectionMode,
    apiToken: info.apiToken,
    pairCode: pairPayload.pairCode,
    pairExpiresAt: pairPayload.expiresAt,
    pairPayload,
    pairPayloadText: JSON.stringify(pairPayload),
    devices: readDevices().map(publicDevice),
    studentCount: readStudentsIndex().length,
    students: hostStudentStats(),
    todayUploadCount,
    recentUploads: readUploadRecords().slice(0, 8),
    license: publicLicenseStatus(),
    startedAt: hostServiceStartedAt,
    lastError: hostServiceLastError,
  });
}

function getHostServiceDiagnostics() {
  resetUploadCounterIfNeeded();
  const info = getConnectionInfo();
  const students = readStudentsIndex();
  const devices = readDevices();
  const activeDevices = devices.filter((device) => !device.revoked);
  const checks = [
    {
      label: '主机服务',
      ok: Boolean(hostServer),
      detail: hostServer ? `运行中，端口 ${info.port}` : '未启动。需要平板连接时，请先启动主机服务。',
      suggestion: hostServer ? '保持控制台打开即可。' : '在首页选择“主机-平板模式”，点击“启动服务”。',
    },
    {
      label: '局域网地址',
      ok: info.lanUrls.length > 0,
      detail: info.lanUrls.length > 0 ? info.lanUrls.join('；') : '没有检测到可用于平板访问的局域网地址。',
      suggestion: info.lanUrls.length > 0 ? '平板需连接同一 Wi-Fi，并使用二维码或扫码内容绑定。' : '检查电脑是否连接 Wi-Fi/网线，或稍后刷新服务状态。',
    },
    {
      label: 'Tailscale 地址',
      ok: info.tailscaleUrls.length > 0,
      detail: info.tailscaleUrls.length > 0 ? info.tailscaleUrls.join('；') : '未检测到 Tailscale 100.x 地址。',
      suggestion: info.tailscaleUrls.length > 0 ? '平板和主机加入同一个 Tailscale 网络后，可作为局域网失败时的远程回退地址。' : '如需远程连接，请先安装并登录 Tailscale；仅局域网使用可忽略。',
    },
    {
      label: 'API Token',
      ok: Boolean(info.apiToken),
      detail: info.apiToken ? `已生成：${info.apiToken.slice(0, 8)}...${info.apiToken.slice(-6)}` : '未生成。',
      suggestion: info.apiToken ? '无需手动输入，平板扫码配对后会自动保存设备 token。' : '启动主机服务后会自动生成。',
    },
    {
      label: '学生索引',
      ok: students.length > 0,
      detail: students.length > 0 ? `${students.length} 位学生可供授权。` : '还没有同步学生，请先初始化或新建学生。',
      suggestion: students.length > 0 ? '可在设备列表中勾选每台平板可访问的学生。' : '先在 Windows 控制台初始化或新建教育管家。',
    },
    {
      label: '平板设备',
      ok: activeDevices.length > 0,
      detail: activeDevices.length > 0 ? `${activeDevices.length} 台有效设备，${devices.length - activeDevices.length} 台已撤销。` : '暂无有效绑定设备。',
      suggestion: activeDevices.length > 0 ? '如资料串学生，请检查设备的学生访问范围。' : '打开平板终端，点击“扫码绑定主机”。',
    },
    {
      label: '最近错误',
      ok: !hostServiceLastError,
      detail: hostServiceLastError || '无。',
      suggestion: hostServiceLastError ? '若提示端口占用，请更换端口；若平板连不上，请检查防火墙和同一网络。' : '暂无需要处理的服务错误。',
    },
  ];
  return JSON.stringify({
    ok: checks.every((check) => check.ok),
    checkedAt: new Date().toISOString(),
    serverUrl: info.serverUrl,
    port: info.port,
    todayUploadCount,
    checks,
  });
}

function checkUpdate(manifestUrl, currentVersionCode) {
  const urls = String(manifestUrl || '').split('|').filter(Boolean);
  const tryUrl = (index) => {
    const url = urls[index];
    if (!url) {
      notify('onNativeUpdateResult', JSON.stringify({ hasUpdate: false, message: '更新检查失败：所有更新地址均不可用' }));
      return;
    }
    https.get(url, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try {
          const json = JSON.parse(body);
          const downloadUrl = json.windowsUrl || json.windows?.url || json.exeUrl || json.apkUrl;
          const nextVersionCode = Number(json.windowsVersionCode || json.versionCode || 0);
          const minimumVersionCode = Number(json.minimumWindowsVersionCode || json.minimumVersionCode || 0);
          const hasUpdate = nextVersionCode > Number(currentVersionCode) && Boolean(downloadUrl);
          notify('onNativeUpdateResult', JSON.stringify({
            ...json,
            versionCode: nextVersionCode,
            minimumVersionCode,
            forceUpdate: Boolean(json.forceWindowsUpdate || (minimumVersionCode && Number(currentVersionCode) < minimumVersionCode)),
            apkUrl: downloadUrl,
            windowsUrl: downloadUrl,
            notes: json.windowsNotes || json.notes,
            hasUpdate,
            message: hasUpdate ? undefined : '当前已是最新版本',
          }));
        } catch {
          tryUrl(index + 1);
        }
      });
    }).on('error', () => tryUrl(index + 1));
  };
  tryUrl(0);
  return true;
}

function downloadAndInstallUpdate(downloadUrl) {
  return openExternalUrl(downloadUrl);
}

ipcMain.on('bridge:copyText', (_event, value) => clipboard.writeText(String(value || '')));
ipcMain.on('bridge:exportTextFile', (event, filename, content) => { event.returnValue = exportTextFile(filename, content); });
ipcMain.on('bridge:importFiles', (event, studentName) => { event.returnValue = importFiles(studentName); });
ipcMain.on('bridge:initStudentWorkspace', (event, studentName, agentMd, indexMd, logMd) => {
  event.returnValue = initStudentWorkspace(studentName, agentMd, indexMd, logMd);
});
ipcMain.on('bridge:openApp', (event, appName) => { event.returnValue = openApp(appName); });
ipcMain.on('bridge:openExternalUrl', (event, url) => { event.returnValue = openExternalUrl(url); });
ipcMain.on('bridge:getAppStatus', (event) => {
  event.returnValue = JSON.stringify({ qclawOpened, marvisOpened, hohuOpened, openclawOpened, codexOpened, claudeCodeOpened, obsidianOpened });
});
ipcMain.on('bridge:getStorageConfig', (event) => { event.returnValue = getStorageConfig(); });
ipcMain.on('bridge:getTemplateCenter', (event, systemTemplatesJson) => { event.returnValue = getTemplateCenter(systemTemplatesJson); });
ipcMain.on('bridge:saveCustomTemplates', (event, templatesJson) => { event.returnValue = saveCustomTemplates(templatesJson); });
ipcMain.on('bridge:restoreSystemTemplates', (event, systemTemplatesJson) => { event.returnValue = restoreSystemTemplates(systemTemplatesJson); });
ipcMain.on('bridge:getAgentCenter', (event, studentId) => { event.returnValue = getAgentCenter(studentId); });
ipcMain.on('bridge:saveAgentMemorySource', (event, studentId, tool, content, mode) => { event.returnValue = saveAgentMemorySource(studentId, tool, content, mode); });
ipcMain.on('bridge:mergeAgentMemory', (event, studentId) => { event.returnValue = mergeAgentMemory(studentId); });
ipcMain.on('bridge:saveUnifiedMemory', (event, studentId, content) => { event.returnValue = saveUnifiedMemory(studentId, content); });
ipcMain.on('bridge:saveAgentSoulSource', (event, studentId, tool, content) => { event.returnValue = saveAgentSoulSource(studentId, tool, content); });
ipcMain.on('bridge:saveUnifiedSoul', (event, studentId, content) => { event.returnValue = saveUnifiedSoul(studentId, content); });
ipcMain.on('bridge:compareAgentSoulSource', (event, studentId, tool) => { event.returnValue = compareAgentSoulSource(studentId, tool); });
ipcMain.on('bridge:scanAgentKnowledgeFiles', (event, studentId) => { event.returnValue = scanAgentKnowledgeFiles(studentId); });
ipcMain.on('bridge:importAgentKnowledgeFile', (event, studentId, filePath, tool, kind) => { event.returnValue = importAgentKnowledgeFile(studentId, filePath, tool, kind); });
ipcMain.on('bridge:getAgentRules', (event, studentId) => { event.returnValue = getAgentRules(studentId); });
ipcMain.on('bridge:saveAgentRuleFile', (event, studentId, fileName, content) => { event.returnValue = saveAgentRuleFile(studentId, fileName, content); });
ipcMain.on('bridge:generateAgentRuleFile', (event, studentId, fileName) => { event.returnValue = generateAgentRuleFile(studentId, fileName); });
ipcMain.on('bridge:compareAgentRuleFiles', (event, studentId, baseName, targetName) => { event.returnValue = compareAgentRuleFiles(studentId, baseName, targetName); });
ipcMain.on('bridge:getAgentSourceRegistry', (event, studentId) => { event.returnValue = getAgentSourceRegistry(studentId); });
ipcMain.on('bridge:getAgentConversationCenter', (event, studentId) => { event.returnValue = getAgentConversationCenter(studentId); });
ipcMain.on('bridge:saveAgentConversationImport', (event, studentId, content, tool, sourcePath) => { event.returnValue = saveAgentConversationImport(studentId, content, tool, sourcePath); });
ipcMain.on('bridge:selectAgentConversationFiles', (event, studentId, tool) => { event.returnValue = selectAgentConversationFiles(studentId, tool); });
ipcMain.on('bridge:saveConversationExtract', (event, studentId, extractJson, tool) => { event.returnValue = saveConversationExtract(studentId, extractJson, tool); });
ipcMain.on('bridge:openStudentRootDir', (event, studentId) => { event.returnValue = openStudentRootDir(studentId); });
ipcMain.on('bridge:getLicenseStatus', (event) => { event.returnValue = getLicenseStatus(); });
ipcMain.on('bridge:activateLicense', (event, code) => { event.returnValue = activateLicense(code); });
ipcMain.on('bridge:deactivateLicense', (event) => { event.returnValue = deactivateLicense(); });
ipcMain.on('bridge:getAgentToolInstallStatus', (event) => { event.returnValue = getAgentToolInstallStatus(); });
ipcMain.on('bridge:checkUpdate', (event, manifestUrl, currentVersionCode) => {
  event.returnValue = checkUpdate(manifestUrl, currentVersionCode);
});
ipcMain.on('bridge:downloadAndInstallUpdate', (event, downloadUrl) => {
  event.returnValue = downloadAndInstallUpdate(downloadUrl);
});
ipcMain.on('bridge:pickArchiveRoot', (event) => { event.returnValue = pickArchiveRoot(); });
ipcMain.on('bridge:getArchiveRootStatus', (event) => { event.returnValue = getArchiveRootStatus(); });
ipcMain.on('bridge:listMarkdownFiles', (event, studentName) => { event.returnValue = listMarkdownFiles(studentName); });
ipcMain.on('bridge:readMarkdownFile', (event, documentId) => { event.returnValue = readMarkdownFile(documentId); });
ipcMain.on('bridge:syncStudents', (event, studentsJson) => { event.returnValue = syncStudentsIndex(studentsJson); });
ipcMain.on('bridge:selectKnowledgeBaseRoot', (event) => { event.returnValue = selectKnowledgeBaseRoot(); });
ipcMain.on('bridge:scanKnowledgeBase', (event, rootPath, studentName) => { event.returnValue = scanExistingKnowledgeBase(rootPath, studentName); });
ipcMain.on('bridge:ensureAdoptedKnowledgeBase', (event, optionsJson) => { event.returnValue = ensureAdoptedKnowledgeBase(optionsJson); });
ipcMain.on('bridge:getHostServiceStatus', (event) => { event.returnValue = getHostServiceStatus(); });
ipcMain.on('bridge:getHostServiceDiagnostics', (event) => { event.returnValue = getHostServiceDiagnostics(); });
ipcMain.on('bridge:repairHostService', (event) => { event.returnValue = repairHostService(); });
ipcMain.on('bridge:startHostService', (event) => { event.returnValue = startHostService(); });
ipcMain.on('bridge:stopHostService', (event) => { event.returnValue = stopHostService(); });
ipcMain.on('bridge:setHostServicePort', (event, port) => { event.returnValue = setHostServicePort(port); });
ipcMain.on('bridge:getHostConnectionInfo', (event) => { event.returnValue = getHostConnectionInfo(); });
ipcMain.on('bridge:getHostDevices', (event) => { event.returnValue = getHostDevices(); });
ipcMain.on('bridge:getHostUploadRecords', (event) => { event.returnValue = getHostUploadRecords(); });
ipcMain.on('bridge:exportHostUploadRecords', (event) => { event.returnValue = exportHostUploadRecords(); });
ipcMain.on('bridge:openHostUploadRecord', (event, recordId) => { event.returnValue = openHostUploadRecord(recordId); });
ipcMain.on('bridge:clearHostUploadRecords', (event) => { event.returnValue = clearHostUploadRecords(); });
ipcMain.on('bridge:setHostUploadRecordStatus', (event, recordId, status) => { event.returnValue = setHostUploadRecordStatus(recordId, status); });
ipcMain.on('bridge:markStudentDigestSubmitted', (event, studentId) => { event.returnValue = markStudentDigestSubmitted(studentId); });
ipcMain.on('bridge:syncStudentDigestResult', (event, studentId) => { event.returnValue = syncStudentDigestResult(studentId, { forceSubmitted: true }); });
ipcMain.on('bridge:getHostTimeline', (event) => { event.returnValue = getHostTimeline(); });
ipcMain.on('bridge:backupHostData', (event) => { event.returnValue = backupHostData(); });
ipcMain.on('bridge:restoreHostData', (event) => { event.returnValue = restoreHostData(); });
ipcMain.on('bridge:resetHostApiToken', (event) => { event.returnValue = resetHostApiToken(); });
ipcMain.on('bridge:exportHostLogs', (event) => { event.returnValue = exportHostLogs(); });
ipcMain.on('bridge:openStudentRawDir', (event, studentId) => { event.returnValue = openStudentRawDir(studentId); });
ipcMain.on('bridge:migrateStudentWorkspace', (event, studentId, newName) => { event.returnValue = migrateStudentWorkspace(studentId, newName); });
ipcMain.on('bridge:renameHostDevice', (event, deviceId, name) => { event.returnValue = renameHostDevice(deviceId, name); });
ipcMain.on('bridge:revokeHostDevice', (event, deviceId) => { event.returnValue = revokeHostDevice(deviceId); });
ipcMain.on('bridge:setHostDeviceStudentAccess', (event, deviceId, studentIdsJson) => {
  event.returnValue = setHostDeviceStudentAccess(deviceId, studentIdsJson);
});
ipcMain.on('bridge:setHostDeviceAccessMode', (event, deviceId, optionsJson) => {
  event.returnValue = setHostDeviceAccessMode(deviceId, optionsJson);
});

app.whenReady().then(createWindow);

app.on('before-quit', () => {
  if (hostServer) {
    hostServer.close();
    hostServer = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
