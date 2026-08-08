const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  appendPathChangeLog,
  classifyStudentBindingSelection,
  commonBindingRoot,
  inspectBindingDirectory,
  replaceManagedBlock,
  validateExistingBinding,
} = require('../electron/path-binding.cjs');

test('manual raw and knowledge directories resolve to their existing common student root', (t) => {
  const root = fixture(t);
  const raw = path.join(root, 'baoshuyuan-raw');
  const wiki = path.join(root, 'baoshuyuan-wiki');
  fs.mkdirSync(raw);
  fs.mkdirSync(wiki);
  assert.equal(commonBindingRoot([raw, wiki]), root);
  assert.deepEqual(fs.readdirSync(root).sort(), ['baoshuyuan-raw', 'baoshuyuan-wiki']);
});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-path-binding-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('existing binding rejects empty directories and inventories real knowledge files', (t) => {
  const root = fixture(t);
  const empty = validateExistingBinding({ rootPath: root, rejectEmpty: true });
  assert.equal(empty.ok, false);
  assert.match(empty.errors.join(' '), /没有可识别/);
  fs.mkdirSync(path.join(root, '学生学情分析汇总'), { recursive: true });
  fs.writeFileSync(path.join(root, '学生学情分析汇总', 'index.md'), '# 正式正文', 'utf8');
  const inspected = inspectBindingDirectory(root);
  assert.equal(inspected.substantiveFileCount, 1);
  assert.deepEqual(inspected.keyFiles, ['学生学情分析汇总/index.md']);
});

test('managed blocks update without rewriting user prose', () => {
  const original = '# Agent\n\n用户正文中的 D:\\旧目录 必须保留。\n';
  const first = replaceManagedBlock(original, 'CURRENT-PATHS', '- `@KB_ROOT`：`D:\\新目录`');
  const second = replaceManagedBlock(first, 'CURRENT-PATHS', '- `@KB_ROOT`：`E:\\最终目录`');
  assert.match(second, /用户正文中的 D:\\旧目录 必须保留/);
  assert.doesNotMatch(second, /D:\\新目录/);
  assert.equal((second.match(/EDU-MANAGER-CURRENT-PATHS:START/g) || []).length, 1);
});

test('path change logging appends an audit entry without changing history', () => {
  const original = '# 处理日志\n\n- 历史结论保持不变。\n';
  const next = appendPathChangeLog(original, { at: '2026-08-08T00:00:00.000Z', scope: '学生知识库', oldPath: 'D:\\旧', newPath: 'C:\\新' });
  assert.match(next, /历史结论保持不变/);
  assert.match(next, /教育管家路径变更/);
  assert.match(next, /D:\\旧/);
});

test('student binding recognizes an existing wiki directory without creating a default summary folder', (t) => {
  const root = fixture(t);
  const wiki = path.join(root, 'baoshuyuan-wiki');
  const raw = path.join(root, 'baoshuyuan-raw');
  fs.mkdirSync(wiki);
  fs.mkdirSync(raw);
  fs.writeFileSync(path.join(wiki, 'index.md'), '# existing wiki', 'utf8');
  fs.writeFileSync(path.join(raw, 'source.md'), '# source', 'utf8');
  const selection = classifyStudentBindingSelection(wiki, { summaryPath: wiki, rawPath: raw });
  assert.equal(selection.selectedRole, 'summary');
  assert.equal(selection.rootPath, root);
  assert.equal(selection.summaryPath, wiki);
  assert.equal(fs.existsSync(path.join(root, '包书源学情分析汇总')), false);
});

test('student binding keeps a parent directory as root and does not invent child directories', (t) => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, 'baoshuyuan-wiki'));
  fs.mkdirSync(path.join(root, 'baoshuyuan-raw'));
  const selection = classifyStudentBindingSelection(root, {});
  assert.equal(selection.selectedRole, 'root');
  assert.equal(selection.rootPath, root);
  assert.equal(selection.summaryPath, '');
  assert.deepEqual(fs.readdirSync(root).sort(), ['baoshuyuan-raw', 'baoshuyuan-wiki']);
});
