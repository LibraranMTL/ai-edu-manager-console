'use strict';

const path = require('node:path');
const { Worker } = require('node:worker_threads');

function createProjectMaterialReadClient({ workerFactory, timeoutMs = 30_000 } = {}) {
  let worker = null, serial = 0, closed = false, closing = null;
  const pending = new Map();

  function stop(error) {
    const current = worker;
    worker = null;
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
    return current ? current.terminate().catch(() => {}) : Promise.resolve();
  }

  function start() {
    if (worker) return worker;
    const current = workerFactory ? workerFactory() : new Worker(
      path.join(__dirname, 'project-material-read-worker.cjs'),
      { resourceLimits: { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 64, stackSizeMb: 4 } },
    );
    worker = current;
    current.unref();
    current.on('message', (message) => {
      const request = pending.get(message?.id);
      if (!request) return;
      clearTimeout(request.timer);
      pending.delete(message.id);
      if (message.ok) request.resolve(message.value);
      else request.reject(Object.assign(new Error(message.error?.message || '项目资料后台读取失败。'), {
        code: message.error?.code || 'project_material_read_failed',
      }));
    });
    current.on('error', (error) => { if (worker === current) void stop(error); });
    current.on('exit', (code) => {
      if (worker === current && !closed) void stop(Object.assign(
        new Error(`项目资料读取工作进程退出：${code}`), { code: 'project_material_read_worker_exit' }));
    });
    return current;
  }

  function request(op, input = {}) {
    if (closed) return Promise.reject(Object.assign(new Error('项目资料读取工作进程已关闭。'), {
      code: 'project_material_read_worker_closed',
    }));
    return new Promise((resolve, reject) => {
      const id = ++serial;
      const timer = setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(Object.assign(new Error('项目资料读取超时，请重试。'), {
          code: 'project_material_read_timeout',
        }));
      }, timeoutMs);
      timer.unref?.();
      pending.set(id, { resolve, reject, timer });
      start().postMessage({ id, op, input });
    });
  }

  function close() {
    if (closing) return closing;
    closing = (worker ? request('close').catch(() => {}) : Promise.resolve()).finally(() => {
      closed = true;
      return stop(Object.assign(new Error('项目资料读取工作进程已关闭。'), {
        code: 'project_material_read_worker_closed',
      }));
    });
    return closing;
  }

  return { request, close };
}

module.exports = { createProjectMaterialReadClient };

