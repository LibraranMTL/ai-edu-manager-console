'use strict';

const fs = require('node:fs');
const { createTaskStateStore } = require('./task-state-store.cjs');

// Owned exclusively by task-io-worker. Main keeps an in-memory compatibility
// snapshot, while durable writes are applied to individual SQLite rows.
function createTaskStoreWriter({ createStore = (file) => createTaskStateStore({ legacyPath: file }) } = {}) {
  const files = new Map();
  let queue = Promise.resolve();

  function signature(file) {
    const stat = fs.statSync(file);
    return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  }

  async function open(file) {
    const store = createStore(file);
    store.open();
    const value = store.value();
    files.set(file, { store, revision: 0, fault: null, value });
    const result = { ok: true, value, revision: 0, signature: signature(store.dbPath), databasePath: store.dbPath };
    store.release();
    return result;
  }

  async function write(file, { value, revision }) {
    const state = files.get(file);
    if (!state || state.fault) throw new Error(state?.fault || '任务数据库尚未初始化');
    if (revision !== state.revision + 1) throw new Error('任务写入序号冲突，拒绝覆盖');
    try {
      state.store.writeSnapshot(value);
      state.revision = revision;
      state.value = structuredClone(value);
      const result = { ok: true, revision, signature: signature(state.store.dbPath), databasePath: state.store.dbPath };
      state.store.release();
      return result;
    } catch (error) { state.store.release(); state.fault = error.message; throw error; }
  }

  async function progress(file, { entries, revision }) {
    const state = files.get(file);
    if (!state || state.fault) throw new Error(state?.fault || '任务数据库尚未初始化');
    if (revision !== state.revision + 1) throw new Error('任务进度写入序号冲突，拒绝覆盖');
    try {
      const accepted = state.store.applyProgress(entries || []);
      for (const patch of entries || []) {
        const task = state.value.tasks.find(item => String(item.id) === String(patch.taskId));
        if (!task || String(task.executionId || '') !== String(patch.executionId || '')
          || !['running', 'waiting_result'].includes(String(task.status || ''))) continue;
        if (patch.lastHeartbeatAt) task.lastHeartbeatAt = String(patch.lastHeartbeatAt);
        if (patch.lastProgressAt) { task.lastProgressAt = String(patch.lastProgressAt); task.progressSource = String(patch.progressSource || ''); }
      }
      state.revision = revision;
      state.store.release();
      return { ok: true, revision, accepted };
    } catch (error) { state.store.release(); state.fault = error.message; throw error; }
  }

  async function appendEvent(file, { event }) {
    const state = files.get(file);
    if (!state || state.fault) throw new Error(state?.fault || '任务数据库尚未初始化');
    try { state.store.appendEvent(event); state.store.release(); return { ok: true }; }
    catch (error) { state.store.release(); state.fault = error.message; throw error; }
  }

  return {
    request(file, op, query = {}) {
      const work = queue.then(() => op === 'store_close'
        ? (files.forEach((state) => state.store.close()), files.clear(), { ok: true })
        : op === 'store_open' ? open(file)
        : op === 'store_event' ? appendEvent(file, query)
          : op === 'store_progress' ? progress(file, query) : write(file, query));
      queue = work.catch(() => {});
      return work;
    },
    close() { for (const state of files.values()) state.store.close(); files.clear(); },
  };
}

module.exports = { createTaskStoreWriter };
