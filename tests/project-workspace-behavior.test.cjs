const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { collectWorkspaceFiles, isPathInside, validateWorkspaceRebind } = require('../electron/project-workspace.cjs');

test('path containment uses relative path boundaries instead of string prefixes', () => {
  const root = path.join(os.tmpdir(), 'project-root');
  assert.equal(isPathInside(root, path.join(root, '资料', 'a.pdf')), true);
  assert.equal(isPathInside(root, `${root}-copy`), false);
});

test('workspace collection skips excluded and linked directories', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-project-scan-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '资料'), { recursive: true });
  fs.mkdirSync(path.join(root, '.edu-manager'), { recursive: true });
  fs.writeFileSync(path.join(root, '资料', 'a.txt'), 'A');
  fs.writeFileSync(path.join(root, '.edu-manager', 'private.json'), '{}');
  const result = await collectWorkspaceFiles(root, { excludedRoots: [path.join(root, '.edu-manager')], limit: 20 });
  assert.equal(result.cancelled, false);
  assert.deepEqual(result.files.map((item) => item.relativePath), ['资料/a.txt']);
  const stat = fs.statSync(path.join(root, '资料', 'a.txt'));
  assert.equal(result.files[0].fileKey, `${stat.dev}:${stat.ino}`);
  assert.equal(result.files[0].nlink, stat.nlink);
});

test('workspace collection skips generated win-unpacked trees', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-project-generated-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'release', 'windows-terminal', 'win-unpacked', 'resources'), { recursive: true });
  fs.writeFileSync(path.join(root, 'release', 'windows-terminal', 'win-unpacked', 'resources', 'app.asar'), 'volatile');
  fs.writeFileSync(path.join(root, 'project-note.md'), 'keep');
  const result = await collectWorkspaceFiles(root, { limit: 20 });
  assert.deepEqual(result.files.map((item) => item.relativePath), ['project-note.md']);
  assert.equal(result.skippedGenerated, 1);
});

test('bounded workspace scan reports a same-directory overflow and resumes without repeating originals', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-project-scan-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt']) fs.writeFileSync(path.join(root, name), name);
  const first = await collectWorkspaceFiles(root, { limit: 2 });
  assert.deepEqual(first.files.map((item) => item.relativePath), ['a.txt', 'b.txt']);
  assert.equal(first.limitReached, true);
  assert.equal(first.nextCursor, 'b.txt');
  const second = await collectWorkspaceFiles(root, { limit: 2, afterRelativePath: first.nextCursor });
  assert.deepEqual(second.files.map((item) => item.relativePath), ['c.txt', 'd.txt']);
  assert.equal(second.limitReached, true);
  const last = await collectWorkspaceFiles(root, { limit: 2, afterRelativePath: second.nextCursor });
  assert.deepEqual(last.files.map((item) => item.relativePath), ['e.txt']);
  assert.equal(last.limitReached, false);
  assert.equal(last.nextCursor, '');
});

test('a scan page with exactly the limit and no remaining source is complete', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-project-scan-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'folder'));
  fs.writeFileSync(path.join(root, 'a.txt'), 'a');
  fs.writeFileSync(path.join(root, 'folder', 'b.txt'), 'b');
  const result = await collectWorkspaceFiles(root, { limit: 2 });
  assert.equal(result.files.length, 2);
  assert.equal(result.limitReached, false);
});

test('nested directory cursor remains ordered before a similarly named sibling file', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-project-scan-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'folder'));
  fs.writeFileSync(path.join(root, 'folder', 'a.txt'), 'a');
  fs.writeFileSync(path.join(root, 'folder.txt'), 'sibling');
  const first = await collectWorkspaceFiles(root, { limit: 1 });
  assert.deepEqual(first.files.map((item) => item.relativePath), ['folder/a.txt']);
  assert.equal(first.limitReached, true);
  const second = await collectWorkspaceFiles(root, { limit: 1, afterRelativePath: first.nextCursor });
  assert.deepEqual(second.files.map((item) => item.relativePath), ['folder.txt']);
  assert.equal(second.limitReached, false);
});

test('a directory removed during scanning is reported as uncovered', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-project-scan-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const vanishing = path.join(root, 'z-vanishing');
  fs.mkdirSync(vanishing);
  fs.writeFileSync(path.join(vanishing, 'source.txt'), 'source');
  for (let index = 0; index < 25; index++) fs.writeFileSync(path.join(root, `a${String(index).padStart(2, '0')}.txt`), 'a');
  const result = await collectWorkspaceFiles(root, { limit: 30,
    onProgress: ({ visited }) => { if (visited === 25) fs.rmSync(vanishing, { recursive: true }); } });
  assert.equal(result.files.length, 25);
  assert.equal(result.skippedDirectories, 1);
  assert.equal(result.limitReached, false);
});

test('workspace rebind rejects duplicate and knowledge-overlapping paths', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-project-rebind-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'workspace');
  const knowledge = path.join(root, 'project', 'knowledge');
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(knowledge, { recursive: true });
  const project = { id: 'p1', workspacePath: workspace, projectRootPath: path.join(root, 'project'), knowledgeRootPath: knowledge, managerPath: path.join(root, 'project', '.edu-manager') };
  const duplicate = validateWorkspaceRebind(project, workspace, [{ id: 'p2', name: '另一个项目', workspacePath: workspace }]);
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.errors.join(' '), /已绑定/);
  const overlap = validateWorkspaceRebind(project, knowledge, []);
  assert.equal(overlap.ok, false);
  assert.match(overlap.errors.join(' '), /相互包含/);
});
