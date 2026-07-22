const crypto = require('crypto');

const LOGIN_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const TERMINAL_MODES = new Set(['personal', 'shared']);
const HOST_USAGE_MODES = new Set(['host', 'host_terminal']);

function normalizeTerminalMode(value, fallback = 'shared') {
  const normalized = String(value || '').trim().toLowerCase();
  return TERMINAL_MODES.has(normalized) ? normalized : fallback;
}

function normalizeHostUsageMode(value, fallback = 'host') {
  const normalized = String(value || '').trim().toLowerCase();
  return HOST_USAGE_MODES.has(normalized) ? normalized : fallback;
}

function loginIdChecksum(body) {
  const normalized = String(body || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
  let total = 17;
  for (let index = 0; index < normalized.length; index += 1) {
    const position = LOGIN_ALPHABET.indexOf(normalized[index]);
    total = (total * 31 + (position >= 0 ? position : normalized.charCodeAt(index))) % LOGIN_ALPHABET.length;
  }
  return LOGIN_ALPHABET[total];
}

function normalizeStudentLoginId(value) {
  const compact = String(value || '').trim().toUpperCase().replace(/\s+/g, '').replace(/_/g, '-');
  const match = /^S-?([2-9A-HJ-KM-NP-Z]{4})-?([2-9A-HJ-KM-NP-Z])$/.exec(compact);
  return match ? `S-${match[1]}-${match[2]}` : compact;
}

function isValidStudentLoginId(value) {
  const normalized = normalizeStudentLoginId(value);
  const match = /^S-([2-9A-HJ-KM-NP-Z]{4})-([2-9A-HJ-KM-NP-Z])$/.exec(normalized);
  return Boolean(match && loginIdChecksum(match[1]) === match[2]);
}

function createStudentLoginId(randomBytes = crypto.randomBytes) {
  const bytes = randomBytes(4);
  let body = '';
  for (let index = 0; index < 4; index += 1) body += LOGIN_ALPHABET[bytes[index] % LOGIN_ALPHABET.length];
  return `S-${body}-${loginIdChecksum(body)}`;
}

function ensureStudentLoginIds(students, options = {}) {
  const input = Array.isArray(students) ? students : [];
  const used = new Set();
  let changed = false;
  const now = options.now || new Date().toISOString();
  const createId = options.createId || (() => createStudentLoginId());
  const output = input.map((student) => {
    let loginId = normalizeStudentLoginId(student?.loginId || '');
    if (!isValidStudentLoginId(loginId) || used.has(loginId)) {
      do { loginId = normalizeStudentLoginId(createId()); }
      while (!isValidStudentLoginId(loginId) || used.has(loginId));
      changed = true;
    }
    used.add(loginId);
    const loginIdVersion = Number(student?.loginIdVersion || 1);
    const loginIdIssuedAt = String(student?.loginIdIssuedAt || now);
    if (student?.loginId !== loginId || student?.loginIdVersion !== loginIdVersion || student?.loginIdIssuedAt !== loginIdIssuedAt) changed = true;
    return { ...student, loginId, loginIdVersion, loginIdIssuedAt };
  });
  return { students: output, changed };
}

function migrateTerminalDevice(device, validStudentIds = []) {
  const valid = new Set((Array.isArray(validStudentIds) ? validStudentIds : []).map(String));
  const allowed = (Array.isArray(device?.allowedStudentIds) ? device.allowedStudentIds : []).map(String).filter((id) => valid.has(id));
  const inferred = device?.allowedAllStudents || allowed.length !== 1 ? 'shared' : 'personal';
  const terminalMode = normalizeTerminalMode(device?.terminalMode, inferred);
  const requestedBound = String(device?.boundStudentId || (terminalMode === 'personal' ? allowed[0] || '' : ''));
  const boundStudentId = terminalMode === 'personal' && valid.has(requestedBound) ? requestedBound : '';
  return {
    ...device,
    terminalMode,
    boundStudentId,
    capabilities: Array.from(new Set([...(Array.isArray(device?.capabilities) ? device.capabilities : []), 'student-session-v1'])),
    allowedStudentIds: terminalMode === 'personal' && boundStudentId ? [boundStudentId] : [],
    allowedAllStudents: terminalMode === 'shared',
    autoAuthorizeNewStudents: terminalMode === 'shared',
  };
}

function migrateTerminalDevices(devices, validStudentIds = []) {
  const input = Array.isArray(devices) ? devices : [];
  const output = input.map((device) => migrateTerminalDevice(device, validStudentIds));
  return {
    devices: output,
    changed: JSON.stringify(output) !== JSON.stringify(input),
  };
}

function studentLoginQrPayload(loginId) {
  const normalized = normalizeStudentLoginId(loginId);
  if (!isValidStudentLoginId(normalized)) throw new Error('学生登录 ID 格式无效。');
  return JSON.stringify({ type: 'AI_EDU_STUDENT_LOGIN', version: 1, loginId: normalized });
}

module.exports = {
  HOST_USAGE_MODES,
  LOGIN_ALPHABET,
  TERMINAL_MODES,
  createStudentLoginId,
  ensureStudentLoginIds,
  isValidStudentLoginId,
  loginIdChecksum,
  migrateTerminalDevice,
  migrateTerminalDevices,
  normalizeHostUsageMode,
  normalizeStudentLoginId,
  normalizeTerminalMode,
  studentLoginQrPayload,
};
