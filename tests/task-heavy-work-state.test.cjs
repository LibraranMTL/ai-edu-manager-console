'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { hasUntrackedExternalHeavyWork } = require('../electron/task-heavy-work-state.cjs');

test('terminal tasks cannot leave a stale in-memory entry that blocks all heavy work', () => {
  const runningEntries = new Map([
    ['finished-internal', { executionId: 'old-execution' }],
  ]);
  const tasks = [{ id: 'finished-internal', status: 'succeeded' }];
  assert.equal(hasUntrackedExternalHeavyWork(runningEntries, tasks), false);
});

test('an actually running untracked operation still blocks new heavy work', () => {
  const runningEntries = new Map([
    ['running-internal', { executionId: 'active-execution' }],
  ]);
  const tasks = [{ id: 'running-internal', status: 'running' }];
  assert.equal(hasUntrackedExternalHeavyWork(runningEntries, tasks), true);
});

test('a managed operation with a shared resource permit is not double-counted', () => {
  const runningEntries = new Map([
    ['managed-agent', { executionId: 'active-execution', releaseHeavyPermit() {} }],
  ]);
  const tasks = [{ id: 'managed-agent', status: 'running' }];
  assert.equal(hasUntrackedExternalHeavyWork(runningEntries, tasks), false);
});
