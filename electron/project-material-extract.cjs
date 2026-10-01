const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { Worker } = require('node:worker_threads');
const { execFile } = require('node:child_process');
const { MaterialError, invariant } = require('./project-material-contract.cjs');
const { safePath, hashStableFile, writeJsonAtomic, withCommitLock } = require('./project-materials.cjs');
const { runPdfWorker } = require('./project-material-pdf.cjs');

const EXTRACTOR_VERSION = 'edu-material-text.v1-yauzl3.4.0-saxes6.0.0-exceljs4.4.0';
const CACHE_SCHEMA = 'edu-manager.project-material-extraction.v1';
const TEXT_LIMIT = 2 * 1024 * 1024;
const CACHE_LIMIT = 256 * 1024 * 1024;
const IMAGE_FORMATS = new Set(['jpg', 'jpeg', 'png', 'bmp', 'tif', 'tiff', 'webp']);
const DOCUMENT_FORMATS = new Set(['txt', 'md', 'csv', 'json', 'jsonl', 'yaml', 'yml', 'xml', 'html', 'htm', 'log', 'docx', 'pptx', 'xlsx']);
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const cancelled = () => new MaterialError('cancelled', '资料提取已取消。');

// Resource admission only; the existing task center still owns task lifecycle.
// A global cap prevents separate projects from each starting unlimited parsers.
let active = 0;
const waiting = [];
function acquire(signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(cancelled()); return; }
    const start = () => {
      signal?.removeEventListener('abort', abort); active++;
      let released = false;
      resolve(() => { if (released) return; released = true; active--; waiting.shift()?.start(); });
    };
    const entry = { start };
    const abort = () => { const index = waiting.indexOf(entry); if (index >= 0) waiting.splice(index, 1); reject(cancelled()); };
    if (active < 2) start();
    else if (waiting.length >= 8) reject(new MaterialError('extraction_busy', '资料提取队列已满，请稍后重试。'));
    else { waiting.push(entry); signal?.addEventListener('abort', abort, { once: true }); }
  });
}

async function runDocumentWorker(input, format, { signal, timeoutMs = 60000, workerPath = path.join(__dirname, 'project-material-extract-worker.cjs') } = {}) {
  invariant(!signal?.aborted, 'cancelled', '资料提取已取消。');
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, { workerData: { kind: 'project-material-extract', input, format },
      resourceLimits: { maxOldGenerationSizeMb: 384, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 } });
    let done = false;
    const finish = async (error, result) => {
      if (done) return; done = true;
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      await worker.terminate().catch(() => {});
      error ? reject(error) : resolve(result);
    };
    const abort = () => { void finish(cancelled()); };
    const timer = setTimeout(() => { void finish(new MaterialError('extraction_timeout', '资料提取超时，原件保持不变。')); }, timeoutMs);
    worker.once('message', (message) => { void finish(message?.ok ? null : new MaterialError(message?.error?.code || 'extraction_failed', message?.error?.message || '资料提取失败。'), message?.result); });
    worker.once('error', (error) => { void finish(new MaterialError('extraction_failed', `资料提取进程异常：${error.message}`)); });
    worker.once('exit', (code) => { if (!done) void finish(new MaterialError('extraction_failed', `资料提取未返回结果（${code}）。`)); });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

function ocrScriptPath() {
  return path.join(__dirname, 'capture-timeline-ocr.ps1').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
}
async function runImageOcr(input, { signal, timeoutMs = 45000, language = 'zh-CN' } = {}) {
  invariant(process.platform === 'win32', 'unsupported', '当前系统没有可用的Windows图片文字识别通道。');
  invariant(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language), 'invalid_extraction_options', 'OCR语言配置无效。');
  invariant(!signal?.aborted, 'cancelled', '资料提取已取消。');
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ocrScriptPath(),
      '-ImagePath', input.path, '-LanguageTag', language], { windowsHide: true, timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024, encoding: 'utf8', signal }, (error, stdout) => {
      if (signal?.aborted) { reject(cancelled()); return; }
      if (error) { reject(new MaterialError('ocr_failed', '本机OCR未成功完成，请检查语言包或稍后重试。')); return; }
      let result;
      try { result = JSON.parse(String(stdout).trim().split(/\r?\n/).at(-1)); }
      catch { reject(new MaterialError('ocr_failed', '本机OCR返回无效结果。')); return; }
      if (!result.ok) { reject(new MaterialError('ocr_failed', '本机OCR未成功识别；原文保持已保存。', { diagnostic: String(result.error || '').slice(0, 1000) })); return; }
      resolve({ text: result.text, warnings: ['图片文字由OCR识别，可能存在漏字或误识别；图示和版式未被完整理解。'], language: result.language });
    });
  });
}

function checkResult(result) {
  invariant(typeof result?.text === 'string' && result.text.trim(), 'empty_source', '未提取到正文，原文保留且不结算为已消化。');
  invariant(Buffer.byteLength(result.text) <= TEXT_LIMIT, 'extraction_limit', '提取正文超过限制，需分段处理。');
  invariant(Array.isArray(result.warnings) && result.warnings.length <= 20
    && result.warnings.every((warning) => typeof warning === 'string' && warning.length <= 2000), 'invalid_extraction', '提取限制说明无效。');
  return result;
}

function createProjectMaterialExtractor({ store, parserVersion = EXTRACTOR_VERSION, ocrLanguage = 'zh-CN',
  documentRunner = runDocumentWorker, imageRunner = runImageOcr, pdfRunner = runPdfWorker, cacheLimitBytes = CACHE_LIMIT } = {}) {
  invariant(store?.projectId && path.isAbsolute(store.directory), 'invalid_scope', '缺少项目提取范围。');
  invariant(Number.isSafeInteger(cacheLimitBytes) && cacheLimitBytes > 0 && cacheLimitBytes <= CACHE_LIMIT, 'invalid_extraction_options', '提取缓存容量配置无效。');
  async function cacheRoot() {
    await fs.mkdir(store.directory, { recursive: true });
    const root = await safePath(store.directory, 'extraction-cache', { allowMissing: true });
    await fs.mkdir(root, { recursive: true });
    return safePath(store.directory, 'extraction-cache');
  }
  async function verify(input) {
    invariant(input?.projectId === store.projectId, 'scope_mismatch', '提取资料不属于当前项目。');
    invariant(Number.isSafeInteger(input.size) && input.size >= 0 && input.size <= 32 * 1024 * 1024, 'input_limit', '资料超过本次提取容量限制。');
    // Never trust a caller-provided arbitrary path even when its bytes match.
    const resolved = await store.resolve(input.materialId, input.version);
    invariant(resolved.sha256 === input.sha256 && resolved.size === input.size
      && path.resolve(resolved.path) === path.resolve(input.path), 'source_changed', '提取来源不是该资料登记的固定版本。');
    // resolve() already hashes and verifies this exact version. Do not perform
    // a second identical full read here; cache hits still verify the source.
  }
  async function extract(input, { signal, timeoutMs } = {}) {
    invariant(!signal?.aborted, 'cancelled', '资料提取已取消。');
    await verify(input);
    const format = path.extname(input.location?.relativePath || '').slice(1).toLowerCase();
    invariant(DOCUMENT_FORMATS.has(format) || IMAGE_FORMATS.has(format) || format === 'pdf', 'unsupported', '此格式暂不支持自动提取，原文保持已保存。');
    const image = IMAGE_FORMATS.has(format);
    const options = image || format === 'pdf' ? { language: ocrLanguage, platform: process.platform, osRelease: os.release(),
      bridgeHash: (await hashStableFile(ocrScriptPath())).sha256 } : {};
    if (format === 'pdf') options.pdfParser = 'pdfjs6.3.289-canvas1.0.9-paged-v1';
    const keyData = { schema: CACHE_SCHEMA, projectId: store.projectId, sha256: input.sha256, format, parserVersion, options };
    const key = sha(JSON.stringify(keyData)), root = await cacheRoot();
    return withCommitLock(`extraction:${root}:${key}`, async () => {
      invariant(!signal?.aborted, 'cancelled', '资料提取已取消。');
      const target = await safePath(root, `${key}.json`, { allowMissing: true });
      let cached;
      try {
        const stat = await fs.stat(target);
        if (stat.size <= 4 * TEXT_LIMIT) cached = JSON.parse(await fs.readFile(target, 'utf8'));
      } catch (error) { if (!(error instanceof SyntaxError) && error.code !== 'ENOENT') throw error; }
      if (cached?.key === key && cached.schema === CACHE_SCHEMA && cached.resultHash === sha(JSON.stringify(cached.result))) {
        try { checkResult(cached.result); } catch { cached = null; }
        if (cached) { await verify(input); return { ...cached.result, cacheHit: true, cacheKey: key, parserVersion }; }
      }
      const release = await acquire(signal);
      let result;
      try {
        invariant(!signal?.aborted, 'cancelled', '资料提取已取消。');
        result = checkResult(await (image ? imageRunner(input, { signal, timeoutMs, language: ocrLanguage })
          : format === 'pdf' ? pdfRunner(input, { signal, timeoutMs, imageRunner, language: ocrLanguage })
            : documentRunner(input, format, { signal, timeoutMs })));
        await verify(input);
        invariant(!signal?.aborted, 'cancelled', '资料提取已取消。');
      } finally { release(); }
      const record = { schema: CACHE_SCHEMA, key, ...keyData, createdAt: new Date().toISOString(),
        result, resultHash: sha(JSON.stringify(result)) };
      // Cache-only eviction never touches originals, snapshots, ledgers or
      // knowledge. A cache write failure must not turn valid extraction into
      // an AI failure; it is reported as a non-cached result for this attempt.
      let cacheStored = false;
      await withCommitLock(`extraction-cache-write:${root}`, async () => {
        const bytes = Buffer.byteLength(JSON.stringify(record));
        if (bytes > cacheLimitBytes) return;
        const entries = [];
        for (const name of await fs.readdir(root)) {
          if (!/^[a-f0-9]{64}\.json$/.test(name) || name === `${key}.json`) continue;
          const file = await safePath(root, name), stat = await fs.stat(file).catch(() => null);
          if (stat?.isFile()) entries.push({ file, size: stat.size, age: stat.mtimeMs });
        }
        let total = entries.reduce((sum, entry) => sum + entry.size, 0) + bytes;
        for (const entry of entries.sort((a, b) => a.age - b.age)) {
          if (total <= cacheLimitBytes) break;
          await fs.unlink(entry.file); total -= entry.size;
        }
        await safePath(root, `${key}.json`, { allowMissing: true });
        await writeJsonAtomic(target, record); cacheStored = true;
      }).catch((error) => { if (!['ENOSPC', 'EACCES', 'EPERM'].includes(error.code)) throw error; });
      return { ...result, cacheHit: false, cacheStored, cacheKey: key, parserVersion };
    });
  }
  async function extractText(input, options) {
    const result = await extract(input, options);
    return result.warnings.length ? `[提取范围与限制]\n${result.warnings.join('\n')}\n\n[正文]\n${result.text}` : result.text;
  }
  return { extract, extractText };
}

module.exports = { createProjectMaterialExtractor, runDocumentWorker, runImageOcr, EXTRACTOR_VERSION, CACHE_SCHEMA };
