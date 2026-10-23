const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const renderer = [
  fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8'),
  fs.readFileSync(path.join(root, 'src', 'AssetCenterPanel.tsx'), 'utf8'),
].join('\n');

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
  'getAgentMemoryState',
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
  assert.match(renderer, /const refreshAgentMemoryState = \(studentId = selectedStudent\?\.id\): Promise<void>/);
  assert.match(renderer, /await bridge\(\)\?\.getAgentMemoryState\?\.\(requestStudentId\)/);
  assert.match(renderer, /activeSection === 'assets'\) void refreshAssets\(assetCursor\)/);
  assert.doesNotMatch(renderer, /refreshLicenseStatus\(\);\s*refreshAssets\(\)/);
  assert.match(renderer, /const generateCrossProjectKnowledgeLinks = async/);
  assert.match(renderer, /materialSourceBusyAction === 'scan' \? '正在扫描…'/);
  assert.match(renderer, /materialSourceBusyAction === 'import' \? '正在导入…'/);
  assert.match(renderer, /m\.assetBusyAction === 'rebuild' \? '正在补建…'/);
  assert.match(renderer, /projectBusyAction === 'cross-project-index' \? '正在关联…'/);
});

test('production preload exposes no synchronous business IPC', () => {
  assert.equal((preload.match(/ipcRenderer\.sendSync\s*\(/g) || []).length, 0);
  assert.match(preload, /const invokeLegacy = \(channel, \.\.\.args\) => ipcRenderer\.invoke\('bridge:invokeLegacyAsync', channel, args\);/);
  assert.match(main, /ipcMain\.handle\('bridge:invokeLegacyAsync'/);
  assert.match(main, /if \(!projectArchiveRecoveryCallerAllowed\(event\)\).*code: 'forbidden'/);
  assert.match(main, /const legacyAsyncHandlers = new Map\(\)/);
  assert.match(main, /if \(name\.startsWith\('bridge:'\)\)/);
  assert.match(main, /legacyAsyncHandlers\.set\(name, listener\)/);
  assert.match(main, /const listener = name !== 'bridge:invokeLegacyAsync' \? legacyAsyncHandlers\.get\(name\) : null/);
  assert.doesNotMatch(main, /ipcMain\.listeners\(name\)/);
  assert.match(main, /if \(!listener\).*code: 'legacy_async_unavailable'/);
  assert.match(main, /if \(!assigned\).*code: 'legacy_async_no_result'/);
});
