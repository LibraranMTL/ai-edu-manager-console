'use strict';

const { deriveWorkKey } = require('./task-work-identity.cjs');

const DELETABLE_HISTORY_STATUSES = new Set(['succeeded', 'failed', 'blocked', 'cancelled', 'timed_out', 'archived']);

function isUnstartedDisposableTask(task = {}) {
  return ['draft', 'pending', 'approved', 'queued'].includes(String(task.status || ''))
    && Number(task.attempt || 0) === 0
    && !String(task.executionId || '')
    && !task.result
    && String(task.recoveryState || '') !== 'unknown';
}

function taskRecordDeletable(task = {}) {
  if (task.recoveryState === 'unknown') return false;
  return DELETABLE_HISTORY_STATUSES.has(String(task.status || '')) || isUnstartedDisposableTask(task);
}

function deletionKey(task = {}) {
  const workKey = String(task.workKey || deriveWorkKey(task) || '');
  if (workKey) return `${String(task.kind || '')}|${workKey}`;
  return `${String(task.id || task.taskId || '')}|${String(task.idempotencyKey || '')}`;
}

function deletedTaskCandidateSuppressed(store, candidate) {
  const key = deletionKey(candidate);
  return Boolean(key !== '|' && (store?.deletedTasks || []).some((entry) =>
    entry.suppression === 'work_key' && deletionKey(entry) === key));
}

function removeHistoricalTaskRecord(store, taskId, now = new Date().toISOString(), options = {}) {
  if (!store || !Array.isArray(store.tasks)) return { ok: false, message: '任务账本不可用。' };
  const index = store.tasks.findIndex((task) => String(task.id) === String(taskId));
  if (index < 0) return { ok: false, message: '未找到历史任务。' };
  const task = store.tasks[index];
  if (!taskRecordDeletable(task)) {
    return { ok: false, message: '只能删除从未启动、已结束或已归档的任务；正在执行、等待结果、审核中或结果未知的任务不能直接删除。' };
  }
  store.tasks.splice(index, 1);
  const historyBefore = Array.isArray(store.history) ? store.history.length : 0;
  store.history = (store.history || []).filter((entry) => String(entry.taskId || '') !== String(task.id));
  const tombstone = {
    taskId: String(task.id),
    idempotencyKey: String(task.idempotencyKey || ''),
    workKey: String(task.workKey || deriveWorkKey(task) || ''),
    deletedAt: now,
    title: String(task.title || ''),
    kind: String(task.kind || ''),
    sourceType: String(task.sourceType || ''),
    sourceId: String(task.sourceId || ''),
    previousStatus: String(task.status || ''),
    suppression: options.suppressCurrentWork === true ? 'work_key' : 'hide_only',
  };
  const deletedTasks = Array.isArray(store.deletedTasks) ? store.deletedTasks : [];
  store.deletedTasks = [tombstone, ...deletedTasks.filter((entry) => deletionKey(entry) !== deletionKey(tombstone))].slice(0, 500);
  return { ok: true, task, tombstone, removedHistoryCount: historyBefore - store.history.length };
}

module.exports = { DELETABLE_HISTORY_STATUSES, deletedTaskCandidateSuppressed, deletionKey, isUnstartedDisposableTask,
  taskRecordDeletable, removeHistoricalTaskRecord };
