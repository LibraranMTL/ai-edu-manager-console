'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  dispatchConflictKey,
  findUnresolvedDispatchConflict,
} = require('../electron/task-dispatch-conflict.cjs');

const cancelledUnknownDigest = {
  id: 'digest-unknown',
  sourceType: 'student',
  sourceId: 'student-a',
  kind: 'student_digest',
  workKey: 'student_digest:student-a:material-hash:v1',
  status: 'cancelled',
  recoveryState: 'unknown',
  executionId: 'execution-a',
  recoveryPlan: { nextCheckAt: '2026-10-27T13:00:00.000Z' },
};

test('cancelled unknown digest does not block a different weekly report work key', () => {
  const weeklyTask = {
    id: 'weekly', sourceType: 'student', sourceId: 'student-a', kind: 'weekly_action',
    workKey: 'weekly_action:student-a:2026-W44:growth-hash', status: 'queued',
  };

  assert.equal(findUnresolvedDispatchConflict(weeklyTask, [cancelledUnknownDigest]), null);
});

test('the same unresolved work key still blocks duplicate execution', () => {
  const rebuiltDigest = {
    id: 'digest-rebuilt', sourceType: 'student', sourceId: 'student-a', kind: 'student_digest',
    workKey: cancelledUnknownDigest.workKey, status: 'queued',
  };

  const conflict = findUnresolvedDispatchConflict(rebuiltDigest, [cancelledUnknownDigest]);
  assert.equal(conflict.blockerTaskId, cancelledUnknownDigest.id);
  assert.equal(conflict.blockerWorkKey, cancelledUnknownDigest.workKey);
  assert.equal(conflict.reasonCode, 'execution_unknown_same_work');
});

test('explicit shared batch identity blocks even when a legacy work key differs', () => {
  const blocker = { ...cancelledUnknownDigest, workKey: 'legacy:key', input: { digestBatchId: 'batch-1' } };
  const candidate = { id: 'candidate', workKey: 'rebuilt:key', input: { digestBatchId: 'batch-1' } };

  assert.equal(findUnresolvedDispatchConflict(candidate, [blocker]).reasonCode, 'execution_unknown_shared_batch');
});

test('paused project remains governed by pause policy rather than a student unknown conflict', () => {
  const pausedProjectTask = {
    id: 'project', sourceType: 'project', sourceId: 'project-a', kind: 'project_digest',
    workKey: 'project_digest:project-a:hash', status: 'queued', processingPaused: true,
  };

  assert.equal(findUnresolvedDispatchConflict(pausedProjectTask, [cancelledUnknownDigest]), null);
});

test('dispatch conflict key derives a stable work key for legacy candidates', () => {
  const task = { id: 'legacy', sourceType: 'student', sourceId: 'student-a', kind: 'student_digest', input: { sourceVersion: 'v3' } };
  assert.match(dispatchConflictKey(task), /^work:/);
  assert.equal(dispatchConflictKey(task), dispatchConflictKey({ ...task, id: 'different-row-id' }));
});
