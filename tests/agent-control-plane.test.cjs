'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), vm = require('node:vm');
const control = require('../electron/agent-control-plane.cjs');
const digest = 'digest_host_mediated.v1', classification = 'classification_readonly.v1';
const student = { id: 's1', agentTool: 'workbuddy', classificationFallback: { enabled: true, providerId: 'codex' } };
const policy = { primary: 'workbuddy', fallbacks: ['codex'], enabled: true, desktopHandoff: true, version: 0, confirmed: true };
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-control-'));
  t.after(async () => { await t.closeTaskHost?.(); await fs.rm(root, { force:true,recursive:true }); });
  return { root, store: control.createAgentControlStore(path.join(root, 'policies.json')) };
}
test('legacy classification grant does not authorize digest fallback or desktop handoff', async t => {
  const { store } = await fixture(t);
  assert.deepEqual(control.resolvePolicy(store.read(), { studentId: 's1' }, classification, student).fallbacks, ['codex']);
  const p = control.resolvePolicy(store.read(), { studentId: 's1' }, digest, student);
  assert.deepEqual(p.fallbacks, []); assert.equal(p.desktopHandoff, false);
});
test('policy is scoped, durable, version checked and rejects unsupported providers and scope', async t => {
  const { store, root } = await fixture(t);
  await store.save({ studentId: 's1' }, digest, policy);
  assert.equal(control.resolvePolicy(store.read(), { studentId: 's1' }, digest, student).version, 1);
  assert.equal(control.resolvePolicy(store.read(), { studentId: 's2' }, digest, student).version, 0);
  await assert.rejects(store.save({ studentId: 's1' }, digest, policy), { code: 'POLICY_CONFLICT' });
  await assert.rejects(store.save({ studentId: 's1' }, digest, { ...policy, primary: 'unverified' }), { code: 'UNSUPPORTED_PROVIDER' });
  await assert.rejects(store.save({ studentId: 's1', projectId: 'p' }, classification, policy), { code: 'INVALID_SCOPE' });
  await store.save({ studentId: 's1' }, digest, { ...policy, enabled: false, version: 1 });
  assert.equal(JSON.parse(await fs.readFile(path.join(root, 'policies.json.pre-update.bak'))).revision, 1);
});
test('concurrent writes serialize and never overwrite another scope', async t => {
  const { store } = await fixture(t);
  await Promise.all(['s1', 's2'].map(studentId => store.save({ studentId }, digest, policy)));
  assert.equal(store.read().revision, 2); assert.equal(Object.keys(store.read().policies).length, 2);
  const results = await Promise.allSettled([1, 2].map(() => store.save({ studentId: 's1' }, digest, { ...policy, version: 1 })));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
});
test('student revocation overrides project allowance and corruption fails closed', async t => {
  const { store, root } = await fixture(t);
  await store.save({ studentId: 's1', projectId: 'p1' }, digest, policy);
  await store.save({ studentId: 's1' }, digest, { ...policy, enabled: false });
  assert.equal(control.resolvePolicy(store.read(), { studentId: 's1', projectId: 'p1' }, digest, student).enabled, false);
  await fs.writeFile(path.join(root, 'policies.json'), '{}');
  assert.throws(() => store.read(), { code: 'CONTROL_STORE_INVALID' });
});
test('authentication failure falls back once; both fail then one desktop handoff', async () => {
  for (const success of [true, false]) {
    const calls = [], records = [];
    const result = await control.dispatchAgent({ policy, profile: digest, current: () => true,
      attempt: async id => { calls.push(id); return id === 'codex' && success ? { ok: true } : { ok: false, code: 'AUTHENTICATION_REQUIRED' }; },
      record: async e => records.push(e), handoff: async () => { calls.push('desktop'); return { ok: true }; } });
    assert.equal(result.ok, true); assert.deepEqual(calls, success ? ['workbuddy', 'codex'] : ['workbuddy', 'codex', 'desktop']);
    assert.equal(records[0].stage, 'qualifying');
  }
});
test('two Agent pre-send failures fall through to the authorized LLM API before desktop handoff', async () => {
  const calls = [], records = [];
  const llmPolicy = { ...policy, fallbacks: ['codex', 'llm-api'] };
  const result = await control.dispatchAgent({ policy: llmPolicy, profile: digest, current: () => true,
    attempt: async providerId => {
      calls.push(providerId);
      return providerId === 'llm-api' ? { ok: true, result: { accepted: true } }
        : { ok: false, code: 'AUTHENTICATION_REQUIRED', stage: 'not_sent' };
    },
    record: async event => records.push(event),
    handoff: async () => assert.fail('LLM API succeeded, so desktop handoff must not run'),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['workbuddy', 'codex', 'llm-api']);
  assert.deepEqual(result.attempts.map(item => [item.providerId, item.stage]), [
    ['workbuddy', 'not_sent'], ['codex', 'not_sent'], ['llm-api', 'accepted'],
  ]);
  assert.equal(records.at(-1).stage, 'accepted');
});
test('provider-local deferral falls through while global resource deferral preserves the selected route', async () => {
  const providerCalls = [];
  const providerResult = await control.dispatchAgent({ policy, profile: digest, current: () => true,
    attempt: async providerId => { providerCalls.push(providerId); return providerId === 'workbuddy'
      ? { ok: false, deferred: true, deferScope: 'provider', code: 'PROVIDER_DEFERRED' }
      : { ok: true, executionId: 'codex-run' }; },
    record: async () => {}, handoff: async () => assert.fail('automatic fallback succeeded'),
  });
  assert.equal(providerResult.ok, true);
  assert.deepEqual(providerCalls, ['workbuddy', 'codex']);

  const globalCalls = [];
  const globalResult = await control.dispatchAgent({ policy, profile: digest, current: () => true,
    attempt: async providerId => { globalCalls.push(providerId); return { ok: false, deferred: true,
      deferScope: 'global', code: 'RESOURCE_DEFERRED' }; },
    record: async () => {}, handoff: async () => assert.fail('global pressure must not change providers'),
  });
  assert.equal(globalResult.deferred, true);
  assert.equal(globalResult.deferScope, 'global');
  assert.deepEqual(globalCalls, ['workbuddy']);
});
for (const failure of [{ code: 'AUTHENTICATION_REQUIRED', stage: 'possibly_sent' }, { code: 'AUTHENTICATION_REQUIRED', executionId: 'run' }, { code: 'EXECUTION_UNRESOLVED' }, { code: 'SENSITIVE_REVIEW_REQUIRED' }, { code: 'ETIMEDOUT' }]) {
  test(`never fail over after uncertain/sensitive outcome ${JSON.stringify(failure)}`, async () => {
    let attempts = 0;
    await control.dispatchAgent({ policy, profile: digest, attempt: async () => { attempts++; return { ok: false, ...failure }; }, record: async () => {}, handoff: async () => assert.fail('handoff forbidden') });
    assert.equal(attempts, 1);
  });
}
test('revocation during failed primary prevents backup and handoff', async () => {
  let valid = true, attempts = 0;
  const result = await control.dispatchAgent({ policy, profile: digest, current: () => valid,
    record: async () => {}, attempt: async () => { attempts++; valid = false; return { ok: false, code: 'AUTHENTICATION_REQUIRED' }; }, handoff: async () => assert.fail() });
  assert.equal(result.code, 'AGENT_POLICY_CHANGED'); assert.equal(attempts, 1);
});
test('failed durable routing checkpoint prevents invocation', async () => {
  await assert.rejects(control.dispatchAgent({ policy, profile: digest, record: async () => { throw Error('disk full'); }, attempt: async () => assert.fail() }), /disk full/);
});
test('actual global IPC works without students and snapshot never probes or starts an Agent', async t => {
  const { store } = await fixture(t);
  const source = await fs.readFile(path.join(__dirname, '../electron/main.cjs'), 'utf8');
  let probes = 0;
  const ctx = vm.createContext({
    require: name => name === './agent-invocation-service.cjs' ? { classificationSavedStatus: s => s } : require(path.join(__dirname, '../electron', name)),
    findStudentByKey: id => id === 's1' ? student : null,
    aiExecutorRegistry: () => require('../electron/ai-executor-registry.cjs').executorRegistry(),
    readStudentsIndex: () => [], findAgentToolInstall: () => ({}), readAgentWriteIntents: () => ({ intents: [] }),
    readProjects: () => [{ id: 'other', studentIds: ['s2'] }], normalizeProject: p => p,
    agentControlStore: () => store, readTaskStore: () => ({ tasks: [], runtime: {} }),
    classificationAdapter: async id => ({ id }), currentStudentAgentStatus: () => ({ state: 'qualification_required', message: 'saved-only' }),
    classificationAuth: () => ({ status: () => null, start: () => { probes++; } }),
    builtinStructuredProvider: require('../electron/builtin-structured-provider.cjs'),
    getLlmApiProvider: () => ({ get: async () => ({ configured: false, runtimeHash: '', lastCheck: null }) }),
    smartInboxHostRuntime: { routing: { qualify: () => { probes++; }, invalidate() {} } }, notify() {},
    CLASSIFICATION_PROFILE: classification, DIGEST_PROFILE: digest,
  });
  const start = source.indexOf('async function agentControlAction(');
  vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), ctx);
  for (let i = 0; i < 3; i++) assert.equal((await ctx.agentControlAction('snapshot', {})).providers.length, 15);
  assert.equal(probes, 0); assert.equal(store.read().revision, 0);
  assert.equal((await ctx.agentControlAction('snapshot', { studentId: 'missing' })).global.enabled, false);
  await assert.rejects(ctx.agentControlAction('savePolicy', { studentId: 's1', profile: digest, policy }), /全局授权/);
  assert.equal(store.read().revision, 0);
});
test('production digest dispatcher uses real Worker storage and marks auth block instead of running', async t => {
  const { root } = await fixture(t);
  const host = await require('./helpers/smart-inbox-task-host.cjs').createTaskHost(root); t.closeTaskHost=()=>host.close();
  const source = await fs.readFile(path.join(__dirname, '../electron/main.cjs'), 'utf8');
  const task = { id: 'digest1', kind: 'student_digest', status: 'approved', sourceId: 's1', sourceType: 'student', title: 'Synthetic digest', attempt: 0 };
  const store = host.context.readTaskStore(); store.tasks.push(task); await host.context.writeTaskStoreDurably(store);
  let digestState, count = 0;
  Object.assign(host.context, { require: name => require(path.join(__dirname, '../electron', name)), DIGEST_PROFILE: digest,
    findStudentByKey: () => student, agentControlPolicy: () => ({ ...policy, desktopHandoff: false }),
    ensureTaskDispatchReadiness: async (_task,providers) => ({decision:'dispatch',providerId:providers[0],reasons:providers.map(providerId=>({providerId,state:'available'}))}),
    submitProjectMaterialAttempt: async () => { count++; return { ok: false, code: 'AUTHENTICATION_REQUIRED' }; },
    writeStudentDigestState: (_, value) => { digestState = value; }, notify() {} });
  const start = source.indexOf('async function submitProjectMaterialTask(');
  vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), host.context);
  const result = await host.context.submitProjectMaterialTask(task, { id: 'project', studentIds: ['s1'] }, 'auto', { student });
  assert.equal(result.code, 'AGENT_ROUTE_BLOCKED'); assert.equal(count, 2);
  assert.equal(host.disk().tasks[0].status, 'blocked'); assert.equal(host.disk().tasks[0].routeDecision.attempts.length, 2);
  assert.equal(digestState.status, 'failed');
});
