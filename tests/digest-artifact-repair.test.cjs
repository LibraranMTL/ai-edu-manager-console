'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { planDigestArtifactRepair, artifactRepairPatch, validationCode } = require('../electron/digest-artifact-repair.cjs');

const task = {
  id: 'digest-1', kind: 'student_digest', sourceId: 'student-1',
  executionId: 'execution-1', input: { digestBatchId: 'batch-1', sourceVersion: 'source-v1' },
};
const artifactGap = { domainSync: { validation: { code: 'artifacts_not_updated' } } };

test('receipt-backed artifact gap can use the batch input version and queues one bounded repair', () => {
  const plan = planDigestArtifactRepair(task, artifactGap, 0);
  assert.equal(plan.eligible, true);
  assert.equal(plan.attempt, 1);
  assert.equal(plan.delayMs, 15_000);
  const patch = artifactRepairPatch(task, plan, ['C:\\vault\\index.md', 'C:\\vault\\log.md']);
  assert.equal(patch.status, 'pending');
  assert.equal(patch.settlementState, 'repair_pending');
  assert.equal(patch.input.artifactRepair.originalExecutionId, 'execution-1');
  assert.deepEqual(patch.input.artifactRepair.requiredArtifacts, ['C:\\vault\\index.md', 'C:\\vault\\log.md']);
});

test('only the artifact validation gap is eligible and repair attempts stop after the budget', () => {
  assert.equal(validationCode({ domainSync: { state: { strictValidation: { code: 'artifacts_not_updated' } } } }), 'artifacts_not_updated');
  assert.equal(planDigestArtifactRepair(task, { code: 'other_failure' }).eligible, false);
  const exhausted = planDigestArtifactRepair({ ...task, input: { ...task.input, artifactRepair: { attempt: 2 } } }, artifactGap);
  assert.equal(exhausted.eligible, false);
  assert.equal(exhausted.exhausted, true);
});
