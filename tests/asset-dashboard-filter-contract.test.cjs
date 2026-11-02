const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = [
  fs.readFileSync(path.join(__dirname, '..', 'src', 'main.tsx'), 'utf8'),
  fs.readFileSync(path.join(__dirname, '..', 'src', 'AssetCenterPanel.tsx'), 'utf8'),
].join('\n');

test('asset dashboard statistics follow the selected student scope', () => {
  assert.match(source, /getAssetStatisticsSnapshot\?:/);
  assert.match(source, /studentId: assetStudentFilter/);
  assert.match(source, /snapshotAction\(filter\)/);
  assert.match(source, /snapshot\.generation !== page\.generation/);
  assert.match(source, /title=\{m\.assetQueryActive \? '当前查询资产' : m\.assetScopeFiltersActive \? '当前筛选资产' : '资产总数'\}/);
  assert.match(source, /title="重复文件组" value=\{`\$\{m\.assetScopedDuplicateGroups\} 组`\}/);
  assert.match(source, /<AssetTrendChart trend=\{m\.assetScopedTrend\}/);
  assert.match(source, /assetIndex\.referenceTotal/);
});

test('duplicate groups support safe page selection without implying a global destructive action', () => {
  assert.match(source, /const duplicatePageAssetIds = assetDuplicateGroups\.filter/);
  assert.match(source, /const allDuplicatePageSelected = duplicatePageAssetIds\.length > 0/);
  assert.match(source, /全选本页（\{m\.assetDuplicateGroups\.length\} 组）/);
  assert.match(source, /清空选择（\{m\.selectedDuplicateAssetIds\.length\}）/);
  assert.match(source, /每次最多处理当前页 50 组/);
});

test('asset detail cannot keep an item outside the active filters', () => {
  assert.match(source, /const nextSelectedId = items\.some/);
  assert.match(source, /requestId !== assetListRequestRef\.current/);
  assert.match(source, /getAssetDetail!\(selectedAssetId\)/);
  assert.match(source, /setSelectedAssetDetail\(result\.ok \? result\.asset/);
});
