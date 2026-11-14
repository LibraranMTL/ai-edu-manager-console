'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  digestBusinessSnapshot,
  digestReconciliationDecision,
  digestStateSemanticallyEqual,
  studentMaterialsSemanticallyEqual,
} = require('../electron/student-digest-reconciliation.cjs');

test('unchanged waiting result produces a frozen snapshot and no write decision', () => {
  const materials = [
    { id: 'a', status: 'submitted', sha1: 'one', statusUpdatedAt: '2026-10-27T10:00:00.000Z' },
    { id: 'b', status: 'processed', sha1: 'two', statusUpdatedAt: '2026-10-27T10:01:00.000Z' },
  ];
  const digestState = { status: 'digesting', digestBatchId: 'batch-1', updatedAt: '2026-10-27T10:02:00.000Z' };
  const snapshot = digestBusinessSnapshot({ materials, digestState, receipts: [] });
  const decision = digestReconciliationDecision(snapshot, '2026-10-27T10:03:00.000Z');

  assert.equal(snapshot.submittedCount, 1);
  assert.equal(snapshot.processedCount, 1);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.deepEqual(decision, {
    changed: false,
    outcome: 'awaiting_receipt',
    nextCheckAt: '2026-10-27T10:03:30.000Z',
    writeRequired: false,
  });
});

test('semantic equality ignores wrapper updatedAt but not material status or digest batch', () => {
  const materials = [{ id: 'a', status: 'submitted', sha1: 'one' }];
  assert.equal(studentMaterialsSemanticallyEqual(materials, structuredClone(materials)), true);
  assert.equal(studentMaterialsSemanticallyEqual(materials, [{ ...materials[0], status: 'processed' }]), false);
  assert.equal(digestStateSemanticallyEqual(
    { status: 'digesting', digestBatchId: 'one', updatedAt: 'old' },
    { status: 'digesting', digestBatchId: 'one', updatedAt: 'new' },
  ), true);
  assert.equal(digestStateSemanticallyEqual(
    { status: 'digesting', digestBatchId: 'one' },
    { status: 'digesting', digestBatchId: 'two' },
  ), false);
});

test('a validated late receipt requests one targeted settlement', () => {
  const snapshot = digestBusinessSnapshot({
    materials: [{ id: 'a', status: 'submitted', digestBatchId: 'batch-1' }],
    digestState: { status: 'digesting', digestBatchId: 'batch-1' },
    receipts: [{ batchId: 'batch-1', status: 'completed', validation: { valid: true } }],
  });
  const decision = digestReconciliationDecision(snapshot, '2026-10-27T10:03:00.000Z');
  assert.equal(decision.changed, true);
  assert.equal(decision.outcome, 'settle_receipt');
  assert.equal(decision.writeRequired, true);
});
