'use strict';

function admissionEvent(eventType) {
  const value = String(eventType || 'execution_started');
  return value.endsWith('_started')
    ? `${value.slice(0, -'_started'.length)}_admitted`
    : `${value}_admitted`;
}

function admitRunnableTaskToRunning({ store, taskId, patch = {}, eventType = 'execution_started', transition }) {
  if (!store || !Array.isArray(store.tasks) || typeof transition !== 'function') {
    return { ok: false, message: '任务执行准入参数无效。' };
  }
  let task = store.tasks.find(item => String(item.id || '') === String(taskId || ''));
  if (!task) return { ok: false, message: '未找到任务。' };
  // Candidate reconciliation can refresh a previously admitted task back to
  // pending while an asynchronous capability probe is in flight. Preserve the
  // strict protocol by replaying the required admission step in the same store
  // snapshot immediately before the durable running transition.
  if (String(task.status || '') === 'pending') {
    const admitted = transition(store, taskId, 'approved', {}, admissionEvent(eventType));
    if (!admitted.ok) return admitted;
    task = admitted.task;
  }
  return transition(store, taskId, 'running', patch, eventType);
}

module.exports = { admitRunnableTaskToRunning };
