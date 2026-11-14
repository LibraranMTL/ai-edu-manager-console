'use strict';

const { taskExecutionUnresolved } = require('./task-recovery-policy.cjs');
const { deriveWorkKey } = require('./task-work-identity.cjs');

function normalized(value) {
  return String(value || '').trim();
}

function declaredBatchIdentity(task = {}) {
  return normalized(task.batchId || task.input?.digestBatchId || task.input?.batchId
    || task.result?.digestBatchId || task.result?.batchId);
}

function declaredExecutionIdentity(task = {}) {
  return normalized(task.executionId || task.input?.executionId || task.result?.executionId);
}

function dispatchConflictKey(task = {}) {
  const workKey = normalized(task.workKey || deriveWorkKey(task));
  return workKey ? `work:${workKey}` : '';
}

function blockerEvidence(task = {}) {
  return {
    status: normalized(task.status),
    recoveryState: normalized(task.recoveryState || task.result?.recoveryState),
    executionId: declaredExecutionIdentity(task),
    batchId: declaredBatchIdentity(task),
    errorCode: normalized(task.error?.code),
  };
}

function findUnresolvedDispatchConflict(candidate = {}, tasks = [], options = {}) {
  const candidateId = normalized(candidate.id);
  const candidateWorkKey = normalized(candidate.workKey || deriveWorkKey(candidate));
  const candidateBatchId = declaredBatchIdentity(candidate);
  const candidateExecutionId = declaredExecutionIdentity(candidate);
  const now = Number(options.now || Date.now());
  for (const blocker of Array.isArray(tasks) ? tasks : []) {
    if (!blocker || normalized(blocker.id) === candidateId || !taskExecutionUnresolved(blocker)) continue;
    const blockerWorkKey = normalized(blocker.workKey || deriveWorkKey(blocker));
    const blockerBatchId = declaredBatchIdentity(blocker);
    const blockerExecutionId = declaredExecutionIdentity(blocker);
    let reasonCode = '';
    if (candidateWorkKey && blockerWorkKey && candidateWorkKey === blockerWorkKey) {
      reasonCode = 'execution_unknown_same_work';
    } else if (candidateBatchId && blockerBatchId && candidateBatchId === blockerBatchId) {
      reasonCode = 'execution_unknown_shared_batch';
    } else if (candidateExecutionId && blockerExecutionId && candidateExecutionId === blockerExecutionId) {
      reasonCode = 'execution_unknown_shared_execution';
    }
    if (!reasonCode) continue;
    const nextCheckAt = normalized(blocker.recoveryPlan?.nextCheckAt || blocker.nextCheckAt
      || blocker.nextRetryAt || new Date(now + 30_000).toISOString());
    return {
      blockerTaskId: normalized(blocker.id),
      blockerWorkKey,
      reasonCode,
      evidence: blockerEvidence(blocker),
      nextCheckAt,
    };
  }
  return null;
}

module.exports = {
  declaredBatchIdentity,
  declaredExecutionIdentity,
  dispatchConflictKey,
  findUnresolvedDispatchConflict,
};
