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
