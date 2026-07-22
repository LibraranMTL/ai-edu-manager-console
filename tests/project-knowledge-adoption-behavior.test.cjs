const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { adoptionPathmap, scanProjectKnowledgeBase } = require('../electron/project-knowledge-adoption.cjs');

function makeKnowledgeBase(root) {
  for (const folder of ['示例项目原始资料库', '概念库', '实体库', '摘要库', '问答精华库', '综合汇总库']) fs.mkdirSync(path.join(root, folder), { recursive: true });
  fs.writeFileSync(path.join(root, 'AGENT.md'), '# Agent\n旧路径：D:\\OldHost\\Project');
}

test('existing project knowledge base is inspected without modifying source files', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-project-kb-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  makeKnowledgeBase(root);
  const before = fs.readFileSync(path.join(root, 'AGENT.md'), 'utf8');
  const result = scanProjectKnowledgeBase(root, []);
  assert.equal(result.ok, true);
  assert.match(result.knowledgeSpaceId, /^project-kb-/);
  assert.equal(result.absolutePathCount, 1);
  assert.equal(fs.readFileSync(path.join(root, 'AGENT.md'), 'utf8'), before);
  assert.equal(fs.existsSync(path.join(root, '.edu-manager')), false);
});

test('duplicate knowledge identity blocks adoption', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-project-kb-duplicate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  makeKnowledgeBase(root);
  fs.mkdirSync(path.join(root, '.ai-manager'), { recursive: true });
  fs.writeFileSync(path.join(root, '.ai-manager', 'metadata.json'), JSON.stringify({ workspace_id: 'kb-stable-1' }));
  const duplicate = scanProjectKnowledgeBase(root, [{ id: 'p2', name: '旧项目', knowledgeSpaceId: 'kb-stable-1', knowledgeRootPath: 'X:\\elsewhere' }]);
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.errors.join(' '), /已被项目/);
});

test('missing universal schema blocks adoption', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-project-kb-missing-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const folder of ['示例项目原始资料库', '实体库', '摘要库', '问答精华库', '综合汇总库']) fs.mkdirSync(path.join(root, folder), { recursive: true });
  const missing = scanProjectKnowledgeBase(root, []);
  assert.equal(missing.ok, false);
  assert.match(missing.errors.join(' '), /Schema/);
});

test('adoption pathmap uses logical paths and current host locations', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-project-kb-map-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  makeKnowledgeBase(root);
  const scan = scanProjectKnowledgeBase(root, []);
  const map = adoptionPathmap({ id: 'p1', projectRootPath: 'D:\\managed', workspacePath: 'D:\\workspace' }, scan);
  assert.equal(map.paths['@PROJECT_KNOWLEDGE_ROOT'], scan.rootPath);
  assert.equal(map.paths['@PROJECT_RAW'], scan.paths.rawPath);
});

test('generated compatibility identity survives a different host path', (t) => {
  const left = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-project-kb-left-'));
  const right = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-project-kb-right-'));
  t.after(() => { fs.rmSync(left, { recursive: true, force: true }); fs.rmSync(right, { recursive: true, force: true }); });
  makeKnowledgeBase(left);
  makeKnowledgeBase(right);
  assert.equal(scanProjectKnowledgeBase(left, []).knowledgeSpaceId, scanProjectKnowledgeBase(right, []).knowledgeSpaceId);
});
