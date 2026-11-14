const test = require('node:test');
const assert = require('node:assert/strict');
const { deletedTaskCandidateSuppressed, removeHistoricalTaskRecord } = require('../electron/task-history-policy.cjs');

test('historical deletion removes the visible task and its state history but keeps a cycle tombstone', () => {
  const store = {
    tasks: [{ id: 'task-a', idempotencyKey: 'cycle-1', title: '历史任务', kind: 'weekly_action', sourceType: 'student', sourceId: 's1', status: 'succeeded' }],
    history: [{ id: 'h1', taskId: 'task-a' }, { id: 'h2', taskId: 'task-b' }],
    deletedTasks: [],
  };
  const result = removeHistoricalTaskRecord(store, 'task-a', '2026-10-10T10:00:00.000Z');
  assert.equal(result.ok, true);
  assert.equal(result.removedHistoryCount, 1);
  assert.deepEqual(store.tasks, []);
  assert.deepEqual(store.history.map(item => item.id), ['h2']);
  const rebuilt = { id: 'task-a', title: '历史任务', kind: 'weekly_action', sourceType: 'student', sourceId: 's1' };
  assert.equal(deletedTaskCandidateSuppressed(store, { ...rebuilt, idempotencyKey: 'cycle-1' }), false);
  assert.equal(deletedTaskCandidateSuppressed(store, { ...rebuilt, idempotencyKey: 'cycle-2' }), false);
});

test('active tasks cannot be deleted as history', () => {
  for (const status of ['running', 'waiting_result', 'reviewing']) {
    const store = { tasks: [{ id: status, status, executionId: 'run-1' }], history: [], deletedTasks: [] };
    const result = removeHistoricalTaskRecord(store, status);
    assert.equal(result.ok, false);
    assert.equal(store.tasks.length, 1);
  }
});

test('failed, blocked, cancelled and timed-out tasks are deletable historical records', () => {
  for (const status of ['failed', 'blocked', 'cancelled', 'timed_out']) {
    const store = { tasks: [{ id: status, idempotencyKey: `cycle-${status}`, status }], history: [], deletedTasks: [] };
    assert.equal(removeHistoricalTaskRecord(store, status).ok, true);
    assert.equal(store.tasks.length, 0);
  }
});

test('every safe unstarted task is removable in one step and receives a tombstone', () => {
  for (const status of ['draft', 'pending', 'approved', 'queued']) {
    const task = { id: `task-${status}`, idempotencyKey: `cycle-${status}`, kind: 'weekly_action',
      status, attempt: 0, executionId: '', result: null };
    const store = { tasks: [task], history: [{ taskId: task.id }], deletedTasks: [] };
    const result = removeHistoricalTaskRecord(store, task.id, '2026-10-11T10:00:00.000Z');
    assert.equal(result.ok, true);
    assert.equal(store.tasks.length, 0);
    assert.equal(result.tombstone.previousStatus, status);
    assert.equal(deletedTaskCandidateSuppressed(store, task), false);
  }
});

test('explicit ignore of the current work key suppresses only that exact source version', () => {
  const first = { id: 'task-ignore', kind: 'project_digest', sourceType: 'project', sourceId: 'p1',
    status: 'cancelled', sourceVersion: 'v1', pipelineVersion: 'pipe-1' };
  const store = { tasks: [first], history: [], deletedTasks: [] };
  const removed = removeHistoricalTaskRecord(store, first.id, '2026-10-11T10:00:00.000Z', {
    suppressCurrentWork: true,
  });
  assert.equal(removed.ok, true);
  assert.equal(removed.tombstone.suppression, 'work_key');
  assert.equal(deletedTaskCandidateSuppressed(store, first), true);
  assert.equal(deletedTaskCandidateSuppressed(store, { ...first, sourceVersion: 'v2' }), false);
});

test('started, result-bearing and unknown pending tasks remain protected from deletion', () => {
  for (const task of [
    { id: 'started', kind: 'collaboration_assignment', status: 'pending', adapterId: 'manual', attempt: 1 },
    { id: 'run', kind: 'collaboration_assignment', status: 'pending', adapterId: 'manual', executionId: 'run-1' },
    { id: 'result', kind: 'weekly_action', status: 'pending', result: { summary: 'returned' } },
    { id: 'unknown', kind: 'weekly_action', status: 'pending', recoveryState: 'unknown' },
  ]) {
    const store = { tasks: [task], history: [], deletedTasks: [] };
    assert.equal(removeHistoricalTaskRecord(store, task.id).ok, false);
  }
});
