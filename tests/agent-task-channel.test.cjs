const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const test = require('node:test');
const channel = require('../electron/agent-task-channel.cjs');
const protocol = require('../electron/task-protocol.cjs');
const { taskTimeoutDecision, repairTaskRuntimeStore } = require('../electron/task-runtime-policy.cjs');
const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');

function loadFunctions(context, names) {
  vm.createContext(context);
  for (const name of names) {
    let start = main.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, name);
    if (main.slice(start - 6, start) === 'async ') start -= 6;
    vm.runInContext(main.slice(start, main.indexOf('\n}', start) + 2), context);
  }
  return context;
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-agent-channel-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = { tasks: [], history: [] };
  let persisted = 0;
  const context = loadFunctions({ fs, path, crypto, ...channel, ...protocol,
    taskCenterDirPath: () => root, readTaskStore: () => store,
    writeTaskStoreDurably: async () => { persisted++; }, taskStoreGuard: { flush: async () => {} }, taskNow: () => new Date().toISOString(),
    timestampForFilename: () => 'test', appendTaskEvent() {}, notify() {}, isDigestTask: () => false,
    writeJsonFile: (file, value) => fs.writeFileSync(file, JSON.stringify(value)),
    transitionTaskInStore(_store, id, status, patch) {
      const task = store.tasks.find(item => item.id === id);
      Object.assign(task, patch, { status }); return { ok: true, task };
    },
    validateTaskCompletion: (_task, _startedAt, payload) => ({ valid: payload.verified === true, message: 'validated by host' }),
    normalizeTaskResult: (_task, payload, validation) => ({ ...payload, validation }),
    commitValidatedTaskResult(_store, task, result, validation, options) {
      Object.assign(task, { result, status: options.successful ? 'succeeded' : 'failed' }); return { ok: true, task };
    },
  }, ['quarantineAgentPayload', 'archiveAgentPayload', 'consumeAgentTaskResults', 'syncQClawTaskResults']);
  // Receipt acceptance remains deterministic; worker discovery is tested separately.
  context.syncAgentTaskResults = (agentId = '') => context.consumeAgentTaskResults(agentId, channel.discoverAgentTaskPayloads(root, agentId));
  function task(id, agentId) {
    const item = { id, adapterId: agentId, executor: agentId, executionId: `run-${id}`, protocolVersion: protocol.TASK_PROTOCOL_VERSION,
      status: 'waiting_result', executionMode: 'agent_handoff', startedAt: new Date().toISOString() };
    store.tasks.push(item); return item;
  }
  function write(item, overrides = {}, options = {}) {
    const delivery = channel.taskResultDelivery(root, item);
    const resultDir = options.legacy ? path.join(root, 'qclaw-results') : channel.agentTaskChannel(root, options.agentId || item.adapterId).resultPath;
    fs.mkdirSync(resultDir, { recursive: true });
    const file = path.join(resultDir, `${item.id}${options.suffix || ''}.result.json`);
    fs.writeFileSync(file, JSON.stringify({ ...delivery.identity, status: 'completed', verified: true, ...overrides }));
    return file;
  }
  return { root, context, store, task, write, persisted: () => persisted };
}

test('one sync imports WorkBuddy, Codex, generic agents and legacy QClaw; replay is idempotent', async t => {
  const f = fixture(t);
  for (const id of ['workbuddy', 'codex', 'claude-code', 'doubao', 'qclaw']) {
    const task = f.task(id, id); f.write(task, {}, { legacy: id === 'qclaw' });
  }
  const first = JSON.parse(await f.context.syncAgentTaskResults());
  assert.equal(first.imported, 5); assert.equal(first.rejected, 0);
  assert(f.store.tasks.every(task => task.status === 'succeeded'));
  assert(f.store.tasks.every(task => fs.existsSync(task.result.resultFile)));
  assert.equal(JSON.parse(await f.context.syncAgentTaskResults()).imported, 0);
});

test('selected channel sync does not consume another Agent result', async t => {
  const f = fixture(t);
  f.write(f.task('a', 'workbuddy')); const untouched = f.write(f.task('b', 'codex'));
  assert.equal(JSON.parse(await f.context.syncAgentTaskResults('workbuddy')).imported, 1);
  assert.equal(f.store.tasks[1].status, 'waiting_result'); assert(fs.existsSync(untouched));
  assert.equal(JSON.parse(await f.context.syncAgentTaskResults('codex')).imported, 1);
});

test('legacy QClaw worker identities remain readable through the old IPC alias', async t => {
  const f = fixture(t); const task = f.task('legacy', 'qclaw');
  f.write(task, { status: undefined, agentId: 'student-agent-1', claimedAt: new Date().toISOString() }, { legacy: true, suffix: '-claim' });
  const result = JSON.parse(await f.context.syncQClawTaskResults());
  assert.equal(result.claimed, 1); assert.equal(result.rejected, 0);
  assert.equal(task.result.claimedBy, 'student-agent-1');
});

test('stale execution, wrong channel, cancelled task and invalid JSON are quarantined', async t => {
  const f = fixture(t);
  const a = f.task('a', 'workbuddy'); f.write(a, { executionId: 'old-run' });
  const b = f.task('b', 'codex'); f.write(b, {}, { agentId: 'workbuddy' });
  const c = f.task('c', 'doubao'); c.status = 'cancelled'; f.write(c);
  const d = f.task('d', 'workbuddy'); const invalid = f.write(d); fs.writeFileSync(invalid, '{broken');
  const result = JSON.parse(await f.context.syncAgentTaskResults());
  assert.equal(result.rejected, 4); assert.equal(result.imported, 0);
  assert.deepEqual(f.store.tasks.map(task => task.status), ['waiting_result', 'waiting_result', 'cancelled', 'waiting_result']);
  assert(fs.readdirSync(path.join(f.root, 'agent-results/workbuddy/rejected')).some(name => name.endsWith('.reason.json')));
});

test('claim then result in one pass settles the same execution, host validation remains authoritative', async t => {
  const f = fixture(t); const item = f.task('a', 'workbuddy');
  f.write(item, { status: undefined, claimedAt: new Date().toISOString() }, { suffix: '-claim' });
  f.write(item, { verified: false, validation: { passed: true } });
  const result = JSON.parse(await f.context.syncAgentTaskResults());
  assert.equal(result.claimed, 1); assert.equal(result.imported, 1); assert.equal(item.status, 'failed');
});

test('task packets include current execution identity and bounded Agent return path', t => {
  const f = fixture(t); const task = f.task('a', 'workbuddy');
  const ctx = loadFunctions({ fs, path, ...channel, taskCenterDirPath: () => f.root,
    taskNow: () => new Date().toISOString(), ARCHIVE_ACCESS_SCHEMA: 'archive', REMOTE_ARCHIVE_REQUEST_SCHEMA: 'remote',
    currentArchiveAccess: () => ({ buildContextBundle: () => ({ resources: [] }) }),
    writeJsonFile: (file, value) => fs.writeFileSync(file, JSON.stringify(value)),
  }, ['writeTaskPacket']);
  const packet = ctx.writeTaskPacket(task, channel.agentTaskChannel(f.root, 'workbuddy').inboxPath, '处理已选资料');
  const json = JSON.parse(fs.readFileSync(packet.packetPath, 'utf8'));
  assert.equal(json.resultDelivery.identity.executionId, task.executionId);
  assert(packet.command.includes(json.resultDelivery.resultPath));
  assert(packet.command.includes(task.executionId));
  assert(fs.readFileSync(packet.promptPath, 'utf8').includes(packet.command));
  assert.throws(() => channel.agentTaskChannel(f.root, '../escape'));
  assert.throws(() => channel.agentTaskChannel(f.root, 'unregistered-agent'));
});

test('WorkBuddy and generic handoffs survive long user waits and restore old false timeouts', () => {
  for (const executionMode of ['desktop_handoff', 'agent_handoff']) {
    const item = { id: 'a', status: 'waiting_result', adapterId: 'workbuddy', executionMode,
      executionId: 'run-a', startedAt: '2026-10-01T00:00:00Z' };
    assert.equal(taskTimeoutDecision(item, Date.parse('2026-10-10T00:00:00Z')).enabled, false);
    item.status = 'timed_out'; item.error = { code: 'HEARTBEAT_LOST' };
    assert.equal(repairTaskRuntimeStore({ tasks: [item] }).changed, true);
    assert.equal(item.status, 'waiting_result');
  }
});

test('opening a dotted Agent ID opens its channel, and manual/legacy packets remain reachable', t => {
  const f = fixture(t); const opened = [];
  const ctx = loadFunctions({ fs, path, taskCenterDirPath: () => f.root,
    agentTaskInboxPath: id => channel.agentTaskChannel(f.root, id).inboxPath,
    agentTaskResultPath: id => channel.agentTaskChannel(f.root, id).resultPath,
    qclawTaskInboxPath: () => path.join(f.root, 'qclaw-inbox'),
    qclawTaskResultPath: () => path.join(f.root, 'qclaw-results'),
    taskManualOutboxPath: () => path.join(f.root, 'manual-outbox'),
    taskEventLogPath: () => path.join(f.root, 'events.jsonl'),
    shell: { openPath: value => opened.push(value) },
  }, ['openTaskCenterPath']);
  for (const id of ['workbuddy', 'ima.copilot', 'manual', 'qclaw']) {
    const result = JSON.parse(ctx.openTaskCenterPath('agent-inbox', id)); assert.equal(result.ok, true);
  }
  assert.equal(opened[1], path.join(f.root, 'agent-inbox', 'ima.copilot'));
  assert.equal(opened[2], path.join(f.root, 'manual-outbox'));
  assert.equal(opened[3], path.join(f.root, 'qclaw-inbox'));
  assert.equal(JSON.parse(ctx.openTaskCenterPath('agent-inbox', '../escape')).ok, false);
});

test('smart routing excludes QClaw and unautomated generic handoffs; explicit choices remain usable', () => {
  const caps = { ...channel.handoffAgentCapabilities(),
    codex: { id: 'codex', label: 'Codex', available: true, authorized: true, automatic: true },
    qclaw: { id: 'qclaw', label: 'QClaw', available: true, authorized: true, automatic: true },
    manual: { id: 'manual', label: 'Manual', available: true, authorized: true, automatic: false } };
  const ctx = loadFunctions({ agentControlStore: () => ({ read: () => ({}) }), registeredAdapterCapabilities: () => caps, adapterCapabilities: () => { throw Error('routing must not probe'); }, readTaskStore: () => ({ history: [] }), taskNow: () => '' }, ['routeTask']);
  const smart = ctx.routeTask({ kind: 'student_digest' }, 'auto');
  assert.equal(smart.selectedAdapter, 'codex');
  assert(!smart.candidates.some(candidate => candidate.adapterId === 'qclaw' || candidate.adapterId === 'doubao'));
  assert.equal(ctx.routeTask({}, 'doubao').selectedAdapter, 'doubao');
  assert.equal(ctx.routeTask({}, 'qclaw').selectedAdapter, 'qclaw');
});
