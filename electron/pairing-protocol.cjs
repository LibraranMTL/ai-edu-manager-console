const crypto = require('crypto');

const PAIR_PROTOCOL_VERSION = 2;
const PAIR_REQUEST_TTL_MS = 2 * 60 * 1000;
const MACHINE_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const TERMINAL_PAIR_STATUSES = new Set(['accepted', 'rejected', 'cancelled', 'expired']);

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function machineCode(role, deviceId) {
  const prefix = role === 'tablet' ? 'T' : 'H';
  const digest = crypto.createHash('sha256').update(`${role}:${String(deviceId || '')}`).digest();
  let body = '';
  for (let index = 0; body.length < 8; index += 1) {
    body += MACHINE_CODE_ALPHABET[digest[index % digest.length] % MACHINE_CODE_ALPHABET.length];
  }
  return `${prefix}-${body.slice(0, 4)}-${body.slice(4, 8)}`;
}

function createRequestToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function createPairRequest(input = {}, nowMs = Date.now()) {
  const initiator = input.initiator === 'host' ? 'host' : 'tablet';
  const requestToken = input.requestToken || createRequestToken();
  const requestId = input.requestId || `pair-${crypto.randomUUID()}`;
  const createdAt = new Date(nowMs).toISOString();
  return {
    requestToken,
    record: {
      requestId,
      requestTokenHash: sha256(requestToken),
      initiator,
      hostId: String(input.hostId || ''),
      tabletId: String(input.tabletId || ''),
      hostMachineCode: String(input.hostMachineCode || ''),
      tabletMachineCode: String(input.tabletMachineCode || ''),
      hostName: String(input.hostName || '').slice(0, 80),
      tabletName: String(input.tabletName || '').slice(0, 80),
      tabletPlatform: String(input.tabletPlatform || ''),
      tabletCapabilities: Array.isArray(input.tabletCapabilities) ? input.tabletCapabilities.map(String).slice(0, 20) : [],
      hostAddress: String(input.hostAddress || ''),
      tabletAddress: String(input.tabletAddress || ''),
      status: initiator === 'host' ? 'pending_tablet_accept' : 'pending_host_accept',
      createdAt,
      updatedAt: createdAt,
      expiresAt: new Date(nowMs + PAIR_REQUEST_TTL_MS).toISOString(),
    },
  };
}

function requestExpired(request, nowMs = Date.now()) {
  const expiresAt = Date.parse(String(request?.expiresAt || ''));
  return !Number.isFinite(expiresAt) || expiresAt <= nowMs;
}

function normalizePairRequest(request, nowMs = Date.now()) {
  if (!request || typeof request !== 'object') return null;
  if (!TERMINAL_PAIR_STATUSES.has(request.status) && requestExpired(request, nowMs)) {
    return { ...request, status: 'expired', updatedAt: new Date(nowMs).toISOString() };
  }
  return request;
}

function verifyRequestToken(request, requestToken) {
  const expected = Buffer.from(String(request?.requestTokenHash || ''), 'utf8');
  const actual = Buffer.from(sha256(requestToken), 'utf8');
  return expected.length > 0 && expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function nextPairRequestStatus(request, action, nowMs = Date.now()) {
  const current = normalizePairRequest(request, nowMs);
  if (!current) return { ok: false, message: 'Pair request was not found.' };
  if (current.status === 'expired') return { ok: false, request: current, message: 'Pair request has expired.' };
  if (TERMINAL_PAIR_STATUSES.has(current.status)) {
    return { ok: false, request: current, message: `Pair request already ended (${current.status}).` };
  }
  if (!['accept', 'reject', 'cancel'].includes(action)) {
    return { ok: false, request: current, message: 'This action is not allowed in the current state.' };
  }
  const status = action === 'accept' ? 'accepted' : action === 'reject' ? 'rejected' : 'cancelled';
  return {
    ok: true,
    request: {
      ...current,
      status,
      updatedAt: new Date(nowMs).toISOString(),
      [`${status}At`]: new Date(nowMs).toISOString(),
    },
  };
}

function machineCodeConflict(devices, role, deviceId, code) {
  const normalizedId = String(deviceId || '');
  const normalizedCode = String(code || '').toUpperCase();
  return (Array.isArray(devices) ? devices : []).find((device) => {
    const storedCode = String(device.machineCode || machineCode(role, device.id)).toUpperCase();
    return storedCode === normalizedCode && String(device.id || '') !== normalizedId;
  }) || null;
}

module.exports = {
  PAIR_PROTOCOL_VERSION,
  PAIR_REQUEST_TTL_MS,
  createPairRequest,
  createRequestToken,
  machineCode,
  machineCodeConflict,
  nextPairRequestStatus,
  normalizePairRequest,
  requestExpired,
  sha256,
  verifyRequestToken,
};
