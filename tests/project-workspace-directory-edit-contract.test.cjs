const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');
const manual = fs.readFileSync(path.join(root, 'docs', 'delivery', 'Windows主机版操作手册.md'), 'utf8');

test('project detail relocation is the single workspace source directory editor', () => {
  assert.match(ui, /title="修改该项目绑定的工作空间来源目录；不移动原文件或项目知识空间"/);
  assert.match(ui, /<FolderOpen size=\{15\} \/>重新定位<\/button>/);
  const editStart = ui.indexOf('{projectEditOpen && (');
  const editEnd = ui.indexOf('<section className="project-overview-panel">', editStart);
  assert.ok(editStart > -1 && editEnd > editStart, 'project edit panel must remain discoverable');
  const editPanel = ui.slice(editStart, editEnd);
  assert.match(editPanel, /只修改项目元数据/);
  assert.doesNotMatch(editPanel, /工作空间来源目录|选择新的来源目录|relocateSelectedProjectWorkspace/);
});

test('workspace relocation reuses validated non-destructive rebinding', () => {
  assert.match(main, /重新定位项目工作空间（选择新的来源目录）/);
  assert.match(main, /validateWorkspaceRebind\(access\.project, selected\[0\]/);
  assert.match(main, /workspaceMode: 'linked'/);
  assert.match(main, /workspaceScanSnapshot: \{\}/);
  assert.match(main, /原目录与知识空间均未改动/);
});

test('manual rejects same-name independent project merging and documents the supported two-host flow', () => {
  assert.match(manual, /不要在 A、B 两台主机上分别独立创建同名项目/);
  assert.match(manual, /不同项目 ID 和协作谱系/);
  assert.match(manual, /系统自动创建的协作项目[\s\S]*?项目详情页点击“重新定位”/);
  assert.match(manual, /无需进入“编辑项目”/);
  assert.match(manual, /发布项目.*项目原始资料、已确认\/已发布知识及来源关系/);
  assert.match(manual, /不同的本机工作空间/);
});
