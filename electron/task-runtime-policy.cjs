const { recoverableResearchBlock } = require('./research-task-policy.cjs');
const { taskExecutionUnresolved, unknownExecutionPatch } = require('./task-recovery-policy.cjs');
const { createHash } = require('node:crypto');
const ACTIVE_TASK_STATUSES = new Set(['running', 'waiting_result']);
const PROTECTED_TASK_STATUSES = new Set(['running', 'waiting_result', 'reviewing']);
const PROTECTED_SETTLEMENT_STATES = new Set(['reviewing', 'committing', 'publishing']);
const TERMINAL_TASK_STATUSES = new Set(['succeeded', 'failed', 'blocked', 'cancelled', 'timed_out', 'archived']);
const NOISY_EVENT_TYPES = new Set([
  'adapter_heartbeat',
  'task_heartbeat_lost',
  'runtime_fallback_prepared',
  'runtime_fallback',
  'manual_execution_prepared',
  'manual_packet_exported',
]);
const CONFIRMED_STOP_STATES = new Set(['host_confirmed_stopped', 'manual_packet_closed', 'user_confirmed_stopped']);
const AUTO_SETTLE_RETAINED_RESULT_KINDS = new Set(['maintenance_lint']);

function dispatchBlockSignature(conflict = {}) {
  return createHash('sha256').update(JSON.stringify([
    String(conflict.reasonCode || ''),
    String(conflict.blockerTaskId || ''),
    String(conflict.blockerWorkKey || ''),
    String(conflict.evidence?.executionId || ''),
    String(conflict.evidence?.batchId || ''),
  ])).digest('hex').slice(0, 40);
}

function dispatchBlockPatch(conflict = {}, now = new Date().toISOString()) {
  const signature = dispatchBlockSignature(conflict);
  return {
    dispatchBlock: {
      code: String(conflict.reasonCode || 'execution_unknown_dependency'),
      blockerTaskId: String(conflict.blockerTaskId || ''),
      blockerWorkKey: String(conflict.blockerWorkKey || ''),
      signature,
      createdAt: String(now),
      nextCheckAt: String(conflict.nextCheckAt || ''),
      evidence: conflict.evidence && typeof conflict.evidence === 'object' ? { ...conflict.evidence } : {},
    },
  };
}

function clearDispatchBlockPatch(signature = '') {
  return { dispatchBlock: null, clearedDispatchBlockSignature: String(signature || '') };
}

function retainedValidatedResult(task) {
  return Boolean(task?.result?.validation?.valid)
    && ['reviewing', 'succeeded'].includes(String(task?.result?.status || ''));
}

function retainedValidatedResultStatus(task) {
  if (!retainedValidatedResult(task)) return '';
  if (String(task?.result?.status || '') === 'succeeded') return 'succeeded';
  if (AUTO_SETTLE_RETAINED_RESULT_KINDS.has(String(task?.kind || ''))
    && task?.approval?.required !== true) return 'succeeded';
  return 'reviewing';
}

function scheduledCycleScope(value) {
  const parts = String(value || '').split(':').reverse();
  return parts.find(part => /^\d{4}(?:-(?:\d{2}(?:-\d{2})?|W\d{2}))?$/.test(part)) || '';
}

function taskExecutionClass(task) {
  const adapterId = String(task?.adapterId || '');
  const mode = String(task?.executionMode || '');
  if (adapterId === 'manual' || mode === 'manual' || mode === 'desktop_handoff' || mode === 'agent_handoff') return 'manual';
  if (mode === 'automatic') return 'process';
  if (adapterId === 'qclaw' || mode === 'inbox') return 'inbox';
  if (adapterId === 'internal' || mode === 'internal') return 'internal';
  return 'process';
}

function taskTimeoutDecision(task, nowValue = Date.now()) {
  if (taskExecutionUnresolved(task)) return { enabled: false, due: false, kind: 'reconciling' };
  if (!ACTIVE_TASK_STATUSES.has(String(task?.status || '')) || !task?.startedAt) {
    return { enabled: false, due: false, kind: 'inactive' };
  }
  const executionClass = taskExecutionClass(task);
  if (executionClass === 'manual') {
    return { enabled: false, due: false, kind: 'manual_wait' };
  }
  const now = Number(nowValue);
  const resumedAt = Date.parse(task.resumedAt || '');
  if (Number.isFinite(resumedAt) && now < resumedAt + 60000) return { enabled: false, due: false, kind: 'resume_grace' };
  const suspendedMs = Math.max(0, Number(task.suspendedDurationMs) || 0);
  const startedAt = Date.parse(task.startedAt);
  if (!Number.isFinite(startedAt)) {
    return { enabled: false, due: false, kind: 'orphan' };
  }
  if (executionClass === 'inbox') {
    const resultTimeoutSeconds = Math.max(900, Number(task.resultTimeoutSeconds || 24 * 60 * 60));
    const timeoutAt = startedAt + resultTimeoutSeconds * 1000 + suspendedMs;
    return {
      enabled: true,
      due: now > timeoutAt,
      kind: 'result_wait',
      timeoutAt,
      error: {
        code: 'RESULT_WAIT_TIMEOUT',
        message: `等待 Agent 结果超过 ${resultTimeoutSeconds} 秒。`,
      },
    };
  }
  const heartbeatAt = Date.parse(task.lastHeartbeatAt || task.startedAt);
  const timeoutSeconds = Math.max(30, Number(task.timeoutSeconds || 900));
  const heartbeatTimeoutSeconds = Math.max(30, Number(task.heartbeatTimeoutSeconds || Math.min(timeoutSeconds, 180)));
  const executionTimeoutAt = startedAt + timeoutSeconds * 1000 + suspendedMs;
  const heartbeatTimeoutAt = Math.max(Number.isFinite(heartbeatAt) ? heartbeatAt : startedAt, Number.isFinite(resumedAt) ? resumedAt : 0) + heartbeatTimeoutSeconds * 1000;
  const timeoutAt = Math.min(executionTimeoutAt, heartbeatTimeoutAt);
  const heartbeatLost = heartbeatTimeoutAt <= executionTimeoutAt;
  return {
    enabled: true,
    due: now > timeoutAt,
    kind: heartbeatLost ? 'heartbeat' : 'execution',
    timeoutAt,
    error: {
      code: heartbeatLost ? 'HEARTBEAT_LOST' : 'TASK_TIMEOUT',
      message: heartbeatLost
        ? `任务超过 ${heartbeatTimeoutSeconds} 秒没有心跳。`
        : `任务超过 ${timeoutSeconds} 秒未完成。`,
    },
  };
}

function candidateRuntimeDecision(current, candidate) {
  const currentStatus = String(current?.status || '');
  const sourceStatus = String(candidate?.status || '');
  const currentCycle = String(current?.idempotencyKey || '');
  const candidateCycle = String(candidate?.idempotencyKey || '');
  const currentWorkKey = String(current?.workKey || '');
  const candidateWorkKey = String(candidate?.workKey || '');
  const sameWork = Boolean(currentWorkKey && candidateWorkKey && currentWorkKey === candidateWorkKey);
  const sameLegacyCycle = Boolean(!currentWorkKey && !candidateWorkKey
    && currentCycle && candidateCycle && currentCycle === candidateCycle);
  const active = PROTECTED_TASK_STATUSES.has(currentStatus)
    || PROTECTED_SETTLEMENT_STATES.has(String(current?.settlementState || ''));
  const manualPacket = taskExecutionClass(current) === 'manual'
    && current?.result?.packet && typeof current.result.packet === 'object';
  const orphan = ['running', 'waiting_result'].includes(currentStatus)
    && (!current?.executionId || !current?.startedAt) && !manualPacket;
  const preserveExecution = active && !orphan;
  // A failed run can already be prepared for its next adapter while the
  // candidate builder still describes the generic pending card. Keep that
  // prepared runtime intact until it launches; otherwise a UI refresh can
  // silently replace the selected adapter and retry state.
  // Approval is a prepared dispatch, including the async preflight before an
  // executionId exists. A background candidate refresh must not demote it to
  // blocked while qualification is in flight (blocked -> running is illegal).
  const preservePreparedExecution = currentStatus === 'approved'
    || currentStatus === 'queued' && Boolean(current?.executionId);
  // A validated result is durable for the work that produced it, not for all
  // future material handled by the same stable task row.  Project/student
  // digest rows are intentionally reused; a changed work key must therefore
  // be allowed to open a new cycle instead of inheriting the old success.
  const retainedResultStatus = sameWork || sameLegacyCycle
    ? retainedValidatedResultStatus(current)
    : '';
  const preserveRuntime = ['claimed','send_intent','started','unknown'].includes(current?.executionPhase)
    || (sameWork&&Boolean(current?.capabilityWait)) || taskExecutionUnresolved(current) || preserveExecution || preservePreparedExecution
    || Boolean(retainedResultStatus);
  // A confirmed stop is durable for the whole scheduled window. Source
  // fingerprints can legitimately change while the app is running (or when a
  // newer host calculates them more precisely); that alone must never turn a
  // quarantined execution back into an automatic dispatch. A genuinely new
  // dated window can create a fresh task, and an explicit user retry follows a
  // separate transition instead of passing through candidate refresh.
  const currentScope = scheduledCycleScope(currentCycle);
  const candidateScope = scheduledCycleScope(candidateCycle);
  const confirmedStopProtected = TERMINAL_TASK_STATUSES.has(currentStatus)
    && CONFIRMED_STOP_STATES.has(String(current?.recoveryState || ''))
    && (!currentScope || !candidateScope || currentScope === candidateScope);
  // Builders may rotate a batch/candidate id while the underlying material
  // versions stay unchanged. The stable work key is authoritative: do not
  // reset attempts, terminal budget or adapter history for the same work.
  const newCycle = Boolean(!sameWork && candidateCycle && candidateCycle !== currentCycle
    && !preserveRuntime && !confirmedStopProtected);
  const refreshBlock = recoverableResearchBlock(current) && ['blocked', 'pending', 'queued'].includes(sourceStatus);
  const preserveTerminal = TERMINAL_TASK_STATUSES.has(currentStatus) && !newCycle && !refreshBlock;
  const safeSourceStatus = orphan && ACTIVE_TASK_STATUSES.has(sourceStatus) ? 'pending' : sourceStatus;
  return {
    newCycle,
    orphan,
    preserveExecution,
    preservePreparedExecution,
    preserveRuntime,
    preserveTerminal,
    sameWork,
    confirmedStopProtected,
    refreshBlock,
    resetExecution: newCycle || orphan,
    nextStatus: retainedResultStatus || (preserveRuntime || preserveTerminal ? currentStatus : safeSourceStatus),
  };
}

function repairTaskRuntimeStore(store, now = new Date().toISOString()) {
  if (!store || !Array.isArray(store.tasks)) return { changed: false, repairs: [] };
  const repairs = [];
  for (const task of store.tasks) {
    const retainedResultStatus = retainedValidatedResultStatus(task);
    if (['draft', 'pending', 'approved', 'queued', 'blocked', 'failed', 'timed_out'].includes(String(task.status || ''))
      && retainedResultStatus) {
      const accepted = retainedResultStatus === 'succeeded';
      task.status = retainedResultStatus;
      task.statusGroup = accepted ? 'completed' : 'actionable';
      task.settlementState = accepted ? 'settled' : 'reviewing';
      task.result = { ...task.result, status: retainedResultStatus,
        ...(accepted && !task.result?.autoAcceptedAt ? { autoAcceptedAt: now } : {}) };
      task.error = null;
      task.nextRetryAt = '';
      task.resourceDeferredAt = '';
      task.resourceRetryAt = '';
      if (accepted) {
        task.completedAt = task.completedAt || now;
        task.approval = { ...(task.approval || {}), required: false, status: 'not_required',
          reviewedAt: task.approval?.reviewedAt || now,
          reviewedBy: task.approval?.reviewedBy || 'system_validation' };
      }
      task.updatedAt = now;
      repairs.push({ taskId: task.id, type: accepted ? 'retained_validated_result_settled' : 'retained_validated_result_restored' });
      continue;
    }
    if (taskExecutionUnresolved(task) && task.recoveryState !== 'unknown') {
      const priorError = task.error;
      Object.assign(task, unknownExecutionPatch(task, 'legacy_unconfirmed_stop', now), { error: priorError, updatedAt: now });
      repairs.push({ taskId: task.id, type: 'unresolved_marker_repaired' });
    }
    if (task.recoveryState === 'unknown') continue;
    const executionClass = taskExecutionClass(task);
    const manualPacket = executionClass === 'manual' && task.result?.packet
      && typeof task.result.packet === 'object';
    if (manualPacket && ['draft', 'pending', 'approved', 'queued', 'running', 'waiting_result'].includes(String(task.status || ''))
      && (task.status !== 'waiting_result' || !task.executionId || !task.startedAt)) {
      // A legacy handoff may already be outside the host even when old metadata
      // is incomplete. Preserve the packet and require reconciliation.
      task.status = 'waiting_result';
      task.recoveryState = 'unknown';
      task.recoveryReason = 'legacy_manual_packet_incomplete';
      task.autoRetry = false;
      task.nextRetryAt = '';
      task.updatedAt = now;
      repairs.push({ taskId: task.id, type: 'legacy_manual_packet_quarantined' });
      continue;
    }
    const maxAttempts = Math.max(1, Number(task.maxAttempts || 1));
    const attempt = Math.max(0, Number(task.attempt || 0));
    if (attempt > maxAttempts) {
      task.attempt = maxAttempts;
      task.autoRetry = false;
      task.nextRetryAt = '';
      task.updatedAt = now;
      repairs.push({ taskId: task.id, type: 'retry_limit_repaired', previousAttempt: attempt, attempt: maxAttempts });
    }
    if (ACTIVE_TASK_STATUSES.has(String(task.status || '')) && (!task.executionId || !task.startedAt)) {
      task.status = 'pending';
      task.statusGroup = 'actionable';
      task.executionId = '';
      task.adapterId = '';
      task.startedAt = '';
      task.lastHeartbeatAt = '';
      task.completedAt = '';
      task.nextRetryAt = '';
      task.error = null;
      task.autoRetry = false;
      task.updatedAt = now;
      repairs.push({ taskId: task.id, type: 'orphan_execution_recovered' });
      continue;
    }
    if (['draft', 'pending', 'approved', 'queued'].includes(String(task.status || ''))
      && task.executionId) {
      task.executionId = '';
      task.adapterId = '';
      task.startedAt = '';
      task.completedAt = '';
      task.lastHeartbeatAt = '';
      task.nextRetryAt = '';
      task.updatedAt = now;
      repairs.push({ taskId: task.id, type: 'stale_execution_identity_cleared' });
    }
    if (String(task.status || '') === 'timed_out'
      && String(task.error?.code || '') === 'HEARTBEAT_LOST'
      && ['manual', 'inbox'].includes(executionClass)
      && task.executionId) {
      task.status = 'waiting_result';
      task.statusGroup = 'running';
      task.completedAt = '';
      task.nextRetryAt = '';
      task.error = null;
      task.autoRetry = false;
      task.updatedAt = now;
      repairs.push({ taskId: task.id, type: `${executionClass}_wait_restored` });
    }
  }
  return { changed: repairs.length > 0, repairs };
}

function compactTaskEvents(events, options = {}) {
  const maxEvents = Math.max(500, Number(options.maxEvents || 5000));
  const windowMs = Math.max(60 * 1000, Number(options.windowMs || 10 * 60 * 1000));
  const compacted = [];
  const recentByKey = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    if (!event || typeof event !== 'object') continue;
    const type = String(event.type || 'updated');
    if (!NOISY_EVENT_TYPES.has(type)) {
      compacted.push(event);
      continue;
    }
    const key = `${String(event.taskId || '')}|${type}`;
    const eventAt = Date.parse(event.at || '') || 0;
    const previousIndex = recentByKey.get(key);
    const previous = Number.isInteger(previousIndex) ? compacted[previousIndex] : null;
    const previousAt = Date.parse(previous?.at || '') || 0;
    if (previous && eventAt && previousAt && eventAt - previousAt <= windowMs) {
      compacted[previousIndex] = {
        ...event,
        firstAt: previous.firstAt || previous.at || event.at,
        repeatCount: Number(previous.repeatCount || 1) + 1,
      };
      continue;
    }
    recentByKey.set(key, compacted.length);
    compacted.push(event);
  }
  return compacted.length > maxEvents ? compacted.slice(-maxEvents) : compacted;
}

module.exports = {
  ACTIVE_TASK_STATUSES,
  TERMINAL_TASK_STATUSES,
  candidateRuntimeDecision,
  clearDispatchBlockPatch,
  compactTaskEvents,
  dispatchBlockPatch,
  dispatchBlockSignature,
  repairTaskRuntimeStore,
  taskExecutionClass,
  taskTimeoutDecision,
};
