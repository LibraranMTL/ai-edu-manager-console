const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

test('host exposes bounded read-only project knowledge routes to authorized student sessions', () => {
  const main = read('electron/main.cjs');
  assert.match(main, /\/api\\\/projects\\\/\(\[\^\/\]\+\)\\\/archive\\\/files/);
  assert.match(main, /\/api\\\/projects\\\/\(\[\^\/\]\+\)\\\/archive\\\/file/);
  assert.match(main, /function handleProjectArchiveFile\(request, response, projectId, url\)/);
  assert.match(main, /if \(!projectAllowed\(request, project\)\)/);
  assert.match(main, /resolveInside\(knowledgeRoot, relativePath\)/);
  assert.match(main, /isPublicArchiveFile\(relativePath\)/);
  assert.match(main, /只允许读取 Markdown 知识文件/);
});

test('Windows student terminal lists only current-student projects and reads project knowledge through the host', () => {
  const renderer = read('src/terminal-main.tsx');
  const preload = read('electron/terminal-preload.cjs');
  const terminalMain = read('electron/terminal-main.cjs');

  assert.match(renderer, /projects\.filter\(\(project\) => \(project\.studentIds \|\| \[\]\)\.includes\(selectedStudentId\)\)/);
  assert.match(renderer, /title="项目资料"/);
  assert.match(renderer, /aria-label="项目管理功能"/);
  assert.match(renderer, /项目资料与知识只读取当前学生本人已关联项目/);
  assert.match(renderer, /当前学生还没有关联学习项目/);
  assert.match(preload, /listProjectKnowledgeFiles/);
  assert.match(preload, /readProjectKnowledgeFile/);
  assert.match(terminalMain, /\/api\/projects\/\$\{encodeURIComponent\(normalizedProjectId\)\}\/archive\/files/);
  assert.match(terminalMain, /\/api\/projects\/\$\{encodeURIComponent\(normalizedProjectId\)\}\/archive\/file\?path=/);
});

test('Android student terminal offers current-student project knowledge without technical configuration', () => {
  const android = read('android-tablet-terminal/src/com/qxmatrix/eduterminal/MainActivity.java');
  assert.match(android, /collapsiblePanel\("项目资料"/);
  assert.match(android, /button\("项目资料与知识", true\)/);
  assert.match(android, /只显示当前学生自己的档案，以及本人关联项目中的公开 Markdown 知识/);
  assert.match(android, /if \(!project\.studentIds\.contains\(selectedStudent\.id\)\) continue/);
  assert.match(android, /\/api\/projects\/" \+ activity\.encode\(project\.id\) \+ "\/archive\/files/);
  assert.match(android, /\/api\/projects\/" \+ activity\.encode\(projectId\) \+ "\/archive\/file\?path=/);
  assert.doesNotMatch(android, /项目知识服务器地址|项目知识目录授权|项目知识 API Token/);
});
