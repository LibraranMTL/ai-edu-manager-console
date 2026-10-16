'use strict';
const crypto = require('node:crypto');
const intents = require('./agent-write-intents.cjs');
const { CAPABILITIES, authorizeCapability } = require('./agent-capability-contract.cjs');
const { fail } = require('./external-agent-connector.cjs');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function provenance(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['sourceEventId', 'sourceType', 'derivedFrom', 'generatedBy'].includes(k))) throw fail('INVALID_PROVENANCE');
  if (['internal_classification', 'internal_digest', 'internal_routing'].includes(input.sourceType)) throw fail('INTERNAL_FEEDBACK_DENIED');
  if (input.sourceType && !['conversation', 'material', 'capture', 'import', 'derived', 'unknown'].includes(input.sourceType)) throw fail('INVALID_PROVENANCE');
  for (const k of ['sourceEventId', 'generatedBy']) if (input[k] !== undefined && (typeof input[k] !== 'string' || input[k].length > 240)) throw fail('INVALID_PROVENANCE');
  if (input.derivedFrom && (!Array.isArray(input.derivedFrom) || input.derivedFrom.length > 50 || input.derivedFrom.some(x => typeof x !== 'string' || x.length > 240))) throw fail('INVALID_PROVENANCE');
  return { sourceEventId: input.sourceEventId || '', sourceType: input.sourceType || 'unknown', derivedFrom: input.derivedFrom || [], generatedBy: input.generatedBy || 'unknown' };
}
function createExternalWriter({ load, save, authenticate, project, apply, processing = async () => ({ digest: 'unknown', index: 'unverified' }), schedule = async () => {}, verify }) {
  const active = new Map();
  // All mutations merge into the latest ledger. An awaited executor may not save
  // a stale pre-execution snapshot over another operation or a user's decision.
  let queue = Promise.resolve();
  function mutate(fn) {
    const work = queue.then(async () => { const s = load(), value = fn(s); if (value.store) await save(value.store); return value; });
    queue = work.catch(() => {}); return work;
  }
  function check(auth, name, input) {
    const p = input.projectId ? project(input.projectId) : null;
    const result = authorizeCapability(auth, name, input, p);
    if (!result.ok) throw fail(result.code);
    if (result.spec.risk !== 'write') throw fail('WRITE_CAPABILITY_REQUIRED');
    if (p?.status === 'sealed') throw fail('PROJECT_SEALED');
  }
  async function submit(token, body) {
    const auth = authenticate(token, body);
    if (auth.accessMode === 'all_authorized_students' && body.name === 'conversation.submit') throw fail('MULTI_STUDENT_ARCHIVE_DISABLED', '多学生完整对话暂不自动归档；请将学生专属成果作为资料保存并指定 targetStudentId');
    const input = { ...(body.input || {}), studentId: auth.studentId };
    if (body.input?.studentId && body.input.studentId !== auth.studentId) throw fail('STUDENT_SCOPE_DENIED');
    if (!input.projectId && auth.defaultProjectId && body.name !== 'report.draft') input.projectId = auth.defaultProjectId;
    if (body.name === 'conversation.submit') { input.sourceAgent = auth.hostType; input.sessionId = hash([auth.connectionId, auth.sessionId, auth.contextRevision]); }
    check(auth, body.name, input);
    const source = provenance(body.provenance);
    // A source event may be delivered by MCP, capture or import. Never dedupe
    // different students/targets, unrelated content or a derived artifact with its source.
    const sourceClass = source.sourceType === 'derived' ? 'derived' : 'original';
    const eventKey = source.sourceEventId ? hash([auth.connectionId, auth.sessionId, auth.contextRevision, input.studentId, input.projectId || '', body.name, sourceClass, source.sourceEventId]) : '';
    const result = await mutate(s => {
      const existing = eventKey && s.intents.find(x => x.sourceEventKey === eventKey);
      const payloadHash = hash({ name: body.name, input, source: { ...source, sourceType: sourceClass } });
      if (existing) {
        if (existing.payloadHash !== payloadHash) throw fail('SOURCE_EVENT_CONFLICT');
        existing.deliverySources = [...new Set([...(existing.deliverySources || []), source.sourceType])];
        return { ok: true, store: s, intent: existing, reused: true };
      }
      const key = hash(auth.accessMode === 'all_authorized_students' ? [auth.sessionId, auth.contextRevision, input.studentId, body.idempotencyKey] : [auth.sessionId, auth.contextRevision, body.idempotencyKey]);
      if (typeof body.idempotencyKey !== 'string' || !body.idempotencyKey.trim() || body.idempotencyKey.length > 128) throw fail('IDEMPOTENCY_KEY_REQUIRED');
      const r = intents.previewIntent(s, { name: body.name, input, idempotencyKey: key, grantId: auth.connectionId });
      if (!r.ok) throw fail(r.code);
      if (!r.reused) {
        Object.assign(r.intent, { connectionId: auth.connectionId, sessionId: auth.sessionId, contextRevision: auth.contextRevision, policyRevision: auth.policyRevision,
          authorizationEpoch: auth.authorizationEpoch, approvalMode: auth.requireWriteConfirmation ? 'manual' : 'persistent_policy',
          sourceEventKey: eventKey, payloadHash, provenance: { ...source, contentHash: hash(input), receivedAt: new Date().toISOString() },
          deliverySources: [source.sourceType],
          scopeSnapshot: { studentId: auth.studentId, projectId: input.projectId || '', contextRevision: auth.contextRevision } });
        if (!auth.requireWriteConfirmation) intents.approveIntent(r.store, r.intent.id, r.intent.inputDigest);
      } else if (r.intent.payloadHash !== payloadHash) throw fail('IDEMPOTENCY_CONFLICT');
      return r;
    });
    if (result.intent.status === 'pending_approval') return { ok: true, intent: intents.publicIntent(result.intent), approvalRequired: true };
    return execute(token, { ...body, intentId: result.intent.id });
  }
  async function status(token, body) {
    const intent = load().intents.find(x => x.id === body.intentId);
    if (!intent?.connectionId) throw fail('INTENT_NOT_FOUND');
    authenticate(token, body, intent, true);
    let stage = { saved: false, digest: 'not_started', index: 'not_started' };
    if (intent.status === 'completed') {
      try { stage = await processing(intent); } catch (e) { stage = { saved: true, digest: 'unavailable', index: 'unverified', error: e.code || 'PROCESSING_STATUS_UNAVAILABLE' }; }
    }
    return { ok: true, intent: intents.publicIntent(intent), processing: stage };
  }
  async function execute(token, body) {
    if (active.has(body.intentId)) { await active.get(body.intentId); return status(token, body); }
    const work = (async () => {
      const begun = await mutate(s => {
        const intent = s.intents.find(x => x.id === body.intentId);
        if (!intent?.connectionId) throw fail('INTENT_NOT_FOUND');
        const auth = authenticate(token, body, intent, intent.status === 'completed');
        if (intent.status === 'completed') return { intent, duplicate: true };
        check(auth, intent.name, intent.input);
        if (auth.requireWriteConfirmation && intent.approvalMode === 'persistent_policy' && !['executing', 'recoverable'].includes(intent.status)) {
          intent.status = 'pending_approval'; intent.approvalMode = 'manual'; return { store: s, intent, approvalRequired: true };
        }
        if (intent.status === 'executing') intents.recoverExecution(s, intent.id);
        const r = intents.beginExecution(s, intent.id, auth.connectionId);
        if (!r.ok) throw fail(r.code);
        return r;
      });
      if (begun.duplicate || begun.approvalRequired) return;
      // Recheck after durable registration and before the first business side effect.
      try {
        authenticate(token, body, begun.intent);
        const result = await apply(begun.intent);
        await mutate(s => {
          const receipt = { intentId: begun.intent.id, studentId: begun.intent.studentId, projectId: begun.intent.projectId, at: new Date().toISOString(), result };
          const r = intents.finishExecution(s, begun.intent.id, receipt); if (!r.ok) throw fail(r.code); return r;
        });
        // Downstream failure does not rerun the already committed write.
        try { authenticate(token, body, begun.intent, true); await schedule(begun.intent); } catch { /* status/retryProcessing exposes the downstream stage */ }
      } catch (e) {
        await mutate(s => { const r = intents.recoverExecution(s, begun.intent.id); return r.ok ? r : {}; });
        throw e;
      }
    })();
    active.set(body.intentId, work);
    try { await work; return status(token, body); } finally { active.delete(body.intentId); }
  }
  async function retryProcessing(token, body) {
    const state = await status(token, body);
    if (state.intent.status !== 'completed') throw fail('WRITE_NOT_COMPLETED');
    const intent = load().intents.find(x => x.id === body.intentId);
    authenticate(token, body, intent, true);
    await schedule(intent); return status(token, body);
  }
  async function verifyIndex(token, body) {
    const intent = load().intents.find(x => x.id === body.intentId);
    if (!intent?.connectionId || intent.status !== 'completed') throw fail('WRITE_NOT_COMPLETED');
    const auth = authenticate(token, body, intent, true);
    if (!auth.capabilities.includes('knowledge:query')) throw fail('CAPABILITY_DENIED');
    if (!verify || typeof body.question !== 'string' || !body.question.trim() || body.question.length > 2000) throw fail('VERIFICATION_QUESTION_REQUIRED');
    const result = await verify(intent, auth, body.question);
    await mutate(s => { s.intents.find(i => i.id === intent.id).indexVerification = result; return { store: s }; });
    return status(token, body);
  }
  return { submit, execute, status, retryProcessing, verifyIndex };
}
module.exports = { createExternalWriter, provenance };
