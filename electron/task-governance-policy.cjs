'use strict';

const SAFE_UNSTARTED_STATUSES = new Set(['draft', 'pending', 'approved', 'queued']);
const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'blocked', 'cancelled', 'timed_out']);

function isSafeUnstartedTask(task = {}) {
  return SAFE_UNSTARTED_STATUSES.has(String(task.status || ''))
    && Number(task.attempt || 0) === 0
    && !String(task.executionId || '')
    && !task.result
    && String(task.recoveryState || '') !== 'unknown';
}

function governanceEligibility(task = {}, action = 'archive') {
  if (!task?.id) return { ok: false, reason: '任务记录无效' };
  if (String(task.recoveryState || '') === 'unknown') return { ok: false, reason: '外部执行结果未知，需先核对' };
  if (['running', 'waiting_result', 'reviewing'].includes(String(task.status || ''))) {
    return { ok: false, reason: '执行中、等待结果或审核中的任务不可批量处理' };
  }
  if (action === 'cancel') return isSafeUnstartedTask(task)
    ? { ok: true } : { ok: false, reason: '只能批量取消从未启动的任务' };
  if (action === 'archive') return (isSafeUnstartedTask(task) || TERMINAL_STATUSES.has(String(task.status || '')))
    ? { ok: true } : { ok: false, reason: '任务当前状态不可安全归档' };
  if (action === 'delete') return (isSafeUnstartedTask(task) || String(task.status || '') === 'archived' || TERMINAL_STATUSES.has(String(task.status || '')))
    ? { ok: true } : { ok: false, reason: '只能删除从未启动、已结束或已归档的任务' };
  if (action === 'restore') return String(task.status || '') === 'archived'
    ? { ok: true } : { ok: false, reason: '只有已归档任务可恢复' };
  return { ok: false, reason: '不支持的批量操作' };
}

function archiveTaskRecord(task, reason = '用户归档', now = new Date().toISOString()) {
  const eligibility = governanceEligibility(task, 'archive');
  if (!eligibility.ok) return eligibility;
  task.archive = { archivedAt: now, reason: String(reason || '用户归档'), previousStatus: String(task.status || '') };
  task.status = 'archived';
  task.statusGroup = 'archived';
  task.updatedAt = now;
  task.completedAt = task.completedAt || now;
  task.autoRetry = false;
  task.nextRetryAt = '';
  return { ok: true, task };
}

function restoreArchivedTask(task, now = new Date().toISOString()) {
  const eligibility = governanceEligibility(task, 'restore');
  if (!eligibility.ok) return eligibility;
  task.status = 'cancelled';
  task.statusGroup = 'completed';
  task.updatedAt = now;
  task.completedAt = now;
  task.archive = { ...(task.archive || {}), restoredAt: now };
  return { ok: true, task };
}

function isLegacySmartInboxOrphan(task = {}, nowValue = Date.now()) {
  const createdAt = Date.parse(task.createdAt || task.updatedAt || '');
  return String(task.kind || '') === 'smart_material_intake'
    && String(task.sourceId || task.input?.sourceId || '') === 'legacy-download'
    && String(task.status || '') === 'pending'
    && isSafeUnstartedTask(task)
    && Number.isFinite(createdAt)
    && nowValue - createdAt >= 60 * 60 * 1000;
}

function batchGovernancePreview(tasks = [], ids = [], action = 'archive') {
  const requested = new Set((ids || []).map(String));
  const eligible = [];
  const skipped = [];
  for (const task of tasks) {
    if (!requested.has(String(task.id))) continue;
    const decision = governanceEligibility(task, action);
    (decision.ok ? eligible : skipped).push(decision.ok
      ? { id: String(task.id), title: String(task.title || '') }
      : { id: String(task.id), title: String(task.title || ''), reason: decision.reason });
  }
  for (const id of requested) if (![...eligible, ...skipped].some((item) => item.id === id)) skipped.push({ id, title: '', reason: '任务不存在' });
  return { action, requestedCount: requested.size, eligible, skipped };
}

module.exports = { SAFE_UNSTARTED_STATUSES, TERMINAL_STATUSES, archiveTaskRecord, batchGovernancePreview,
  governanceEligibility, isLegacySmartInboxOrphan, isSafeUnstartedTask, restoreArchivedTask };
