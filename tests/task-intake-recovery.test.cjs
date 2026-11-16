'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { intakeRecoveryPatch } = require('../electron/task-intake-recovery.cjs');
const { reconcileInterruptedExecutions } = require('../electron/task-recovery-policy.cjs');
const { planTaskRecovery } = require('../electron/task-backlog-recovery.cjs');

const task = { id: 'batch', kind: 'smart_material_intake', status: 'failed', adapterId: 'internal',
  executionMode: 'internal', executionId: 'run', recoveryState: 'host_confirmed_stopped',
  error: { code: 'INTERNAL_EXECUTION_INTERRUPTED' }, input: { sourceId: 'source', itemIds: ['a', 'b'] } };
test('review and unknown receipt stay attached to original batch across restart', () => {
  const items = [{ id: 'a', sourceId: 'source', status: 'review' }, { id: 'b', sourceId: 'source', status: 'execution_unknown' }];
  const patch = intakeRecoveryPatch(task, items, '2026-11-16T00:00:00Z');
  assert.equal(patch.status, 'reviewing'); assert.equal(patch.settlementState, 'receipt_pending');
  assert.equal(patch.autoRetry, false); assert.equal(patch.result.validation.valid, false);
  const restored = { ...task, ...patch }; reconcileInterruptedExecutions({ tasks: [restored] }, new Set());
  assert.equal(restored.status, 'reviewing'); assert.equal(restored.executionId, 'run');
  assert.equal(restored.result.structuredOutput.closure.receiptPending, 1);
  assert.equal(planTaskRecovery(restored, {}).action, 'no_change');
});
test('missing, mismatched, pending and fully finished items cannot trigger recovery', () => {
  const a = { id: 'a', sourceId: 'source', status: 'review' };
  assert.equal(intakeRecoveryPatch(task, [a]), null);
  for (const b of [{ id: 'b', sourceId: 'other', status: 'review' }, { id: 'b', sourceId: 'source', status: 'pending' }])
    assert.equal(intakeRecoveryPatch(task, [a, b]), null);
  assert.equal(intakeRecoveryPatch(task, [{ ...a, status: 'delivered' }, { id: 'b', sourceId: 'source', status: 'ignored' }]), null);
  assert.equal(intakeRecoveryPatch({ ...task, input: { ...task.input, itemIds: ['a', 'a'] } }, [a, a]), null);
});
