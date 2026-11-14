'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const { createConnectorStore, PRESETS, PERMISSIONS, restrictions } = require('../electron/external-agent-connector.cjs');
const { createExternalWriter } = require('../electron/external-agent-writes.cjs');
const { createExternalGateway } = require('../electron/external-agent-host.cjs');
const { createAgentMemoryStore } = require('../electron/agent-memory-v1.cjs');
const { agentKnowledgeScopePlan, authorizeCapability } = require('../electron/agent-capability-contract.cjs');
const { toolDefinitions } = require('../electron/external-agent-mcp.cjs');
const intents = require('../electron/agent-write-intents.cjs');
const { writeJsonAtomic } = require('../electron/project-materials.cjs');

async function fixture(t, multiple = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-r21-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const students = [{ id: 's1', name: '合成甲' }, ...(multiple ? [{ id: 's2', name: '合成乙' }] : [])];
  const projects = [{ id: 'p1', studentIds: ['s1'] }, { id: 'p2', studentIds: ['s1'] }, { id: 'shared', studentIds: ['s1', 's2'] }, { id: 'other', studentIds: ['s2'] }];
  const file = path.join(root, 'auth.json'), ledger = path.join(root, 'intents.json');
  const connectors = createConnectorStore(file, { students: () => students, projects: () => projects });
  const savePolicy = extra => connectors.action('savePolicy', { preset: 'full', revision: connectors.read().policy.revision, confirmed: true, ...extra });
  await savePolicy();
  const connection = await connectors.action('createConnection', { label: '合成 WorkBuddy', hostType: 'workbuddy' });
  const second = await connectors.action('createConnection', { label: '合成 Codex', hostType: 'codex' });
  const session = await connectors.open(connection.token, 'chat-a');
  const load = () => fs.existsSync(ledger) ? JSON.parse(fs.readFileSync(ledger, 'utf8')) : { schema: intents.WRITE_INTENT_SCHEMA, intents: [] };
  let calls = 0, schedules = 0, applyOverride;
  const writerArgs = { load, save: s => writeJsonAtomic(ledger, s),
    authenticate: (token, body, intent, readOnly) => intent ? connectors.resolveOperation(token, body, intent, readOnly) : connectors.resolve(token, body.sessionId, body.contextRevision, body.targetStudentId),
    project: id => projects.find(p => p.id === id),
    apply: async intent => { calls++; if (applyOverride) return applyOverride(intent);
      const target = path.join(root, intent.id + '.txt');
      if (!fs.existsSync(target)) fs.writeFileSync(target, JSON.stringify(intent.input), { flag: 'wx' });
      return { materialId: intent.id, status: 'stored' }; },
    schedule: async () => { schedules++; }, processing: async intent => ({ saved: true, digest: 'pending', index: 'not_started', receiptId: intent.id }) };
  const writer = createExternalWriter(writerArgs), memory = createAgentMemoryStore({ rootDir: path.join(root, 'memory') });
  const gateway = createExternalGateway({ connectors, writer, memory: () => memory, projects: () => projects, invoke: async (req, name, input) => ({ ...authorizeCapability(req.authContext, name, input, projects.find(p => p.id === input.projectId)), auth: req.authContext }) });
  const body = (key = 'event1', extra = {}) => ({ action: 'submit', name: 'material.upload', sessionId: 'chat-a', contextRevision: session.contextRevision, idempotencyKey: key, input: { filename: '合成.txt', contentBase64: Buffer.from('synthetic only').toString('base64') }, ...extra });
  return { root, file, ledger, students, projects, connectors, connection, second, session, savePolicy, writer, writerArgs, load, body, gateway, memory,
    calls: () => calls, schedules: () => schedules, setApply: fn => { applyOverride = fn; } };
}
const rejects = (promise, code) => assert.rejects(promise, e => e.code === code);

test('delete revoked connection requires consent and preserves data, receipts, other sessions and revocation', async t => {
  const f = await fixture(t), { connectionId } = f.connection;
  await f.connectors.open(f.second.token, 'other-chat');
  await f.gateway(f.connection.token, f.body());
  const ledger = fs.readFileSync(f.ledger, 'utf8');
  const input = { connectionId, confirmed: true };
  await rejects(f.connectors.action('deleteConnection', input), 'CONNECTION_NOT_REVOKED');
  await f.connectors.action('connection', { connectionId, status: 'disabled' });
  await rejects(f.connectors.action('deleteConnection', input), 'CONNECTION_NOT_REVOKED');
  await f.connectors.action('connection', { connectionId, status: 'revoked' });
  await rejects(f.connectors.action('deleteConnection', { connectionId }), 'CONSENT_REQUIRED');
  await f.connectors.action('deleteConnection', input);
  assert.equal(f.connectors.auth(f.connection.token), null);
  await assert.rejects(f.connectors.open(f.connection.token, 'chat-a'));
  assert.equal(f.connectors.snapshot().connections.length, 1);
  assert.ok(f.connectors.snapshot().sessions.every(s => s.connectionId === f.second.connectionId));
  assert.equal(f.connectors.auth(f.second.token, 'other-chat').studentId, 's1');
  assert.equal(fs.readFileSync(f.ledger, 'utf8'), ledger);
  assert.ok(f.connectors.read().history.some(h => h.action === 'deleteConnection' && h.connectionId === connectionId));
  const fresh = await f.connectors.action('createConnection', { label: 'new', hostType: 'workbuddy' });
  assert.notEqual(fresh.connectionId, connectionId); assert.equal(f.connectors.auth(f.connection.token), null);
  await rejects(f.connectors.action('deleteConnection', input), 'CONNECTION_NOT_FOUND');
});

test('R21 read inputs: omission and empty objects work; malformed inputs and mismatched capability fields fail closed', async t => {
  const f = await fixture(t, true); await f.savePolicy({ accessMode: 'all_authorized_students' });
  const s = await f.connectors.open(f.connection.token, 'read-inputs');
  const base = { sessionId: s.sessionId, contextRevision: s.contextRevision };
  for (const name of ['student.overview', 'report.list', 'archive.list', 'task.status']) {
    for (const input of [undefined, {}]) {
      assert.equal((await f.gateway(f.connection.token, { ...base, action: 'invoke', targetStudentId: 's1', name, input })).ok, true);
      const r = await f.gateway(f.connection.token, { ...base, action: 'queryMany', studentIds: ['s1', 's2'], name, input });
      assert.equal(r.results.length, 2); assert.ok(r.results.every(v => v.result.ok));
    }
    for (const input of [null, [], '', 0, false, { question: 'not accepted here' }, { unrecognized: 'x' }, { toString: 'x' }, { constructor: 'x' }, JSON.parse('{"__proto__":"x"}')])
      await rejects(f.gateway(f.connection.token, { ...base, action: 'queryMany', studentIds: 'all', name, input }), 'INVALID_INPUT');
  }
  await rejects(f.gateway(f.connection.token, { ...base, action: 'invoke', targetStudentId: 's1', name: 'knowledge.query' }), 'INVALID_INPUT');
  await rejects(f.gateway(f.connection.token, { ...base, action: 'queryMany', studentIds: 'all', name: 'knowledge.query', input: {} }), 'INVALID_INPUT');
  for (const input of [{ studentId: '' }, { projectId: '' }])
    await rejects(f.gateway(f.connection.token, { ...base, action: 'queryMany', studentIds: 'all', name: 'student.overview', input }), 'AMBIGUOUS_STUDENT_SCOPE');
  await rejects(f.gateway(f.connection.token, { ...base, action: 'invoke', targetStudentId: 's1', name: 'student.overview', input: { studentId: 's2' } }), 'STUDENT_SCOPE_DENIED');
  await rejects(f.gateway(f.connection.token, { ...base, action: 'invoke', name: 'student.overview' }), 'TARGET_STUDENT_REQUIRED');
  await rejects(f.gateway(f.connection.token, { ...base, action: 'queryMany', studentIds: ['not-authorized'], name: 'student.overview' }), 'STUDENT_SCOPE_DENIED');
});

test('R21 schemas expose capability-specific multi-query inputs and direct report workflow', () => {
  const tools = toolDefinitions(PRESETS.full), tool = name => tools.find(t => t.name === name);
  for (const name of ['education_student_overview', 'education_report_list', 'education_archive_list', 'get_education_task_status']) {
    assert.ok(!tool(name).inputSchema.required.includes('input')); assert.equal(tool(name).annotations.readOnlyHint, true);
  }
  for (const name of ['education_knowledge_query', 'education_report_read', 'education_material_upload']) assert.ok(tool(name).inputSchema.required.includes('input'));
  assert.equal(tool('education_material_upload').annotations, undefined);
  const branches = tool('education_query_students').inputSchema.oneOf;
  for (const n of ['student.overview', 'report.list']) {
    const branch = branches.find(b => b.properties.name.const === n);
    assert.deepEqual(branch.properties.input.properties, {}); assert.ok(!branch.required.includes('input'));
  }
  assert.ok(branches.find(b => b.properties.name.const === 'knowledge.query').required.includes('input'));
  assert.match(tool('education_student_overview').description, /不包含整体画像正文/);
  assert.match(tool('education_report_read').description, /nextOffset.*contentHash/);
});

test('R21 unified: all-student queries group results and each write has one immutable target', async t => {
  const f = await fixture(t, true);
  await f.savePolicy({ accessMode: 'all_authorized_students' });
  const session = await f.connectors.open(f.connection.token, 'chat-a');
  assert.equal(session.bindingRequired, false); assert.equal(session.studentId, '');
  assert.equal(session.contextRevision, 2);
  const base = { sessionId: 'chat-a', contextRevision: 2 };
  assert.equal((await f.gateway(f.connection.token, { ...base, action: 'students' })).students.length, 2);
  const grouped = await f.gateway(f.connection.token, { ...base, action: 'queryMany', name: 'student.overview', studentIds: 'all', input: {} });
  assert.deepEqual(grouped.results.map(r => r.studentId), ['s1', 's2']);
  for (const r of grouped.results) assert.deepEqual(r.result.auth.allowedStudentIds, [r.studentId]);
  await rejects(f.gateway(f.connection.token, f.body()), 'CONTEXT_CHANGED');
  await rejects(f.gateway(f.connection.token, f.body('missing', base)), 'TARGET_STUDENT_REQUIRED');
  for (const targetStudentId of ['s1', 's2']) {
    const result = await f.gateway(f.connection.token, f.body('same-key', { ...base, targetStudentId }));
    assert.equal(result.intent.studentId, targetStudentId); assert.equal(result.intent.receipt.studentId, targetStudentId);
    await f.gateway(f.connection.token, f.body('same-key', { ...base, targetStudentId }));
  }
  assert.equal(f.calls(), 2);
  await rejects(f.gateway(f.connection.token, f.body('other-project', { ...base, targetStudentId: 's1', input: { projectId: 'other', filename: 'a', contentBase64: 'YQ==' } })), 'PROJECT_SCOPE_DENIED');
  await rejects(f.gateway(f.connection.token, { ...base, action: 'memory', operation: 'append', targetStudentId: 's1', input: {} }), 'MULTI_STUDENT_MEMORY_DISABLED');
  await rejects(f.gateway(f.connection.token, f.body('mixed', { ...base, name: 'conversation.submit', targetStudentId: 's1', input: { messages: [{ role: 'user', content: 'mixed' }] } })), 'MULTI_STUDENT_ARCHIVE_DISABLED');
  await rejects(f.gateway(f.connection.token, { ...base, action: 'queryMany', name: 'task.create', studentIds: 'all', input: {} }), 'READ_CAPABILITY_REQUIRED');
  await f.savePolicy({ accessMode: 'all_authorized_students', restrictions: { excludedStudentIds: ['s2'] } });
  assert.deepEqual((await f.gateway(f.connection.token, { ...base, action: 'students' })).students.map(s => s.studentId), ['s1']);
  await rejects(f.gateway(f.connection.token, f.body('denied', { ...base, targetStudentId: 's2' })), 'STUDENT_SCOPE_DENIED');
  await f.savePolicy({ accessMode: 'session_bound' });
  await rejects(f.gateway(f.connection.token, f.body('stale', { ...base, targetStudentId: 's1' })), 'CONTEXT_CHANGED');
  assert.equal((await f.connectors.open(f.connection.token, 'chat-a')).bindingRequired, true);
});

test('R21 unified: new students, expiry, revoked connections and permissions gate all-student access', async t => {
  const f = await fixture(t, true);
  await f.savePolicy({ accessMode: 'all_authorized_students', inheritForNewStudents: false });
  f.students.push({ id: 's3', name: '合成丙' });
  const base = { sessionId: 'chat-a', contextRevision: 2, action: 'students' };
  assert.equal((await f.gateway(f.connection.token, base)).students.length, 2);
  await rejects(f.gateway(f.connection.token, { ...base, action: 'queryMany', name: 'student.overview', studentIds: ['s1', 's3'], input: {} }), 'STUDENT_SCOPE_DENIED');
  await f.savePolicy({ inheritForNewStudents: true });
  assert.equal((await f.gateway(f.connection.token, base)).students.length, 3);
  await f.savePolicy({ restrictions: { disabledPermissions: ['student:read'] } });
  await rejects(f.gateway(f.connection.token, base), 'CAPABILITY_DENIED');
  await f.savePolicy({ restrictions: { expiresAt: '2020-01-01T00:00:00Z' } });
  await rejects(f.gateway(f.connection.token, base), 'EXTERNAL_AUTH_EXPIRED');
  await f.savePolicy({ restrictions: {} });
  await f.connectors.action('connection', { connectionId: f.connection.connectionId, status: 'revoked' });
  await rejects(f.gateway(f.connection.token, base), 'CONNECTION_INACTIVE');
});

test('R21: exactly 6/9/13 permissions; tooling and advanced restrictions cannot expand authority', () => {
  assert.deepEqual(Object.values(PRESETS).map(p => p.length), [6, 9, 13]); assert.equal(PERMISSIONS.length, 13);
  assert.throws(() => restrictions({ allow: ['research:search'] }), /高级设置/);
  assert.throws(() => restrictions({ disabledPermissions: ['research:search'] }));
  for (const preset of Object.keys(PRESETS)) {
    const tools = toolDefinitions(PRESETS[preset]);
    assert.equal(tools.some(t => t.name.includes('research')), false);
    assert.equal(tools.some(t => t.name === 'education_material_upload'), preset === 'full');
    assert.equal(tools.some(t => t.name === 'education_memory'), preset !== 'read');
  }
});
test('R21: independent credentials, restart, auto-bind and immutable identity', async t => {
  const f = await fixture(t);
  assert.notEqual(f.connection.token, f.second.token);
  assert.equal(f.session.studentId, 's1'); assert.equal(f.session.bindingRequired, false);
  assert.equal(JSON.stringify(f.connectors.snapshot()).includes(f.connection.token), false);
  assert.equal(JSON.stringify(f.connectors.snapshot()).includes('tokenHash'), false);
  const restarted = createConnectorStore(f.file, { students: () => f.students, projects: () => f.projects });
  assert.equal(restarted.resolve(f.connection.token, 'chat-a', 1).studentId, 's1');
  await f.connectors.action('connection', { connectionId: f.connection.connectionId, status: 'revoked' });
  assert.throws(() => restarted.auth(f.connection.token), { code: 'CONNECTION_INACTIVE' });
  assert.equal(restarted.auth(f.second.token).connectionId, f.second.connectionId);
  await rejects(f.connectors.action('connection', { connectionId: f.connection.connectionId, status: 'active' }), 'CONNECTION_REVOKED');
});
test('R21: multiple students require host selection; concurrent sessions and future students stay isolated', async t => {
  const f = await fixture(t, true);
  assert.equal(f.session.bindingRequired, true);
  await rejects(f.gateway(f.connection.token, f.body()), 'SESSION_SELECTION_REQUIRED');
  await f.connectors.action('bindSession', { connectionId: f.connection.connectionId, sessionId: 'chat-a', studentId: 's1', contextRevision: 1, confirmed: true });
  await f.connectors.open(f.connection.token, 'chat-b');
  await f.connectors.action('bindSession', { connectionId: f.connection.connectionId, sessionId: 'chat-b', studentId: 's2', contextRevision: 1, confirmed: true });
  assert.equal(f.connectors.resolve(f.connection.token, 'chat-a', 2).studentId, 's1');
  assert.equal(f.connectors.resolve(f.connection.token, 'chat-b', 2).studentId, 's2');
  f.students.push({ id: 's3' }); await f.connectors.open(f.second.token, 'new');
  await f.connectors.action('bindSession', { connectionId: f.second.connectionId, sessionId: 'new', studentId: 's3', contextRevision: 1, confirmed: true });
  assert.equal(f.connectors.resolve(f.second.token, 'new', 2).studentId, 's3');
  await rejects(f.gateway(f.connection.token, f.body()), 'CONTEXT_CHANGED');
});
test('R21: same student cross-project queries exclude shared/other/excluded scopes', async t => {
  const f = await fixture(t);
  let a = f.connectors.resolve(f.connection.token, 'chat-a', 1);
  assert.deepEqual(agentKnowledgeScopePlan(a, 's1', f.projects).scopes.map(s => s.scopeId), ['s1', 'p1', 'p2']);
  await f.savePolicy({ restrictions: { excludedProjectIds: ['p2'] } });
  a = f.connectors.resolve(f.connection.token, 'chat-a', 1);
  assert.deepEqual(a.allowedProjectIds, ['p1']);
  await rejects(f.gateway(f.connection.token, f.body('bad', { input: { studentId: 's2', filename: 'x', contentBase64: 'YQ==' } })), 'STUDENT_SCOPE_DENIED');
  await rejects(f.gateway(f.connection.token, f.body('bad', { input: { projectId: 'p2', filename: 'x', contentBase64: 'YQ==' } })), 'PROJECT_SCOPE_DENIED');
  assert.equal(f.calls(), 0);
});
test('R21: default auto-write, durable receipt and lost-response retries do not repeat application', async t => {
  const f = await fixture(t), result = await f.gateway(f.connection.token, f.body());
  assert.equal(result.intent.status, 'completed'); assert.equal(result.intent.approvalMode, 'persistent_policy');
  assert.equal(result.processing.saved, true); assert.equal(result.processing.index, 'not_started');
  const retry = await f.gateway(f.connection.token, f.body());
  assert.equal(retry.intent.id, result.intent.id); assert.equal(f.calls(), 1);
  const restarted = createExternalWriter(f.writerArgs);
  await restarted.submit(f.connection.token, f.body()); assert.equal(f.calls(), 1);
  await restarted.retryProcessing(f.connection.token, { sessionId: 'chat-a', intentId: result.intent.id });
  assert.equal(f.calls(), 1); assert.equal(f.schedules(), 2);
});
test('R21: advanced approval and policy downgrade rechecked at execution', async t => {
  const f = await fixture(t); await f.savePolicy({ restrictions: { requireWriteConfirmation: true } });
  const r = await f.gateway(f.connection.token, f.body()); assert.equal(r.approvalRequired, true); assert.equal(f.calls(), 0);
  const approved = intents.approveIntent(f.load(), r.intent.id, r.intent.inputDigest); await writeJsonAtomic(f.ledger, approved.store);
  await f.savePolicy({ preset: 'read' });
  await rejects(f.writer.execute(f.connection.token, { sessionId: 'chat-a', intentId: r.intent.id }), 'CAPABILITY_DENIED');
  await f.savePolicy({ preset: 'full', restrictions: { requireWriteConfirmation: true } });
  assert.equal((await f.writer.execute(f.connection.token, { sessionId: 'chat-a', intentId: r.intent.id })).intent.status, 'completed');
});
test('R21: pause/resume, expiry and revoke stay closed across restart and reauthorization', async t => {
  const f = await fixture(t);
  await f.connectors.action('pause'); await rejects(f.gateway(f.connection.token, f.body()), 'EXTERNAL_AUTH_INACTIVE');
  await f.connectors.action('resume');
  await f.connectors.action('connection', { connectionId: f.connection.connectionId, status: 'active', restrictions: { expiresAt: '2020-01-01T00:00:00Z' } });
  assert.throws(() => f.connectors.auth(f.connection.token), { code: 'EXTERNAL_AUTH_EXPIRED' });
  await f.connectors.action('revoke'); await f.savePolicy();
  assert.throws(() => f.connectors.auth(f.second.token), { code: 'CONNECTION_INACTIVE' });
  assert.equal(f.connectors.read().legacyDenied, true);
});
test('R21: concurrency merges latest ledger and in-flight work retains its frozen student', async t => {
  const f = await fixture(t);
  let release, started; const entered = new Promise(r => { started = r; }); const gate = new Promise(r => { release = r; });
  f.setApply(async intent => { if (intent.input.filename === '合成.txt') { started(); await gate; } return { studentId: intent.studentId, projectId: intent.projectId }; });
  const work = f.gateway(f.connection.token, f.body()); await entered;
  const other = await f.gateway(f.connection.token, f.body('second', { input: { filename: 'other.txt', contentBase64: 'YQ==' } }));
  f.students.push({ id: 's2' });
  await f.connectors.action('bindSession', { connectionId: f.connection.connectionId, sessionId: 'chat-a', contextRevision: 1, studentId: 's2', confirmed: true });
  release(); const first = await work;
  assert.equal(first.intent.receipt.result.studentId, 's1');
  assert.equal(f.load().intents.length, 2); assert.equal(f.load().intents.find(i => i.id === other.intent.id).status, 'completed');
  await rejects(f.gateway(f.connection.token, f.body('stale')), 'CONTEXT_CHANGED');
});
test('R21: interrupted write recovers without losing payload or re-targeting after a session switch', async t => {
  const f = await fixture(t); let saved = 0;
  f.setApply(async intent => { const target = path.join(f.root, `${intent.id}.stored`); if (!fs.existsSync(target)) { fs.writeFileSync(target, 'source'); saved++; throw Error('simulated response loss'); } return { studentId: intent.studentId }; });
  await assert.rejects(f.gateway(f.connection.token, f.body()), /simulated/);
  const record = f.load().intents[0]; assert.equal(record.status, 'recoverable');
  record.expiresAt = '2020-01-01T00:00:00Z';
  const store = f.load(); store.intents[0] = record; await writeJsonAtomic(f.ledger, store);
  assert.equal(intents.expireIntents(store).store.intents[0].status, 'recoverable');
  f.students.push({ id: 's2' }); await f.connectors.action('bindSession', { connectionId: f.connection.connectionId, sessionId: 'chat-a', studentId: 's2', contextRevision: 1, confirmed: true });
  const retry = await createExternalWriter(f.writerArgs).execute(f.connection.token, { sessionId: 'chat-a', intentId: record.id });
  assert.equal(retry.intent.receipt.result.studentId, 's1'); assert.equal(saved, 1);
});
test('R21: source provenance dedup, conflict and internal feedback guard', async t => {
  const f = await fixture(t), source = { sourceEventId: 'source-a', sourceType: 'capture', derivedFrom: ['edu://original'] };
  const first = await f.gateway(f.connection.token, f.body('one', { provenance: source }));
  const second = await f.gateway(f.connection.token, f.body('two', { provenance: source }));
  assert.equal(first.intent.id, second.intent.id); assert.equal(f.calls(), 1);
  const imported = await f.gateway(f.connection.token, f.body('import', { provenance: { ...source, sourceType: 'import' } }));
  assert.equal(imported.intent.id, first.intent.id); assert.equal(f.calls(), 1);
  assert.deepEqual(imported.intent.deliverySources, ['capture', 'import']);
  await rejects(f.gateway(f.connection.token, f.body('three', { provenance: source, input: { filename: 'different', contentBase64: 'YQ==' } })), 'SOURCE_EVENT_CONFLICT');
  await rejects(f.gateway(f.connection.token, f.body('internal', { provenance: { sourceType: 'internal_digest' } })), 'INTERNAL_FEEDBACK_DENIED');
  const derived = await f.gateway(f.connection.token, f.body('derived', { provenance: { ...source, sourceType: 'derived' } }));
  assert.notEqual(first.intent.id, derived.intent.id);
});
test('R21: memory-only preset saves isolated memory but cannot archive or leak an excluded project', async t => {
  const f = await fixture(t); await f.savePolicy({ preset: 'read_memory' });
  const mem = (operation, input) => f.gateway(f.connection.token, { action: 'memory', sessionId: 'chat-a', contextRevision: 1, operation, input });
  await mem('start', { agentId: 'spoof', projectId: 'p1' }); await mem('append', { projectId: 'p1', messages: [{ role: 'user', content: '私域原文', messageId: 'm1' }] });
  const end = await mem('finalize', { projectId: 'p1', summary: { objective: '不得泄露的项目记忆' } });
  assert.equal(end.result.session.agentId, 'workbuddy'); assert.equal(f.load().intents.length, 0);
  await f.savePolicy({ preset: 'read_memory', restrictions: { excludedProjectIds: ['p1'] } });
  assert.equal((await mem('recent', {})).result.sessions.length, 0);
  await rejects(f.gateway(f.connection.token, f.body()), 'CAPABILITY_DENIED');
});
test('R21: migration backs up exact old state and never auto-approves old requests', async t => {
  const f = await fixture(t), old = path.join(f.root, 'legacy.json');
  fs.writeFileSync(old, JSON.stringify({ revoked: true, pending: 'pending_approval' }));
  const migrated = createConnectorStore(path.join(f.root, 'new.json'), { legacyFiles: [old] });
  await migrated.action('savePolicy', { revision: 0, preset: 'full', confirmed: true });
  assert.equal(fs.readFileSync(old, 'utf8'), fs.readFileSync(old + '.pre-r21.bak', 'utf8'));
  assert.equal(migrated.read().connections.length, 0);
  fs.writeFileSync(f.file, '{broken'); assert.throws(() => f.connectors.auth(f.connection.token), { code: 'CONNECTOR_STORE_INVALID' });
});
test('R21: permission change conflicts serialize; sealed and removed targets never fall back', async t => {
  const f = await fixture(t), revision = f.connectors.read().policy.revision;
  const outcomes = await Promise.allSettled([1, 2].map(() => f.connectors.action('savePolicy', { revision, preset: 'full', confirmed: true })));
  assert.equal(outcomes.filter(x => x.status === 'rejected').length, 1);
  f.projects[0].status = 'sealed';
  await rejects(f.gateway(f.connection.token, f.body('sealed', { input: { projectId: 'p1', filename: 'x', contentBase64: 'YQ==' } })), 'PROJECT_SEALED');
  f.students[0].archived = true; await rejects(f.gateway(f.connection.token, f.body()), 'STUDENT_SCOPE_DENIED');
  assert.equal(f.calls(), 0);
});
test('R21: completed idempotency records remain beyond the old 500-record window', () => {
  const store = { intents: Array.from({ length: 505 }, (_, i) => ({ id: `done${i}`, status: 'completed' })) };
  const r = intents.previewIntent(store, { name: 'task.create', input: { studentId: 's1', title: 'x', detail: 'y' }, idempotencyKey: 'new', grantId: 'g1' });
  assert.equal(r.store.intents.length, 506);
});
test('R21: saving a narrower policy never resumes a paused connector or enrolls excluded future students', async t => {
  const f = await fixture(t); await f.savePolicy({ inheritForNewStudents: false });
  f.students.push({ id: 'future' }); await f.savePolicy({ preset: 'read', inheritForNewStudents: false });
  assert.deepEqual(f.connectors.read().policy.studentIds, ['s1']);
  await f.connectors.action('pause'); await f.savePolicy({ preset: 'read', inheritForNewStudents: false });
  assert.equal(f.connectors.read().policy.paused, true);
});
test('R21: revoking during a committed write retains its receipt but prevents new downstream work', async t => {
  const f = await fixture(t);
  f.setApply(async intent => { await f.connectors.action('revoke'); return { materialId: intent.id }; });
  await rejects(f.gateway(f.connection.token, f.body()), 'INTENT_SCOPE_DENIED');
  assert.equal(f.load().intents[0].status, 'completed'); assert.ok(f.load().intents[0].receipt);
  assert.equal(f.schedules(), 0);
});
test('R21: indexing evidence requires committed current-version links and a matching live query', () => {
  const { projectKnowledgeRefs, verifiedIndex } = require('../electron/external-processing-receipt.cjs');
  const material = { materialId: 'm', version: 2, sha256: 'source', adoption: { state: 'accepted' }, links: { knowledge: [{ knowledgeId: 'k', version: 2 }] } };
  const registry = { knowledge: [{ knowledgeId: 'k', status: 'committed', relativePath: '成果.md', sha256: 'digest', sources: [{ materialId: 'm', version: 2, sha256: 'source' }] }] };
  const refs = projectKnowledgeRefs(material, registry, 'p1'); assert.equal(refs.length, 1);
  const result = { ok: true, freshness: 'local', result: { resources: [{ projectId: 'p1', relativePath: '成果.md' }] } };
  assert.equal(verifiedIndex(refs, result).status, 'query_verified');
  assert.equal(verifiedIndex(refs, { ...result, freshness: 'cached' }).status, 'no_evidence');
  assert.equal(verifiedIndex(refs, { ok: true, resources: [{ projectId: 'p2', relativePath: '成果.md' }] }).status, 'no_evidence');
  material.version = 3; assert.deepEqual(projectKnowledgeRefs(material, registry, 'p1'), []);
});
test('R21: real host material/task/report writers commit once in an isolated workspace', async t => {
  const f = await fixture(t), rawPath = path.join(f.root, 'raw'), source = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
  let uploads = [], taskStore = { tasks: [] }, conversations = [];
  const ctx = vm.createContext({ fs, path, crypto: require('node:crypto'), Buffer,
    findStudent: id => ({ id, name: '合成甲', rawPath }), readProjects: () => f.projects,
    readProjectMetadata: () => f.projects, getProjectMetadata: id => f.projects.find(project => String(project.id) === String(id)) || null,
    normalizeProject: p => p, normalizeProjectMetadata: p => p,
    assertUploadFileAllowed: (filename, size) => { assert.ok(size < 3e6); assert.ok(!filename.includes('/')); },
    readUploadRecords: () => uploads, addUploadRecords: rows => { uploads.push(...rows); }, sha1File: file => require('node:crypto').createHash('sha1').update(fs.readFileSync(file)).digest('hex'),
    readTaskStore: () => structuredClone(taskStore), normalizeTaskEnvelope: v => v, writeTaskStore: v => { taskStore = v; }, appendTaskEvent() {},
    LEARNING_REPORTS: [{ id: 'report', title: '合成报告' }], learningReportDirForStudent: () => path.join(f.root, 'reports'),
    parseJsonObject: JSON.parse, submitAgentConversation: async input => { conversations.push(JSON.parse(input)); return JSON.stringify({ ok: true, receipt: { status: 'stored', materialId: 'conversation-raw' } }); },
  });
  const start = source.indexOf('async function applyAgentWriteIntent('); vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), ctx);
  f.setApply(intent => ctx.applyAgentWriteIntent(intent));
  const material = await f.gateway(f.connection.token, f.body()); await f.gateway(f.connection.token, f.body());
  assert.equal(uploads.length, 1); assert.equal(fs.readdirSync(rawPath).length, 1);
  assert.equal(fs.readFileSync(uploads[0].path, 'utf8'), 'synthetic only');
  const task = f.body('task', { name: 'task.create', input: { title: '合成计划', detail: '仅草稿，不执行' } });
  await f.gateway(f.connection.token, task); await f.gateway(f.connection.token, task);
  assert.equal(taskStore.tasks.length, 1); assert.equal(taskStore.tasks[0].status, 'draft'); assert.equal(taskStore.tasks[0].autoRetry, false);
  const report = f.body('report', { name: 'report.draft', input: { reportId: 'report', content: '# 合成草稿' } });
  await f.gateway(f.connection.token, report); await f.gateway(f.connection.token, report);
  assert.equal(fs.readdirSync(path.join(f.root, 'reports', 'Agent草稿')).length, 1);
  const conversation = f.body('conversation', { name: 'conversation.submit', input: { projectId: 'p1', sourceAgent: 'forged', messages: [{ role: 'user', content: '合成经历' }] } });
  await f.gateway(f.connection.token, conversation); await f.gateway(f.connection.token, conversation);
  assert.equal(conversations.length, 1); assert.equal(conversations[0].scopeId, 'p1'); assert.equal(conversations[0].sourceAgent, 'workbuddy');
  assert.equal(material.intent.receipt.result.status, 'pending_digest');
});
test('R21: actual stdio MCP process negotiates, filters tools and completes idempotent HTTP write', async t => {
  const f = await fixture(t), http = require('node:http'), { spawn } = require('node:child_process');
  const server = http.createServer(async (req, res) => {
    try { let data = ''; for await (const chunk of req) data += chunk;
      const token = String(req.headers.authorization).replace(/^Bearer /, '');
      res.end(JSON.stringify(await f.gateway(token, JSON.parse(data))));
    } catch (e) { res.end(JSON.stringify({ ok: false, code: e.code || 'FAILED' })); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const credentialFile = path.join(f.root, 'credential'), config = path.join(f.root, 'connection.json');
  fs.writeFileSync(credentialFile, f.connection.token); fs.writeFileSync(config, JSON.stringify({ credentialFile, endpoint: `http://127.0.0.1:${server.address().port}/api/agent/connector` }));
  const child = spawn(process.execPath, [path.join(__dirname, '../electron/external-agent-mcp.cjs'), config], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const readline = require('node:readline'), lines = readline.createInterface({ input: child.stdout });
  const waiting = new Map(); let id = 0;
  lines.on('line', line => { const value = JSON.parse(line); waiting.get(value.id)?.(value); waiting.delete(value.id); });
  function rpc(method, params) { return new Promise((resolve, reject) => {
    const next = ++id, timeout = setTimeout(() => reject(Error('MCP timeout')), 10000);
    waiting.set(next, value => { clearTimeout(timeout); resolve(value); }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: next, method, params }) + '\n');
  }); }
  assert.equal((await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'r21-test', version: '1' } })).result.serverInfo.name, 'edu-manager-knowledge');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  assert.ok((await rpc('tools/list')).result.tools.some(t => t.name === 'education_material_upload'));
  const opened = await rpc('tools/call', { name: 'education_open_session', arguments: { sessionId: 'chat-a' } });
  assert.equal(JSON.parse(opened.result.content[0].text).studentId, 's1');
  const args = f.body(); delete args.action; delete args.name;
  const result = await rpc('tools/call', { name: 'education_material_upload', arguments: args });
  assert.equal(JSON.parse(result.result.content[0].text).intent.status, 'completed');
  await rpc('tools/call', { name: 'education_material_upload', arguments: args }); assert.equal(f.calls(), 1);
  assert.ok((await rpc('tools/call', { name: 'education_write_operation', arguments: { ...args, action: 'submit', name: 'material.upload' } })).error);
  assert.equal(f.calls(), 1);
  await f.savePolicy({ preset: 'read' });
  assert.equal((await rpc('tools/list')).result.tools.some(t => t.name === 'education_material_upload'), false);
  assert.equal((await rpc('tools/call', { name: 'education_material_upload', arguments: args })).result.isError, true);
  child.stdin.end();
});
test('R21: portable host refreshes active MCP connection paths and endpoint after every restart', () => {
  const source = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
  assert.match(source, /function writeExternalConnectionRuntimeConfig\(connectionId, token = ''\)/);
  assert.match(source, /command: runtime\.executable/);
  assert.match(source, /runtimeKind: runtime\.useElectronNode \? 'electron-node' : 'node'/);
  assert.match(source, /endpoint: `http:\/\/127\.0\.0\.1:\$\{getHostServicePort\(\)\}\/api\/agent\/connector`/);
  assert.match(source, /hostServer\.listen[\s\S]*refreshExternalConnectionRuntimeConfigs\(\)/);
  assert.match(source, /externalConnectorNeedsHost = external\.policy\.status === 'active'[\s\S]*startHostService\(\{ preserveUsageMode: true \}\)/);
  assert.match(source, /\['createConnection', 'upgradeInstalled'\]\.includes\(action\) && !hostServer[\s\S]*startHostService\(\{ preserveUsageMode: true \}\)/);
});
