'use strict';
const { Worker } = require('node:worker_threads');
const path = require('node:path');
function createTaskIoClient({ onInboxChanged = () => {} } = {}) {
  const deadlines = require('./task-active-deadlines.cjs').createActiveDeadlines();
  let worker, serial = 0, closed = false;
  const pending = new Map(), inflight = new Map();
  function fail(error) {
    const old = worker; worker = null;
    for (const p of pending.values()) { p.timer.cancel(); p.reject(error); }
    pending.clear(); inflight.clear();
    old?.terminate().catch(() => {});
  }
  function start() {
    if (worker) return worker;
    const current = new Worker(path.join(__dirname, 'task-io-worker.cjs'));
    worker = current;
    current.unref();
    current.on('message', ({ id, value, event }) => {
      if (event === 'inbox_changed') { onInboxChanged(); return; }
      const p = pending.get(id); if (!p) return;
      p.timer.cancel(); pending.delete(id); p.resolve(value);
    });
    current.on('error', error => { if (worker === current) fail(error); });
    current.on('exit', code => { if (worker === current) fail(new Error(`任务存储工作进程退出：${code}`)); });
    return current;
  }
  function request(file, op = 'list', query = {}) {
    if (closed) return Promise.reject(new Error('任务查询已关闭。'));
    // Never stringify a ledger on the main thread, or coalesce writes.
    const key = op.startsWith('store_') ? `write:${++serial}` : JSON.stringify([file, op, query]);
    if (inflight.has(key)) return inflight.get(key);
    const promise = new Promise((resolve, reject) => {
      const current = start(), id = ++serial;
      const timer = deadlines.schedule(() => fail(new Error('任务快照读取超时，请重试。')), 15000);
      timer.unref?.(); pending.set(id, { resolve, reject, timer });
      current.postMessage({ id, file, op, query });
    }).finally(() => { if (inflight.get(key) === promise) inflight.delete(key); });
    inflight.set(key, promise);
    return promise;
  }
  return { request, pause: () => deadlines.pause(), resume: () => deadlines.resume(), close: () => { closed = true; fail(new Error('任务查询已关闭。')); } };
}
module.exports = { createTaskIoClient };
