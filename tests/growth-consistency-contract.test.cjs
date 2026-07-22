const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');

test('project evidence confirmation updates ledger and growth index as one recoverable operation', () => {
  assert.match(main, /growthTransactionSnapshot\(student\)/);
  assert.match(main, /restoreGrowthTransaction\(transactionSnapshot\)/);
  assert.match(main, /const growthResult = JSON\.parse\(rebuildGrowthIndex\(studentId\)\)/);
  assert.match(main, /growthIndex: growthResult\.index/);
  assert.match(ui, /result\.growthIndex.*setGrowthIndex\(result\.growthIndex\)/);
});

test('growth index self-heals when source fingerprint is stale', () => {
  assert.match(main, /growthSourceFingerprint\(review, projects\)/);
  assert.match(main, /growthIndexNeedsRebuild\(index, fingerprint\)/);
  assert.match(main, /createGrowthRecoverySnapshot\(normalized, 'stale-index-rebuild'\)/);
  assert.match(main, /repairStaleGrowthIndexes\(\)/);
});

