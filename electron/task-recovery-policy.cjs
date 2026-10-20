'use strict';
const { closedManualPacketPatch, executionProvenance, internalStoppedPatch, recoveryBudget, recoveryPlan, taskExecutionClass } = require('./task-recovery-experience.cjs');
const VERSION = 1;
const retryStatuses = new Set(['failed', 'blocked', 'timed_out']);
function taskExecutionUnresolved(task = {}) {
  if (task.recoveryState === 'unknown' || task.result?.recoveryState === 'unknown') return true;
  if (['CANCEL_STOP_UNCONFIRMED', 'EXECUTION_UNRESOLVED'].includes(String(task.error?.code || ''))) return true;
  return !task.recoveryState && ['running', 'waiting_result'].includes(task.status)
    && ['HEARTBEAT_LOST', 'TASK_TIMEOUT', 'EXECUTION_UNRESOLVED'].includes(task.error?.code)
    && /尚未确认|未确认.*停止|尚未.*停止/.test(task.error?.message || '');
}
const cycle = task => JSON.stringify([task.id, task.sourceType, task.sourceId, task.idempotencyKey || '',
  task.input?.digestBatchId || '', task.input?.sourceVersion || task.input?.inputFingerprint || '']);
function classifyTaskFailure({ message = '', code = '', category = '' } = {}) {
  const text = `${code} ${message}`;
  if (/authentication|unauthorized|login|required.*auth|登录|401\b/i.test(text)) return 'authorization';
  if (/permission|forbidden|access.denied|权限|403\b/i.test(text)) return 'permission';
  if (category === 'validation' || /validation|source.mismatch|execution.id|HOST_DRAFT_INVALID|来源.*冲突|批次.*不一致|校验|观察项不能/i.test(text)) return 'validation';
  if (/429\b|rate.?limit|限流|too many requests/i.test(text)) return 'rate_limit';
  if (/503\b|502\b|service.unavailable|temporarily.unavailable|overloaded|服务繁忙|暂时不可用/i.test(text)) return 'busy';
  if (/ECONNRESET|ECONNREFUSED|ENETUNREACH|EAI_AGAIN|ETIMEDOUT|断网|网络连接/i.test(text)) return 'network';
  return 'other';
}
function retryAfterTime(value, now) {
  if (value == null || value === '') return 0;
  if (/^\d+(?:\.\d+)?$/.test(String(value).trim())) return now + Number(value) * 1000;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? Math.max(now, parsed) : 0;
}
function taskRetryDecision(task, failure, { now = Date.now(), random = Math.random, stopConfirmed = false, retryAfter } = {}) {
  const category = classifyTaskFailure(failure);
  const attempts = Math.max(0, Number(task.attempt || 0));
  const limit = Math.min(3, Math.max(1, Number(task.maxAttempts || 1)));
  const retryable = ['busy', 'rate_limit', 'network'].includes(category);
  const allowed = retryable && stopConfirmed && !taskExecutionUnresolved(task) && task.autoRetry !== false && attempts < limit;
  const earliest = Math.max(now + (attempts < 2 ? 60000 : 300000), retryAfterTime(retryAfter, now));
  const delay = Math.max(0, earliest - now);
  const scheduledAt = earliest + Math.floor(delay * Math.max(0, Math.min(1, random())) * 0.1);
  const nextRetryAt = allowed && Number.isFinite(scheduledAt) && scheduledAt <= 8.64e15 ? new Date(scheduledAt).toISOString() : '';
  return { nextRetryAt, autoRetry: Boolean(nextRetryAt),
    retryRecovery: { version: VERSION, cycleKey: cycle(task), executionId: String(task.executionId || ''),
      attempt: attempts, category, stopConfirmed, nextRetryAt },
    recoveryState: taskExecutionUnresolved(task) || (retryable && !stopConfirmed) ? 'unknown' : task.recoveryState || '',
  };
}
function taskRetryEligible(task, now = Date.now()) {
  const saved = task?.retryRecovery;
  return Boolean(saved?.version === VERSION && saved.stopConfirmed === true && !taskExecutionUnresolved(task)
    && retryStatuses.has(task.status) && task.autoRetry !== false
    && saved.cycleKey === cycle(task) && saved.executionId === String(task.executionId || '')
    && saved.attempt === Number(task.attempt || 0) && Number(task.attempt || 0) < Math.min(3, Number(task.maxAttempts || 1))
    && task.nextRetryAt && saved.nextRetryAt === task.nextRetryAt && Number.isFinite(Date.parse(task.nextRetryAt))
    && Date.parse(task.nextRetryAt) <= now);
}
function unknownExecutionPatch(task, reason, now = new Date().toISOString()) {
  const next = { ...task, recoveryState: 'unknown', recoveryReason: reason, recoveryCheckedAt: now, nextRetryAt: '', autoRetry: false,
    retryRecovery: null, error: { code: 'EXECUTION_UNRESOLVED', message: '上次执行尚未确认完成或停止，系统正在核对回执；原批次和已保存资料保持不变，不会自动重复派发。' } };
  return { recoveryState: next.recoveryState, recoveryReason: next.recoveryReason, recoveryCheckedAt: next.recoveryCheckedAt,
    nextRetryAt: '', autoRetry: false, retryRecovery: null, error: next.error,
    executionProvenance: executionProvenance(next), recoveryBudget: recoveryBudget(next, now), recoveryPlan: recoveryPlan(next, now) };
}
function restoreResetConfirmedStops(store, now = new Date().toISOString()) {
  const repairs = [];
  const history = Array.isArray(store?.history) ? store.history : [];
  for (const task of store?.tasks || []) {
    if (!['draft', 'pending', 'queued', 'approved'].includes(String(task.status || ''))
      || task.executionId || task.result || Number(task.attempt || 0) !== 0) continue;
    const entries = history.filter(entry => String(entry.taskId || '') === String(task.id || ''));
    const proofIndex = entries.findIndex(entry => entry.status === 'cancelled'
      && entry.executionId && entry.executor === 'internal'
      && entry.detail === 'P0 运行时修复：internal_execution_confirmed_stopped');
    if (proofIndex <= 0) continue;
    const proof = entries[proofIndex];
    const newer = entries.slice(0, proofIndex);
    const proofAt = Date.parse(proof.at || '');
    const latestAt = Date.parse(newer[0]?.at || '');
    const onlyPreDispatchRefresh = newer.every(entry => ['draft', 'pending', 'queued', 'approved'].includes(String(entry.status || ''))
      && !entry.executionId && !String(entry.detail || ''));
    // This narrowly repairs the observed migration race: candidate refresh
    // immediately followed a recorded confirmed-stop repair and never began a
    // new execution. Old proofs cannot cancel a later, genuinely dispatched
    // task because the time/order/zero-execution checks all have to match.
    if (!onlyPreDispatchRefresh || !Number.isFinite(proofAt) || !Number.isFinite(latestAt)
      || latestAt < proofAt || latestAt - proofAt > 5 * 60 * 1000) continue;
    Object.assign(task, internalStoppedPatch({
      ...task,
      status: 'cancelled',
      executor: 'internal',
      requestedExecutor: task.requestedExecutor || 'internal',
      executionMode: 'internal',
      adapterId: 'internal',
      executionId: proof.executionId,
      completedAt: proof.at || now,
    }, now));
    repairs.push({ taskId: task.id, type: 'confirmed_stop_guard_restored' });
  }
  return repairs;
}
function reconcileInterruptedExecutions(store, liveExecutions = new Set(), now = new Date().toISOString()) {
  const repairs = restoreResetConfirmedStops(store, now);
  for (const task of store.tasks || []) {
    if (repairs.some(item => item.taskId === task.id && item.type === 'confirmed_stop_guard_restored')) continue;
    const live = liveExecutions.has(`${task.id}:${task.executionId}`);
    const executionClass = taskExecutionClass(task);
    const unresolved = taskExecutionUnresolved(task);
    if (executionClass === 'manual' && task.status === 'cancelled' && task.result?.status === 'manual_required'
      && task.error?.code === 'CANCEL_STOP_UNCONFIRMED') {
      Object.assign(task, closedManualPacketPatch(task, now));
      repairs.push({ taskId: task.id, type: 'legacy_manual_packet_closed' });
      continue;
    }
    const normalizedInternalProvenance = task.adapterId === 'internal'
      ? executionProvenance({ ...task, executor: 'internal', executionMode: 'internal', executionProvenance: null }) : null;
    if (task.recoveryState === 'host_confirmed_stopped' && task.adapterId === 'internal'
      && (task.executor !== 'internal' || task.executionMode !== 'internal'
        || task.executionProvenance?.providerId !== normalizedInternalProvenance.providerId
        || task.executionProvenance?.providerLabel !== normalizedInternalProvenance.providerLabel)) {
      Object.assign(task, internalStoppedPatch(task, now));
      repairs.push({ taskId: task.id, type: 'confirmed_stop_provenance_restored' });
      continue;
    }
    if (executionClass === 'internal' && !live && (unresolved
      || ['running', 'waiting_result', 'reviewing'].includes(task.status))) {
      Object.assign(task, internalStoppedPatch(task, now));
      repairs.push({ taskId: task.id, type: 'internal_execution_confirmed_stopped' });
      continue;
    }
    if (!['internal', 'manual'].includes(executionClass) && !live && unresolved && !['running', 'waiting_result'].includes(task.status)) {
      Object.assign(task, unknownExecutionPatch(task, task.recoveryReason || 'legacy_unconfirmed_stop', now));
      repairs.push({ taskId: task.id, type: 'external_execution_requires_reconciliation' });
      continue;
    }
    if (!['running', 'waiting_result'].includes(task.status) || task.recoveryState === 'unknown'
      || task.executionMode !== 'automatic' || !(['codex', 'workbuddy', 'openclaw', 'qclaw', 'llm-api'].includes(task.adapterId) || /^custom:[0-9a-f-]{36}$/.test(task.adapterId || ''))
      || live) continue;
    Object.assign(task, unknownExecutionPatch(task, 'host_restarted', now));
    repairs.push({ taskId: task.id, type: 'external_execution_requires_reconciliation' });
  }
  return repairs;
}
module.exports = { taskExecutionUnresolved, taskRetryDecision, taskRetryEligible, classifyTaskFailure, retryAfterTime, unknownExecutionPatch, restoreResetConfirmedStops, reconcileInterruptedExecutions };
