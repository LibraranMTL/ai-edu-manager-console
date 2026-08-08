const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');

test('project detail exposes separate workspace and knowledge-space binding controls', () => {
  assert.match(ui, /<FolderOpen size=\{15\} \/>更换工作空间<\/button>/);
  assert.match(ui, /<BookOpen size=\{15\} \/>绑定知识空间<\/button>/);
  assert.match(ui, /rebindSelectedProjectKnowledge/);
  assert.match(main, /function rebindProjectKnowledgeSpace\(projectId\)/);
  assert.match(main, /bridge:rebindProjectKnowledgeSpace/);
  assert.match(preload, /rebindProjectKnowledgeSpace\(projectId\)/);
  const editStart = ui.indexOf('{projectEditOpen && (');
  const editEnd = ui.indexOf('<section className="project-overview-panel">', editStart);
  assert.ok(editStart > -1 && editEnd > editStart, 'project edit panel must remain discoverable');
  const editPanel = ui.slice(editStart, editEnd);
  assert.doesNotMatch(editPanel, /rebindSelectedProjectKnowledge|relocateSelectedProjectWorkspace/);
});

test('workspace relocation reuses validated non-destructive rebinding', () => {
  assert.match(main, /validateWorkspaceRebind\(access\.project, selected\[0\]/);
  assert.match(main, /workspaceMode: 'linked'/);
  assert.match(main, /workspaceScanSnapshot: \{\}/);
});

test('project metadata templates use logical paths instead of host absolute paths', () => {
  assert.match(main, /@PROJECT_WORKSPACE/);
  assert.match(main, /@PROJECT_KNOWLEDGE/);
  assert.match(main, /edu:\/\/student\/\$\{student\.id\}/);
});
