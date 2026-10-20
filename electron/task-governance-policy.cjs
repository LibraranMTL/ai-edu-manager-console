'use strict';
const { taskExecutionUnresolved } = require('./task-recovery-policy.cjs');

const SAFE_UNSTARTED_STATUSES = new Set(['draft', 'pending', 'approved', 'queued']);
const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'blocked', 'cancelled', 'timed_out']);

function isSafeUnstartedTask(task = {}) {
  return SAFE_UNSTARTED_STATUSES.has(String(task.status || ''))
    && Number(task.attempt || 0) === 0
    && !String(task.executionId || '')
    && !task.result
    && !taskExecutionUnresolved(task);
}

function governanceEligibility(task = {}, action = 'archive') {
  if (!task?.id) return { ok: false, reason: '任务记录无效' };
  if (taskExecutionUnresolved(task)) return { ok: false, reason: '外部执行结果未知，需先核对' };
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
    && (task.sourceId === 'legacy-download' || (!task.sourceId || task.sourceId === 'system') && task.input?.sourceId === 'legacy-download')
    && String(task.status || '') === 'pending'
    && isSafeUnstartedTask(task)
    && Number(task.count || 0) === 0
    && !(task.input?.itemIds || []).length && !task.input?.batchKey && !task.input?.digestBatchId
    && Number.isFinite(createdAt)
    && nowValue - createdAt >= 60 * 60 * 1000;
}

function queueGovernanceCandidates(store, { inboxItems, projects, hasExecutionArtifacts, now = Date.now() } = {}) {
  const candidates = [], skipped = [];
  for (const task of store.tasks || []) {
    const legacy = isLegacySmartInboxOrphan(task, now);
    const idle = task.kind === 'project_digest' && ['pending', 'queued'].includes(task.status)
      && Number(task.count || 0) === 0 && isSafeUnstartedTask(task);
    if (!legacy && !idle) continue;
    let reason = '';
    if (typeof hasExecutionArtifacts !== 'function' || hasExecutionArtifacts(task)) reason = '执行目录未核实或存在执行产物';
    else if ((store.tasks || []).some(other => other.id !== task.id
      && [other.parentTaskId, other.input?.parentTaskId, other.input?.taskId].includes(task.id))) reason = '存在关联子任务';
    else if (legacy && (!Array.isArray(inboxItems) || inboxItems.some(item =>
      [item.taskId, item.analysisTaskId, item.classificationTaskId, item.processing?.taskId].includes(task.id)))) reason = '资料关联未核实或存在关联资料';
    else if (idle) {
      const project = projects?.find(item => String(item.id) === String(task.sourceId));
      const state = project?.digestState;
      if (!state || Number(state.pendingCount) !== 0 || (state.pendingFiles || []).length
        || state.digestBatchId || task.input?.digestBatchId || ['digesting', 'submitted', 'failed'].includes(state.status)) reason = '项目仍有资料、批次或状态未核实';
    }
    if (reason) skipped.push({ taskId: task.id, reason });
    else candidates.push({ task, reason: legacy ? '旧版资料入口的空历史任务，已核对无关联执行' : '项目当前无待处理资料，转为空闲监测' });
  }
  return { candidates, skipped };
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
  governanceEligibility, isLegacySmartInboxOrphan, isSafeUnstartedTask, restoreArchivedTask, queueGovernanceCandidates };
