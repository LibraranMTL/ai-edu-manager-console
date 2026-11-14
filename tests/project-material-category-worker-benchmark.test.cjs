const test = require('node:test');
const assert = require('node:assert/strict');

const { runCategoryWorkerBenchmark } = require('../scripts/benchmark-project-material-categories.cjs');

test('project material category cold-path benchmark stays bounded across the Worker boundary', async () => {
  const result = await runCategoryWorkerBenchmark({ rows: 2_000, categoryCount: 12 });
  assert.equal(result.rows, 2_000);
  assert.equal(result.returnedRecordCount, 12);
  assert.ok(result.returnedRecordCount <= 500);
  assert.ok(result.messageBytes < 2 * 1024 * 1024);
  assert.ok(result.workerDurationMs > 0);
  assert.ok(result.mainThreadEventLoopDelayMaxMs <= 100,
    `main-thread delay ${result.mainThreadEventLoopDelayMaxMs}ms exceeded 100ms`);
  assert.equal(result.mainThreadParsedRegistry, false);
});
