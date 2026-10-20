const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { reconcileInterruptedExecutions } = require('../electron/task-recovery-policy.cjs');
const { recoveryPlan } = require('../electron/task-recovery-experience.cjs');
const { taskPresentation, taskReadIndex } = require('../electron/task-read-model.cjs');
const { repairReportDraftForAutoPublish, validateReportDraftForAutoPublish } = require('../electron/report-auto-publication.cjs');

test('cancelled internal research is confirmed stopped without rerunning or asking for an original tool', () => {
  const task = {
    id: 'research-1', title: '来源检查', status: 'cancelled', adapterId: 'internal', executor: 'internal',
    executionMode: 'internal', executionId: 'research-old', recoveryState: 'unknown', attempt: 1,
    error: { code: 'CANCEL_STOP_UNCONFIRMED', message: 'legacy' },
  };
  const store = { tasks: [task] };
  const repairs = reconcileInterruptedExecutions(store, new Set(), '2026-10-17T12:00:00.000Z');
  assert.deepEqual(repairs, [{ taskId: 'research-1', type: 'internal_execution_confirmed_stopped' }]);
  assert.equal(task.status, 'cancelled');
  assert.equal(task.recoveryState, 'host_confirmed_stopped');
  assert.equal(task.autoRetry, false);
  assert.equal(task.error.code, 'CANCELLED');
  assert.match(task.error.message, /上一有效版本保持不变/);
  assert.doesNotMatch(task.error.message, /原工具/);
});

test('orphaned active internal execution becomes a safe failure and keeps its execution identity', () => {
  const task = { id: 'internal-2', status: 'running', adapterId: 'internal', executionMode: 'internal',
    executionId: 'internal-old', startedAt: '2026-10-17T10:00:00.000Z', attempt: 1 };
  reconcileInterruptedExecutions({ tasks: [task] }, new Set(), '2026-10-17T12:00:00.000Z');
  assert.equal(task.status, 'failed');
  assert.equal(task.executionId, 'internal-old');
  assert.equal(task.recoveryState, 'host_confirmed_stopped');
  assert.equal(task.autoRetry, false);
});

test('startup restores a confirmed internal stop that candidate refresh reset before dispatch', () => {
  const store = {
    tasks: [{
      id: 'research-reset', status: 'approved', kind: 'competition_research_check', sourceType: 'student', sourceId: 'student-1',
      executor: 'auto', executionMode: 'adapter', executionId: '', result: null, attempt: 0,
      idempotencyKey: 'competition:student:new-fingerprint:2026-10',
    }],
    history: [
      { taskId: 'research-reset', status: 'approved', executor: 'auto', executionId: '', detail: '', at: '2026-10-17T14:08:16.590Z' },
      { taskId: 'research-reset', status: 'cancelled', executor: 'internal', executionId: 'research-old',
        detail: 'P0 运行时修复：internal_execution_confirmed_stopped', at: '2026-10-17T14:07:00.356Z' },
    ],
  };
  const repairs = reconcileInterruptedExecutions(store, new Set(), '2026-10-17T15:00:00.000Z');
  assert.deepEqual(repairs, [{ taskId: 'research-reset', type: 'confirmed_stop_guard_restored' }]);
  assert.equal(store.tasks[0].status, 'cancelled');
  assert.equal(store.tasks[0].executionId, 'research-old');
  assert.equal(store.tasks[0].recoveryState, 'host_confirmed_stopped');
  assert.equal(store.tasks[0].autoRetry, false);
});

test('startup repairs display provenance without changing a confirmed stop or execution identity', () => {
  const task = {
    id: 'research-provenance', status: 'cancelled', recoveryState: 'host_confirmed_stopped',
    executionId: 'research-old', adapterId: 'internal', executor: 'auto', executionMode: 'adapter',
    executionProvenance: { providerId: 'internal', providerLabel: 'auto', executionClass: 'internal' },
    error: { code: 'CANCELLED', message: 'stopped' }, autoRetry: false,
  };
  const repairs = reconcileInterruptedExecutions({ tasks: [task], history: [] }, new Set(), '2026-10-17T15:30:00.000Z');
  assert.deepEqual(repairs, [{ taskId: 'research-provenance', type: 'confirmed_stop_provenance_restored' }]);
  assert.equal(task.status, 'cancelled');
  assert.equal(task.executionId, 'research-old');
  assert.equal(task.executor, 'internal');
  assert.equal(task.executionMode, 'internal');
  assert.equal(task.adapterId, 'internal');
  assert.equal(task.executionProvenance.providerId, 'internal');
  assert.equal(task.executionProvenance.providerLabel, 'AI 教育管家内置流程');
  assert.equal(task.autoRetry, false);
});

test('legacy manual packet cancellation is closed without the generic original-tool instruction', () => {
  const task = { id: 'manual-1', status: 'cancelled', adapterId: 'manual', executor: 'manual', executionMode: 'manual',
    executionId: 'manual-old', result: { status: 'manual_required' },
    error: { code: 'CANCEL_STOP_UNCONFIRMED', message: '请到原工具核对。' } };
  const repairs = reconcileInterruptedExecutions({ tasks: [task] }, new Set(), '2026-10-17T12:00:00.000Z');
  assert.deepEqual(repairs, [{ taskId: 'manual-1', type: 'legacy_manual_packet_closed' }]);
  assert.equal(task.recoveryState, 'manual_packet_closed');
  assert.equal(task.error.code, 'CANCELLED');
  assert.match(task.error.message, /人工任务包已取消/);
  assert.doesNotMatch(task.error.message, /原工具/);
});

test('legacy external cancellation becomes a provider-specific reconciliation instead of generic history text', () => {
  const task = { id: 'external-old', status: 'cancelled', adapterId: 'codex', executor: 'codex', executionMode: 'automatic',
    executionId: 'run-old', error: { code: 'CANCEL_STOP_UNCONFIRMED', message: '请到原工具核对。' } };
  reconcileInterruptedExecutions({ tasks: [task] }, new Set(), '2026-10-17T12:00:00.000Z');
  assert.equal(task.recoveryState, 'unknown');
  assert.equal(task.recoveryPlan.providerLabel, 'Codex');
  assert.doesNotMatch(task.error.message, /原工具/);
  assert.equal(taskPresentation(task).userGroup, 'needs_help');
});

test('external unknown execution names the provider and only asks for help when query is unavailable or exhausted', () => {
  const codex = { id: 'external-1', status: 'cancelled', adapterId: 'codex', executor: 'codex', executionMode: 'automatic',
    executionId: 'run-1', recoveryState: 'unknown', recoveryCheckedAt: '2026-10-17T12:00:00.000Z' };
  const manualPlan = recoveryPlan(codex, '2026-10-17T12:00:00.000Z');
  assert.equal(manualPlan.owner, 'user');
  assert.equal(manualPlan.providerLabel, 'Codex');
  assert.equal(manualPlan.userSteps.length, 4);
  assert.match(manualPlan.nextAction, /run-1/);

  const inbox = { ...codex, adapterId: 'qclaw', executor: 'qclaw', executionMode: 'inbox', recoveryBudget: { receiptQueries: 2 } };
  assert.equal(recoveryPlan(inbox).owner, 'system');
  inbox.recoveryBudget = { receiptQueries: 6 };
  assert.equal(recoveryPlan(inbox).owner, 'user');
  assert.match(recoveryPlan(inbox).summary, /6 次回执查询/);
});

test('recovery guidance trusts the actual built-in adapter and gives manual and pending tasks concrete steps', () => {
  const stale = {
    status: 'cancelled', adapterId: 'codex', executor: 'codex', executionMode: 'automatic', executionId: 'codex-run',
    recoveryState: 'unknown', executionProvenance: { providerId: 'codex', providerLabel: 'WorkBuddy' },
  };
  const corrected = recoveryPlan(stale, '2026-10-17T16:00:00.000Z');
  assert.equal(corrected.providerLabel, 'Codex');
  assert.match(corrected.nextAction, /打开 Codex/);
  assert.doesNotMatch(corrected.nextAction, /WorkBuddy/);

  const manual = recoveryPlan({
    status: 'waiting_result', adapterId: 'manual', executor: 'manual', executionMode: 'manual', executionId: 'packet-1',
    executionProvenance: { providerId: 'manual', providerLabel: 'WorkBuddy' },
  }, '2026-10-17T16:00:00.000Z');
  assert.equal(manual.owner, 'user');
  assert.equal(manual.action, 'complete_manual_handoff');
  assert.equal(manual.providerLabel, 'WorkBuddy');
  assert.equal(manual.userSteps.length, 4);
  assert.match(manual.nextAction, /packet-1/);

  const pending = recoveryPlan({ status: 'pending', adapterId: '', executor: 'workbuddy', executionMode: 'adapter' });
  assert.equal(pending.action, 'start');
  assert.match(pending.nextAction, /开始处理/);
});

test('read model exposes the three ordinary-user queue groups while preserving legacy status groups', () => {
  const store = { tasks: [
    { id: 'a', title: '自动', status: 'running', executionMode: 'automatic', adapterId: 'codex' },
    { id: 'b', title: '帮助', status: 'failed', error: { code: 'FAILED', message: '需要决定' } },
    { id: 'c', title: '历史', status: 'succeeded', result: { validation: { valid: true }, structuredOutput: { ok: true } } },
  ] };
  const index = taskReadIndex(store);
  assert.deepEqual(index.userSummary, { automatic: 1, needs_help: 1, history: 1 });
  assert.equal(taskPresentation(store.tasks[0]).statusGroup, 'running');
  assert.equal(taskPresentation(store.tasks[0]).userGroup, 'automatic');
});

test('report repair is bounded to conservative structure and evidence corrections', () => {
  const growthIndex = {
    sourceFingerprint: 'fp-1',
    evidence: [
      { id: 'watch-1', status: 'watching' },
      { id: 'bad-1', status: 'rejected' },
    ],
  };
  const content = [
    '---', 'student_id: student-1', 'growth_fingerprint: fp-1', 'updated: bad-date', 'status: invalid', '---', '',
    '## 学习特点', '', '已经完全掌握实验设计。[依据:watch-1]', '',
    '## 主要问题', '', '已经形成稳定能力。[依据:bad-1]',
  ].join('\n');
  const repaired = repairReportDraftForAutoPublish({ content, studentId: 'student-1', expectedFingerprint: 'fp-1', growthIndex,
    requiredSections: ['学习特点', '主要问题', '建议行动'], expectedDate: '2026-10-17', sourceAccessible: () => true,
    now: '2026-10-17T12:00:00.000Z' });
  assert.equal(repaired.changed, true);
  assert.match(repaired.content, /status: pending_review/);
  assert.match(repaired.content, /updated: 2026-10-17/);
  assert.match(repaired.content, /仍待观察/);
  assert.match(repaired.content, /## 建议行动\n\n资料不足/);
  assert.doesNotMatch(repaired.content, /稳定能力/);
  const validated = validateReportDraftForAutoPublish({ content: repaired.content, studentId: 'student-1',
    expectedFingerprint: 'fp-1', growthIndex, sourceAccessible: () => true });
  assert.equal(validated.valid, true, validated.errors.join('；'));

  const wrongStudent = repairReportDraftForAutoPublish({ content, studentId: 'student-2', expectedFingerprint: 'fp-1', growthIndex });
  assert.equal(wrongStudent.changed, false);
});

test('Windows host source routes internal cancellation to automatic confirmation and removes the generic original-tool instruction', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(source, /cancelInternalTask\(task\)/);
  assert.match(source, /task_stop_confirmed/);
  assert.doesNotMatch(source, /请到原工具核对/);
});

test('runtime reconciliation runs before the business window even when the scheduler is disabled', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  const startup = source.slice(source.indexOf('app.whenReady().then'), source.indexOf("app.on('before-quit'"));
  const repairAt = startup.indexOf('repairTaskCenterRuntimeState()');
  const windowAt = startup.indexOf('createWindow()');
  const schedulerGateAt = startup.indexOf("process.env.EDU_DISABLE_TASK_SCHEDULER !== '1'");
  assert(repairAt >= 0, 'startup must invoke runtime reconciliation');
  assert(windowAt > repairAt, 'runtime reconciliation must finish before the business window opens');
  assert(schedulerGateAt > repairAt, 'runtime reconciliation must not depend on the scheduler gate');
});

test('completed and cancelled history is read-only and does not offer duplicate execution buttons', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.tsx'), 'utf8');
  assert.match(source, /'succeeded', 'cancelled', 'archived'\]\.includes\(selectedTask\.status\)/);
  assert.match(source, /'running', 'waiting_result', 'reviewing', 'succeeded', 'cancelled', 'archived'/);
  assert.match(source, /\['failed', 'blocked', 'timed_out'\]\.includes\(selectedTask\.status\)/);
  assert.doesNotMatch(source, /\['failed', 'blocked', 'timed_out', 'cancelled'\]\.includes\(selectedTask\.status\)/);
  assert.match(source, /不会自动重新执行/);
  assert.match(source, /friendlyTaskHistoryDetail\(entry\.detail/);
  assert.doesNotMatch(source, /` · \$\{entry\.detail\}`/);
});
