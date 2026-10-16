'use strict';
const fs = require('node:fs');

// The legacy host is still synchronous. Fail closed instead of replacing an
// unreadable ledger with an empty one while its async migration is in progress.
function createTaskStoreGuard() {
  let fault = null;
  const knownFiles = new Set();
  const revisions = new WeakMap();
  function signature(file) {
    try { const s = fs.statSync(file); return `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`; }
    catch (error) { if (error.code === 'ENOENT') return 'missing'; throw error; }
  }
  function record(error) {
    fault = { code: error.code || 'TASK_STORAGE_FAILURE', message: error.message, at: new Date().toISOString() };
    return error;
  }
  function assertHealthy() {
    if (fault) throw Object.assign(new Error(`任务存储已暂停派发：${fault.message}。请检查磁盘及目录权限，恢复后重启主机；不要删除账本。`), { code: 'TASK_STORAGE_UNAVAILABLE' });
  }
  function read(file) {
    assertHealthy();
    try {
      const before = signature(file);
      if (before === 'missing') {
        if (knownFiles.has(file)) throw new Error('原有任务账本消失，拒绝重新创建空账本');
        return { value: { tasks: [], history: [] }, revision: before };
      }
      knownFiles.add(file);
      const value = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
      if (!value || !Array.isArray(value.tasks) || (value.history != null && !Array.isArray(value.history))) throw new Error('任务账本格式损坏；原文件保持不变');
      if (signature(file) !== before) throw new Error('读取期间账本发生外部变化');
      return { value, revision: before };
    } catch (error) { throw record(error); }
  }
  return { read, assertHealthy, status: () => fault,
    track(store, revision) { revisions.set(store, revision); return store; },
    write(file, store, normalized, write) {
      assertHealthy();
      const revision = revisions.get(store);
      if (revision === undefined || revision !== signature(file)) throw Object.assign(new Error('任务账本已变化，拒绝用旧快照覆盖；请重新读取后操作'), { code: 'TASK_STORE_CONFLICT' });
      try {
        write(file, normalized);
        knownFiles.add(file);
        const saved = signature(file);
        revisions.set(store, saved); revisions.set(normalized, saved);
        return normalized;
      } catch (error) { throw record(error); }
    },
  };
}
module.exports = { createTaskStoreGuard };
