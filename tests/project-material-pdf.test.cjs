const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createCanvas, PDFDocument } = require('@napi-rs/canvas');
const { runPdfWorker } = require('../electron/project-material-pdf.cjs');
const { runImageOcr, createProjectMaterialExtractor } = require('../electron/project-material-extract.cjs');
const { createProjectMaterialStore } = require('../electron/project-materials.cjs');
const { stagePdfRuntime, auditPdfRuntime, verifyCanvasRuntime } = require('../scripts/build-project-material-pdf.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-pdf-test-'));
  const workspace = path.join(root, 'workspace'); await fs.mkdir(workspace);
  const store = createProjectMaterialStore({ projectId: 'p1', managerPath: path.join(root, 'manager'),
    roots: { workspace: { path: workspace, kind: 'workspace' } } });
  t.after(async () => {
    assert.equal(path.dirname(root), await fs.realpath(os.tmpdir())); assert.match(path.basename(root), /^edu-pdf-test-/);
    for (const name of await fs.readdir(path.join(store.directory, 'snapshots')).catch(() => [])) await fs.chmod(path.join(store.directory, 'snapshots', name), 0o600);
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  async function add(bytes, name = 'source.pdf') {
    await fs.writeFile(path.join(workspace, name), bytes);
    const item = (await store.registerFiles([{ location: { rootId: 'workspace', kind: 'workspace', relativePath: name } }])).result[0];
    await store.snapshot(item.materialId, item.version);
    return store.resolve(item.materialId, item.version);
  }
  return { root, store, add };
}

function pdfFixture(kinds = ['text']) {
  const pdf = new PDFDocument({ title: 'SYNTHETIC PDF EXTRACTION TEST', creator: 'Education Manager tests' });
  for (const [index, kind] of kinds.entries()) {
    const context = pdf.beginPage(600, 800);
    context.fillStyle = 'white'; context.fillRect(0, 0, 600, 800);
    if (kind === 'text' || kind === 'hybrid') {
      context.fillStyle = 'black'; context.font = '24px Arial';
      context.fillText(`SYNTHETIC PAGE ${index + 1}: 20 25 30`, 30, 50);
    }
    if (kind === 'scan' || kind === 'hybrid') {
      const image = createCanvas(1000, 300), ctx = image.getContext('2d');
      ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1000, 300);
      ctx.fillStyle = 'black'; ctx.font = '48px "Microsoft YaHei"';
      ctx.fillText('合成实验 温度 20 25 30', 30, 100);
      ctx.fillText('并非真实学生资料', 30, 200);
      context.drawImage(image, 20, 100, 560, 168);
    }
    pdf.endPage();
  }
  return pdf.close();
}

test('embedded PDF text preserves page order and avoids OCR for ordinary text pages', async (t) => {
  const f = await fixture(t), input = await f.add(pdfFixture(['text', 'blank', 'text']));
  let calls = 0;
  const result = await runPdfWorker(input, { imageRunner: async () => { calls++; throw new Error('text pages must not OCR'); } });
  assert.match(result.text, /SYNTHETIC PAGE 1: 20 25 30/); assert.match(result.text, /SYNTHETIC PAGE 3/);
  assert.deepEqual(result.pages.map((p) => p.method), ['embedded', 'blank', 'embedded']); assert.equal(calls, 0);
});

test('scan and hybrid PDF pages use real Windows OCR and retain embedded header text', { skip: process.platform !== 'win32' }, async (t) => {
  const f = await fixture(t), input = await f.add(pdfFixture(['scan', 'hybrid']));
  const seen = [];
  const result = await runPdfWorker(input, { imageRunner: runImageOcr,
    onPagePreview: async (file, number) => {
      seen.push(number);
      if (number === 1) {
        const target = path.join(__dirname, '../.tmp/project-material-pdf-preview.png');
        await fs.mkdir(path.dirname(target), { recursive: true }); await fs.copyFile(file, target);
      }
    } });
  assert.deepEqual(seen, [1, 2]); assert.deepEqual(result.pages.map((p) => p.method), ['ocr', 'embedded+ocr']);
  assert.match(result.text, /温\s*度/); assert.match(result.text, /20\s+25\s+30/);
  assert.match(result.text, /SYNTHETIC PAGE 2/);
});

test('PDF cache is shared with normal extraction and binds OCR language and source version', async (t) => {
  const f = await fixture(t), input = await f.add(pdfFixture()); let runs = 0;
  const pdfRunner = (...args) => { runs++; return runPdfWorker(...args); };
  const extractor = createProjectMaterialExtractor({ store: f.store, pdfRunner });
  const a = await extractor.extract(input), b = await extractor.extract(input);
  assert.equal(a.cacheHit, false); assert.equal(b.cacheHit, true); assert.equal(runs, 1);
  const other = await createProjectMaterialExtractor({ store: f.store, ocrLanguage: 'en-US', pdfRunner }).extract(input);
  assert.notEqual(other.cacheKey, a.cacheKey); assert.equal(runs, 2);
});

test('malformed PDFs, all-blank PDFs, page and text limits fail without partial success', async (t) => {
  const f = await fixture(t), options = { imageRunner: runImageOcr };
  await assert.rejects(runPdfWorker(await f.add(Buffer.from('invalid PDF')), options), { code: 'invalid_document' });
  await assert.rejects(runPdfWorker(await f.add(pdfFixture(['blank'])), options), { code: 'empty_source' });
  const input = await f.add(pdfFixture(['text', 'text']));
  const { PDF_LIMITS } = require('../electron/project-material-pdf-worker.cjs');
  await assert.rejects(runPdfWorker(input, { ...options, limits: { ...PDF_LIMITS, pages: 1 } }), { code: 'extraction_limit' });
  await assert.rejects(runPdfWorker(input, { ...options, limits: { ...PDF_LIMITS, text: 10 } }), { code: 'extraction_limit' });
});

test('OCR failure on a later page rejects the entire extraction instead of losing the scan', async (t) => {
  const f = await fixture(t), input = await f.add(pdfFixture(['text', 'hybrid']));
  await assert.rejects(runPdfWorker(input, { imageRunner: async () => ({ text: '' }) }), { code: 'pdf_ocr_empty' });
  const extractor = createProjectMaterialExtractor({ store: f.store, imageRunner: async () => { throw Object.assign(new Error('missing OCR'), { code: 'ocr_failed' }); } });
  await assert.rejects(extractor.extract(input), { code: 'ocr_failed' });
  assert.equal((await fs.readdir(path.join(f.store.directory, 'extraction-cache'))).length, 0);
});

test('a real password-protected PDF reports encryption, not empty content or successful knowledge', async (t) => {
  const f = await fixture(t), input = await f.add(require('./fixtures/material-encrypted-pdf.cjs'));
  await assert.rejects(runPdfWorker(input, { imageRunner: runImageOcr }), { code: 'unsupported_encryption' });
});

test('cancelled PDF OCR stops the child work and removes its exact temporary page directory', async (t) => {
  const f = await fixture(t), input = await f.add(pdfFixture(['scan']));
  const controller = new AbortController(); let pagePath;
  const work = runPdfWorker(input, { signal: controller.signal, imageRunner: (page, { signal }) => {
    pagePath = page.path; setImmediate(() => controller.abort());
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('stopped'), { code: 'cancelled' })), { once: true }));
  } });
  await assert.rejects(work, { code: 'cancelled' });
  assert.ok(pagePath); assert.equal(await fs.stat(path.dirname(pagePath)).then(() => true, () => false), false);
  await assert.rejects(runPdfWorker(input, { imageRunner: runImageOcr, timeoutMs: 1 }), { code: 'extraction_timeout' });
});

test('staged PDF runtime uses only copied renderer dependencies and its manifest detects corruption', { skip: process.platform !== 'win32' || process.arch !== 'x64' }, async (t) => {
  const f = await fixture(t), runtimeRoot = stagePdfRuntime(path.join(f.root, 'stage'));
  const pdfRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
  for (const name of ['pdf.mjs', 'pdf.worker.mjs']) {
    assert.deepEqual(await fs.readFile(path.join(runtimeRoot, 'pdfjs/legacy/build', name)),
      await fs.readFile(path.join(pdfRoot, 'legacy/build', name.replace('.mjs', '.min.mjs'))));
  }
  const evidence = auditPdfRuntime(runtimeRoot, runtimeRoot);
  assert.ok(evidence.bytes < 64 * 1024 * 1024);
  const canvasEvidence = verifyCanvasRuntime(runtimeRoot);
  assert.match(canvasEvidence.resolved, /material-pdf-runtime[\\/]canvas[\\/]index\.js$/u);
  assert.ok(canvasEvidence.pngBytes > 8);
  const input = await f.add(pdfFixture(['text', 'scan']));
  // A Windows native DLL remains mapped until its process exits even after
  // worker termination. Run a copied runtime in a child process so cleanup
  // never attempts to remove an in-use native library from this test process.
  const code = `const {runPdfWorker}=require(process.argv[1]);
    const {runImageOcr}=require(process.argv[2]);
    const options=JSON.parse(process.argv[3]);
    runPdfWorker(options.input,{runtimeRoot:options.runtimeRoot,imageRunner:runImageOcr})
      .then(r=>console.log(JSON.stringify(r)),e=>{console.error(e);process.exitCode=1});`;
  const execution = await require('node:util').promisify(require('node:child_process').execFile)(process.execPath,
    ['-e', code, require.resolve('../electron/project-material-pdf.cjs'), require.resolve('../electron/project-material-extract.cjs'), JSON.stringify({ input, runtimeRoot })],
    { windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  const result = JSON.parse(execution.stdout.trim());
  assert.match(result.text, /PAGE 1/); assert.match(result.text, /20\s+25\s+30/);
  const library = path.join(runtimeRoot, 'pdfjs', 'legacy', 'build', 'pdf.mjs');
  await fs.appendFile(library, '\n// synthetic tamper');
  assert.throws(() => auditPdfRuntime(runtimeRoot, runtimeRoot), /mismatch/);
});

module.exports = { pdfFixture };
