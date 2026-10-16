'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

// Owned exclusively by task-io-worker. Never expose a second file writer.
function createTaskStoreWriter({ io = fs } = {}) {
  const files = new Map();
  let queue = Promise.resolve();
  const signature = async file => {
    try { const s = await io.stat(file); return `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`; }
    catch (error) { if (error.code === 'ENOENT') return 'missing'; throw error; }
  };
  async function open(file) {
    const before = await signature(file);
    let value = { tasks: [], history: [] };
    if (before !== 'missing') {
      value = JSON.parse((await io.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
      if (!value || !Array.isArray(value.tasks) || (value.history != null && !Array.isArray(value.history))) throw new Error('任务账本格式损坏，原文件保持不变');
      if (before !== await signature(file)) throw new Error('读取期间账本发生外部变化');
      // Copy once, without overwriting a previous migration backup.
      const backup = path.join(path.dirname(file), 'migration-backups', 'tasks-before-async-writer.json');
      await io.mkdir(path.dirname(backup), { recursive: true });
      try { await io.copyFile(file, backup, 1); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    const progressFile = path.join(path.dirname(file), 'progress.jsonl');
    try {
      const raw = await io.readFile(progressFile, 'utf8');
      for (const line of raw.split(/\r?\n/).filter(Boolean)) {
        let patch; try { patch = JSON.parse(line); } catch { continue; }
        const task = value.tasks.find(item => String(item.id) === String(patch.taskId));
        if (!task || String(task.executionId || '') !== String(patch.executionId || '')
          || !['running', 'waiting_result'].includes(String(task.status || ''))) continue;
        if (patch.lastHeartbeatAt) task.lastHeartbeatAt = String(patch.lastHeartbeatAt);
        if (patch.lastProgressAt) { task.lastProgressAt = String(patch.lastProgressAt); task.progressSource = String(patch.progressSource || ''); }
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    files.set(file, { signature: before, revision: 0, fault: null, value });
    return { ok: true, value, revision: 0, signature: before };
  }
  async function write(file, { value, revision }) {
    const state = files.get(file);
    if (!state || state.fault) throw new Error(state?.fault || '任务账本尚未初始化');
    if (revision !== state.revision + 1) throw new Error('任务写入序号冲突，拒绝覆盖');
    const temporary = `${file}.${crypto.randomUUID()}.pending`;
    try {
      if (await signature(file) !== state.signature) throw new Error('账本发生外部变化，拒绝覆盖；请保留现场并重新启动');
      await io.mkdir(path.dirname(file), { recursive: true });
      const handle = await io.open(temporary, 'wx');
      try { await handle.writeFile(JSON.stringify(value, null, 2), 'utf8'); await handle.sync(); }
      finally { await handle.close(); }
      // Check again after expensive serialization/I/O, before atomic replacement.
      if (await signature(file) !== state.signature) throw new Error('保存期间账本发生外部变化');
      await io.rename(temporary, file);
      state.signature = await signature(file); state.revision = revision; state.value = value;
      // A full durable snapshot now contains every accepted progress patch.
      // Removing the journal after replacement is crash-safe: replay is
      // idempotent and still checks execution identity.
      await io.unlink(path.join(path.dirname(file), 'progress.jsonl')).catch(() => {});
      return { ok: true, revision, signature: state.signature };
    } catch (error) {
      state.fault = error.message;
      // Keep the uniquely named pending file for explicit recovery, never adopt it blindly.
      throw error;
    }
  }
  async function progress(file, { entries, revision }) {
    const state = files.get(file);
    if (!state || state.fault) throw new Error(state?.fault || '任务账本尚未初始化');
    if (revision !== state.revision + 1) throw new Error('任务进度写入序号冲突，拒绝覆盖');
    const accepted = [];
    for (const patch of entries || []) {
      const task = state.value.tasks.find(item => String(item.id) === String(patch.taskId));
      if (!task || String(task.executionId || '') !== String(patch.executionId || '')
        || !['running', 'waiting_result'].includes(String(task.status || ''))) continue;
      if (patch.lastHeartbeatAt) task.lastHeartbeatAt = String(patch.lastHeartbeatAt);
      if (patch.lastProgressAt) { task.lastProgressAt = String(patch.lastProgressAt); task.progressSource = String(patch.progressSource || ''); }
      accepted.push(patch);
    }
    if (accepted.length) {
      await io.mkdir(path.dirname(file), { recursive: true });
      const handle = await io.open(path.join(path.dirname(file), 'progress.jsonl'), 'a');
      try { await handle.writeFile(`${accepted.map(item => JSON.stringify(item)).join('\n')}\n`, 'utf8'); await handle.sync(); }
      finally { await handle.close(); }
    }
    state.revision = revision;
    return { ok: true, revision, accepted: accepted.length };
  }
  async function appendEvent(file, { event }) {
    const state = files.get(file);
    if (!state || state.fault) throw new Error(state?.fault || '任务存储尚未初始化');
    const eventFile = path.join(path.dirname(file), 'events.jsonl');
    try {
      await io.mkdir(path.dirname(file), { recursive: true });
      let stat; try { stat = await io.stat(eventFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (stat?.size >= 5 * 1024 * 1024) {
        const archives = path.join(path.dirname(file), 'event-archives'); await io.mkdir(archives, { recursive: true });
        await io.rename(eventFile, path.join(archives, `events-${Date.now()}-${crypto.randomUUID()}.jsonl`));
      }
      await io.appendFile(eventFile, `${JSON.stringify(event)}\n`, 'utf8');
      return { ok: true };
    } catch (error) { state.fault = error.message; throw error; }
  }
  return { request(file, op, query = {}) {
    const work = queue.then(() => op === 'store_open' ? open(file)
      : op === 'store_event' ? appendEvent(file, query)
        : op === 'store_progress' ? progress(file, query) : write(file, query));
    queue = work.catch(() => {});
    return work;
  } };
}
module.exports = { createTaskStoreWriter };
