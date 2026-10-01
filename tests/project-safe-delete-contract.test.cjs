const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');

function functionBody(source, functionName, nextFunctionName) {
  const start = source.indexOf(`function ${functionName}(`);
  const end = source.indexOf(`function ${nextFunctionName}(`, start + 1);
  assert.ok(start >= 0, `${functionName} should exist`);
  assert.ok(end > start, `${nextFunctionName} should follow ${functionName}`);
  return source.slice(start, end);
}

test('learning projects expose a discoverable safe delete and restore workflow', () => {
  assert.match(preload, /deleteLearningProject\(projectId\)/);
  assert.match(preload, /previewLearningProjectRemoval\(projectId\)/);
  assert.match(main, /bridge:deleteLearningProject/);
  assert.match(main, /bridge:previewLearningProjectRemoval/);
  assert.match(ui, />\s*删除项目\s*</);
  assert.match(ui, />已删除项目</);
  assert.match(ui, /这是安全删除/);
  assert.match(ui, /恢复项目/);
});

test('project deletion removes only the index record and writes a recoverable snapshot', () => {
  const body = functionBody(main, 'deleteLearningProject', 'removeProjectRecord');
  assert.match(body, /deletionType: 'record_only'/);
  assert.match(body, /项目记录已移除\.json/);
  assert.match(body, /dismissProjectLineage/);
  assert.match(body, /停止自动重新接收该项目谱系/);
  assert.match(body, /preservedPaths/);
  assert.match(body, /commitProjectRecordOperation\('remove', project\.id, entries/);
  assert.match(body, /target: projectsPath\(\)/);
  assert.doesNotMatch(body, /rmSync|rmdirSync|unlinkSync/);
});

test('legacy remove calls remain compatible and deleted projects remain restorable', () => {
  assert.match(main, /function removeProjectRecord\(projectId\)[\s\S]*return deleteLearningProject\(projectId\)/);
  assert.match(main, /function restoreRemovedProject/);
  assert.match(main, /restoreProjectLineage/);
  assert.match(preload, /restoreRemovedProject/);
  assert.match(ui, /restoreProjectRecord/);
});
