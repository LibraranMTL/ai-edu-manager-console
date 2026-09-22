const crypto = require('crypto');

const WRITE_INTENT_SCHEMA = 'edu-manager.agent-write-intents.v1';
const WRITE_NAMES = new Set(['conversation.submit', 'material.upload', 'task.create', 'report.draft']);

function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function normalizeStore(value = {}) { return { schema: WRITE_INTENT_SCHEMA, intents: Array.isArray(value.intents) ? value.intents : [] }; }

function validateWriteInput(name, input) {
  if (!WRITE_NAMES.has(name) || !input || typeof input !== 'object' || Array.isArray(input)) return 'INVALID_INPUT';
  if (typeof input.studentId !== 'string' || !input.studentId.trim()) return 'INVALID_INPUT';
  if (input.projectId !== undefined && (typeof input.projectId !== 'string' || !input.projectId.trim())) return 'INVALID_INPUT';
  const allowed = {
    'conversation.submit': ['studentId', 'projectId', 'messages', 'sourceAgent', 'title', 'sessionId'],
    'material.upload': ['studentId', 'projectId', 'filename', 'contentBase64'],
    'task.create': ['studentId', 'projectId', 'title', 'detail'],
    'report.draft': ['studentId', 'reportId', 'content'],
  };
  if (Object.keys(input).some((key) => !allowed[name].includes(key))) return 'INVALID_INPUT';
  if (name === 'conversation.submit') {
    if (!Array.isArray(input.messages) || input.messages.length < 1 || input.messages.length > 100
      || input.messages.some((item) => !['user', 'assistant'].includes(item?.role) || typeof item.content !== 'string' || !item.content.trim() || item.content.length > 20_000)) return 'INVALID_INPUT';
    if (JSON.stringify(input.messages).length > 500_000 || input.attachments || input.targetNodeId) return 'INVALID_INPUT';
  }
  if (name === 'material.upload') {
    if (typeof input.filename !== 'string' || !input.filename.trim() || input.filename.length > 240
      || typeof input.contentBase64 !== 'string' || input.contentBase64.length > 2_800_000
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.contentBase64)) return 'INVALID_INPUT';
  }
  if (name === 'task.create' && (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 240 || typeof input.detail !== 'string' || input.detail.length > 2000)) return 'INVALID_INPUT';
  if (name === 'report.draft' && (typeof input.reportId !== 'string' || !input.reportId.trim() || typeof input.content !== 'string' || !input.content.trim() || input.content.length > 64 * 1024)) return 'INVALID_INPUT';
  return '';
}

function previewIntent(storeValue, { name, input, idempotencyKey, grantId }, now = new Date().toISOString()) {
  const error = validateWriteInput(name, input);
  if (error) return { ok: false, code: error };
  if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 128 || !grantId) return { ok: false, code: 'IDEMPOTENCY_KEY_REQUIRED' };
  const store = normalizeStore(storeValue);
  const inputDigest = digest({ name, input });
  const existing = store.intents.find((item) => item.grantId === grantId && item.idempotencyKey === idempotencyKey);
  if (existing) return existing.inputDigest === inputDigest ? { ok: true, store, intent: existing, reused: true } : { ok: false, code: 'IDEMPOTENCY_CONFLICT' };
  const pending = store.intents.filter((item) => item.status !== 'completed' && Date.parse(item.expiresAt) > Date.parse(now));
  if (pending.length >= 20 || pending.reduce((sum, item) => sum + JSON.stringify(item.input || {}).length, 0) + JSON.stringify(input).length > 20 * 1024 * 1024) return { ok: false, code: 'PENDING_INTENT_LIMIT' };
  const intent = { id: `agent-intent-${crypto.randomUUID()}`, schema: WRITE_INTENT_SCHEMA, name, input, inputDigest, idempotencyKey, grantId, studentId: input.studentId, projectId: input.projectId || '', status: 'pending_approval', createdAt: now, expiresAt: new Date(Date.parse(now) + 24 * 60 * 60 * 1000).toISOString(), approvedAt: '', executedAt: '', receipt: null };
  return { ok: true, store: { ...store, intents: [...store.intents.filter((item) => item.status !== 'pending_approval' || Date.parse(item.expiresAt) > Date.parse(now)), intent].slice(-500) }, intent, reused: false };
}

function approveIntent(storeValue, id, expectedDigest, now = new Date().toISOString()) {
  const store = normalizeStore(storeValue);
  const intent = store.intents.find((item) => item.id === id);
  if (!intent) return { ok: false, code: 'INTENT_NOT_FOUND' };
  if (intent.inputDigest !== expectedDigest) return { ok: false, code: 'INTENT_DIGEST_MISMATCH' };
  if (Date.parse(intent.expiresAt) <= Date.parse(now)) return { ok: false, code: 'INTENT_EXPIRED' };
  if (!['pending_approval', 'approved'].includes(intent.status)) return { ok: false, code: 'INTENT_STATE_INVALID' };
  intent.status = 'approved';
  intent.approvedAt = intent.approvedAt || now;
  return { ok: true, store, intent };
}

function rejectIntent(storeValue, id, expectedDigest, now = new Date().toISOString()) {
  const store = normalizeStore(storeValue);
  const intent = store.intents.find((item) => item.id === id);
  if (!intent) return { ok: false, code: 'INTENT_NOT_FOUND' };
  if (intent.inputDigest !== expectedDigest) return { ok: false, code: 'INTENT_DIGEST_MISMATCH' };
  if (intent.status !== 'pending_approval' && intent.status !== 'approved') return { ok: false, code: 'INTENT_STATE_INVALID' };
  intent.status = 'rejected';
  intent.rejectedAt = now;
  intent.input = null;
  return { ok: true, store, intent };
}

function beginExecution(storeValue, id, grantId, now = new Date().toISOString()) {
  const store = normalizeStore(storeValue);
  const intent = store.intents.find((item) => item.id === id);
  if (!intent) return { ok: false, code: 'INTENT_NOT_FOUND' };
  if (intent.grantId !== grantId) return { ok: false, code: 'INTENT_SCOPE_DENIED' };
  if (intent.status === 'completed') return { ok: true, store, intent, duplicate: true };
  if (Date.parse(intent.expiresAt) <= Date.parse(now)) return { ok: false, code: 'INTENT_EXPIRED' };
  if (!['approved', 'recoverable'].includes(intent.status)) return { ok: false, code: 'INTENT_NOT_APPROVED' };
  intent.status = 'executing';
  return { ok: true, store, intent, duplicate: false };
}

function finishExecution(storeValue, id, receipt, now = new Date().toISOString()) {
  const store = normalizeStore(storeValue);
  const intent = store.intents.find((item) => item.id === id);
  if (!intent || intent.status !== 'executing') return { ok: false, code: 'INTENT_STATE_INVALID' };
  intent.status = 'completed';
  intent.executedAt = now;
  intent.receipt = receipt;
  intent.input = null;
  return { ok: true, store, intent };
}

function recoverExecution(storeValue, id) {
  const store = normalizeStore(storeValue);
  const intent = store.intents.find((item) => item.id === id);
  if (!intent || intent.status !== 'executing') return { ok: false, code: 'INTENT_STATE_INVALID' };
  intent.status = 'recoverable';
  return { ok: true, store, intent };
}

function expireIntents(storeValue, now = new Date().toISOString()) {
  const store = normalizeStore(storeValue);
  let changed = false;
  for (const intent of store.intents) {
    if (!['completed', 'rejected', 'expired'].includes(intent.status) && Date.parse(intent.expiresAt) <= Date.parse(now)) {
      intent.status = 'expired';
      intent.input = null;
      changed = true;
    }
  }
  return { store, changed };
}

function publicIntent(intent) {
  if (!intent) return null;
  const { input, ...safe } = intent;
  return { ...safe, preview: { name: intent.name, studentId: intent.studentId, projectId: intent.projectId, ...(intent.name === 'conversation.submit' ? { messageCount: input?.messages?.length || 0 } : {}), ...(intent.name === 'material.upload' ? { filename: input?.filename || '', bytes: input?.contentBase64 ? Buffer.from(input.contentBase64, 'base64').length : 0 } : {}), ...(intent.name === 'task.create' ? { title: input?.title || '' } : {}), ...(intent.name === 'report.draft' ? { reportId: input?.reportId || '' } : {}) } };
}

module.exports = { WRITE_INTENT_SCHEMA, WRITE_NAMES, normalizeStore, validateWriteInput, previewIntent, approveIntent, rejectIntent, beginExecution, finishExecution, recoverExecution, expireIntents, publicIntent };
