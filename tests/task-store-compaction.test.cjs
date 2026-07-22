const assert = require('node:assert/strict');
const test = require('node:test');

const {
  compactDigestDomainSync,
  compactDigestTaskStore,
} = require('../electron/task-store-compaction.cjs');

test('digest domain sync keeps status summary and drops heavy manifests', () => {
  const compacted = compactDigestDomainSync({
    ok: true,
    projectId: 'project-1',
    message: 'done',
    digestState: {
      status: 'completed',
      digestBatchId: 'batch-1',
      pendingCount: 0,
      processedCount: 913,
      digestManifest: Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`file-${index}`, { content: 'x'.repeat(1000) }])),
    },
    project: { stagingItems: Array.from({ length: 100 }, () => ({ content: 'x'.repeat(1000) })) },
  });

  assert.equal(compacted.ok, true);
  assert.equal(compacted.scopeId, 'project-1');
  assert.equal(compacted.state.status, 'completed');
  assert.equal(compacted.state.processedCount, 913);
  assert.equal('digestManifest' in compacted.state, false);
  assert.equal('project' in compacted, false);
  assert.ok(JSON.stringify(compacted).length < 1000);
});

test('task store compacts digest results without changing unrelated tasks', () => {
  const unrelatedResult = { structuredOutput: { rows: [1, 2, 3] } };
  const store = {
    tasks: [
      {
        kind: 'project_digest',
        result: {
          structuredOutput: { ok: true, digestState: { status: 'completed', digestManifest: { huge: 'x'.repeat(10000) } } },
          validation: { valid: true, domainSync: { ok: true, state: { status: 'completed', records: ['x'.repeat(10000)] } } },
        },
      },
      { kind: 'weekly_action', result: unrelatedResult },
    ],
    history: [
      {
        kind: 'project_digest',
        validation: { valid: true, domainSync: { ok: true, digestState: { status: 'completed', digestManifest: { huge: 'x'.repeat(10000) } } } },
      },
      { kind: 'weekly_action', validation: { domainSync: { rows: ['keep'] } } },
    ],
  };

  assert.equal(compactDigestTaskStore(store), true);
  assert.equal(store.tasks[0].result.structuredOutput.state.status, 'completed');
  assert.ok(JSON.stringify(store.tasks[0].result).length < 2000);
  assert.equal(store.tasks[1].result, unrelatedResult);
  assert.ok(JSON.stringify(store.history[0]).length < 1000);
  assert.deepEqual(store.history[1].validation.domainSync, { rows: ['keep'] });
  assert.equal(compactDigestTaskStore(store), false);
});
