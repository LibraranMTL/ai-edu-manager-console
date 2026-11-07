'use strict';

const crypto = require('node:crypto');

const PIPELINE_VERSION = 'digest-artifact-repair-v1';
const MAX_ATTEMPTS = 2;

function validationCode(validation) {
  return String(validation?.domainSync?.validation?.code
    || validation?.domainSync?.state?.strictValidation?.code
    || validation?.code || '');
}

function artifactRepairWorkKey(task) {
  const identity = JSON.stringify({
    kind: task?.kind,
    sourceId: task?.sourceId,
    sourceVersion: task?.sourceVersion || task?.input?.sourceVersion || '',
    digestBatchId: task?.input?.digestBatchId || '',
    pipelineVersion: PIPELINE_VERSION,
  });
  return `artifact-repair:${crypto.createHash('sha256').update(identity).digest('hex')}`;
}

function planDigestArtifactRepair(task, validation, now = Date.now()) {
  const attempt = Math.max(0, Number(task?.input?.artifactRepair?.attempt || 0));
  if (task?.kind !== 'student_digest' || validationCode(validation) !== 'artifacts_not_updated') {
    return { eligible: false, reason: 'not_artifact_gap', attempt };
  }
  if (!task?.input?.digestBatchId || !(task?.sourceVersion || task?.input?.sourceVersion)) {
    return { eligible: false, reason: 'unversioned_batch', attempt };
  }
  if (attempt >= MAX_ATTEMPTS) {
    return { eligible: false, exhausted: true, reason: 'repair_budget_exhausted', attempt };
  }
  const nextAttempt = attempt + 1;
  const delayMs = nextAttempt === 1 ? 15_000 : 60_000;
  const workKey = artifactRepairWorkKey(task);
  return {
    eligible: true,
    attempt: nextAttempt,
    maxAttempts: MAX_ATTEMPTS,
    delayMs,
    nextRetryAt: new Date(now + delayMs).toISOString(),
    workKey,
    pipelineVersion: PIPELINE_VERSION,
  };
}

function artifactRepairPatch(task, plan, requiredArtifacts = []) {
  if (!plan?.eligible) throw new Error('artifact_repair_not_eligible');
  return {
    status: 'pending',
    settlementState: 'repair_pending',
    businessOutcome: 'artifact_repair',
    completedAt: '',
    executionId: '',
    executionPhase: '',
    adapterId: '',
    startedAt: '',
    lastHeartbeatAt: '',
    nextRetryAt: plan.nextRetryAt,
    autoRetry: true,
    error: null,
    idempotencyKey: plan.workKey,
    pipelineVersion: plan.pipelineVersion,
    input: {
      ...(task?.input || {}),
      artifactRepair: {
        enabled: true,
        attempt: plan.attempt,
        maxAttempts: plan.maxAttempts,
        workKey: plan.workKey,
        originalExecutionId: String(task?.executionId || ''),
        requiredArtifacts: requiredArtifacts.map(String).filter(Boolean),
      },
    },
  };
}

module.exports = {
  PIPELINE_VERSION,
  MAX_ATTEMPTS,
  validationCode,
  artifactRepairWorkKey,
  planDigestArtifactRepair,
  artifactRepairPatch,
};
