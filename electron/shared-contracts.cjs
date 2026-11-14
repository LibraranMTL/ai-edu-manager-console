'use strict';

const crypto = require('node:crypto');

const CONTRACT_VERSION = 'edu.shared-contracts.v1';
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;
const FIELD_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/;
const EVIDENCE_AVAILABILITY = new Set(['active', 'withdrawn', 'corrected', 'invalid', 'missing', 'forbidden']);
const READER_ROLES = new Set(['student', 'teacher', 'parent', 'manager', 'system']);
const CORRECTION_ACTIONS = new Set(['correct', 'withdraw']);

function contractError(code, message) {
  return Object.assign(new Error(message), { code });
}

function requiredId(value, field) {
  const result = String(value || '').trim();
  if (!ID_PATTERN.test(result)) throw contractError('shared_contract_invalid', `${field} 无效。`);
  return result;
}

function optionalId(value, field) {
  if (value == null || value === '') return undefined;
  return requiredId(value, field);
}

function uniqueIds(value, field) {
  if (!Array.isArray(value)) throw contractError('shared_contract_invalid', `${field} 必须是数组。`);
  return [...new Set(value.map((item) => requiredId(item, field)))].sort();
}

function positiveRevision(value, field, { allowZero = false } = {}) {
  const result = Number(value);
  const minimum = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(result) || result < minimum) {
    throw contractError('shared_contract_invalid', `${field} 必须是${allowZero ? '非负' : '正'}整数。`);
  }
  return result;
}

function isoTimestamp(value, field) {
  const result = String(value || '').trim();
  if (!result || !Number.isFinite(Date.parse(result))) throw contractError('shared_contract_invalid', `${field} 必须是有效时间。`);
  return result;
}

function timezone(value) {
  const result = String(value || '').trim();
  try { new Intl.DateTimeFormat('zh-CN', { timeZone: result }).format(new Date(0)); }
  catch { throw contractError('shared_contract_invalid', 'timezone 必须是有效 IANA 时区。'); }
  return result;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function subjectScope(input = {}) {
  const studentIds = uniqueIds(input.studentIds || (input.studentId ? [input.studentId] : []), 'studentIds');
  const projectId = optionalId(input.projectId, 'projectId');
  if (!studentIds.length && !projectId) throw contractError('subject_scope_required', '主体范围必须包含学生或项目。');
  return deepFreeze({
    schema: CONTRACT_VERSION,
    kind: 'SubjectScope',
    actorId: requiredId(input.actorId, 'actorId'),
    actorRole: requiredId(input.actorRole, 'actorRole'),
    studentIds,
    projectId,
    deviceId: optionalId(input.deviceId, 'deviceId'),
  });
}

function evidenceRef(input = {}) {
  const availability = String(input.availability || 'active');
  if (!EVIDENCE_AVAILABILITY.has(availability)) throw contractError('shared_contract_invalid', 'availability 无效。');
  const contentHash = String(input.contentHash || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(contentHash)) throw contractError('shared_contract_invalid', 'contentHash 必须是 SHA-256。');
  return deepFreeze({
    schema: CONTRACT_VERSION,
    kind: 'EvidenceRef',
    sourceType: requiredId(input.sourceType, 'sourceType'),
    sourceId: requiredId(input.sourceId, 'sourceId'),
    revision: positiveRevision(input.revision, 'revision'),
    contentHash,
    availability,
    usable: availability === 'active',
  });
}

function asOfContext(input = {}) {
  return deepFreeze({
    schema: CONTRACT_VERSION,
    kind: 'AsOfContext',
    asOf: isoTimestamp(input.asOf, 'asOf'),
    timezone: timezone(input.timezone),
    policyVersion: requiredId(input.policyVersion, 'policyVersion'),
    dataGeneration: positiveRevision(input.dataGeneration, 'dataGeneration', { allowZero: true }),
    authorizationVersion: positiveRevision(input.authorizationVersion, 'authorizationVersion', { allowZero: true }),
  });
}

function accessProjection(input = {}) {
  const role = String(input.role || '').trim();
  if (!READER_ROLES.has(role)) throw contractError('shared_contract_invalid', 'reader role 无效。');
  const allowedFields = [...new Set((Array.isArray(input.allowedFields) ? input.allowedFields : []).map((field) => String(field || '').trim()))].sort();
  if (allowedFields.some((field) => !FIELD_PATTERN.test(field))) throw contractError('shared_contract_invalid', 'allowedFields 包含无效字段。');
  return deepFreeze({
    schema: CONTRACT_VERSION,
    kind: 'AccessProjection',
    readerId: requiredId(input.readerId || input.id, 'readerId'),
    role,
    allowedStudentIds: uniqueIds(input.allowedStudentIds || [], 'allowedStudentIds'),
    allowedFields,
    authorizationVersion: positiveRevision(input.authorizationVersion, 'authorizationVersion', { allowZero: true }),
  });
}

function assertProjectionCanRead(projection, request = {}) {
  const reader = projection?.kind === 'AccessProjection' ? projection : accessProjection(projection);
  const studentId = requiredId(request.studentId, 'studentId');
  const field = String(request.field || '').trim();
  if (!reader.allowedStudentIds.includes(studentId) || !reader.allowedFields.includes(field)) {
    throw contractError('subject_scope_forbidden', '当前读者无权读取该学生或字段。');
  }
  return true;
}

function canonicalPart(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalPart).join(',')}]`;
  if (typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalPart(value[key])}`).join(',')}}`;
  throw contractError('shared_contract_invalid', '提交键包含不支持的值。');
}

function stableCommitKey(namespace, parts) {
  const prefix = requiredId(namespace, 'namespace');
  if (!Array.isArray(parts) || !parts.length) throw contractError('shared_contract_invalid', '提交键至少需要一个稳定组成部分。');
  const digest = crypto.createHash('sha256').update(canonicalPart(parts)).digest('hex');
  return `${prefix}:${digest}`;
}

function correctionRecord(input = {}) {
  const action = String(input.action || '');
  if (!CORRECTION_ACTIONS.has(action)) throw contractError('shared_contract_invalid', '更正动作无效。');
  const reason = String(input.reason || '').trim();
  if (!reason) throw contractError('shared_contract_invalid', '更正或撤回必须说明原因。');
  const commitKey = String(input.commitKey || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}:[a-f0-9]{64}$/.test(commitKey)) {
    throw contractError('shared_contract_invalid', 'commitKey 无效。');
  }
  return deepFreeze({
    schema: CONTRACT_VERSION,
    kind: 'CorrectionRecord',
    objectType: requiredId(input.objectType, 'objectType'),
    objectId: requiredId(input.objectId, 'objectId'),
    expectedRevision: positiveRevision(input.expectedRevision, 'expectedRevision'),
    action,
    reason,
    actorId: requiredId(input.actorId, 'actorId'),
    createdAt: isoTimestamp(input.createdAt, 'createdAt'),
    commitKey,
  });
}

function shouldAcceptGeneration(currentGeneration, incomingGeneration) {
  const current = positiveRevision(currentGeneration, 'currentGeneration', { allowZero: true });
  const incoming = positiveRevision(incomingGeneration, 'incomingGeneration', { allowZero: true });
  return incoming >= current;
}

module.exports = {
  CONTRACT_VERSION,
  subjectScope,
  evidenceRef,
  asOfContext,
  accessProjection,
  assertProjectionCanRead,
  stableCommitKey,
  correctionRecord,
  shouldAcceptGeneration,
};
