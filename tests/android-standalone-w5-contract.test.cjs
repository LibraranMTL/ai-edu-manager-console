const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const repo = path.resolve(__dirname, '..');
const root = path.join(repo, 'android-standalone-manager', 'app', 'src', 'main', 'java', 'com', 'qxmatrix', 'edumanager', 'standalone');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const models = read('ProjectModels.kt');
const service = read('ProjectWorkspaceService.kt');
const repository = read('ProjectRepository.kt');
const activity = read('MainActivity.kt');
const windowsMain = fs.readFileSync(path.join(repo, 'electron', 'main.cjs'), 'utf8');

test('W5 preserves the Windows project workspace and fixed LLM Wiki knowledge schema', () => {
  for (const folder of ['学习项目', '项目工作空间', '研究暂存', '项目知识空间', '项目原始资料库', '概念库', '实体库', '摘要库', '问答精华库', '综合汇总库', '项目报告', '知识贡献', '输出结果']) {
    assert.match(windowsMain, new RegExp(folder));
    assert.match(`${models}\n${service}`, new RegExp(folder));
  }
});

test('W5 projects.json v1 retains multi-student scope and Windows project fields', () => {
  assert.match(repository, /projects\.json/);
  assert.match(repository, /put\("version", 1\)/);
  assert.match(models, /studentIds: List<String>/);
  for (const field of ['workspaceMode', 'knowledgeMode', 'knowledgeSpaceId', 'projectRootPath', 'managerPath', 'workspacePath', 'stagingPath', 'knowledgeRootPath', 'rawPath', 'conceptPath', 'entityPath', 'summaryPath', 'qaPath', 'synthesisPath', 'reportPath', 'contributionPath', 'agentPath', 'outputPath']) {
    assert.match(models, new RegExp(`put\\("${field}"`));
  }
});

test('W5 supports managed creation and existing knowledge-base adoption without modifying source files', () => {
  assert.match(service, /fun createManaged/);
  assert.match(service, /fun scanAdoptedKnowledge/);
  assert.match(service, /fun adoptKnowledge/);
  assert.match(service, /originalFilesModified.*false/s);
  assert.match(service, /删除项目记录即可解除绑定；原知识库文件保持不变/);
  assert.match(activity, /新建学习项目/);
  assert.match(activity, /接管已有项目知识库/);
  assert.match(activity, /不修改原知识库文件/);
});

test('W5 binds students and projects by exact IDs with no single-student simplification', () => {
  assert.match(service, /ids\.distinct\(\)\.map\(students::requireExact\)/);
  assert.match(repository, /singleOrNull \{ it\.id == projectId \}/);
  assert.doesNotMatch(repository, /it\.name == projectId/);
  assert.match(service, /boundStudents\.joinToString|bound\.joinToString/);
});

test('W5 expands project workspace paths from fields instead of ProjectPaths.toString()', () => {
  assert.doesNotMatch(service, /"\$p\.(workspacePath|managerPath)/);
  assert.match(service, /"\$\{p\.workspacePath\}\/资料"/);
  assert.match(service, /"\$\{p\.workspacePath\}\/工作空间结构\.md"/);
  assert.match(service, /"\$\{p\.managerPath\}\/绑定学生\.md"/);
});
