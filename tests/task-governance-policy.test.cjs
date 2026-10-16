const test = require('node:test');
const assert = require('node:assert/strict');

const {
  archiveTaskRecord,
  batchGovernancePreview,
  governanceEligibility,
  isLegacySmartInboxOrphan,
  restoreArchivedTask,
} = require('../electron/task-governance-policy.cjs');

test('batch governance protects active and unknown-outcome tasks', () => {
  for (const task of [
    { id: 'running', status: 'running', executionId: 'run-1' },
    { id: 'waiting', status: 'waiting_result', executionId: 'run-2' },
    { id: 'reviewing', status: 'reviewing' },
    { id: 'unknown', status: 'pending', recoveryState: 'unknown' },
  ]) {
    assert.equal(governanceEligibility(task, 'archive').ok, false);
    assert.equal(governanceEligibility(task, 'delete').ok, false);
  }
});

test('safe unstarted tasks can be cancelled or archived, then restored without execution', () => {
  const task = { id: 'pending', status: 'pending', attempt: 0, executionId: '', result: null };
  assert.equal(governanceEligibility(task, 'cancel').ok, true);
  assert.equal(governanceEligibility(task, 'delete').ok, true);
  assert.equal(archiveTaskRecord(task, 'cleanup', '2026-10-16T00:00:00.000Z').ok, true);
  assert.equal(task.status, 'archived');
  assert.equal(task.archive.previousStatus, 'pending');
  assert.equal(restoreArchivedTask(task, '2026-10-16T01:00:00.000Z').ok, true);
  assert.equal(task.status, 'cancelled');
  assert.equal(task.archive.restoredAt, '2026-10-16T01:00:00.000Z');
});

test('batch deletion accepts every safe unstarted status but still rejects started or unknown work', () => {
  for (const status of ['draft', 'pending', 'approved', 'queued']) {
    assert.equal(governanceEligibility({ id: status, status, attempt: 0, executionId: '', result: null }, 'delete').ok, true);
  }
  for (const task of [
    { id: 'attempted', status: 'pending', attempt: 1 },
    { id: 'claimed', status: 'queued', executionId: 'run-1' },
    { id: 'result', status: 'pending', result: { summary: 'returned' } },
    { id: 'unknown', status: 'pending', recoveryState: 'unknown' },
  ]) assert.equal(governanceEligibility(task, 'delete').ok, false);
});

test('legacy smart inbox migration only selects old never-started download orphans', () => {
  const now = Date.parse('2026-10-16T12:00:00.000Z');
  const base = { id: 'legacy', kind: 'smart_material_intake', sourceId: 'legacy-download', status: 'pending',
    attempt: 0, executionId: '', result: null, createdAt: '2026-10-16T10:00:00.000Z' };
  assert.equal(isLegacySmartInboxOrphan(base, now), true);
  assert.equal(isLegacySmartInboxOrphan({ ...base, executionId: 'run' }, now), false);
  assert.equal(isLegacySmartInboxOrphan({ ...base, sourceId: 'camera' }, now), false);
  assert.equal(isLegacySmartInboxOrphan({ ...base, createdAt: '2026-10-16T11:30:00.000Z' }, now), false);
});

test('batch preview reports eligible and skipped rows without mutating them', () => {
  const tasks = [
    { id: 'safe', title: '安全任务', status: 'pending', attempt: 0 },
    { id: 'active', title: '执行任务', status: 'running', executionId: 'run' },
  ];
  const before = JSON.stringify(tasks);
  const preview = batchGovernancePreview(tasks, ['safe', 'active', 'missing'], 'archive');
  assert.deepEqual(preview.eligible.map((item) => item.id), ['safe']);
  assert.deepEqual(preview.skipped.map((item) => item.id).sort(), ['active', 'missing']);
  assert.equal(JSON.stringify(tasks), before);
});
