'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  deriveWorkKey,
  executionBudgetKey,
  normalizePriorityClass,
  preserveProtectedTaskState,
  taskWorkIdentity,
} = require('../electron/task-work-identity.cjs');
const { candidateRuntimeDecision } = require('../electron/task-runtime-policy.cjs');
const { deletedTaskCandidateSuppressed, removeHistoricalTaskRecord } = require('../electron/task-history-policy.cjs');

test('material work identity follows source versions rather than execution batch ids', () => {
  const base = { kind: 'student_digest', sourceType: 'student', sourceId: 's1',
    input: { pipelineVersion: 'digest-v3', materials: [
      { materialId: 'b', version: 2, sha256: 'bb' },
      { materialId: 'a', version: 1, sha256: 'aa' },
    ] } };
  const first = deriveWorkKey({ ...base, input: { ...base.input, digestBatchId: 'batch-one' } });
  const rebuilt = deriveWorkKey({ ...base, input: { ...base.input, digestBatchId: 'batch-two', materials: [...base.input.materials].reverse() } });
  assert.equal(first, rebuilt);
  assert.notEqual(first, deriveWorkKey({ ...base, input: { ...base.input,
    materials: [{ materialId: 'a', version: 2, sha256: 'changed' }] } }));
  assert.equal(executionBudgetKey({ ...base, workKey: first }, 'unsupported', 'input'),
    executionBudgetKey({ ...base, workKey: first }, 'unsupported', 'input'));
});

test('a prepared digest batch cannot replace the already claimed business source identity', () => {
  const task = { kind: 'project_digest', sourceType: 'project', sourceId: 'p1',
    workKey: 'project_digest:p1:materials-v1', input: {} };
  const claimed = taskWorkIdentity(task);
  const prepared = taskWorkIdentity({ ...task, input: { digestBatchId: 'execution-batch-random' } });
  assert.equal(claimed.sourceVersion, 'work:project_digest:p1:materials-v1');
  assert.equal(prepared.sourceVersion, claimed.sourceVersion);
});

test('candidate refresh protects review and settlement states', () => {
  for (const current of [
    { status: 'reviewing', executionId: 'e', startedAt: '2026-10-24T00:00:00Z' },
    { status: 'queued', settlementState: 'committing', executionId: 'e' },
    { status: 'queued', settlementState: 'publishing', executionId: 'e' },
  ]) {
    const decision = candidateRuntimeDecision({ ...current, idempotencyKey: 'same' }, { status: 'pending', idempotencyKey: 'same' });
    assert.equal(decision.preserveRuntime, true);
  }
  const preserved = preserveProtectedTaskState({ status: 'reviewing', result: { ok: true }, executionId: 'e' }, { status: 'queued', result: null });
  assert.equal(preserved.status, 'reviewing'); assert.deepEqual(preserved.result, { ok: true });
});

test('deletion tombstones suppress only the exact business work', () => {
  const original = { id: 'task-digest', kind: 'student_digest', sourceType: 'student', sourceId: 's1', status: 'pending',
    workKey: 'student_digest:s1:source-v1', idempotencyKey: 'execution-one', attempt: 0 };
  const store = { tasks: [original], history: [], deletedTasks: [] };
  assert.equal(removeHistoricalTaskRecord(store, original.id).ok, true);
  assert.equal(deletedTaskCandidateSuppressed(store, { ...original, idempotencyKey: 'execution-two' }), false);
  const suppressedStore = { tasks: [original], history: [], deletedTasks: [] };
  assert.equal(removeHistoricalTaskRecord(suppressedStore, original.id, new Date().toISOString(),
    { suppressCurrentWork: true }).ok, true);
  assert.equal(deletedTaskCandidateSuppressed(suppressedStore,
    { ...original, idempotencyKey: 'execution-two' }), true);
  assert.equal(deletedTaskCandidateSuppressed(suppressedStore,
    { ...original, workKey: 'student_digest:s1:source-v2' }), false);
});

test('priority classes keep manual/event/scheduled/maintenance order and temporary boost', () => {
  assert.equal(normalizePriorityClass({ trigger: 'manual' }), 80);
  assert.equal(normalizePriorityClass({ trigger: 'event' }), 60);
  assert.equal(normalizePriorityClass({ trigger: 'schedule', kind: 'weekly_action' }), 40);
  assert.equal(normalizePriorityClass({ trigger: 'schedule', kind: 'maintenance_lint' }), 20);
  assert.equal(normalizePriorityClass({ priorityBoostUntil: '2999-01-01T00:00:00.000Z' }), 100);
});
