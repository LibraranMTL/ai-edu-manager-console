const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('student and teacher read-only document dialogs share the Markdown reader', () => {
  const student = read('android-tablet-terminal/src/com/qxmatrix/eduterminal/MainActivity.java');
  const teacher = read('android-teacher-terminal/src/com/qxmatrix/eduteacher/MainActivity.java');
  assert.match(student, /MarkdownReadOnlyDialog\.show\(this, title, metadata, content, false\)/);
  assert.match(teacher, /MarkdownReadOnlyDialog\.show\(this, title, metadata, content, true\)/);
  assert.doesNotMatch(student.slice(student.indexOf('void showCollaborationTextDialog'), student.indexOf('void openWeeklyKnowledgeGrowth')), /body\.setText\(metadata/);
  assert.doesNotMatch(teacher.slice(teacher.indexOf('void showCollaborationTextDialog'), teacher.indexOf('void openWeeklyKnowledgeGrowth')), /body\.setText\(metadata/);
});

test('shared Markdown reader is network isolated and offers readable source controls', () => {
  const shared = read('android-shared/src/com/qxmatrix/markdown/MarkdownReadOnlyDialog.java');
  for (const marker of [
    'settings.setJavaScriptEnabled(false)',
    'settings.setDomStorageEnabled(false)',
    'settings.setAllowFileAccess(false)',
    'settings.setAllowContentAccess(false)',
    'settings.setBlockNetworkLoads(true)',
    '查看原文', '阅读模式', '正文已复制', 'A−', 'A+'
  ]) assert.ok(shared.includes(marker), marker);
  assert.match(shared, /confirmExternalLink/);
  assert.match(shared, /打开外部链接？/);
  assert.match(shared, /ORDERED_ITEM/);
  assert.match(shared, /TASK_ITEM/);
  assert.match(shared, /splitTableCells/);
  assert.match(shared, /stripFrontMatter/);
  assert.match(shared, /远程图片未自动加载/);
});

test('planning and recommendation details use Markdown without changing forms or confirmations', () => {
  const learning = read('android-shared/src/com/qxmatrix/terminallearning/TerminalLearningDialog.java');
  assert.match(learning, /MarkdownReadOnlyDialog\.show\(activity, title, "只读内容 · 来自 Windows 主机", content, teacher\)/);
  assert.match(learning, /MarkdownReadOnlyDialog\.show\(activity, title, "候选建议 · 来自 Windows 主机", content, false/);
  assert.match(learning, /out\.append\("## "\)\.append\(labels\[index\]\)/);
  assert.match(learning, /out\.append\("- "\)\.append\(values\.optString\(i\)\)/);
  assert.match(learning, /new AlertDialog\.Builder\(activity\)\.setTitle\("提交练习"\)\.setView\(formScroll\)/);
  assert.match(learning, /setTitle\("未确认作答原文"\)\.setMessage\(original\)/);
});

test('both APK build scripts compile the shared Markdown reader', () => {
  for (const script of ['android-tablet-terminal/build.ps1', 'android-teacher-terminal/build.ps1']) {
    assert.match(read(script), /android-shared\\src\\com\\qxmatrix\\markdown\\MarkdownReadOnlyDialog\.java/);
  }
});
