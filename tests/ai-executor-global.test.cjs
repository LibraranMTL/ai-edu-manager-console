'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), fss = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), crypto = require('node:crypto');
const control = require('../electron/agent-control-plane.cjs'), registry = require('../electron/ai-executor-registry.cjs');
const cli = require('../electron/standard-cli-provider.cjs');
const profile = 'digest_host_mediated.v1', customId = 'custom:12345678-1234-1234-1234-123456789abc';
async function fixture(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'r20-global-')); t.after(() => fs.rm(root, { recursive: true, force: true })); return { root, store: control.createAgentControlStore(path.join(root, 'policies.json')) }; }
test('one global authorization replaces conflicting old policies for two students plus future student and survives restart', async t => {
  const { root, store } = await fixture(t);
  for (const studentId of ['one', 'two']) await store.save({ studentId }, profile, { enabled: false, primary: 'codex', fallbacks: [], desktopHandoff: false, confirmed: true, version: 0 });
  const global = await store.saveGlobal({ ...control.globalDefaults('workbuddy'), enabled: true });
  const restarted = control.createAgentControlStore(path.join(root, 'policies.json'));
  for (const studentId of ['one', 'two', 'new']) {
    const policy = control.resolvePolicy(restarted.read(), { studentId, projectId: 'project' }, profile, { id: studentId, agentTool: 'codex' });
    assert.equal(policy.enabled, true); assert.deepEqual(control.providersFor(policy, profile), ['workbuddy', 'codex', 'qclaw', 'openclaw', 'claude-code', 'trae', 'qoder-work', 'llm-api']);
  }
  assert.equal(Object.keys(restarted.read().legacyPolicies).length, 2);
  assert.equal(Object.keys(JSON.parse(await fs.readFile(path.join(root, 'policies.json.pre-global.bak'))).policies).length, 2);
  await assert.rejects(store.saveGlobal({ ...global, version: 0 }), { code: 'POLICY_CONFLICT' });
  await assert.rejects(store.save({ studentId: 'one' }, profile, { enabled: true, primary: 'codex', fallbacks: [], desktopHandoff: false, confirmed: true, version: 1 }), { code: 'GLOBAL_POLICY_ACTIVE' });
  await store.saveGlobal({ ...global, enabled: false });
  assert.deepEqual(control.providersFor(control.resolvePolicy(store.read(), { studentId: 'new' }, profile, {}), profile), []);
});
test('concurrent global saves conflict instead of dropping changes; reenabling starts a new capture boundary', async t => {
  const { store } = await fixture(t), input = { ...control.globalDefaults(), enabled: true };
  const results = await Promise.allSettled([store.saveGlobal(input), store.saveGlobal(input)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const first = store.read().global;
  const off = await store.saveGlobal({ ...first, enabled: false });
  const next = await store.saveGlobal({ ...off, enabled: true });
  assert.notEqual(next.captureEpoch, first.captureEpoch); assert.equal(store.read().history.length, 3);
});
test('registry has all 14 builtins plus API, capability filtering, custom changes and API last', () => {
  const tools = [{ id: customId, kind: 'cli', name: 'CLI' }, { id: 'custom:aaaaaaaa-1234-1234-1234-123456789abc', kind: 'web', name: 'Web' }];
  const list = registry.executorRegistry(tools); assert.equal(list.length, 17);
  const global = { ...control.globalDefaults(), enabled: true, order: [customId, 'llm-api', 'workbuddy', 'codex'] };
  assert.deepEqual(registry.routeProviders(global, profile, list), [customId, 'workbuddy', 'codex', 'qclaw', 'openclaw', 'claude-code', 'trae', 'qoder-work', 'llm-api']);
  assert.deepEqual(registry.routeProviders(global, 'research.v1', list), ['workbuddy', 'codex', 'llm-api']);
  assert.deepEqual(list.find(item => item.id === 'workbuddy').automaticProfiles, Object.keys(registry.PROFILES));
  assert.equal(registry.executorRegistry().some(p => p.id === customId), false);
  for (const id of registry.BUILTIN_STRUCTURED_EXECUTORS) {
    const provider = list.find(item => item.id === id); assert.equal(provider.handoff, true); assert.deepEqual(provider.automaticProfiles, registry.STRUCTURED_PROFILES);
  }
  for (const p of list.filter(p => !['codex','workbuddy','llm-api',customId,...registry.BUILTIN_STRUCTURED_EXECUTORS].includes(p.id))) { assert.equal(p.handoff, true); assert.deepEqual(p.automaticProfiles, []); }
});
test('per-executor mode and task contract settings control automatic routing without disabling manual handoff', async t => {
  const { store } = await fixture(t), list = registry.executorRegistry();
  let global = await store.saveGlobal({ ...control.globalDefaults(), enabled: true });
  global = await store.saveGlobal({ ...global,
    providerModes: { ...global.providerModes, openclaw: 'manual_only', 'claude-code': 'disabled' },
    providerProfiles: { ...global.providerProfiles, codex: ['research.v1'] },
  }, list);
  assert.equal(global.disabledProviders.includes('claude-code'), true);
  assert.equal(list.find(item => item.id === 'openclaw').handoff, true);
  assert.deepEqual(registry.routeProviders(global, profile, list), ['workbuddy', 'qclaw', 'trae', 'qoder-work', 'llm-api']);
  assert.deepEqual(registry.routeProviders(global, 'research.v1', list), ['workbuddy', 'codex', 'llm-api']);
  await assert.rejects(store.saveGlobal({ ...global, providerModes: { ...global.providerModes, marvis: 'automatic_preferred' } }, list), { code: 'INVALID_POLICY' });
});
test('no automatic candidates still creates only one manual handoff when enabled', async () => {
  let calls = 0;
  const result = await control.dispatchAgent({ policy: { global: true, enabled: true, providers: [], desktopHandoff: true }, profile,
    current: () => true, record: async () => {}, attempt: () => assert.fail(), handoff: async () => { calls++; return { ok: true }; } });
  assert.equal(result.ok, true); assert.equal(calls, 1);
});
test('unknown, cancellation, revoked scope and invalid output are never safe retries', () => {
  for (const error of [{ code: 'EXECUTION_UNRESOLVED', stage: 'unknown' }, { code: 'AGENT_CANCELLED', stage: 'not_sent' }, { code: 'AGENT_POLICY_CHANGED' }, { code: 'AGENT_SCOPE_DENIED' }, { code: 'AGENT_RESULT_INVALID' }, { code: 'agent_timeout', stopConfirmed: true }]) assert.equal(control.safeToRetry(error), false);
  assert.equal(control.safeToRetry({ code: 'AUTHENTICATION_REQUIRED' }), true);
});
test('global capture settings cover new students without changing existing session ownership', async t => {
  const { root, store } = await fixture(t);
  const global = await store.saveGlobal({ ...control.globalDefaults(), enabled: true });
  const memory = require('../electron/agent-memory-v1.cjs').createAgentMemoryStore({ rootDir: path.join(root, 'memory'),
    resolveSettings: (_, saved) => ({ ...saved, automationEnabled: store.read().global.enabled, captureEpoch: store.read().global.captureEpoch, captureAuthorizedAt: store.read().global.authorizedAt, allowedAgents: ['codex'] }) });
  for (const id of ['one','two','new']) assert.equal(memory.getSettings(id).automationEnabled, true);
  const started = memory.startSession({ studentId: 'one', sessionId: 'session', agentId: 'codex' });
  memory.getSettings('two'); assert.equal(started.session.studentId, 'one');
  await store.saveGlobal({ ...global, enabled: false }); assert.equal(memory.getSettings('new').automationEnabled, false);
});
test('real CLI process receives stdin JSON and verifies all three task schemas before automatic use', async () => {
  const tool = { id: customId, target: process.execPath, args: [path.join(__dirname, 'fixtures/standard-cli.cjs')] };
  await assert.rejects(cli.createAdapter(tool), { code: 'CLI_CONTRACT_REQUIRED' });
  tool.verification = await cli.verify(tool);
  assert.deepEqual(tool.verification.profiles, registry.STRUCTURED_PROFILES);
  const adapter = await cli.createAdapter(tool);
  assert.deepEqual(await adapter.generate({ prompt: 'synthetic', schema: { type: 'object', required: ['answer'], properties: { answer: { type: 'integer' } } } }), { answer: 42 });
  await assert.rejects(cli.createAdapter({ ...tool, args: [...tool.args, 'changed'] }), { code: 'CLI_CONTRACT_REQUIRED' });
});
for (const mode of ['wait','bad','fail']) test(`CLI ${mode} is non-retriable and bounded`, async () => {
  const tool = { target: process.execPath, args: [path.join(__dirname, 'fixtures/standard-cli.cjs'), mode] };
  await assert.rejects(cli.invoke(tool, { requestId: crypto.randomUUID(), type: 'generate' }, { timeoutMs: 400 }), error => ['EXECUTION_UNRESOLVED','AGENT_RESULT_INVALID'].includes(error.code) && !control.safeToRetry(error));
});
test('CLI cancellation does not dispatch again', async () => {
  const controller = new AbortController();
  const promise = cli.invoke({ target: process.execPath, args: [path.join(__dirname, 'fixtures/standard-cli.cjs'), 'wait'] }, { requestId: 'cancel' }, { signal: controller.signal });
  setTimeout(() => controller.abort(), 150);
  await assert.rejects(promise, { code: 'AGENT_CANCELLED' });
});
test('custom result channels use safe Windows paths and preserve external identity', async t => {
  const { root } = await fixture(t), channels = require('../electron/agent-task-channel.cjs');
  const value = channels.taskResultDelivery(root, { id: 'task', executionId: 'exec', adapterId: customId, protocolVersion: '1.2' });
  assert.equal(value.identity.agentId, customId); assert.match(value.resultPath, /custom-12345678/);
  assert.throws(() => channels.agentTaskChannel(root, 'custom:../../other'));
});
test('effective global credentials remain limited to original student and reject revoked global access', async t => {
  const { store } = await fixture(t), source = await fs.readFile(path.join(__dirname, '../electron/main.cjs'), 'utf8');
  const ctx = vm.createContext({ require: name => require(path.join(__dirname, '../electron', name)),
    externalConnectorStore: () => ({ read: () => require('../electron/external-agent-connector.cjs').initialStore() }),
    agentControlStore: () => store, readAgentAccessGrantStore: () => ({}), resolveAgentAccessGrant: () => ({ studentId: 'one', allowedStudentIds: ['one'], allowedProjectIds: ['p1'], allowedAllStudents: false, capabilities: ['knowledge:query'] }),
    findStudentByKey: id => ({ id }), readProjects: () => [{ id: 'p1', studentIds: ['one'] }, { id: 'p2', studentIds: ['two'] }], normalizeProject: p => p });
  const start = source.indexOf('function effectiveAgentGrant('); vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), ctx);
  const global = await store.saveGlobal({ ...control.globalDefaults(), enabled: true });
  const grant = ctx.effectiveAgentGrant('synthetic'); assert.deepEqual([...grant.allowedStudentIds], ['one']); assert.deepEqual([...grant.allowedProjectIds], ['p1']); assert.equal(grant.allowedAllStudents, false);
  assert.deepEqual([...grant.capabilities], ['knowledge:query'], 'outbound enable must not expand an issued inbound token');
  await store.saveGlobal({ ...global, enabled: false }); assert.equal(ctx.effectiveAgentGrant('synthetic'), null);
});
test('host restart preserves LLM and custom unknown execution identities', () => {
  const tasks = ['llm-api', customId].map((adapterId, i) => ({ id: `t${i}`, status: 'running', executionMode: 'automatic', adapterId, executionId: `original-${i}` }));
  require('../electron/task-recovery-policy.cjs').reconcileInterruptedExecutions({ tasks });
  tasks.forEach((task, i) => { assert.equal(task.recoveryState, 'unknown'); assert.equal(task.executionId, `original-${i}`); assert.equal(task.autoRetry, false); });
});
test('actual handoff selection is single-flight and a delivered identity cannot be selected again', async t => {
  const { store } = await fixture(t), source = await fs.readFile(path.join(__dirname, '../electron/main.cjs'), 'utf8');
  await store.saveGlobal({ ...control.globalDefaults(), enabled: true });
  let task = { id: 'handoff', status: 'waiting_result', executionId: 'handoff-select-original', routeDecision: { stage: 'desktop_handoff' } }, sends = 0;
  const ctx = vm.createContext({ require: name => require(path.join(__dirname, '../electron', name)), aiExecutorRegistry: () => registry.executorRegistry(),
    agentControlStore: () => store, readTaskStore: () => ({ tasks: [structuredClone(task)] }), taskDispatchPending: new Map(),
    validateTaskPermissionDeclaration: () => ({ ok: true }), taskCommandFor: () => 'synthetic', notify() {},
    submitAgentHandoffTask: async (_, command, id) => { sends++; await new Promise(r => setTimeout(r, 10)); task = { ...task, executionId: 'sent-once', adapterId: id }; return { ok: true, task }; } });
  const start = source.indexOf('async function agentControlAction('); vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), ctx);
  const call = () => ctx.agentControlAction('handoffTarget', { taskId: 'handoff', providerId: 'doubao' });
  const results = await Promise.allSettled([call(), call()]); assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(sends, 1);
  await assert.rejects(call(), /已经交接/); assert.equal(task.executionId, 'sent-once');
});
test('production dispatch recovers existing output with original adapter and no provider route', async t => {
  const source = await fs.readFile(path.join(__dirname, '../electron/main.cjs'), 'utf8'); let received;
  const ctx = vm.createContext({ require: name => require(path.join(__dirname, '../electron', name)), DIGEST_PROFILE: profile,
    findStudentByKey: () => ({ id: 'student' }), agentControlPolicy: () => ({ enabled: true, version: 2, primary: 'llm-api' }),
    submitProjectMaterialAttempt: async (...args) => { received = args; return { ok: true }; } });
  const start = source.indexOf('async function submitProjectMaterialTask('); vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), ctx);
  await ctx.submitProjectMaterialTask({ id: 't', adapterId: 'codex', input: { materialExecution: { phase: 'committing', batchId: 'existing' } } }, { id: 'project', studentIds: ['student'] }, 'auto');
  assert.equal(received[2], 'codex'); assert.equal(received[3].commitRecovery, true);
});
test('production execution gate prevents a new request when globally disabled', async () => {
  const source = await fs.readFile(path.join(__dirname, '../electron/main.cjs'), 'utf8');
  const ctx = vm.createContext({ taskPowerRecovery: { canDispatch: () => true }, projectArchiveRuntime: { assertAccess() {} },
    readTaskStore: () => ({ tasks: [{ id: 't', kind: 'student_digest' }] }), agentControlStore: () => ({ read: () => ({ global: { enabled: false } }) }) });
  const start = source.indexOf('async function executeTaskByAdapterCore('); vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), ctx);
  assert.equal(JSON.parse(await ctx.executeTaskByAdapterCore('t', 'auto')).code, 'AGENT_SCOPE_DENIED');
});
test('all registered API and custom executors expose cancellation and result reception', async () => {
  const source = await fs.readFile(path.join(__dirname, '../electron/main.cjs'), 'utf8'), cancelled = [];
  const ctx = vm.createContext({ aiExecutorRegistry: () => registry.executorRegistry([{ id: customId, kind: 'cli', name: 'CLI' }]),
    adapterTaskStatus: () => ({}), adapterTaskResult: () => ({}), handoffAgentCapabilities: () => ({}),
    cancelRunningAdapterTask: id => cancelled.push(id), adapterCapabilities: () => ({}) });
  const start = source.indexOf('function getAgentExecutionAdapters('); vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), ctx);
  const adapters = ctx.getAgentExecutionAdapters();
  for (const id of ['llm-api',customId]) { assert.equal(typeof adapters[id].readResult, 'function'); adapters[id].cancel({ id }); }
  assert.deepEqual(cancelled, ['llm-api',customId]);
});

test('production task page uses live registry without connection probes and drops deleted custom options', async () => {
  const source = await fs.readFile(path.join(__dirname, '../electron/main.cjs'), 'utf8');
  let tools = [{ id: customId, kind: 'web', name: 'Synthetic Web' }];
  const ctx = vm.createContext({ aiExecutorRegistry: () => registry.executorRegistry(tools),
    agentControlStore: () => ({ read: () => ({ global: { enabled: true, disabledProviders: [] } }) }),
    adapterCapabilityCache: { value: { [customId]: { id: customId }, codex: { available: true, authorized: true, automatic: true } } },
    taskIoClient: { request: async () => ({ ok: true, ready: true, tasks: [] }) }, taskStorePath: () => '', taskSessionRunId:'synthetic-session',
    taskAutomationEnabled: () => true, taskStoreGuard: { status: () => ({}) },
    refreshAdapterCapabilities: () => assert.fail('listing must not probe') });
  for (const name of ['function registeredAdapterCapabilities(', 'async function getTaskPage(']) {
    const start = source.indexOf(name); vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), ctx);
  }
  let page = JSON.parse(await ctx.getTaskPage()); assert.equal(page.capabilities[customId].handoffOnly, true);
  assert.equal(Object.keys(page.capabilities).length, 16);
  tools = []; page = JSON.parse(await ctx.getTaskPage()); assert.equal(page.capabilities[customId], undefined);
  assert.equal(Object.keys(page.capabilities).length, 15);
});

test('a partial startup capability snapshot cannot hide the internal executor or force a manual packet', async () => {
  const source = await fs.readFile(path.join(__dirname, '../electron/main.cjs'), 'utf8');
  const context = vm.createContext({
    adapterCapabilityCache: { value: {
      workbuddy: { id: 'workbuddy', label: 'WorkBuddy', available: true, authorized: true, automatic: true },
    } },
    aiExecutorRegistry: () => [],
    agentControlStore: () => ({ read: () => ({ global: { enabled: true, disabledProviders: [] } }) }),
    readTaskStore: () => ({ runtime: { circuits: {} }, history: [] }),
    circuitDecision: () => ({ allowed: true }),
    taskNow: () => '2026-10-30T00:00:00.000Z',
  });
  for (const name of ['function registeredAdapterCapabilities(', 'function adapterCapabilities(', 'function routeTask(']) {
    const start = source.indexOf(name);
    vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
  }
  const capabilities = context.adapterCapabilities();
  assert.equal(capabilities.internal.available, true);
  assert.equal(capabilities.internal.authorized, true);
  const decision = context.routeTask({ kind: 'topic_suggestion_refresh', executionMode: 'internal', requestedExecutor: 'internal' }, 'internal', [], { preferRequested: true });
  assert.equal(decision.selectedAdapter, 'internal');
});
