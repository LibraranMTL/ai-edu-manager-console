const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { openKnowledgeGuard } = require('../electron/project-knowledge-guard.cjs');
const hash = (text) => crypto.createHash('sha256').update(text).digest('hex');

async function fixture(t, { existing = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-guard-test-'));
  const knowledgeRoot = path.join(root, 'knowledge');
  const backupRoot = path.join(root, 'backups');
  const sourceRoot = path.join(root, 'workspace');
  await Promise.all([knowledgeRoot, backupRoot, sourceRoot].map((dir) => fs.mkdir(dir)));
  const source = path.join(sourceRoot, 'source.txt');
  const target = path.join(knowledgeRoot, 'summary.md');
  await fs.writeFile(source, 'original source');
  if (existing) await fs.writeFile(target, 'previous knowledge');
  const request = { knowledgeRoot, backupRoot, sources: [{ root: sourceRoot, path: source, sha256: hash('original source') }],
    targets: [{ path: target, backupPath: path.join(backupRoot, 'before.bin'), baselineHash: existing ? hash('previous knowledge') : null,
      sha256: hash('new knowledge'), contentBase64: Buffer.from('new knowledge').toString('base64') }] };
  t.after(async () => {
    assert.equal(path.dirname(root), await fs.realpath(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-guard-test-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, source, target, request };
}

test('native guard blocks external source/knowledge writes during commit and releases after finalization', { skip: process.platform !== 'win32' }, async (t) => {
  const f = await fixture(t);
  const guard = openKnowledgeGuard(f.request);
  t.after(() => guard.abort());
  await guard.ready();
  await assert.rejects(fs.writeFile(f.source, 'unauthorized concurrent edit'));
  await assert.rejects(fs.writeFile(f.target, 'concurrent edit'));
  await guard.write();
  await assert.rejects(fs.readFile(f.target));
  await guard.finalize();
  assert.equal(await fs.readFile(f.source, 'utf8'), 'original source');
  assert.equal(await fs.readFile(f.target, 'utf8'), 'new knowledge');
  assert.equal(await fs.readFile(f.request.targets[0].backupPath, 'utf8'), 'previous knowledge');
});

test('native guard restores overwritten bytes if metadata phase is aborted', { skip: process.platform !== 'win32' }, async (t) => {
  const f = await fixture(t);
  const guard = openKnowledgeGuard(f.request);
  t.after(() => guard.abort());
  await guard.ready(); await guard.write(); await guard.abort();
  assert.equal(await fs.readFile(f.target, 'utf8'), 'previous knowledge');
});

test('native guard removes only its own newly created file on abort', { skip: process.platform !== 'win32' }, async (t) => {
  const f = await fixture(t, { existing: false });
  const guard = openKnowledgeGuard(f.request);
  t.after(() => guard.abort());
  await guard.ready(); await guard.write(); await guard.abort();
  await assert.rejects(fs.stat(f.target), { code: 'ENOENT' });
});

test('native guard finalizes a new file without deleting it at process exit', { skip: process.platform !== 'win32' }, async (t) => {
  const f = await fixture(t, { existing: false });
  const guard = openKnowledgeGuard(f.request);
  t.after(() => guard.abort());
  await guard.ready(); await guard.write(); await guard.finalize();
  assert.equal(await fs.readFile(f.target, 'utf8'), 'new knowledge');
});

test('knowledge baseline mismatch fails without touching externally edited text', { skip: process.platform !== 'win32' }, async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.target, 'human latest');
  const guard = openKnowledgeGuard(f.request);
  await assert.rejects(guard.ready(), { code: 'knowledge_conflict' });
  await guard.abort();
  assert.equal(await fs.readFile(f.target, 'utf8'), 'human latest');
});

test('target created externally after absent baseline is never overwritten or deleted', { skip: process.platform !== 'win32' }, async (t) => {
  const f = await fixture(t, { existing: false });
  await fs.writeFile(f.target, 'human new file');
  const guard = openKnowledgeGuard(f.request);
  await assert.rejects(guard.ready()); await guard.abort();
  assert.equal(await fs.readFile(f.target, 'utf8'), 'human new file');
});
