'use strict';
function createTaskProgressBuffer() {
  const pending = new Map();
  function record(taskId, executionId, at, source, meaningful = false) {
    const previous = pending.get(taskId);
    pending.set(taskId, { ...(previous?.executionId === executionId ? previous : {}), executionId, lastHeartbeatAt: at,
      ...(meaningful ? { lastProgressAt: at, progressSource: source } : {}) });
  }
  function apply(store) {
    let changed = false;
    for (const task of store.tasks || []) {
      const update = pending.get(task.id);
      if (!update) continue;
      if (task.executionId === update.executionId && ['running', 'waiting_result'].includes(task.status)) {
        const { executionId, ...fields } = update;
        Object.assign(task, fields); changed = true;
      }
    }
    return changed;
  }
  function entries() {
    return [...pending].map(([taskId, update]) => ({ taskId, ...update }));
  }
  return { record, apply, entries, clear: () => pending.clear(), get size() { return pending.size; } };
}
module.exports = { createTaskProgressBuffer };
