const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');

test('growth navigation loads once and does not use blocking IPC on the desktop', () => {
  assert.equal((ui.match(/if \(activeSection !== 'growth' \|\| !selectedStudent\) return;/g) || []).length, 1);
  assert.match(ui, /void refreshSelectedGrowthModel\(selectedStudent\)/);
  assert.match(ui, /await api\.getGrowthModelSnapshot\(student\.id\)/);
  assert.doesNotMatch(ui, /if \(activeSection !== 'tasks'\) return undefined;[\s\S]{0,120}void refreshTaskCenter\(false, true\)/);
  const taskRead = main.match(/function getTaskCenter\(options = \{\}\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(taskRead, /getTaskPage\(\{\}, 'legacy'\)/);
  assert.doesNotMatch(taskRead, /buildTaskCenterCandidates|syncAgentTaskResults|refreshAdapterCapabilities/);
  assert.match(ui, /return \(\) => \{ growthLoadSerial\.current \+= 1; \};/);
  assert.match(ui, /await api\.getGrowthEvidenceReviewAsync\(student\.id\)/);
  assert.match(ui, /await api\.getGrowthIndexAsync\(student\.id\)/);
  assert.ok(ui.indexOf('await api.getGrowthEvidenceReviewAsync(student.id)') < ui.indexOf('await api.getGrowthIndexAsync(student.id)'), 'index load must follow automatic evidence processing');
  assert.match(ui, /正在后台读取成长模型，页面可继续操作/);
  for (const method of ['getGrowthEvidenceReviewAsync', 'getGrowthIndexAsync']) {
    assert.match(preload, new RegExp(`${method}\\(studentId\\) \\{\\s+return ipcRenderer\\.invoke`));
    assert.match(main, new RegExp(`ipcMain\\.handle\\('bridge:${method}'`));
  }
});
