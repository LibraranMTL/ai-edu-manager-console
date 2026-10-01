const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Worker } = require('node:worker_threads');
const { MaterialError, invariant } = require('./project-material-contract.cjs');

async function runPdfWorker(input, { signal, timeoutMs = 180000, imageRunner, language = 'zh-CN',
  workerPath = path.join(__dirname, 'project-material-pdf-worker.cjs'), runtimeRoot,
  limits, onPagePreview } = {}) {
  invariant(!signal?.aborted, 'cancelled', 'PDF提取已取消。');
  invariant(typeof imageRunner === 'function', 'pdf_runtime_missing', 'PDF页面OCR通道缺失。');
  if (!runtimeRoot && __dirname.includes('app.asar')) runtimeRoot = path.join(process.resourcesPath, 'material-pdf-runtime');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-material-pdf-'));
  const local = new AbortController();
  let worker, pageWork = Promise.resolve();
  try {
    return await new Promise((resolve, reject) => {
      worker = new Worker(workerPath, { workerData: { kind: 'project-material-pdf', input, runtimeRoot, limits },
        resourceLimits: { maxOldGenerationSizeMb: 384, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 } });
      let done = false, pendingPage = false, lastPage = 0;
      const finish = async (error, result) => {
        if (done) return; done = true;
        clearTimeout(timer); signal?.removeEventListener('abort', abort);
        local.abort(); await worker.terminate().catch(() => {});
        await pageWork.catch(() => {});
        error ? reject(error) : resolve(result);
      };
      const abort = () => { void finish(new MaterialError('cancelled', 'PDF提取已取消。')); };
      const timer = setTimeout(() => { void finish(new MaterialError('extraction_timeout', 'PDF提取超时，保留原文供重试。')); }, timeoutMs);
      worker.on('message', (message) => {
        if (done) return;
        if (message?.type !== 'ocr-page') { void finish(message?.ok ? null : new MaterialError(message?.error?.code || 'extraction_failed', message?.error?.message || 'PDF提取失败。'), message?.result); return; }
        if (pendingPage || !Number.isSafeInteger(message.pageNumber) || message.pageNumber <= lastPage || message.pageNumber > 200
            || !(message.png instanceof Uint8Array) || message.png.byteLength > 16 * 1024 * 1024) {
          void finish(new MaterialError('invalid_extraction', 'PDF页面提取请求无效。')); return;
        }
        pendingPage = true; lastPage = message.pageNumber;
        pageWork = (async () => {
          const file = path.join(root, `page-${lastPage}.png`);
          let reply;
          try {
            await fs.writeFile(file, message.png, { flag: 'wx' });
            await onPagePreview?.(file, lastPage);
            const result = await imageRunner({ path: file }, { signal: local.signal, language, timeoutMs: Math.min(timeoutMs, 45000) });
            invariant(typeof result?.text === 'string' && Buffer.byteLength(result.text) <= 2 * 1024 * 1024, 'invalid_extraction', 'PDF页面OCR正文无效。');
            reply = { type: 'ocr-result', pageNumber: lastPage, text: result.text };
          } catch (error) {
            reply = { type: 'ocr-result', pageNumber: lastPage, error: { code: error.code || 'ocr_failed', message: error.message } };
          } finally { await fs.rm(file, { force: true, maxRetries: 5, retryDelay: 100 }); }
          pendingPage = false;
          if (!done) worker.postMessage(reply);
        })();
        void pageWork.catch((error) => { void finish(new MaterialError('extraction_failed', `PDF临时页处理失败：${error.message}`)); });
      });
      worker.once('error', (error) => { void finish(new MaterialError('extraction_failed', `PDF处理进程异常：${error.message}`)); });
      worker.once('exit', (code) => { if (!done) void finish(new MaterialError('extraction_failed', `PDF处理未返回结果（${code}）。`)); });
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
  } finally {
    local.abort(); await worker?.terminate().catch(() => {}); await pageWork.catch(() => {});
    const canonical = await fs.realpath(root);
    invariant(path.dirname(canonical) === await fs.realpath(os.tmpdir()) && path.basename(canonical).startsWith('edu-material-pdf-'), 'invalid_path', '拒绝清理非本次PDF临时目录。');
    await fs.rm(canonical, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
module.exports = { runPdfWorker };
