'use strict';

// Compatibility reads are memory-only. All durable writes go through one Worker
// queue. Critical callers must await flush() before dispatch or reporting success.
function createTaskStoreService({ request, onFault = () => {} }) {
  let file, value, revision = 0, durableRevision = 0, fault = null, pendingEvents = 0, sequence = 0;
  let tail = Promise.resolve();
  const versions = new WeakMap();
  function record(error) {
    if (!fault) { fault = { code: error.code || 'TASK_STORAGE_FAILURE', message: error.message, at: new Date().toISOString() }; onFault(fault); }
    return error;
  }
  function assertHealthy() {
    if (!value || fault) throw Object.assign(new Error(fault ? `任务存储已暂停派发：${fault.message}。原件保留，请检查磁盘后重新启动。` : '任务存储尚未就绪'), { code: 'TASK_STORAGE_UNAVAILABLE' });
  }
  async function checked(op, query) {
    const result = await request(file, op, query);
    if (!result?.ok) throw Object.assign(new Error(result?.message || '任务存储工作进程未确认保存'), { code: result?.code });
    return result;
  }
  return {
    async initialize(target) {
      if (value) { if (file !== target) throw new Error('运行中不能切换任务账本'); return; }
      file = target;
      try { const opened = await checked('store_open', {}); value = opened.value; revision = durableRevision = opened.revision; }
      catch (error) { throw record(error); }
    },
    read(target) {
      assertHealthy(); if (target !== file) throw record(new Error('任务目录发生变化，请重新启动以载入新目录'));
      return { value: structuredClone(value), revision };
    },
    track(store, rev) { versions.set(store, rev); return store; },
    write(target, store, normalized) {
      assertHealthy();
      if (target !== file || versions.get(store) !== revision) throw Object.assign(new Error('任务账本已变化，拒绝旧快照覆盖'), { code: 'TASK_STORE_CONFLICT' });
      // Capture before returning: callers are allowed to mutate their own snapshots.
      const snapshot = structuredClone(normalized), next = ++revision;
      sequence++;
      value = snapshot; versions.set(store, next); versions.set(normalized, next);
      const work = tail.then(async () => {
        assertHealthy(); await checked('store_write', { value: snapshot, revision: next }); durableRevision = next;
      }).catch(error => { throw record(error); });
      tail = work;
      void work.catch(() => {}); // fault is latched; explicit barriers still reject.
      return normalized;
    },
    writeProgress(target, entries = []) {
      assertHealthy();
      if (target !== file) throw record(new Error('任务目录发生变化，请重新启动以载入新目录'));
      const accepted = [];
      for (const patch of entries) {
        const task = value.tasks.find(item => String(item.id) === String(patch.taskId));
        if (!task || String(task.executionId || '') !== String(patch.executionId || '')
          || !['running', 'waiting_result'].includes(String(task.status || ''))) continue;
        const fields = {
          lastHeartbeatAt: String(patch.lastHeartbeatAt || ''),
          ...(patch.lastProgressAt ? { lastProgressAt: String(patch.lastProgressAt), progressSource: String(patch.progressSource || '') } : {}),
        };
        Object.assign(task, fields); accepted.push({ taskId: String(task.id), executionId: String(task.executionId), ...fields });
      }
      if (!accepted.length) return { accepted: 0, revision };
      const next = ++revision; sequence++;
      const work = tail.then(async () => {
        assertHealthy(); await checked('store_progress', { entries: accepted, revision: next }); durableRevision = next;
      }).catch(error => { throw record(error); });
      tail = work; void work.catch(() => {});
      return { accepted: accepted.length, revision: next };
    },
    async flush() { await tail; assertHealthy(); },
    appendEvent(event) {
      assertHealthy(); pendingEvents++; sequence++;
      const captured = structuredClone(event);
      const work = tail.then(async () => { assertHealthy(); await checked('store_event', { event: captured }); })
        .catch(error => { throw record(error); }).finally(() => { pendingEvents--; });
      tail = work; void work.catch(() => {});
    },
    assertHealthy,
    status: () => fault,
    pending: () => revision !== durableRevision || pendingEvents > 0,
    ready: () => Boolean(value),
    sequence: () => sequence,
  };
}
module.exports = { createTaskStoreService };
