const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const ExcelJS = require('exceljs');
const JSZip = createRequire(require.resolve('exceljs'))('jszip');
const { createProjectMaterialStore } = require('../electron/project-materials.cjs');
const { createProjectMaterialExtractor, runDocumentWorker, runImageOcr } = require('../electron/project-material-extract.cjs');
const { bundleMaterialExtractor } = require('../scripts/build-project-material-extractor.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-material-extraction-test-'));
  const workspace = path.join(root, 'workspace'); await fs.mkdir(workspace);
  const store = createProjectMaterialStore({ projectId: 'project-1', managerPath: path.join(root, 'manager'), roots: { workspace: { kind: 'workspace', path: workspace } } });
  t.after(async () => {
    assert.equal(path.dirname(root), await fs.realpath(os.tmpdir()));
    assert.match(path.basename(root), /^edu-material-extraction-test-/);
    for (const name of await fs.readdir(path.join(store.directory, 'snapshots')).catch(() => [])) await fs.chmod(path.join(store.directory, 'snapshots', name), 0o600);
    await fs.rm(root, { recursive: true, force: true });
  });
  async function add(name, bytes) {
    await fs.writeFile(path.join(workspace, name), bytes);
    const item = (await store.registerFiles([{ location: { rootId: 'workspace', kind: 'workspace', relativePath: name } }])).result[0];
    await store.snapshot(item.materialId, item.version);
    return store.resolve(item.materialId, item.version);
  }
  return { root, workspace, store, add, extractor: createProjectMaterialExtractor({ store }) };
}
async function archive(entries) {
  const zip = new JSZip();
  for (const [name, value] of Object.entries(entries)) zip.file(name, value);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
const docx = (text) => archive({ 'word/document.xml': `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>` });

test('fixed-version extraction is reused across service instances without rewriting the registry', async (t) => {
  const f = await fixture(t), input = await f.add('中文.txt', '温度20、25、30。'); let calls = 0;
  const options = { store: f.store, documentRunner: (...args) => { calls++; return runDocumentWorker(...args); } };
  const first = createProjectMaterialExtractor(options), second = createProjectMaterialExtractor(options);
  const before = (await fs.stat(f.store.indexPath)).mtimeMs;
  const [a, b] = await Promise.all([first.extract(input), second.extract(input)]);
  assert.equal(a.text, '温度20、25、30。'); assert.notEqual(a.cacheHit, b.cacheHit); assert.equal(calls, 1);
  assert.equal((await fs.stat(f.store.indexPath)).mtimeMs, before);
  await fs.writeFile(path.join(f.workspace, '中文.txt'), '新版本，不应替换旧快照');
  assert.equal((await second.extract(input)).text, a.text);
});

test('content, extension and parser changes invalidate only extraction cache, not material identity', async (t) => {
  const f = await fixture(t), first = await f.add('source.txt', 'version one');
  const a = await f.extractor.extract(first);
  const newer = await f.add('source.txt', 'version two');
  const b = await f.extractor.extract(newer);
  assert.equal(first.materialId, newer.materialId); assert.equal(newer.version, 2); assert.notEqual(a.cacheKey, b.cacheKey);
  const c = await createProjectMaterialExtractor({ store: f.store, parserVersion: 'synthetic-parser-v2' }).extract(newer);
  assert.notEqual(b.cacheKey, c.cacheKey); assert.equal(c.cacheHit, false);
});

test('damaged cache rebuilds and bad extraction is never persisted as a successful result', async (t) => {
  const f = await fixture(t), input = await f.add('a.txt', 'valid');
  const a = await f.extractor.extract(input), file = path.join(f.store.directory, 'extraction-cache', `${a.cacheKey}.json`);
  const record = JSON.parse(await fs.readFile(file)); record.result.text = 'tampered';
  await fs.writeFile(file, JSON.stringify(record));
  assert.equal((await f.extractor.extract(input)).text, 'valid');
  const broken = createProjectMaterialExtractor({ store: f.store, parserVersion: 'empty', documentRunner: async () => ({ text: '', warnings: [] }) });
  await assert.rejects(broken.extract(input), { code: 'empty_source' });
  assert.equal((await fs.readdir(path.dirname(file))).length, 1);
});

test('DOCX paragraphs, tables, footnotes and entities survive extraction; deleted revisions stay excluded', async (t) => {
  const f = await fixture(t);
  const bytes = await archive({
    'word/document.xml': '<w:document xmlns:w="urn:word"><w:body><w:p><w:r><w:t>温度 &amp; 20</w:t><w:tab/><w:t>25</w:t></w:r><w:del><w:r><w:delText>DELETE_ME</w:delText></w:r></w:del></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>30</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>',
    'word/footnotes.xml': '<w:footnotes xmlns:w="urn:word"><w:footnote><w:p><w:r><w:t>仅为合成实验</w:t></w:r></w:p></w:footnote></w:footnotes>',
  });
  const input = await f.add('实验.docx', bytes), result = await f.extractor.extract(input);
  assert.match(result.text, /温度 & 20\t25/); assert.match(result.text, /30/); assert.match(result.text, /仅为合成实验/);
  assert.doesNotMatch(result.text, /DELETE_ME/); assert.ok(result.warnings.length);
  assert.match(await f.extractor.extractText(input), /提取范围与限制/);
});

test('PPTX uses presentation relationship order and includes slide-specific notes', async (t) => {
  const f = await fixture(t);
  const slide = (text) => `<p:sld xmlns:p="urn:ppt" xmlns:a="urn:drawing"><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:sld>`;
  const bytes = await archive({
    'ppt/presentation.xml': '<p:presentation xmlns:p="urn:ppt" xmlns:r="urn:rels"><p:sldIdLst><p:sldId id="256" r:id="second"/><p:sldId id="257" r:id="first"/></p:sldIdLst></p:presentation>',
    'ppt/_rels/presentation.xml.rels': '<Relationships><Relationship Id="first" Type="urn:office/slide" Target="slides/slide1.xml"/><Relationship Id="second" Type="urn:office/slide" Target="slides/slide2.xml"/></Relationships>',
    'ppt/slides/slide1.xml': slide('LAST'), 'ppt/slides/slide2.xml': slide('FIRST'),
    'ppt/slides/_rels/slide2.xml.rels': '<Relationships><Relationship Id="note" Type="urn:office/notesSlide" Target="../notesSlides/notesSlide9.xml"/></Relationships>',
    'ppt/notesSlides/notesSlide9.xml': slide('说明20、25、30'),
  });
  const result = await f.extractor.extract(await f.add('deck.pptx', bytes));
  assert.ok(result.text.indexOf('FIRST') < result.text.indexOf('LAST'));
  assert.match(result.text, /该页演讲备注.*\n说明20、25、30/);
});

test('XLSX preserves sheet/cell labels and cached formulas without evaluating them', async (t) => {
  const f = await fixture(t), book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('温度'); sheet.addRow(['项目', 20, 25, 30]);
  sheet.getCell('A2').value = { formula: 'SUM(B1:D1)', result: 75 };
  sheet.getCell('B2').value = { formula: '1+2' };
  sheet.getCell('C2').value = new Date('2026-09-29T00:00:00Z');
  const hidden = book.addWorksheet('辅助'); hidden.state = 'hidden'; hidden.addRow(['合成样本']);
  const result = await f.extractor.extract(await f.add('data.xlsx', Buffer.from(await book.xlsx.writeBuffer())));
  assert.match(result.text, /B1: 20/); assert.match(result.text, /缓存结果：75/); assert.match(result.text, /缓存结果：无/);
  assert.match(result.text, /2026-09-29T00:00:00.000Z/); assert.match(result.text, /辅助（隐藏）/);
});

test('malformed, DTD, missing-part, encrypted and oversized archives do not become successful text', async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.extractor.extract(await f.add('broken.docx', 'not a zip')), /./);
  await assert.rejects(f.extractor.extract(await f.add('missing.docx', await archive({ 'missing.xml': '<x/>' }))), { code: 'invalid_document' });
  await assert.rejects(f.extractor.extract(await f.add('entities.docx', await archive({ 'word/document.xml': '<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///secret">]><x>&secret;</x>' }))), { code: 'unsafe_document' });
  await assert.rejects(f.extractor.extract(await f.add('deep.docx', await archive({ 'word/document.xml': '<x>'.repeat(150) + '</x>'.repeat(150) }))), { code: 'extraction_limit' });
  await assert.rejects(f.extractor.extract(await f.add('large.docx', await archive({ 'word/document.xml': '<x>' + 'x'.repeat(17 * 1024 * 1024) + '</x>' }))), { code: 'extraction_limit' });
  const encrypted = await docx('hello');
  const directory = encrypted.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); encrypted.writeUInt16LE(encrypted.readUInt16LE(directory + 8) | 1, directory + 8);
  await assert.rejects(f.extractor.extract(await f.add('encrypted.docx', encrypted)), { code: 'unsupported_encryption' });
});

test('UTF16 is decoded only with BOM; binary encodings and unsupported formats remain explicit failures', async (t) => {
  const f = await fixture(t);
  const input = await f.add('wide.txt', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('中文样本', 'utf16le')]));
  assert.equal((await f.extractor.extract(input)).text, '中文样本');
  await assert.rejects(f.extractor.extract(await f.add('old.txt', Buffer.from([0xc4, 0xe3, 0xba, 0xc3]))), { code: 'unsupported_encoding' });
  await assert.rejects(f.extractor.extract(await f.add('binary.doc', Buffer.from([0, 1, 2]))), { code: 'unsupported' });
});

test('archive traversal, bad CRC and macros are rejected without opening an external resource', async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.extractor.extract(await f.add('traversal.docx', await archive({ '../outside.xml': '<x/>' }))), /./);
  const corrupt = await docx('valid text');
  const directory = corrupt.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  corrupt.writeUInt32LE((corrupt.readUInt32LE(directory + 16) ^ 1) >>> 0, directory + 16);
  await assert.rejects(f.extractor.extract(await f.add('crc.docx', corrupt)), { code: 'invalid_document' });
  await assert.rejects(f.extractor.extract(await f.add('macro.docx', await archive({ 'word/vbaProject.bin': Buffer.from([1]) }))), { code: 'unsupported' });
  assert.equal(await fs.stat(path.join(f.root, 'outside.xml')).then(() => true, () => false), false);
});

test('wrong project/path and mutated snapshots are rejected even when a cache exists', async (t) => {
  const f = await fixture(t), input = await f.add('a.txt', 'original'); await f.extractor.extract(input);
  await assert.rejects(f.extractor.extract({ ...input, projectId: 'other' }), { code: 'scope_mismatch' });
  await assert.rejects(f.extractor.extract({ ...input, path: path.join(f.workspace, 'a.txt') }), { code: 'source_changed' });
  await fs.chmod(input.path, 0o600); await fs.writeFile(input.path, 'changed');
  await assert.rejects(f.extractor.extract(input), /./);
});

test('worker cancellation and timeout stop parsing without writing a cache entry', async (t) => {
  const f = await fixture(t), input = await f.add('large.docx', await docx('x'.repeat(1024 * 1024)));
  const controller = new AbortController();
  const work = runDocumentWorker(input, 'docx', { signal: controller.signal }); controller.abort();
  await assert.rejects(work, { code: 'cancelled' });
  await assert.rejects(runDocumentWorker(input, 'docx', { timeoutMs: 1 }), { code: 'extraction_timeout' });
  await assert.rejects(f.extractor.extract(input, { signal: controller.signal }), { code: 'cancelled' });
  assert.equal(await fs.stat(path.join(f.store.directory, 'extraction-cache')).then(() => true, () => false), false);
});

test('image OCR results are shared and language changes invalidate the OCR cache', async (t) => {
  const f = await fixture(t), input = await f.add('image.png', Buffer.from('synthetic image bytes')); let calls = 0;
  const options = { store: f.store, imageRunner: async (_, { language }) => { calls++; return { text: `OCR ${language}`, warnings: ['合成替身，不是真实OCR验收'] }; } };
  const zh = createProjectMaterialExtractor(options), en = createProjectMaterialExtractor({ ...options, ocrLanguage: 'en-US' });
  const first = await zh.extract(input); assert.equal((await zh.extract(input)).cacheHit, true);
  const second = await en.extract(input); assert.notEqual(first.cacheKey, second.cacheKey); assert.equal(calls, 2);
});

test('cache quota only evicts reproducible extraction entries, retaining original snapshots and registry', async (t) => {
  const f = await fixture(t), a = await f.add('a.txt', 'a'.repeat(1500)), b = await f.add('b.txt', 'b'.repeat(1500));
  const extractor = createProjectMaterialExtractor({ store: f.store, cacheLimitBytes: 3000 });
  await extractor.extract(a); await extractor.extract(b);
  assert.equal((await fs.readdir(path.join(f.store.directory, 'extraction-cache'))).length, 1);
  assert.equal((await fs.readFile(a.path, 'utf8')).length, 1500); assert.equal((await f.store.read()).materials.length, 2);
  assert.equal((await extractor.extract(a)).cacheHit, false);
});

test('packaged worker bundle executes without a node_modules tree next to the staging runtime', async (t) => {
  const f = await fixture(t), input = await f.add('packaged.docx', await docx('PACKAGED 中文20'));
  const esbuild = createRequire(require.resolve('vite'))('esbuild');
  const workerPath = bundleMaterialExtractor(path.join(f.root, 'stage'), esbuild);
  assert.equal((await runDocumentWorker(input, 'docx', { workerPath })).text, 'PACKAGED 中文20');
  const book = new ExcelJS.Workbook(); book.addWorksheet('Test').addRow(['BUNDLED_XLSX', 20]);
  const xlsx = await f.add('packaged.xlsx', Buffer.from(await book.xlsx.writeBuffer()));
  assert.match((await runDocumentWorker(xlsx, 'xlsx', { workerPath })).text, /BUNDLED_XLSX/);
  assert.ok((await fs.stat(workerPath)).size < 5 * 1024 * 1024);
});

test('empty Office containers do not turn labels or warnings into source evidence', async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.extractor.extract(await f.add('blank.docx', await docx(''))), { code: 'empty_source' });
  const book = new ExcelJS.Workbook(); book.addWorksheet('只有表名');
  await assert.rejects(f.extractor.extract(await f.add('blank.xlsx', Buffer.from(await book.xlsx.writeBuffer()))), { code: 'empty_source' });
});

test('actual Windows OCR reads an extensionless fixed PNG snapshot and reuses its result', { skip: process.platform !== 'win32' }, async (t) => {
  const f = await fixture(t), file = path.join(f.root, 'ocr-fixture.png');
  const code = `Add-Type -AssemblyName System.Drawing
    $bitmap = New-Object System.Drawing.Bitmap(1000, 200)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $font = New-Object System.Drawing.Font('Microsoft YaHei', 40)
    try { $graphics.Clear([System.Drawing.Color]::White)
      $graphics.DrawString('温度 20 25 30', $font, [System.Drawing.Brushes]::Black, 20, 50)
      $bitmap.Save('${file.replaceAll("'", "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $font.Dispose(); $graphics.Dispose(); $bitmap.Dispose() }`;
  await require('node:util').promisify(require('node:child_process').execFile)('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64')], { windowsHide: true, timeout: 15000 });
  const input = await f.add('ocr.png', await fs.readFile(file));
  assert.equal(path.extname(input.path), '');
  const extractor = createProjectMaterialExtractor({ store: f.store });
  const result = await extractor.extract(input);
  assert.match(result.text, /温\s*度/); assert.match(result.text, /20\s+25\s+30/);
  assert.equal((await extractor.extract(input)).cacheHit, true);
  await assert.rejects(runImageOcr(input, { language: 'invalid command;' }), { code: 'invalid_extraction_options' });
});

test('global extraction admission bounds concurrency and cancellation removes queued requests', { timeout: 10000 }, async (t) => {
  const f = await fixture(t), inputs = [];
  for (let i = 0; i < 5; i++) inputs.push(await f.add(`${i}.txt`, `source ${i}`));
  let active = 0, maximum = 0, completed = 0;
  let releaseRunning, markOccupied, markQueued;
  const runningGate = new Promise((resolve) => { releaseRunning = resolve; });
  const occupied = new Promise((resolve) => { markOccupied = resolve; });
  const queued = new Promise((resolve) => { markQueued = resolve; });
  const extractor = createProjectMaterialExtractor({ store: f.store, documentRunner: async () => {
    active++; maximum = Math.max(maximum, active);
    if (active === 2) markOccupied();
    await runningGate;
    active--; completed++; return { text: 'synthetic admission result', warnings: [] };
  } });
  const controller = new AbortController();
  // Only admission's queued branch subscribes to this signal; observe that
  // event instead of assuming asynchronous hash/cache reads preserve order.
  const addListener = controller.signal.addEventListener.bind(controller.signal);
  controller.signal.addEventListener = (type, listener, options) => {
    addListener(type, listener, options);
    if (type === 'abort') markQueued();
  };
  const first = inputs.slice(0, 2).map((input) => extractor.extract(input));
  await occupied;
  const pending = [...first, ...inputs.slice(2).map((input, index) => extractor.extract(input, index === 2 ? { signal: controller.signal } : {}))];
  const settled = Promise.allSettled(pending);
  try { await queued; controller.abort(); } finally { releaseRunning(); }
  const results = await settled;
  assert.equal(maximum, 2); assert.equal(completed, 4);
  assert.equal(results[4].status, 'rejected'); assert.equal(results[4].reason.code, 'cancelled');
});

test('large document parsing leaves the host event loop responsive and never returns truncated text', async (t) => {
  const f = await fixture(t), input = await f.add('large.docx', await docx('中文'.repeat(400000)));
  let ticks = 0; const timer = setInterval(() => ticks++, 5);
  try { await assert.rejects(f.extractor.extract(input), { code: 'extraction_limit' }); }
  finally { clearInterval(timer); }
  assert.ok(ticks >= 3, `host event loop ticked only ${ticks} times`);
});
