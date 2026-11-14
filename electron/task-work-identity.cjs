'use strict';

const crypto = require('node:crypto');

const PROTECTED_TASK_STATUSES = new Set([
  'running', 'waiting_result', 'reviewing', 'committing', 'publishing',
]);

const BUSINESS_OUTCOMES = new Set([
  '', 'completed', 'skipped_unsupported', 'failed_retryable',
  'failed_terminal', 'execution_unknown', 'needs_user_action',
  'no_work', 'awaiting_receipt', 'automation_disabled',
]);

const PRIORITY_CLASSES = Object.freeze({
  maintenance: 20,
  scheduled: 40,
  event: 60,
  manual: 80,
  boosted: 100,
});

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizeMaterialIdentity(input = {}) {
  const rows = Array.isArray(input.materials) ? input.materials : [];
  return rows.map((row) => ({
    materialId: String(row.materialId || row.id || ''),
    version: Math.max(0, Number(row.version || 0)),
    hash: String(row.sha256 || row.sha1 || row.hash || '').toLowerCase(),
  })).filter((row) => row.materialId || row.hash)
    .sort((left, right) => left.materialId.localeCompare(right.materialId)
      || left.version - right.version || left.hash.localeCompare(right.hash));
}

function taskSourceVersion(task = {}) {
  const direct=String(task.sourceVersion || task.input?.sourceVersion || task.input?.inputFingerprint
    || task.input?.growthFingerprint || '');
  const digestBatchId=String(task.input?.digestBatchId || '');
  const digestTask=task.kind==='student_digest'||task.kind==='project_digest';
  // A digest batch is generated during execution preparation. It is evidence
  // for one attempt, not a new business input version; changing identity after
  // a durable claim would correctly trip the send barrier and stall every run.
  if(direct&&!(digestTask&&digestBatchId&&direct===digestBatchId))return direct;
  if(digestTask&&task.workKey)return `work:${String(task.workKey)}`;
  return digestBatchId;
}

function taskPipelineVersion(task = {}) {
  return String(task.pipelineVersion || task.input?.pipelineVersion || task.input?.ruleVersion
    || task.input?.materialExecution?.ruleVersion || 'v1');
}

function deriveWorkKey(task = {}) {
  if (task.workKey) return String(task.workKey);
  const kind = String(task.kind || 'generic');
  const sourceType = String(task.sourceType || 'system');
  const sourceId = String(task.sourceId || 'system');
  const pipelineVersion = taskPipelineVersion(task);
  const periodKey = String(task.periodKey || task.scheduleKey || task.input?.periodKey || '');
  const materials = normalizeMaterialIdentity({
    materials: task.input?.materials || task.input?.files || task.input?.pendingFiles,
  });
  if (kind === 'student_digest' || kind === 'project_digest') {
    if (materials.length) return `${kind}:${sourceId}:${stableHash([materials, pipelineVersion]).slice(0, 40)}`;
    const stableSource = taskSourceVersion(task) || String(task.idempotencyKey || 'idle');
    return `${kind}:${sourceId}:${stableHash([stableSource, pipelineVersion]).slice(0, 40)}`;
  }
  if (['daily_action', 'weekly_action', 'learning_profile', 'learning_changes', 'learning_stage'].includes(kind)) {
    const growth = String(task.input?.growthFingerprint || taskSourceVersion(task));
    const cycle = periodKey || scheduledPeriod(task) || String(task.idempotencyKey || 'current');
    return `${kind}:${sourceId}:${cycle}:${stableHash([growth, pipelineVersion]).slice(0, 24)}`;
  }
  if (kind === 'maintenance_lint') return `${kind}:${sourceId}:${periodKey || scheduledPeriod(task) || 'current'}`;
  return `${kind}:${sourceType}:${sourceId}:${stableHash([
    periodKey || task.idempotencyKey || taskSourceVersion(task) || 'current', pipelineVersion,
  ]).slice(0, 32)}`;
}

function scheduledPeriod(task = {}) {
  const text = String(task.idempotencyKey || task.scheduledAt || '');
  return text.match(/\d{4}-(?:W\d{2}|\d{2}(?:-\d{2})?)/)?.[0] || '';
}

function normalizePriorityClass(task = {}, now = Date.now()) {
  const boostedUntil = Date.parse(task.priorityBoostUntil || '');
  if (Number.isFinite(boostedUntil) && boostedUntil > now) return PRIORITY_CLASSES.boosted;
  const stored = Number(task.basePriorityClass ?? task.priorityClass);
  // Older builds persisted the temporary boost as the base value. Once the
  // boost expires, derive the real base priority instead of keeping 100.
  if (Number.isFinite(stored) && stored !== PRIORITY_CLASSES.boosted) return Math.max(0, Math.min(100, stored));
  if (task.trigger === 'manual') return PRIORITY_CLASSES.manual;
  if (task.trigger === 'event') return PRIORITY_CLASSES.event;
  if (String(task.kind || '').includes('maintenance')) return PRIORITY_CLASSES.maintenance;
  return PRIORITY_CLASSES.scheduled;
}

function normalizeBusinessOutcome(value) {
  const result = String(value || '');
  return BUSINESS_OUTCOMES.has(result) ? result : '';
}

function taskWorkIdentity(task = {}) {
  const workKey=deriveWorkKey(task);
  return {
    workKey,
    sourceVersion: taskSourceVersion({ ...task, workKey }),
    pipelineVersion: taskPipelineVersion(task),
  };
}

function executionBudgetKey(task = {}, errorCode = '', inputHash = '') {
  const identity = taskWorkIdentity(task);
  return stableHash([identity.workKey, String(errorCode || ''), String(inputHash || identity.sourceVersion || '')]);
}

function preserveProtectedTaskState(current = {}, candidate = {}) {
  if (!PROTECTED_TASK_STATUSES.has(String(current.status || ''))) return candidate;
  return {
    ...candidate,
    status: current.status,
    settlementState: current.settlementState,
    businessOutcome: current.businessOutcome,
    result: current.result,
    error: current.error,
    executionId: current.executionId,
    adapterId: current.adapterId,
    executor: current.executor,
    requestedExecutor: current.requestedExecutor,
    executionMode: current.executionMode,
    attempt: current.attempt,
    routeAttempts: current.routeAttempts,
    startedAt: current.startedAt,
    completedAt: current.completedAt,
    lastHeartbeatAt: current.lastHeartbeatAt,
  };
}

module.exports = {
  BUSINESS_OUTCOMES,
  PRIORITY_CLASSES,
  PROTECTED_TASK_STATUSES,
  deriveWorkKey,
  executionBudgetKey,
  normalizeBusinessOutcome,
  normalizeMaterialIdentity,
  normalizePriorityClass,
  preserveProtectedTaskState,
  stableHash,
  taskPipelineVersion,
  taskSourceVersion,
  taskWorkIdentity,
};
