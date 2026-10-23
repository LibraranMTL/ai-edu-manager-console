'use strict';

const path = require('node:path');
const { Worker } = require('node:worker_threads');

function runProjectMaterialAutomationWorker({ project, options = {}, onAiRequest, workerFactory,
  timeoutMs = 180_000 } = {}) {
  return new Promise((resolve, reject) => {
    const worker = workerFactory ? workerFactory({ project, options })
      : new Worker(path.join(__dirname, 'project-material-automation-worker.cjs'), {
        workerData: { project, options },
        resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
      });
    let settled = false;
    const timer = setTimeout(() => finish(Object.assign(new Error('项目资料后台处理超时。'), {
      code: 'material_automation_worker_timeout',
    })), timeoutMs);
    timer.unref?.();
    async function finish(error, value) {
      if (settled) return;
      settled = true; clearTimeout(timer);
      worker.removeAllListeners();
      await Promise.resolve(worker.terminate()).catch(() => {});
      if (error) reject(error); else resolve(value);
    }
    worker.on('message', async (message) => {
      if (message?.type === 'ai_request') {
        try {
          const value = typeof onAiRequest === 'function'
            ? await onAiRequest(message.payload) : { suggestions: [], failed: [] };
          worker.postMessage({ type: 'ai_response', requestId: message.requestId, ok: true, value });
        } catch (error) {
          worker.postMessage({ type: 'ai_response', requestId: message.requestId, ok: false,
            error: { code: error.code || 'ai_classification_failed', message: error.message } });
        }
        return;
      }
      if (message?.type === 'result') finish(null, message.value);
      else if (message?.type === 'error') finish(Object.assign(new Error(message.error?.message
        || '项目资料后台处理失败。'), { code: message.error?.code || 'material_automation_worker_failed' }));
    });
    worker.on('error', finish);
    worker.on('exit', (code) => {
      if (!settled) finish(Object.assign(new Error(`项目资料后台进程意外退出：${code}`), {
        code: 'material_automation_worker_exit',
      }));
    });
  });
}

module.exports = { runProjectMaterialAutomationWorker };
