'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SCHEMA,
  POLICY_VERSION,
  eligibleProject,
  orderedProjectIds,
  nextBackfillProject,
  stableBatchKey,
  beginProjectCheckpoint,
  completeBatch,
} = require('../electron/project-history-backfill.cjs');

test('history backfill selects only active opted-in projects in stable order', () => {
  const projects = [
    { id: 'project-b', materialAutomation: { enabled: true, processingPaused: false } },
    { id: 'project-a', materialAutomation: { enabled: true, processingPaused: false } },
    { id: 'paused', materialAutomation: { enabled: true, processingPaused: true } },
    { id: 'sealed', status: 'sealed', materialAutomation: { enabled: true, processingPaused: false } },
  ];
  assert.equal(eligibleProject(projects[0]), true);
  assert.deepEqual(orderedProjectIds(projects), ['project-a', 'project-b']);
  assert.equal(nextBackfillProject(projects, {}), 'project-a');
  assert.equal(nextBackfillProject(projects, { completedProjectId: 'project-a' }), 'project-b');
});

test('history backfill checkpoint and batch identity are restart-stable and bounded', () => {
  const started = beginProjectCheckpoint('project-a', {}, '2026-11-07T00:00:00.000Z');
  assert.equal(started.schema, SCHEMA);
  assert.equal(started.policyVersion, POLICY_VERSION);
  assert.equal(stableBatchKey('project-a', started), stableBatchKey('project-a', started));
  const partial = completeBatch(started, { processed: 20, remaining: 3 }, '2026-11-07T00:01:00.000Z');
  assert.equal(partial.batch, 1);
  assert.equal(partial.processed, 20);
  assert.equal(partial.remaining, 3);
  assert.equal(partial.completedAt, '');
  const completed = completeBatch(partial, { processed: 3, remaining: 0 }, '2026-11-07T00:02:00.000Z');
  assert.equal(completed.completedProjectId, 'project-a');
  assert.equal(completed.completedAt, '2026-11-07T00:02:00.000Z');
});
