'use strict';

const path = require('node:path');
const { Worker } = require('node:worker_threads');

const WORKER = path.join(__dirname, 'material-index-worker.cjs');

function startMaterialIndexer({ service, pollMs = 2000, timeoutMs = 180000, ocrCommand = '', ocrArgs = [] } = {}) {
  if (!service || typeof service.claimMaterialIndexJob !== 'function') throw new TypeError('Material index service is required');
  let timer = null, active = null, stopped = false, lastError = '', completed = 0;
  const schedule = delay => {
    if (stopped || timer) return;
    timer = setTimeout(() => { timer = null; void tick(); }, delay); timer.unref?.();
  };
  const runWorker = job => new Promise((resolve, reject) => {
    const worker = new Worker(WORKER, { workerData: { ...job, ocrCommand, ocrArgs }, resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32 } });
    active = worker;
    const timeout = setTimeout(() => { const error = new Error('云端资料提取超时。'); error.code = 'extraction_timeout'; reject(error); void worker.terminate(); }, timeoutMs);
    const finish = (error, result) => { clearTimeout(timeout); error ? reject(error) : resolve(result); };
    worker.once('message', message => message?.ok ? finish(null, message.result) : finish(Object.assign(new Error(message?.error?.message || '资料提取失败。'), { code: message?.error?.code || 'extraction_failed' })));
    worker.once('error', error => finish(error));
    worker.once('exit', code => { if (active === worker && code !== 0) finish(Object.assign(new Error(`资料提取进程异常退出（${code}）。`), { code: 'worker_exit' })); });
  });
  async function tick() {
    if (stopped || active) return;
    const job = service.claimMaterialIndexJob();
    if (!job) { schedule(pollMs); return; }
    try { service.completeMaterialIndexJob(job.revisionId, await runWorker(job)); completed++; lastError = ''; }
    catch (error) { lastError = String(error?.message || error); service.failMaterialIndexJob(job.revisionId, error); }
    finally { active = null; }
    schedule(0);
  }
  async function drainUntilIdle({ maxJobs = 100, waitMs = timeoutMs } = {}) {
    const started = Date.now(); let handled = 0;
    while (handled < maxJobs && Date.now() - started < waitMs) {
      if (active) { await new Promise(resolve => setTimeout(resolve, 10)); continue; }
      const job = service.claimMaterialIndexJob(); if (!job) break;
      try { service.completeMaterialIndexJob(job.revisionId, await runWorker(job)); completed++; lastError = ''; }
      catch (error) { lastError = String(error?.message || error); service.failMaterialIndexJob(job.revisionId, error); }
      finally { active = null; }
      handled++;
    }
    return { handled, summary: service.materialIndexSummary(), lastError };
  }
  schedule(0);
  return { drainUntilIdle, status: () => ({ running: Boolean(active), completed, lastError, summary: service.materialIndexSummary() }),
    async stop() { stopped = true; if (timer) clearTimeout(timer); timer = null; if (active) await active.terminate(); active = null; } };
}

module.exports = { startMaterialIndexer };
