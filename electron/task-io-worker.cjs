'use strict';
const { parentPort } = require('node:worker_threads');
const fs = require('node:fs/promises');
const { watch } = require('node:fs');
const path = require('node:path');
const { queryTaskSnapshot, taskPresentation } = require('./task-read-model.cjs');
const { createTaskInboxReader } = require('./task-inbox-reader.cjs');
const inbox = createTaskInboxReader();
const writer = require('./task-store-writer.cjs').createTaskStoreWriter();
let cache = null;
const watchers = new Map();
let changeTimer = null;
async function watchInbox(root) {
  for (const directory of [path.join(root, 'agent-results'), path.join(root, 'qclaw-results')]) {
    if (watchers.has(directory)) continue;
    try {
      if (!(await fs.lstat(directory)).isDirectory()) continue;
      const watcher = watch(directory, { recursive: true, persistent: false }, (_kind, name) => {
        if (!String(name || '').endsWith('.json') || changeTimer) return;
        // Watchers only invalidate the inbox; parsing is bounded by the normal scan.
        changeTimer = setTimeout(() => { changeTimer = null; parentPort.postMessage({ event: 'inbox_changed' }); }, 250);
        changeTimer.unref?.();
      });
      watcher.on('error', () => { watcher.close(); watchers.delete(directory); });
      watchers.set(directory, watcher);
    } catch { /* The periodic scan remains authoritative if watching is unavailable. */ }
  }
  return { ok: true, watching: watchers.size };
}
async function readStore(file) {
  let stat;
  try { stat = await fs.stat(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const key = `${file}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  if (cache?.key === key) return cache.value;
  const value = JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
  if (!Array.isArray(value.tasks)) throw new Error('任务账本格式无效，未用空列表替代。');
  cache = { key, value };
  return value;
}
async function handle(message) {
  if (['store_open', 'store_write', 'store_event', 'store_progress'].includes(message.op)) {
    const result = await writer.request(message.file, message.op, message.query);
    if (message.op === 'store_write') cache = { key: `${message.file}:${result.signature}`, value: message.query.value };
    else if (message.op === 'store_progress' && cache?.value) {
      for (const patch of message.query.entries || []) {
        const task = cache.value.tasks.find(item => String(item.id) === String(patch.taskId));
        if (!task || String(task.executionId || '') !== String(patch.executionId || '')) continue;
        if (patch.lastHeartbeatAt) task.lastHeartbeatAt = String(patch.lastHeartbeatAt);
        if (patch.lastProgressAt) { task.lastProgressAt = String(patch.lastProgressAt); task.progressSource = String(patch.progressSource || ''); }
      }
    }
    else if (message.op === 'store_open') cache = { key: `${message.file}:${result.signature}`, value: result.value };
    return result;
  }
  if (message.op === 'inbox') return inbox.scan(path.dirname(message.file), message.query.agentId || '');
  if (message.op === 'watch') return watchInbox(path.dirname(message.file));
  const store = await readStore(message.file);
  if (!store) return { ok: true, ready: false, tasks: [], history: [], message: '任务快照尚未初始化。' };
  if (message.op === 'detail') {
    const task = store.tasks.find(t => String(t.id) === String(message.query.id));
    if (!task) return { ok: false, message: '未找到任务。' };
    return { ok: true, task: { ...task, ...taskPresentation(task) }, history: (store.history || []).filter(e => e.taskId === task.id).slice(0, 100) };
  }
  if (message.op === 'statuses') {
    const ids = new Set((message.query.ids || []).slice(0, 32).map(String));
    return { ok: true, tasks: store.tasks.filter(t => ids.has(String(t.id))).map(t => ({ id: t.id, status: t.status,
      updatedAt: t.updatedAt, completedAt: t.completedAt, error: t.error, result: t.result ? { summary: t.result.summary, message: t.result.message } : null })) };
  }
  if (message.op === 'legacy') return { ok: true, ready: true, protocolVersion: store.protocolVersion,
    generatedAt: store.updatedAt, tasks: store.tasks, history: (store.history || []).slice(0, 100), summary: queryTaskSnapshot(store).summary };
  return queryTaskSnapshot(store, message.query);
}
// One queue owns the read cache. Heavy JSON parsing never runs in the UI/main process.
let queue = Promise.resolve();
parentPort.on('message', message => {
  if (message.op === 'inbox') {
    // Directory I/O must not head-of-line block a cached page query.
    void handle(message).then(value => parentPort.postMessage({ id: message.id, value }), error =>
      parentPort.postMessage({ id: message.id, value: { ok: false, message: `回执扫描失败：${error.message}` } }));
    return;
  }
  queue = queue.then(async () => {
    try { parentPort.postMessage({ id: message.id, value: await handle(message) }); }
    catch (error) { parentPort.postMessage({ id: message.id, value: { ok: false, message: `任务快照读取失败：${error.message}` } }); }
  });
});
