'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { planConvergenceSlice, finishConvergenceSlice, SCHEMA } = require('../electron/task-backlog-convergence.cjs');

test('backlog convergence applies only evidence-safe actions and preserves the scan cursor', () => {
  const plan = planConvergenceSlice({
    cursor: 'task-20',
    rows: [
      { taskId: 'a', action: 'settle_existing' },
      { taskId: 'b', action: 'requeue_proven_not_sent' },
      { taskId: 'c', action: 'reconcile_original' },
      { taskId: 'd', action: 'needs_confirmation' },
      { taskId: 'e', action: 'resume_safe_items' },
    ],
  }, { scanned: 7, applied: 2, conflicts: 1 }, '2026-11-04T01:00:00.000Z');

  assert.equal(plan.checkpoint.schema, SCHEMA);
  assert.equal(plan.checkpoint.cursor, 'task-20');
  assert.equal(plan.checkpoint.scanned, 12);
  assert.deepEqual(plan.safeRows.map(row => row.taskId), ['a', 'b', 'c']);
  assert.deepEqual(plan.untouched.map(row => row.taskId), ['d', 'e']);

  const completed = finishConvergenceSlice(plan, [
    { applied: true }, { applied: false, code: 'TASK_EXECUTION_CONFLICT' }, { applied: true },
  ], '2026-11-04T01:00:02.000Z');
  assert.equal(completed.applied, 4);
  assert.equal(completed.conflicts, 2);
});

test('an empty page records a completed scan without inventing a new task', () => {
  const plan = planConvergenceSlice({ rows: [], cursor: '' }, { jobId: 'same-job' }, '2026-11-04T01:00:00.000Z');
  assert.equal(plan.checkpoint.jobId, 'same-job');
  assert.equal(plan.checkpoint.completedAt, '2026-11-04T01:00:00.000Z');
  assert.equal(plan.safeRows.length, 0);
});
