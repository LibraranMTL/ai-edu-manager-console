const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'src', 'DigestStatusCard.tsx'), 'utf8');

test('main process wires authoritative path recovery into student digest registration', () => {
  assert.match(main, /require\('\.\/material-path-recovery\.cjs'\)/);
  assert.match(main, /require\('\.\/material-ledger-reconciliation\.cjs'\)/);
  assert.match(main, /mergeMaterialFromUpload/);
  assert.match(main, /reconcileCompletedMaterialRevisions/);
  assert.match(main, /function preflightStudentDigestMaterials/);
  assert.match(main, /const preflight = preflightStudentDigestMaterials\(normalized, options\)/);
  assert.match(main, /selectDigestBatchFiles/);
  const uploadWriter = main.slice(main.indexOf('function writeUploadRecords'), main.indexOf('function normalizeUploadStatus'));
  const materialWriter = main.slice(main.indexOf('function writeStudentMaterials'), main.indexOf('const studentRawDiscoveryLastRun'));
  assert.doesNotMatch(uploadWriter, /slice\(0,\s*200\)/);
  assert.doesNotMatch(materialWriter, /slice\(0,\s*1000\)/);
});

test('repair UI is exposed through the isolated preload bridge', () => {
  for (const method of ['getStudentMaterialPathIssues', 'retryStudentMaterialPathRecovery', 'selectStudentMaterialPath']) {
    assert.match(preload, new RegExp(`${method}\\(`));
  }
  assert.match(ui, /资料路径预检/);
  assert.match(ui, /重新检查并自动修复/);
  assert.match(ui, /手工选择文件/);
});
