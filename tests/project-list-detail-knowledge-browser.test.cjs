const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('existing projects use a student-filtered list before opening a separate detail page', () => {
  const source = read('src/main.tsx');
  const styles = read('src/styles.css');
  assert.match(source, /type ProjectPageMode = 'list' \| 'detail'/);
  assert.match(source, /projectStudentFilterId === 'all'/);
  assert.match(source, /projects\.filter\(\(project\) => \(project\.studentIds \|\| \[\]\)\.includes\(projectStudentFilterId\)\)/);
  assert.match(source, /projectPageMode === 'list' \? \(/);
  assert.match(source, /className="projects-existing-only project-index-page"/);
  assert.match(source, /className="project-student-filter"/);
  assert.match(source, /htmlFor="project-student-filter"/);
  assert.match(source, /id="project-student-filter" aria-label="按学生筛选项目"/);
  assert.match(styles, /\.project-student-filter select\s*\{[\s\S]*pointer-events:\s*auto/);
  assert.match(source, /onClick=\{\(\) => openProjectDetail\(project\.id\)\}/);
  assert.match(source, /className="projects-existing-only project-detail-page"/);
  assert.match(source, /返回项目列表/);
});

test('project knowledge browser is categorized, rendered and connected through Electron', () => {
  const source = read('src/main.tsx');
  const preload = read('electron/preload.cjs');
  const main = read('electron/main.cjs');
  const styles = read('src/styles.css');

  for (const label of ['概念', '实体', '摘要', '问答精华', '综合汇总']) assert.match(source, new RegExp(label));
  assert.match(source, /查看项目知识空间/);
  assert.match(source, /<MarkdownView content=\{projectKnowledgeContent\}/);
  assert.match(preload, /listProjectKnowledgeFiles\(projectId\)/);
  assert.match(preload, /readProjectKnowledgeFile\(projectId, documentId\)/);
  assert.match(main, /bridge:listProjectKnowledgeFiles/);
  assert.match(main, /bridge:readProjectKnowledgeFile/);
  assert.match(main, /isPathInside\(root, target\)/);
  const browser = main.slice(main.indexOf('function listProjectKnowledgeFiles'), main.indexOf('function readProjectKnowledgeFile'));
  assert.match(browser, /const categoryRoots =/);
  assert.match(browser, /collectMarkdownFiles\(categoryPath, categoryPath, files, 8\)/);
  assert.doesNotMatch(browser, /collectMarkdownFiles\(root, root/);
  assert.match(styles, /\.project-knowledge-browser\s*\{/);
});
