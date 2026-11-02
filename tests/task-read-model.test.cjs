'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { taskPresentation, taskSummary } = require('../electron/task-read-model.cjs');

test('pre-dispatch conflict stays automatic and exposes its blocker', () => {
  const task = {
    id: 'blocked-target', status: 'queued', automaticExecution: true,
    dispatchBlock: {
      code: 'execution_unknown_same_work', blockerTaskId: 'unknown-1', blockerWorkKey: 'digest:student-a',
      signature: 'signature-1', createdAt: '2026-10-27T11:59:00.000Z', nextCheckAt: '2026-10-27T12:00:00.000Z',
    },
  };

  const view = taskPresentation(task);
  const summary = taskSummary(task);
  assert.equal(view.automationState, 'waiting_dependency');
  assert.equal(view.requiresUserAction, false);
  assert.match(view.automationReason, /unknown-1|核对/);
  assert.equal(view.nextDispatchAt, task.dispatchBlock.nextCheckAt);
  assert.equal(summary.dispatchBlock.blockerTaskId, 'unknown-1');
});
