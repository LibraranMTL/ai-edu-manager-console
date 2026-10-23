'use strict';
const { Worker } = require('node:worker_threads');
const path = require('node:path');
function createTaskIoClient({ onInboxChanged = () => {}, workerFactory,
  readTimeoutMs = 15_000, durableTimeoutMs = 90_000 } = {}) {
  const deadlines = require('./task-active-deadlines.cjs').createActiveDeadlines();
  let worker, serial = 0, closed = false, closing = null;
  const pending = new Map(), inflight = new Map();
  function fail(error) {
    const old = worker; worker = null;
    for (const p of pending.values()) { p.timer.cancel(); p.reject(error); }
    pending.clear(); inflight.clear();
    return old ? old.terminate().catch(() => {}) : Promise.resolve();
  }
  function start() {
    if (worker) return worker;
    const current = workerFactory ? workerFactory() : new Worker(path.join(__dirname, 'task-io-worker.cjs'));
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
    const durable = op.startsWith('store_');
    const key = durable ? `write:${++serial}` : JSON.stringify([file, op, query]);
    if (inflight.has(key)) return inflight.get(key);
    const promise = new Promise((resolve, reject) => {
      const current = start(), id = ++serial;
      const timer = deadlines.schedule(() => {
        const waiting = pending.get(id);
        if (!waiting) return;
        const error = new Error(durable
          ? '任务账本持久化等待超时，已暂停写入；原账本保持不变，请重启主机后重试。'
          : '任务快照读取超时，请重试。');
        if (durable) { fail(error); return; }
        // A slow page query must not terminate the Worker and reject an
        // unrelated durable write. Ignore a late read response instead.
        pending.delete(id); waiting.reject(error);
      }, durable ? durableTimeoutMs : readTimeoutMs);
      timer.unref?.(); pending.set(id, { resolve, reject, timer });
      current.postMessage({ id, file, op, query });
    }).finally(() => { if (inflight.get(key) === promise) inflight.delete(key); });
    inflight.set(key, promise);
    return promise;
  }
  return { request, pause: () => deadlines.pause(), resume: () => deadlines.resume(), close: () => {
    if (closing) return closing;
    closing = (worker ? request('', 'store_close', {}).catch(() => {}) : Promise.resolve()).then(() => {
      closed = true;
      return fail(new Error('任务查询已关闭。'));
    }).then(() => new Promise((resolve) => setTimeout(resolve, 50)));
    return closing;
  } };
}
module.exports = { createTaskIoClient };
