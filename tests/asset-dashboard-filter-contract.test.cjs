const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.tsx'), 'utf8');

test('asset dashboard statistics follow the selected student scope', () => {
  assert.match(source, /getAssetSummary\?:/);
  assert.match(source, /studentId: assetStudentFilter/);
  assert.match(source, /api\.getAssetSummary\(filter\)/);
  assert.match(source, /title=\{assetFiltersActive \? '当前筛选资产' : '资产总数'\}/);
  assert.match(source, /title="重复文件组" value=\{`\$\{assetScopedDuplicateGroups\} 组`\}/);
  assert.match(source, /<AssetTrendChart trend=\{assetScopedTrend\}/);
  assert.match(source, /assetIndex\.referenceTotal/);
});

test('duplicate groups support safe page selection without implying a global destructive action', () => {
  assert.match(source, /const duplicatePageAssetIds = assetDuplicateGroups\.map/);
  assert.match(source, /const allDuplicatePageSelected = duplicatePageAssetIds\.length > 0/);
  assert.match(source, /全选本页（\{assetDuplicateGroups\.length\} 组）/);
  assert.match(source, /清空选择（\{selectedDuplicateAssetIds\.length\}）/);
  assert.match(source, /每次最多处理当前页 50 组/);
});

test('asset detail cannot keep an item outside the active filters', () => {
  assert.match(source, /setSelectedAssetId\(\(current\) => \(page\.items \?\? \[\]\)\.some/);
  assert.match(source, /getAssetDetail!\(selectedAssetId\)/);
  assert.match(source, /setSelectedAssetDetail\(result\.ok \? result\.asset/);
});
