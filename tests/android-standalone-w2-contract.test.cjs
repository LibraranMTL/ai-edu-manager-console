const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repo = path.resolve(__dirname, '..');
const androidSource = path.join(repo, 'android-standalone-manager', 'app', 'src', 'main', 'java', 'com', 'qxmatrix', 'edumanager', 'standalone');
const readAndroid = (file) => fs.readFileSync(path.join(androidSource, file), 'utf8');
const windowsMain = fs.readFileSync(path.join(repo, 'electron', 'main.cjs'), 'utf8');

test('W2 preserves the authoritative Windows student directory names', () => {
  const service = readAndroid('StudentWorkspaceService.kt');
  const model = readAndroid('StudentModels.kt');
  const required = ['知识库', '原始资料库', '学情分析汇总', '输出结果', '摘要库', '概念库', '实体库', '综合库', '咨询精华库', '.edu-manager'];
  for (const name of required) {
    assert.match(windowsMain, new RegExp(name.replace('.', '\\.')));
    assert.match(`${model}\n${service}`, new RegExp(name.replace('.', '\\.')));
  }
});

test('W2 keeps Windows students.json fields while adapting paths to SAF', () => {
  const model = readAndroid('StudentModels.kt');
  for (const field of ['id', 'name', 'grade', 'school', 'goal', 'knowledgeBaseMode', 'rootPath', 'rawPath', 'summaryPath', 'agentPath', 'outputPath', 'materialSources', 'adoptedAt', 'createdAt']) {
    assert.match(model, new RegExp(`put\\("${field}"`));
  }
  assert.match(model, /android-saf-relative-v1/);
  assert.match(model, /storageRootUri/);
});

test('W2 supports both new workspace creation and explicit existing-directory adoption', () => {
  const service = readAndroid('StudentWorkspaceService.kt');
  const activity = readAndroid('MainActivity.kt');
  assert.match(service, /fun createStandard/);
  assert.match(service, /fun scanAdopted/);
  assert.match(service, /fun adoptExisting/);
  assert.match(activity, /新建学生档案库/);
  assert.match(activity, /接管已有学生档案库/);
  assert.match(activity, /不覆盖已有 AGENT\.md、index\.md、log\.md/);
});

test('W2 student resolution is exact by id with no cross-student name fallback', () => {
  const repository = readAndroid('StudentIndexRepository.kt');
  assert.match(repository, /singleOrNull \{ it\.id == studentId \}/);
  assert.doesNotMatch(repository, /it\.name == studentId/);
  assert.match(repository, /该已有目录已被另一名学生档案接管/);
});
