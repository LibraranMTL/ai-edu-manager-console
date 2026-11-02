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
const sourceWatchers=new Map();
function watchSources(sources){
  for(const source of sources||[])for(const file of source.files||[]){
    if(sourceWatchers.has(file))continue;
    try{
      const watcher=watch(path.dirname(file),{persistent:false},(_kind,name)=>{
        if(String(name||'')===path.basename(file))parentPort.postMessage({event:'source_changed',source:{sourceType:source.sourceType,sourceId:source.sourceId}});
      });
      watcher.on('error',()=>{watcher.close();sourceWatchers.delete(file);});
      sourceWatchers.set(file,watcher);
    }catch{} // The persisted dirty queue and 15-minute signature check recover missed events.
  }
  return {ok:true};
}
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
  // Once store_open succeeds the Worker owns the authoritative SQLite-backed
  // snapshot. Never fall back to the frozen migration input tasks.json.
  if (cache?.authoritative && cache.value) return cache.value;
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
  if(message.op==='watch_sources')return watchSources(message.query.sources);
  if(message.op==='store_close'){for(const watcher of sourceWatchers.values())watcher.close();sourceWatchers.clear();}
  if (message.op.startsWith('store_') || (writer.has(message.file) && !['inbox','watch'].includes(message.op))) {
    return writer.request(message.file, message.op, message.query);
  }
  if (message.op === 'inbox') return inbox.scan(path.dirname(message.file), message.query.agentId || '');
  if (message.op === 'watch') return watchInbox(path.dirname(message.file));
  if (message.op !== 'legacy') return { ok: true, ready: false, tasks: [], history: [], message: '任务数据库正在初始化。' };
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
// Durable writes stay strictly ordered. Read-only projections can run beside a
// slow fsync so a page refresh never head-of-line blocks task controls.
let queue = Promise.resolve();
parentPort.on('message', message => {
  if (!message.op.startsWith('store_')) {
    void handle(message).then(value => parentPort.postMessage({ id: message.id, value }), error =>
      parentPort.postMessage({ id: message.id, value: { ok: false, message: message.op === 'inbox'
        ? `回执扫描失败：${error.message}`
        : `任务快照读取失败：${error.message}`, code:error.code } }));
    return;
  }
  queue = queue.then(async () => {
    try { parentPort.postMessage({ id: message.id, value: await handle(message) }); }
    catch (error) { parentPort.postMessage({ id: message.id, value: { ok: false, code:error.code, message: `任务快照读取失败：${error.message}` } }); }
  });
});
