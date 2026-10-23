const test = require('node:test');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { queryTaskSnapshot, taskPresentation, taskReadIndex, scheduledAtTime } = require('../electron/task-read-model.cjs');
const { createTaskProgressBuffer } = require('../electron/task-progress-buffer.cjs');
const { createTaskIoClient } = require('../electron/task-io-client.cjs');
const { createTaskInboxReader } = require('../electron/task-inbox-reader.cjs');
const { createTaskRetryQueue } = require('../electron/task-retry-queue.cjs');
const { automaticTaskDispatchDecision, AUTOMATIC_TASK_KINDS } = require('../electron/task-auto-dispatch.cjs');

function fixtures(count) {
  return { protocolVersion: '1.2', updatedAt: '2026-10-11T10:00:00Z', tasks: Array.from({ length: count }, (_, i) => ({
    id: `task-${i}`, title: `合成资料 ${i}`, kind: 'student_digest', sourceType: i % 2 ? 'project' : 'student', sourceId: String(i % 10),
    status: i % 3 ? 'succeeded' : 'running', executor: 'codex', executionMode: 'automatic', executionId: `run-${i}`,
    updatedAt: '2026-10-11T10:00:00Z', input: { privatePrompt: 'not-in-summary'.repeat(20) },
    result: { summary: '合成结果'.repeat(200), validation: { valid: true }, resultFile: `/synthetic/${i}.json` },
  })), history: [] };
}
test('10k tasks are filtered and paginated before returning a whitelist summary', () => {
  const store = fixtures(10000);
  const result = queryTaskSnapshot(store, { source: 'student', page: 2 });
  assert.equal(result.summary.total, 10000); assert.equal(result.filteredTotal, 5000);
  assert.equal(result.tasks.length, 20); assert.equal(result.pageCount, 250);
  assert.ok(result.tasks.every(t => t.sourceType === 'student'));
  assert.ok(result.tasks.every(t => !t.input && !t.result && !t.permissions));
  assert.ok(JSON.stringify(result).length < 20000);
  assert.equal(queryTaskSnapshot(fixtures(2), { page: -1 }).page, 1);
  assert.strictEqual(taskReadIndex(store), taskReadIndex(store), 'unchanged worker snapshot reuses its derived 10k-task index');
  assert.notStrictEqual(taskReadIndex(store), taskReadIndex({ ...store }), 'new durable snapshot invalidates the derived index by identity');
});
test('unacknowledged handoff has no result and does not occupy a compute slot', () => {
  const task = { status: 'waiting_result', executionMode: 'desktop_handoff', result: { packet: { packetPath: 'task.json' } } };
  const presentation = taskPresentation(task);
  assert.equal(presentation.statusGroup, 'actionable');
  assert.equal(presentation.userGroup, 'needs_help');
  assert.equal(presentation.phaseLabel, '等待发送确认');
  assert.equal(presentation.awaitingSend, true);
  assert.equal(presentation.hasResult, false);
  assert.equal(presentation.occupiesExecutionSlot, false);
  assert.equal(presentation.resolution, null);
  assert.equal(presentation.nextAction, '请在桌面工具检查任务内容并发送；未收到领取确认。');
  assert.equal(taskPresentation({ ...task, result: { claimedAt: 'now' } }).awaitingSend, false);
});
test('clock-only schedules remain automatic before their local due time', () => {
  const morning = new Date('2026-10-21T08:00:00+08:00').getTime();
  assert.equal(scheduledAtTime('21:30', morning), new Date('2026-10-21T21:30:00+08:00').getTime());
  const now = new Date();
  const future = new Date(now.getTime() + 60 * 60 * 1000);
  if (future.getDate() === now.getDate()) {
    const scheduledAt = `${String(future.getHours()).padStart(2, '0')}:${String(future.getMinutes()).padStart(2, '0')}`;
    const presentation = taskPresentation({ status: 'pending', trigger: 'schedule', scheduledAt, executionMode: 'automatic' });
    assert.equal(presentation.statusGroup, 'scheduled');
    assert.equal(presentation.userGroup, 'automatic');
    assert.equal(presentation.phaseLabel, '按计划开始');
  }
});
test('automatic task presentation separates queued work from real user action', () => {
  const automatic = taskPresentation({ status: 'pending', kind: 'student_digest', trigger: 'event', executionMode: 'adapter', automaticExecution: true });
  assert.equal(automatic.userGroup, 'automatic');
  assert.equal(automatic.requiresUserAction, false);
  assert.equal(automatic.automationState, 'waiting_dispatch');
  const resource = taskPresentation({ status: 'approved', kind: 'student_digest', trigger: 'event', executionMode: 'adapter', resourceDeferredAt: 'now', resourceRetryAt: 'later' });
  assert.equal(resource.userGroup, 'automatic'); assert.equal(resource.automationState, 'waiting_resource');
  const approval = taskPresentation({ status: 'pending', trigger: 'event', executionMode: 'adapter', approval: { required: true, status: 'pending' } });
  assert.equal(approval.userGroup, 'needs_help'); assert.equal(approval.automationState, 'approval_required');
});
test('automatic dispatch policy admits only safe due work', () => {
  const base = { id: 'one', kind: 'student_digest', status: 'pending', trigger: 'event', executionMode: 'adapter', attempt: 0 };
  assert.equal(automaticTaskDispatchDecision(base, { kinds: AUTOMATIC_TASK_KINDS }).eligible, true);
  assert.equal(automaticTaskDispatchDecision({ ...base, manualOnly: true }, { kinds: AUTOMATIC_TASK_KINDS }).reason, 'manual_only');
  assert.equal(automaticTaskDispatchDecision({ ...base, status: 'waiting_result' }, { kinds: AUTOMATIC_TASK_KINDS }).reason, 'not_waiting_dispatch');
  assert.equal(automaticTaskDispatchDecision({ ...base, approval: { required: true, status: 'pending' } }, { kinds: AUTOMATIC_TASK_KINDS, approvalRequired: true }).reason, 'approval_required');
  assert.equal(automaticTaskDispatchDecision({ ...base, trigger: 'manual', automaticExecution: false }, { kinds: AUTOMATIC_TASK_KINDS }).reason, 'manual_only');
});
test('progress buffering never changes ordering, crosses execution identities, or revives completed tasks', () => {
  const buffer = createTaskProgressBuffer(), store = fixtures(3);
  const before = store.tasks[0].updatedAt;
  buffer.record('task-0', 'run-0', 'later', 'process_alive');
  buffer.record('task-1', 'run-1', 'later', 'committed', true);
  buffer.record('task-2', 'other-run', 'later', 'stdout');
  buffer.apply(store);
  assert.equal(store.tasks[0].lastHeartbeatAt, 'later');
  assert.equal(store.tasks[0].lastProgressAt, undefined);
  assert.equal(store.tasks[0].updatedAt, before);
  assert.equal(store.tasks[1].lastHeartbeatAt, undefined);
  assert.equal(store.tasks[2].lastHeartbeatAt, undefined);
  buffer.record('task-0', 'run-0', 'later2', 'result_validated', true); buffer.apply(store);
  assert.equal(store.tasks[0].lastProgressAt, 'later2');
  buffer.clear(); assert.equal(buffer.size, 0);
});
test('worker reads are asynchronous, deduplicated, and do not fabricate an empty corrupt store', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-task-query-'));
  const client = createTaskIoClient();
  t.after(async () => { client.close(); await fs.rm(root, { recursive: true, force: true }); });
  const file = path.join(root, 'tasks.json');
  assert.equal((await client.request(file)).ready, false);
  await fs.writeFile(file, JSON.stringify(fixtures(1000)));
  const a = client.request(file, 'list', { page: 2 }), b = client.request(file, 'list', { page: 2 });
  assert.equal(a, b);
  assert.equal((await a).tasks.length, 20);
  assert.equal((await client.request(file, 'detail', { id: 'task-1' })).task.input.privatePrompt.startsWith('not-in-summary'), true);
  assert.equal((await client.request(file, 'statuses', { ids: ['task-1'] })).tasks.length, 1);
  await fs.writeFile(file, '{broken');
  const failed = await client.request(file);
  assert.equal(failed.ok, false); assert.equal(failed.tasks, undefined);
});
test('incremental receipt scanner waits for stable files, bounds batches, and reuses parsed content', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-inbox-query-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dir = path.join(root, 'agent-results', 'workbuddy'); await fs.mkdir(dir, { recursive: true });
  let clock = 1000;
  const scanner = createTaskInboxReader({ now: () => clock });
  const file = path.join(dir, 'first.result.json');
  await fs.writeFile(file, '{partial');
  assert.equal((await scanner.scan(root)).results.length, 0);
  clock += 1000;
  assert.equal((await scanner.scan(root)).results.length, 0);
  assert.equal((await scanner.scan(root)).reads, 0, 'unchanged partial JSON is not reparsed');
  await fs.writeFile(file, JSON.stringify({ taskId: 'one', executionId: 'run', status: 'completed' }));
  await scanner.scan(root); clock += 1000;
  const parsed = await scanner.scan(root); assert.equal(parsed.results.length, 1);
  assert.equal((await scanner.scan(root)).reads, 0);
  await fs.unlink(file);
  for (let i = 0; i < 70; i++) await fs.writeFile(path.join(dir, `${i}.result.json`), JSON.stringify({ taskId: `${i}`, executionId: 'run', status: 'completed' }));
  await scanner.scan(root); clock += 1000;
  assert.equal((await scanner.scan(root)).results.length, 50);
});
test('stable invalid and oversized receipts are isolated without reading unbounded bytes', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-inbox-invalid-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dir = path.join(root, 'agent-results', 'workbuddy'); await fs.mkdir(dir, { recursive: true });
  let clock = 100;
  const scanner = createTaskInboxReader({ now: () => clock, maxBytes: 20 });
  await fs.writeFile(path.join(dir, 'bad.result.json'), '{');
  await fs.writeFile(path.join(dir, 'big.result.json'), 'x'.repeat(30));
  await scanner.scan(root); clock += 31000;
  const result = await scanner.scan(root);
  assert.equal(result.results.length, 2);
  assert.ok(result.results.some(r => r.invalidReason === 'RESULT_TOO_LARGE'));
});

test('receipt batches are bounded by bytes as well as file count', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-inbox-budget-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dir = path.join(root, 'agent-results', 'workbuddy'); await fs.mkdir(dir, { recursive: true });
  const raw = JSON.stringify({ taskId: 'test', message: 'x'.repeat(200) });
  for (let i = 0; i < 4; i++) await fs.writeFile(path.join(dir, `${i}.json`), raw);
  const scanner = createTaskInboxReader({ stableMs: 0, batchBytes: Buffer.byteLength(raw) * 2 });
  const batch = await scanner.scan(root);
  assert.equal(batch.results.length, 2); assert.equal(batch.deferred, 2); assert.equal(batch.reads, 2);
});

test('resource waits share one timer and bounded draining, errors do not block other tasks', async () => {
  let clock = 100, sequence = 0, yields = 0;
  const timers = new Map(), calls = [], errors = [];
  const queue = createTaskRetryQueue({ now: () => clock, batchSize: 20,
    setTimer: (callback, delay) => { const id = ++sequence; timers.set(id, { callback, delay }); return id; },
    clearTimer: id => timers.delete(id), yieldTurn: async () => { yields++; },
    run: id => { calls.push(id); if (id === 't-0') throw new Error('synthetic'); }, onError: e => errors.push(e.message) });
  for (let i = 0; i < 1000; i++) queue.schedule(`t-${i}`, 'codex');
  assert.equal(timers.size, 1); assert.equal(queue.size, 1000);
  clock += 15000;
  const tick = async () => { const [id, timer] = timers.entries().next().value; timers.delete(id); await timer.callback(); };
  await tick(); assert.equal(calls.length, 20); assert.equal(yields, 20);
  assert.equal(errors.length, 1); assert.equal(timers.size, 1);
  queue.delete('t-20'); await tick(); assert.ok(!calls.includes('t-20'));
  queue.close(); assert.equal(timers.size, 0); assert.equal(queue.size, 0);
  queue.schedule('closed', 'codex'); assert.equal(timers.size, 0);
});

test('event wake queue deduplicates bursts and enforces a global minimum drain interval', async () => {
  let clock = 0, sequence = 0;
  const timers = new Map(), calls = [];
  const queue = createTaskRetryQueue({ now: () => clock, minimumDrainIntervalMs: 15000,
    setTimer: (callback, delay) => { const id = ++sequence; timers.set(id, { callback, delay }); return id; },
    clearTimer: id => timers.delete(id), yieldTurn: async () => {}, run: id => calls.push(id) });
  for (let i = 0; i < 100; i++) queue.schedule('same-task', 'event', 2000);
  assert.equal(queue.size, 1); assert.equal(timers.size, 1); assert.equal(queue.has('same-task'), true);
  clock = 2000;
  let entry = timers.entries().next().value; timers.delete(entry[0]); await entry[1].callback();
  assert.deepEqual(calls, ['same-task']);
  queue.schedule('next-task', 'event', 2000);
  entry = timers.entries().next().value;
  assert.equal(entry[1].delay, 15000);
  queue.close();
});

test('main page reads have no business scans and shutdown releases the added resources', async () => {
  const source = await fs.readFile(path.join(__dirname, '../electron/main.cjs'), 'utf8');
  const renderer = await fs.readFile(path.join(__dirname, '../src/main.tsx'), 'utf8');
  const body = source.slice(source.indexOf('async function getTaskPage('), source.indexOf('function getTaskStatuses('));
  assert.doesNotMatch(body, /buildTaskCenterCandidates|syncAgentTaskResults|refreshAdapterCapabilities|enforceTaskTimeouts/);
  assert.match(source, /startDigestWorkflowMonitor\(\);\s*startTaskReadMaintenance\(\);/);
  assert.match(source, /taskIoClient\.close\(\)/);
  assert.match(source, /heavyTaskRetryQueue\.close\(\)/);
  assert.match(source, /automaticTaskWakeQueue\.close\(\)/);
  assert.match(source, /minimumDrainIntervalMs: 15_000/);
  assert.match(source, /batchSize: 20/);
  assert.match(source, /推荐报告路径：\$\{reportPath\}/);
  assert.match(source, /也可以在现有报告目录中生成新的 Markdown：\$\{outputPath\}/);
  assert.match(source, /task\.kind === 'maintenance_lint'/);
  assert.match(source, /task\.kind !== 'maintenance_lint' \|\| item\.size <= 2 \* 1024 \* 1024/);
  const maintenance = source.slice(source.indexOf('async function maintainTaskReadModel('), source.indexOf('async function getTaskPage('));
  assert.doesNotMatch(maintenance, /executeTaskByAdapter|refreshAdapterCapabilities/);
  assert.match(maintenance, /setImmediate\(resolve\)/);
  const wake = source.slice(source.indexOf('async function resumeAutomaticTaskWake('), source.indexOf('async function reopenTaskHandoff('));
  assert.doesNotMatch(wake, /runUnifiedTaskScheduler|runProjectAutomationSweep|buildTaskCenterCandidates|refreshAdapterCapabilities/);
  assert.match(wake, /automaticTaskWakeDecision\(task\)/);
  assert.match(wake, /taskDispatchPending\.get\(id\)/);
  const scheduler = source.slice(source.indexOf('async function runUnifiedTaskScheduler('), source.indexOf('function startUnifiedTaskScheduler('));
  assert.match(scheduler, /scheduleAutomaticTaskWakeups/);
  assert.doesNotMatch(scheduler, /due\.map\(\(task\).*executeTaskByAdapter/s);
  assert.match(renderer, /userSummary: result\.userSummary/);
  assert.match(renderer, /立即提高优先级/);
  assert.match(renderer, /setTaskCenterStatusFilter\(item\.id\);[\s\S]{0,300}setTaskCenterSourceFilter\('all'\);[\s\S]{0,300}setTaskCenterExecutorFilter\('all'\)/);
});

test('maintenance validation accepts only a fresh Markdown report in a controlled report directory', async t => {
  const source = await fs.readFile(path.join(__dirname, '../electron/main.cjs'), 'utf8');
  const body = source.slice(source.indexOf('function validateTaskArtifacts('), source.indexOf('function normalizeTaskResult('));
  const root = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'edu-maintenance-report-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const manager = path.join(root, '.ai-manager');
  const output = path.join(root, '输出结果');
  await fs.mkdir(manager, { recursive: true });
  await fs.mkdir(output, { recursive: true });
  const report = path.join(output, '知识库健康检查.md');
  await fs.writeFile(report, '# 检查结果\n', 'utf8');
  const context = {
    fs: require('node:fs'), path: require('node:path'), PERIODIC_REPORT_TASKS: {},
    readStudentsIndex: () => [{ id: 'student-1', name: '测试学生', rootPath: root, outputPath: output }],
    toHostStudent: value => value,
    studentAiManagerDir: () => manager,
    getStudentRootDir: () => root,
    isSameOrInsidePath: (base, candidate) => {
      const relative = path.relative(base, candidate);
      return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    },
    validateDailyActionDocument: () => ({ errors: [] }), validateSectionedReport: () => ({ errors: [] }),
    isAutoPublishReportTask: () => false, recoveryBudget: () => ({ limits: {}, correctionAttempts: 0 }),
    taskNow: () => new Date().toISOString(),
  };
  vm.runInNewContext(`${body}\nthis.validateTaskArtifacts = validateTaskArtifacts;`, context);
  const result = context.validateTaskArtifacts({ kind: 'maintenance_lint', sourceId: 'student-1', expectedOutput: { path: path.join(manager, 'maintenance-report.md') } }, new Date(Date.now() - 5_000).toISOString());
  assert.equal(result.valid, true);
  assert.equal(result.artifacts.some(item => item.path === report && item.exists), true);
  const outside = path.join(root, '其他目录');
  await fs.mkdir(outside);
  const outsideReport = path.join(outside, '不应接受.md');
  await fs.writeFile(outsideReport, '# outside', 'utf8');
  const outsideOnly = context.validateTaskArtifacts({ kind: 'maintenance_lint', sourceId: 'student-1', expectedOutput: {} }, new Date(Date.now() + 60_000).toISOString(), { artifacts: [outsideReport] });
  assert.equal(outsideOnly.valid, false);
});

test('receipt watcher only notifies changes and closed clients cannot recreate workers', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-inbox-watch-'));
  const dir = path.join(root, 'agent-results', 'workbuddy'); await fs.mkdir(dir, { recursive: true });
  let changed;
  const notification = new Promise(resolve => { changed = resolve; });
  const client = createTaskIoClient({ onInboxChanged: () => changed() });
  t.after(async () => { client.close(); await fs.rm(root, { recursive: true, force: true }); });
  assert.ok((await client.request(path.join(root, 'tasks.json'), 'watch')).watching >= 1);
  const file = path.join(dir, 'one.result.json');
  await fs.writeFile(file, JSON.stringify({ taskId: 'synthetic' }));
  let timeout;
  try { await Promise.race([notification, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('watch notification timeout')), 5000); })]); }
  finally { clearTimeout(timeout); }
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).taskId, 'synthetic');
  client.close(); await assert.rejects(client.request(path.join(root, 'tasks.json')), /已关闭/);
});

test('a timed-out page read does not terminate the durable task worker', async () => {
  class FakeWorker extends EventEmitter {
    constructor() { super(); this.messages = []; this.terminated = false; }
    unref() {}
    postMessage(message) {
      this.messages.push(message);
      if (message.op === 'detail') setImmediate(() => this.emit('message', { id: message.id, value: { ok: true, task: { id: 'next' } } }));
    }
    terminate() { this.terminated = true; return Promise.resolve(); }
  }
  const worker = new FakeWorker();
  const client = createTaskIoClient({ workerFactory: () => worker, readTimeoutMs: 20, durableTimeoutMs: 100 });
  await assert.rejects(client.request('tasks.json', 'list', { page: 1 }), /任务快照读取超时/);
  assert.equal(worker.terminated, false);
  assert.equal((await client.request('tasks.json', 'detail', { id: 'next' })).task.id, 'next');
  client.close();
});

test('a timed-out durable write still closes the uncertain worker', async () => {
  class FakeWorker extends EventEmitter {
    constructor() { super(); this.terminated = false; }
    unref() {}
    postMessage() {}
    terminate() { this.terminated = true; return Promise.resolve(); }
  }
  const worker = new FakeWorker();
  const client = createTaskIoClient({ workerFactory: () => worker, readTimeoutMs: 20, durableTimeoutMs: 20 });
  await assert.rejects(client.request('tasks.json', 'store_write', { value: {}, revision: 1 }), /持久化等待超时/);
  assert.equal(worker.terminated, true);
  client.close();
});
