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

test('growth index reads queue stale repair without synchronously rebuilding or startup all-student repair', () => {
  assert.match(main, /growthSourceFingerprint\(review, projects\)/);
  assert.match(main, /growthIndexNeedsRebuild\(index, fingerprint\)/);
  assert.match(main, /queueGrowthRefreshOnRead\(studentId, 'stale_index_on_read'\)/);
  const getter = main.slice(main.indexOf('function getGrowthIndex('), main.indexOf('function getGrowthModelSnapshot('));
  assert.doesNotMatch(getter, /rebuildGrowthIndex\(|repairMigratedStudentMetadata\(|createGrowthRecoverySnapshot\(/);
  assert.match(main, /function repairStaleGrowthIndexes\(studentIds = \[\]\)/);
  assert.doesNotMatch(main, /setTimeout\(\(\) => \{\s*try \{ repairStaleGrowthIndexes/);
  assert.match(main, /startGrowthRefreshMonitor\(\)/);
});

test('growth refresh is event-driven, bounded and has a low-frequency fallback', () => {
  assert.match(main, /markGrowthStudentsDirty\(\[student\.id\], 'growth_evidence_changed'\)/);
  assert.match(main, /changedGrowthProjectStudentIds\(previousProjects, projects\)/);
  assert.match(main, /claimDueGrowthRefreshes\(readGrowthRefreshState\(\), \{ limit: 2 \}\)/);
  assert.match(main, /growthRefreshFallbackTimer = setInterval/);
  assert.match(main, /15 \* 60 \* 1000/);
  assert.doesNotMatch(main, /taskSchedulerTimer = setInterval\(\(\) => \{ void runUnifiedTaskScheduler\(\); \}, 60 \* 1000\)/);
});
