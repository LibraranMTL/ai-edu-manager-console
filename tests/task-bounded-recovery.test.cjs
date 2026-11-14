'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const policy = require('../electron/task-recovery-policy.cjs');
const recoveryExperience = require('../electron/task-recovery-experience.cjs');
const taskIdentity = require('../electron/task-work-identity.cjs');
const { createTaskRetryQueue } = require('../electron/task-retry-queue.cjs');
const { taskTimeoutDecision, repairTaskRuntimeStore } = require('../electron/task-runtime-policy.cjs');
const source = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
function load(name, context) {
  let start = source.indexOf(`function ${name}(`); assert(start >= 0);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  context.taskPowerRecovery ||= { canDispatch: () => true };
  context.taskWorkIdentity ||= taskIdentity.taskWorkIdentity;
  context.normalizePriorityClass ||= taskIdentity.normalizePriorityClass;
  context.normalizeBusinessOutcome ||= taskIdentity.normalizeBusinessOutcome;
  vm.createContext(context);
  vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
  return context[name];
}
const task = () => ({ id: 't', sourceType: 'student', sourceId: 's', status: 'failed', executionId: 'e',
  idempotencyKey: 'batch-v1', attempt: 1, maxAttempts: 9, autoRetry: true });

test('backoff is 1 then 5 minutes, jitter never runs early and two routing rounds cap at six', () => {
  const now = Date.parse('2026-10-11T00:00:00Z');
  for (const attempt of [1, 2, 3, 6]) {
    const result = policy.taskRetryDecision({ ...task(), attempt }, { code: '503' }, { now, random: () => 1, stopConfirmed: true });
    if (attempt === 6) { assert.equal(result.nextRetryAt, ''); assert.equal(result.autoRetry, false); }
    else assert.equal(Date.parse(result.nextRetryAt) - now, attempt === 1 ? 66000 : 330000);
  }
});
test('Retry-After seconds/date is respected even when it exceeds the local backoff', () => {
  const now = Date.parse('2026-10-11T00:00:00Z');
  for (const retryAfter of ['900', 'Sun, 11 Oct 2026 00:15:00 GMT']) {
    const result = policy.taskRetryDecision(task(), { code: '429' }, { now, random: () => 0, stopConfirmed: true, retryAfter });
    assert.equal(Date.parse(result.nextRetryAt), now + 900000);
  }
});
test('invalid outputs, authentication and permission failures never enter automatic retry', () => {
  for (const failure of [{ code: '401' }, { message: '权限不足' }, { category: 'validation', message: 'HTTP 503 in supplied material' }, { message: '观察项不能写成正式定论' }, { message: 'Agent exit 1' }]) {
    const result = policy.taskRetryDecision(task(), failure, { stopConfirmed: true });
    assert.equal(result.nextRetryAt, ''); assert.equal(result.autoRetry, false);
  }
});
test('a lost network response does not prove remote work stopped', () => {
  const result = policy.taskRetryDecision(task(), { code: 'ECONNRESET' });
  assert.equal(result.recoveryState, 'unknown'); assert.equal(result.nextRetryAt, '');
});
test('persisted decisions are bound to cycle, attempt and execution; old failed tasks are not bulk retried', () => {
  const t = task(); Object.assign(t, policy.taskRetryDecision(t, { code: '503' }, { now: 0, random: () => 0, stopConfirmed: true }));
  const restored = JSON.parse(JSON.stringify(t));
  assert.equal(policy.taskRetryEligible(restored, 59999), false);
  assert.equal(policy.taskRetryEligible(restored, 60000), true);
  for (const patch of [{ executionId: 'new' }, { idempotencyKey: 'batch-v2' }, { input: { digestBatchId: 'new-batch' } }, { sourceId: 'another-student' }, { attempt: 2 }, { nextRetryAt: new Date(0).toISOString() }, { status: 'succeeded' }, { recoveryState: 'unknown' }, { retryRecovery: null }]) {
    assert.equal(policy.taskRetryEligible({ ...restored, ...patch }, Infinity), false);
  }
  assert.equal(policy.taskRetryEligible({ ...task(), nextRetryAt: new Date(0).toISOString() }, Infinity), false);
});
test('restart retains unknown identities and does not quarantine a live runner or a desktop handoff', () => {
  const a = { ...task(), status: 'running', executionMode: 'automatic', adapterId: 'codex', startedAt: '2026-10-11T00:00:00Z' };
  const b = { ...a, id: 'live' }, c = { ...a, id: 'desktop', executionMode: 'desktop_handoff', status: 'waiting_result' };
  const store = { tasks: [a, b, c] };
  assert.equal(policy.reconcileInterruptedExecutions(store, new Set(['live:e'])).length, 1);
  assert.equal(a.recoveryState, 'unknown'); assert.equal(a.executionId, 'e');
  assert.equal(b.recoveryState, undefined); assert.equal(c.recoveryState, undefined);
  repairTaskRuntimeStore(store);
  assert.equal(a.executionId, 'e'); assert.equal(taskTimeoutDecision(a).due, false);
});
test('actual timeout handler retains process ownership, cancels once and never schedules replacement', () => {
  let kills = 0, writes = 0;
  const t = { ...task(), status: 'running' };
  const runner = { child: { killed: false, kill() { kills++; } } };
  const context = { Date, taskProgressBuffer: { apply() {} }, taskTimeoutDecision: () => ({ enabled: true, due: true, kind: 'execution', error: { code: 'TASK_TIMEOUT', message: '超时' } }),
    taskChildProcesses: new Map([['t', runner]]), clearTaskProcessHeartbeat() {}, unknownExecutionPatch: policy.unknownExecutionPatch,
    taskExecutionClass: recoveryExperience.taskExecutionClass, internalStoppedPatch: recoveryExperience.internalStoppedPatch,
    executionProvenance: recoveryExperience.executionProvenance, appendTaskEvent() {},
    businessTaskRetryQueue: { delete() {} }, transitionTaskInStore: (_store, _id, status, patch) => { Object.assign(t, patch, { status }); writes++; return { ok: true }; },
    setTimeout() { assert.fail('per-task retry timer forbidden'); } };
  assert.equal(load('enforceTaskTimeouts', context)({ tasks: [t] }), true);
  assert.equal(kills, 1); assert.equal(writes, 1);
  assert.equal(context.taskChildProcesses.get('t'), runner);
  assert.equal(t.recoveryState, 'unknown'); assert.equal(t.nextRetryAt, '');
});
test('critical material commit is never interrupted by timeout', () => {
  const context = { Date, taskProgressBuffer: { apply() {} }, taskTimeoutDecision: () => ({ enabled: true, due: true }),
    taskChildProcesses: new Map([['t', { materialRuntime: { canCancel: false } }]]) };
  assert.equal(load('enforceTaskTimeouts', context)({ tasks: [task()] }), false);
});
test('actual business wake-up pauses for storage failure and does not dispatch', () => {
  const queued = [];
  const context = { taskAutomationEnabled: () => true, publicLicenseStatus: () => ({ active: true }),
    projectArchiveRuntime: { status: () => ({ ready: true }) }, taskStoreGuard: { status: () => ({ code: 'disk_full' }) },
    businessTaskRetryQueue: { schedule: (...args) => queued.push(args) }, readTaskStore() { assert.fail('faulted store must not be read'); } };
  load('resumeBusinessTaskRetry', context)('t', 'codex');
  assert.deepEqual(queued, [['t', 'codex', 60000]]);
});
test('actual fallback refuses early or identity-invalid decisions before routing or writing', () => {
  const t = task(); const context = { readTaskStore: () => ({ tasks: [t] }), taskRetryEligible: policy.taskRetryEligible,
    appendTaskEvent() { assert.fail('no error expected'); }, routeTask() { assert.fail('no routing'); } };
  const result = load('fallbackTaskAfterFailure', context)('t', 'codex');
  assert.equal(result.skipped, true);
});
test('thousands of retry entries share one timer, cancellation is stale-safe', async () => {
  let now = 0, serial = 0;
  const timers = new Map(), ran = [];
  const queue = createTaskRetryQueue({ now: () => now, setTimer: (fn, delay) => { const id = ++serial; timers.set(id, { fn, delay }); return id; },
    clearTimer: id => timers.delete(id), yieldTurn: async () => {}, run: id => ran.push(id) });
  for (let i = 0; i < 1000; i++) queue.schedule(String(i), 'codex', 60000);
  assert.equal(timers.size, 1);
  queue.delete('0'); now = 60000;
  const [id, timer] = [...timers][0]; timers.delete(id); await timer.fn();
  assert.equal(ran.length, 20); assert(!ran.includes('0')); assert.equal(timers.size, 1);
  queue.close(); assert.equal(timers.size, 0);
});

test('dispatch persistence/read failures release capacity and never spawn an Agent', async () => {
  for (const failureAt of ['read', 'write', 'log']) {
    let released = 0,claimsReleased=0;
    const currentTask = task();
    const context = { Date, crypto: require('node:crypto'), path, taskNow: () => 'now', activeAdapterTask: () => false,
      captureHeavyWorkGate: { tryAcquire: () => () => released++ }, captureTimelineResourceSnapshot: () => ({}),
      heavyTaskRetryQueue: { delete() {} }, taskExecutionDirPath: () => 'C:/synthetic',
      externalTaskDispatchBarrier: () => ({claim:async()=>({ok:true,claimed:true,executionId:'synthetic-claim'})}),
      releaseUnstartedTaskClaim:async()=>{claimsReleased++;},
      readTaskStore: () => { if (failureAt === 'read') throw Error('disk failed'); return { tasks: [currentTask] }; },
      fs: { mkdirSync() {}, writeFileSync() { if (failureAt === 'log') throw Error('disk failed'); } },
      admitRunnableTaskToRunning: require('../electron/task-execution-admission.cjs').admitRunnableTaskToRunning,
      transitionTaskInStore: (_store, _id, status, patch) => { Object.assign(currentTask, patch, { status }); return { ok: true, task: currentTask }; },
      writeTaskStoreDurably: async () => { if (failureAt === 'write') throw Error('disk failed'); },
      spawnAdapterProcess() { assert.fail('must not spawn before persistence'); } };
    await assert.rejects(load('launchCommandAdapter', context)(task(), 'codex', 'fake.exe', [], 'C:/synthetic'), /disk failed/);
    assert.equal(released, 1);
    assert.equal(claimsReleased,1);
  }
});

test('host normalization preserves recovery metadata across write and restart', () => {
  const t = task(); Object.assign(t, policy.taskRetryDecision(t, { code: '503' }, { now: 0, random: () => 0, stopConfirmed: true }));
  const context = { TASK_PROTOCOL_VERSION: '1.2', taskNow: () => '2026-10-25T00:00:00.000Z', normalizeTaskStatus: x => x,
    TASK_TERMINAL_STATUSES: new Set(['succeeded', 'failed', 'blocked', 'cancelled', 'timed_out', 'archived']),
    taskRiskForKind: () => 'low', taskStatusGroup: () => 'actionable',
    executionProvenance: recoveryExperience.executionProvenance, recoveryBudget: recoveryExperience.recoveryBudget,
    recoveryPlan: recoveryExperience.recoveryPlan };
  const normalize = load('normalizeTaskEnvelope', context);
  const saved = normalize(t, t);
  assert.deepEqual(saved.retryRecovery, t.retryRecovery);
  assert.equal(policy.taskRetryEligible(JSON.parse(JSON.stringify(saved)), 60000), true);
});

test('empty candidate closure fields cannot erase an existing settlement or receipt plan', () => {
  const current = { ...task(), status: 'waiting_result', settlementState: 'reconciling', businessOutcome: 'awaiting_receipt',
    executor: 'qclaw', adapterId: 'qclaw', executionMode: 'inbox', recoveryState: 'unknown' };
  current.recoveryBudget = recoveryExperience.recoveryBudget(current, '2026-10-25T00:00:00.000Z');
  current.recoveryBudget.receiptQueries = 2;
  current.recoveryPlan = recoveryExperience.recoveryPlan(current, '2026-10-25T00:00:00.000Z');
  const context = { TASK_PROTOCOL_VERSION: '1.2', taskNow: () => '2026-10-25T00:00:00.000Z', normalizeTaskStatus: x => x,
    TASK_TERMINAL_STATUSES: new Set(['succeeded', 'failed', 'blocked', 'cancelled', 'timed_out', 'archived']),
    taskRiskForKind: () => 'low', taskStatusGroup: () => 'running',
    executionProvenance: recoveryExperience.executionProvenance, recoveryBudget: recoveryExperience.recoveryBudget,
    recoveryPlan: recoveryExperience.recoveryPlan };
  const normalize = load('normalizeTaskEnvelope', context);
  const saved = normalize({ ...current, settlementState: '', businessOutcome: '', recoveryPlan: undefined,
    recoveryBudget: undefined }, current);
  assert.equal(saved.settlementState, 'reconciling');
  assert.equal(saved.businessOutcome, 'awaiting_receipt');
  assert.equal(saved.recoveryBudget.receiptQueries, 2);
  assert.equal(saved.recoveryPlan.owner, 'system');
});

test('a fully validated same-execution result releases unknown scope, not unvalidated output', () => {
  for (const valid of [true, false]) {
    const t = { ...task(), status: 'running', recoveryState: 'unknown' };
    const context = { taskNow: () => 'now', persistReportIssue: () => '', isAutoPublishReportTask: () => false,
      shouldAutoAccept: () => true, RESEARCH_KINDS: new Set(),
      transitionTaskInStore: (_store, _id, status, patch) => { Object.assign(t, patch, { status }); return { ok: true, task: t }; } };
    load('commitValidatedTaskResult', context)({ tasks: [t] }, t, {}, { valid }, { successful: valid });
    assert.equal(t.recoveryState, valid ? 'result_validated' : 'unknown');
    assert.equal(t.status, valid ? 'succeeded' : 'failed');
  }
});

test('long Retry-After never becomes an overflowing 1 ms timer', () => {
  let delay;
  const queue = createTaskRetryQueue({ now: () => 0, setTimer: (_fn, ms) => { delay = ms; return 1; }, clearTimer() {}, run() {} });
  queue.schedule('invalid', 'codex', NaN);
  assert.equal(queue.size, 0);
  queue.schedule('long', 'codex', 90 * 86400000);
  assert.equal(delay, 2147483647);
  queue.close();
});

test('read model distinguishes a resumable wait from a historical unscheduled failure', () => {
  const { taskPresentation } = require('../electron/task-read-model.cjs');
  const t = task(); Object.assign(t, policy.taskRetryDecision(t, { code: '503' }, { stopConfirmed: true }));
  assert.equal(taskPresentation(t).phaseLabel, '稍后继续');
  assert.equal(taskPresentation(t).statusGroup, 'scheduled');
  assert.equal(taskPresentation({ ...t, retryRecovery: null }).phaseLabel, '需要处理');
});

test('read model keeps no-work in history and submitted batches in automatic reconciliation', () => {
  const { taskPresentation, queryTaskSnapshot } = require('../electron/task-read-model.cjs');
  const noWork = taskPresentation({ ...task(), status: 'succeeded', businessOutcome: 'no_work', settlementState: 'settled' });
  assert.equal(noWork.userGroup, 'history'); assert.equal(noWork.phaseLabel, '无需处理');
  const receipt = taskPresentation({ ...task(), status: 'waiting_result', executionMode: 'automatic',
    automaticExecution: true, businessOutcome: 'awaiting_receipt', settlementState: 'reconciling' });
  assert.equal(receipt.userGroup, 'automatic'); assert.equal(receipt.requiresUserAction, false);
  assert.equal(receipt.phaseLabel, '正在核对已提交批次');
  const hidden = queryTaskSnapshot({ protocolVersion: '1.2', updatedAt: '', history: [], tasks: [{
    ...task(), status: 'archived', businessOutcome: 'automation_disabled', settlementState: 'settled',
  }] });
  assert.equal(hidden.summary.total, 0); assert.equal(hidden.tasks.length, 0);
});
