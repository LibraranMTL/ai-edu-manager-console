const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildStudentMaterialStats,
  markStatsFreshness,
  validateStatsPrivacy,
} = require('../electron/collaboration-statistics.cjs');

const now = Date.parse('2026-07-24T12:00:00.000Z');

test('student authority nodes build aggregate material statistics without file details', () => {
  const snapshot = buildStudentMaterialStats({
    authorityNodeId: 'node-student',
    viewerNodeId: 'node-teacher',
    studentId: 'student-1',
    allowedProjectIds: ['project-1'],
    materials: [
      { id: 'm1', filename: 'private.pdf', absolutePath: 'D:/private.pdf', uploadedAt: '2026-07-24T10:00:00.000Z', status: 'pending_digest', projectId: 'project-1', sourceType: 'local_upload' },
      { id: 'm2', uploadedAt: '2026-07-20T10:00:00.000Z', status: 'processed', projectId: 'project-1', sourceType: 'agent_save' },
      { id: 'm3', uploadedAt: '2026-06-01T10:00:00.000Z', status: 'failed', projectId: 'project-secret', sourceType: 'screen_capture' },
    ],
    assets: [{ id: 'a1' }, { id: 'a2' }],
    projects: [
      { id: 'project-1', name: '物理项目' },
      { id: 'project-secret', name: '未授权项目' },
    ],
  }, now);
  assert.equal(snapshot.totalCollectedCount, 3);
  assert.equal(snapshot.addedLast24Hours, 1);
  assert.equal(snapshot.addedLast7Days, 2);
  assert.equal(snapshot.pendingDigestCount, 1);
  assert.equal(snapshot.digestedCount, 1);
  assert.equal(snapshot.digestFailedCount, 1);
  assert.equal(snapshot.managedAssetCount, 2);
  assert.deepEqual(snapshot.projectBreakdown.map((item) => item.projectId), ['project-1']);
  assert.equal(validateStatsPrivacy(snapshot).ok, true);
  assert.doesNotMatch(JSON.stringify(snapshot), /private\.pdf|D:\/private\.pdf|project-secret|未授权项目/);
});

test('statistics freshness clearly separates live and offline snapshots', () => {
  const snapshot = { generatedAt: '2026-07-24T11:59:00.000Z' };
  assert.equal(markStatsFreshness(snapshot, { nowMs: now, staleAfterMs: 5 * 60 * 1000 }).dataFreshness, 'live');
  assert.equal(markStatsFreshness(snapshot, { nowMs: now + 10 * 60 * 1000, staleAfterMs: 5 * 60 * 1000 }).dataFreshness, 'stale');
});

test('privacy validation rejects accidental filenames, paths and content', () => {
  assert.equal(validateStatsPrivacy({ totalCollectedCount: 1 }).ok, true);
  assert.equal(validateStatsPrivacy({ filename: 'private.pdf' }).code, 'PRIVATE_FIELD_LEAK');
  assert.equal(validateStatsPrivacy({ nested: { absolutePath: 'D:/private.pdf' } }).code, 'PRIVATE_FIELD_LEAK');
  assert.equal(validateStatsPrivacy({ summary: 'private learning detail' }).code, 'PRIVATE_FIELD_LEAK');
});
