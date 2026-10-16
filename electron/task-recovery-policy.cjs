'use strict';
const VERSION = 1;
const retryStatuses = new Set(['failed', 'blocked', 'timed_out']);
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
  const allowed = retryable && stopConfirmed && task.recoveryState !== 'unknown' && task.autoRetry !== false && attempts < limit;
  const earliest = Math.max(now + (attempts < 2 ? 60000 : 300000), retryAfterTime(retryAfter, now));
  const delay = Math.max(0, earliest - now);
  const scheduledAt = earliest + Math.floor(delay * Math.max(0, Math.min(1, random())) * 0.1);
  const nextRetryAt = allowed && Number.isFinite(scheduledAt) && scheduledAt <= 8.64e15 ? new Date(scheduledAt).toISOString() : '';
  return { nextRetryAt, autoRetry: Boolean(nextRetryAt),
    retryRecovery: { version: VERSION, cycleKey: cycle(task), executionId: String(task.executionId || ''),
      attempt: attempts, category, stopConfirmed, nextRetryAt },
    recoveryState: task.recoveryState === 'unknown' || (retryable && !stopConfirmed) ? 'unknown' : task.recoveryState || '',
  };
}
function taskRetryEligible(task, now = Date.now()) {
  const saved = task?.retryRecovery;
  return Boolean(saved?.version === VERSION && saved.stopConfirmed === true && task.recoveryState !== 'unknown'
    && retryStatuses.has(task.status) && task.autoRetry !== false
    && saved.cycleKey === cycle(task) && saved.executionId === String(task.executionId || '')
    && saved.attempt === Number(task.attempt || 0) && Number(task.attempt || 0) < Math.min(3, Number(task.maxAttempts || 1))
    && task.nextRetryAt && saved.nextRetryAt === task.nextRetryAt && Number.isFinite(Date.parse(task.nextRetryAt))
    && Date.parse(task.nextRetryAt) <= now);
}
function unknownExecutionPatch(task, reason, now = new Date().toISOString()) {
  return { recoveryState: 'unknown', recoveryReason: reason, recoveryCheckedAt: now, nextRetryAt: '', autoRetry: false,
    retryRecovery: null, error: { code: 'EXECUTION_UNRESOLVED', message: '上次执行尚未确认完成或停止，正在核对；原批次和已保存资料保持不变，不会自动重复派发。' } };
}
function reconcileInterruptedExecutions(store, liveExecutions = new Set(), now = new Date().toISOString()) {
  const repairs = [];
  for (const task of store.tasks || []) {
    if (!['running', 'waiting_result'].includes(task.status) || task.recoveryState === 'unknown'
      || task.executionMode !== 'automatic' || !(['codex', 'workbuddy', 'openclaw', 'qclaw', 'llm-api'].includes(task.adapterId) || /^custom:[0-9a-f-]{36}$/.test(task.adapterId || ''))
      || liveExecutions.has(`${task.id}:${task.executionId}`)) continue;
    Object.assign(task, unknownExecutionPatch(task, 'host_restarted', now));
    repairs.push({ taskId: task.id, type: 'external_execution_requires_reconciliation' });
  }
  return repairs;
}
module.exports = { taskRetryDecision, taskRetryEligible, classifyTaskFailure, retryAfterTime, unknownExecutionPatch, reconcileInterruptedExecutions };
