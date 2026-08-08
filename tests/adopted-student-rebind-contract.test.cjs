const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');

test('student knowledge and raw directories are rebound independently with exactly two visible choices', () => {
  assert.match(main, /async function rebindAdoptedStudentWorkspace\(studentId, selectionMode = 'knowledge'\)/);
  assert.match(main, /selectionMode === 'raw'/);
  assert.match(main, /为「\$\{student\.name\}」选择现有原始资料库/);
  assert.match(main, /为「\$\{student\.name\}」选择现有学生知识库或 wiki\/汇总目录/);
  assert.match(main, /原始资料库校验失败/);
  assert.match(main, /当前操作用于选择学生知识库/);
  assert.match(main, /selectedBinding\.rawPath = student\.rawPath/);
  assert.match(main, /const remapRoots = selectedBinding\.selectedRole === 'raw'/);
  assert.match(main, /const remapTarget = selectedBinding\.selectedRole === 'raw'/);
  assert.match(main, /remapAdoptedStudentMetadata\(nextStudent, remapRoots, remapTarget\)/);
  assert.match(main, /updateAdoptedAgentDirectoryStructure\(nextStudent, oldRoots\)/);
  assert.match(main, /replaceManagedBlock\(current, 'CURRENT-PATHS'/);
  assert.match(main, /appendPathChangeLog/);
  assert.match(main, /writeStudentsIndex\(students\)/);
  assert.match(main, /refreshStudentArchiveSyncWatchers\(\)/);
  assert.match(main, /ipcMain\.handle\('bridge:rebindAdoptedStudentWorkspace'/);
  assert.match(preload, /rebindAdoptedStudentWorkspace\(studentId, selectionMode\)/);
  assert.match(preload, /ipcRenderer\.invoke\('bridge:rebindAdoptedStudentWorkspace'/);
  assert.doesNotMatch(preload, /sendSync\('bridge:rebindAdoptedStudentWorkspace'/);
  assert.match(renderer, /await api\(selectedStudent\.id, selectionMode\)/);
  assert.match(renderer, /rebindSelectedAdoptedWorkspace\('knowledge'\)/);
  assert.match(renderer, /rebindSelectedAdoptedWorkspace\('raw'\)/);

  const saveIndex = renderer.indexOf('onClick={saveSelectedStudentProfile}');
  const actionsStart = renderer.lastIndexOf('<div className="actions">', saveIndex);
  const actionsEnd = renderer.indexOf('{pathBindingMessage && (', saveIndex);
  const actions = actionsStart >= 0 && actionsEnd > actionsStart ? renderer.slice(actionsStart, actionsEnd) : '';
  assert.ok(actions, 'student profile actions must be discoverable');
  assert.equal((actions.match(/手工选择学生知识库/g) || []).length, 1);
  assert.equal((actions.match(/手工选择原始资料库/g) || []).length, 1);
  assert.ok(actions.indexOf('手工选择原始资料库') < actions.indexOf('手工选择学生知识库'));
  assert.doesNotMatch(actions, /自动识别并绑定目录|手动选择知识库目录|迁移\/重命名知识库目录|打开原始资料库|打开学生原始资料库|复制资料变更提示/);
  assert.equal((actions.match(/className="secondary"/g) || []).length, 2);
});
