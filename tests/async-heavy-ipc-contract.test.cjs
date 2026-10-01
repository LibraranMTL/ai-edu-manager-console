const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');

const routes = [
  'scanMaterialSources',
  'importMaterialSourceFiles',
  'rebuildAssetIndex',
  'analyzeAssetGovernance',
  'buildCrossProjectKnowledgeIndex',
  'getAssetIndex',
  'getProjects',
  'importProjectRawFiles',
  'importProjectAssets',
];

test('heavy bridge operations use invoke/handle instead of synchronous IPC', () => {
  for (const route of routes) {
    assert.match(preload, new RegExp(`ipcRenderer\\.invoke\\('bridge:${route}'`));
    assert.doesNotMatch(preload, new RegExp(`ipcRenderer\\.sendSync\\('bridge:${route}'`));
    assert.match(main, new RegExp(`ipcMain\\.handle\\('bridge:${route}'`));
    assert.doesNotMatch(main, new RegExp(`ipcMain\\.on\\('bridge:${route}'`));
  }
  assert.match(main, /function licensedInvoke\(action, handler\)/);
  assert.match(main, /setImmediate\(\(\) =>/);
});

test('renderer awaits heavy work and exposes non-blocking busy feedback', () => {
  assert.match(renderer, /const scanMaterialSourcesForStudent = async/);
  assert.match(renderer, /const importSelectedMaterialSourceFiles = async/);
  assert.match(renderer, /const rebuildAssets = async/);
  assert.match(renderer, /const analyzeAssets = async/);
  assert.match(renderer, /const refreshAssets = async/);
  assert.match(renderer, /const refreshProjects = async/);
  assert.match(renderer, /const importRawFilesToProject = async/);
  assert.match(renderer, /await importFiles\(targetProjectId\)/);
  assert.match(renderer, /const importSelectedAssetsToProject = async/);
  assert.match(renderer, /await importAssets\(targetProjectId, JSON\.stringify\(selectedIds\)\)/);
  assert.match(renderer, /activeSection === 'assets'\) void refreshAssets\(\)/);
  assert.doesNotMatch(renderer, /refreshLicenseStatus\(\);\s*refreshAssets\(\)/);
  assert.match(renderer, /const generateCrossProjectKnowledgeLinks = async/);
  assert.match(renderer, /materialSourceBusyAction === 'scan' \? '正在扫描…'/);
  assert.match(renderer, /materialSourceBusyAction === 'import' \? '正在导入…'/);
  assert.match(renderer, /assetBusyAction === 'rebuild' \? '正在补建…'/);
  assert.match(renderer, /projectBusyAction === 'cross-project-index' \? '正在关联…'/);
});
