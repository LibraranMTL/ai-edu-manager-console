const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.tsx'), 'utf8');

test('asset dashboard statistics follow the selected student scope', () => {
  assert.match(source, /const studentScopedAssets = useMemo/);
  assert.match(source, /assetStudentFilter === 'all'/);
  assert.match(source, /reference\.spaceType === 'student'/);
  assert.match(source, /title="资产总数" value=\{`\$\{studentScopedAssets\.length\} 个`\}/);
  assert.match(source, /title="重复文件组" value=\{`\$\{assetScopedDuplicateGroups\} 组`\}/);
  assert.match(source, /<AssetTrendChart trend=\{assetScopedTrend\}/);
  assert.match(source, /studentScopedAssets\.reduce\(\(sum, asset\)/);
});

test('asset detail cannot keep an item outside the active filters', () => {
  assert.match(source, /const selectedAsset = filteredAssets\.find\(\(asset\) => asset\.assetId === selectedAssetId\) \?\? filteredAssets\[0\]/);
  assert.match(source, /for \(const asset of filteredAssets\)/);
});
