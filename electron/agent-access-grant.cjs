const crypto = require('crypto');

const AGENT_ACCESS_GRANT_SCHEMA = 'edu-manager.agent-access-grants.v1';
const AGENT_ACCESS_TOKEN_PREFIX = 'eak_';

function boundedId(value, limit = 240) {
  return String(value || '').trim().slice(0, limit);
}

function uniqueIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => boundedId(value)).filter(Boolean))];
}

function hashAgentAccessToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function normalizeAgentAccessGrantStore(value = {}) {
  const grants = Array.isArray(value.grants) ? value.grants : [];
  return {
    schema: AGENT_ACCESS_GRANT_SCHEMA,
    updatedAt: boundedId(value.updatedAt, 80),
    disabledStudentIds: uniqueIds(value.disabledStudentIds),
    grants: grants
      .map((grant) => ({
        grantId: boundedId(grant?.grantId),
        tokenHash: boundedId(grant?.tokenHash, 128),
        studentId: boundedId(grant?.studentId),
        allowedStudentIds: uniqueIds(grant?.allowedStudentIds),
        allowedProjectIds: uniqueIds(grant?.allowedProjectIds),
        capabilities: uniqueIds(grant?.capabilities),
        issuedAt: boundedId(grant?.issuedAt, 80),
        updatedAt: boundedId(grant?.updatedAt, 80),
        revokedAt: boundedId(grant?.revokedAt, 80),
      }))
      .filter((grant) => grant.grantId && grant.tokenHash && grant.studentId),
  };
}

function timingSafeHashEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function resolveAgentAccessGrant(storeValue, token) {
  const rawToken = String(token || '').trim();
  if (!rawToken.startsWith(AGENT_ACCESS_TOKEN_PREFIX)) return null;
  const tokenHash = hashAgentAccessToken(rawToken);
  const store = normalizeAgentAccessGrantStore(storeValue);
  const grant = store.grants.find((item) => !item.revokedAt && timingSafeHashEqual(item.tokenHash, tokenHash));
  if (!grant || store.disabledStudentIds.includes(grant.studentId)) return null;
  return {
    type: 'agent_grant',
    grantId: grant.grantId,
    studentId: grant.studentId,
    allowedStudentIds: grant.allowedStudentIds.length ? grant.allowedStudentIds : [grant.studentId],
    allowedProjectIds: grant.allowedProjectIds,
    capabilities: grant.capabilities,
    allowedAllStudents: false,
  };
}

function issueAgentAccessGrant(storeValue, options = {}) {
  const studentId = boundedId(options.studentId);
  if (!studentId) throw new Error('studentId is required for an Agent access grant.');
  const now = boundedId(options.now || new Date().toISOString(), 80);
  const allowedProjectIds = uniqueIds(options.allowedProjectIds);
  const requestedCapabilities = uniqueIds(options.capabilities || [
    'knowledge:query',
    'conversation:submit',
    'memory:read',
    'memory:write',
    'handoff:manage',
  ]);
  const store = normalizeAgentAccessGrantStore(storeValue);
  if (store.disabledStudentIds.includes(studentId) && !options.reauthorize) throw new Error('Agent access revoked for this student. Explicit reauthorization is required.');
  const existingToken = String(options.existingToken || '').trim();
  const existing = existingToken.startsWith(AGENT_ACCESS_TOKEN_PREFIX)
    ? store.grants.find((item) => (
      !item.revokedAt
      && item.studentId === studentId
      && timingSafeHashEqual(item.tokenHash, hashAgentAccessToken(existingToken))
    ))
    : null;
  const capabilities = existing && !options.capabilities ? existing.capabilities : requestedCapabilities;
  const token = existing
    ? existingToken
    : `${AGENT_ACCESS_TOKEN_PREFIX}${(options.randomBytes || crypto.randomBytes)(32).toString('hex')}`;
  const grantId = existing?.grantId || `agent-grant-${(options.randomUUID || crypto.randomUUID)()}`;
  const nextGrant = {
    grantId,
    tokenHash: hashAgentAccessToken(token),
    studentId,
    allowedStudentIds: [studentId],
    allowedProjectIds,
    capabilities,
    issuedAt: existing?.issuedAt || now,
    updatedAt: now,
    revokedAt: '',
  };
  const grants = store.grants
    .filter((item) => item.grantId !== grantId && item.studentId !== studentId)
    .concat(nextGrant)
    .slice(-500);
  return {
    token,
    grant: nextGrant,
    store: { schema: AGENT_ACCESS_GRANT_SCHEMA, updatedAt: now, disabledStudentIds: store.disabledStudentIds.filter((id) => id !== studentId), grants },
    reused: Boolean(existing),
  };
}

function revokeAgentAccessGrant(storeValue, studentId, now = new Date().toISOString()) {
  const id = boundedId(studentId);
  if (!id) throw new Error('studentId is required.');
  const store = normalizeAgentAccessGrantStore(storeValue);
  return { ...store, updatedAt: now, disabledStudentIds: uniqueIds([...store.disabledStudentIds, id]), grants: store.grants.map((grant) => grant.studentId === id ? { ...grant, revokedAt: now, updatedAt: now } : grant) };
}

module.exports = {
  AGENT_ACCESS_GRANT_SCHEMA,
  AGENT_ACCESS_TOKEN_PREFIX,
  hashAgentAccessToken,
  issueAgentAccessGrant,
  normalizeAgentAccessGrantStore,
  resolveAgentAccessGrant,
  revokeAgentAccessGrant,
};
