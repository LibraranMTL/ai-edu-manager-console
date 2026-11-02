'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAssetIndexStore, SCHEMA_VERSION } = require('../electron/asset-index-store.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-asset-generation-'));
  const events = [];
  const store = createAssetIndexStore({
    dbPath: path.join(root, 'asset-index.sqlite3'),
    legacyJsonPath: path.join(root, 'asset-index.json'),
    now: () => Date.parse('2026-11-02T10:00:00.000+08:00'),
    onChanged: (event) => events.push(event),
  });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { store, events };
}

test('asset statistics generation persists and advances only after committed summary changes', (t) => {
  const { store, events } = fixture(t);
  assert.equal(SCHEMA_VERSION, 5);
  const initial = store.statisticsSnapshot({});
  assert.equal(initial.generation, 0);

  const asset = {
    assetId: 'asset-generation-1', sha1: 'a'.repeat(40), sha256: 'b'.repeat(64),
    filename: 'fixture.pdf', ownerStudentId: 'student-a', ownerStudentName: '学生甲',
    path: 'D:/fixture.pdf', status: 'active', updatedAt: '2026-11-02T02:00:00.000Z',
  };
  store.upsertAsset(asset, [{ referenceId: 'ref-1', spaceType: 'project', spaceId: 'project-team', studentId: 'student-a', role: 'raw', path: asset.path }]);
  const changed = store.statisticsSnapshot({});
  assert.ok(changed.generation > initial.generation);
  assert.equal(changed.changedAt, '2026-11-02T02:00:00.000Z');
  assert.equal(events.length, 1);
  assert.equal(events[0].generation, changed.generation);

  store.upsertAsset(asset, [{ referenceId: 'ref-1', spaceType: 'project', spaceId: 'project-team', studentId: 'student-a', role: 'raw', path: asset.path }]);
  assert.equal(store.statisticsSnapshot({}).generation, changed.generation);
  assert.equal(events.length, 1, 'idempotent retry does not publish a change event');
});

test('student, project and global snapshots share the same as-of generation', (t) => {
  const { store } = fixture(t);
  store.upsertAsset({ assetId: 'asset-a', sha1: 'c'.repeat(40), sha256: 'd'.repeat(64), filename: 'a.pdf', ownerStudentId: 'student-a', path: 'D:/a.pdf' },
    [{ referenceId: 'ref-a', spaceType: 'project', spaceId: 'project-team', studentId: 'student-a', role: 'raw', path: 'D:/a.pdf' }]);
  store.upsertAsset({ assetId: 'asset-b', sha1: 'e'.repeat(40), sha256: 'f'.repeat(64), filename: 'b.pdf', ownerStudentId: 'student-b', path: 'D:/b.pdf' },
    [{ referenceId: 'ref-b', spaceType: 'student', spaceId: 'student-b', studentId: 'student-b', role: 'raw', path: 'D:/b.pdf' }]);
  const global = store.statisticsSnapshot({});
  const student = store.statisticsSnapshot({ studentId: 'student-a' });
  const project = store.statisticsSnapshot({ projectId: 'project-team' });
  assert.equal(global.total, 2);
  assert.equal(student.total, 1);
  assert.equal(project.total, 1);
  assert.equal(student.generation, global.generation);
  assert.equal(project.generation, global.generation);
  assert.equal(student.asOf, global.asOf);
});

test('statistics snapshots include the scoped seven-day asset and reference trend', (t) => {
  const { store } = fixture(t);
  store.upsertAsset({
    assetId: 'asset-trend-a', sha1: '1'.repeat(40), sha256: '2'.repeat(64), filename: 'recent.pdf',
    ownerStudentId: 'student-a', path: 'D:/recent.pdf', uploadedAt: '2026-10-29T01:00:00.000Z',
  }, [{
    referenceId: 'ref-trend-a', spaceType: 'student', spaceId: 'student-a', studentId: 'student-a', role: 'raw',
    path: 'D:/recent.pdf', linkedAt: '2026-11-01T01:00:00.000Z',
  }]);
  store.upsertAsset({
    assetId: 'asset-trend-b', sha1: '3'.repeat(40), sha256: '4'.repeat(64), filename: 'other.pdf',
    ownerStudentId: 'student-b', path: 'D:/other.pdf', uploadedAt: '2026-11-01T01:00:00.000Z',
  }, [{
    referenceId: 'ref-trend-b', spaceType: 'student', spaceId: 'student-b', studentId: 'student-b', role: 'raw',
    path: 'D:/other.pdf', linkedAt: '2026-11-01T01:00:00.000Z',
  }]);

  const snapshot = store.statisticsSnapshot({ studentId: 'student-a' });
  assert.equal(snapshot.recentTrend.addedTotal, 1);
  assert.equal(snapshot.recentTrend.referenceTotal, 1);
  assert.equal(snapshot.recentTrend.days.length, 7);
  assert.deepEqual(snapshot.recentTrend.days.map((day) => [day.date, day.added, day.references]), [
    ['2026-10-27', 0, 0], ['2026-10-28', 0, 0], ['2026-10-29', 1, 0], ['2026-10-30', 0, 0],
    ['2026-10-31', 0, 0], ['2026-11-01', 0, 1], ['2026-11-02', 0, 0],
  ]);
  assert.equal(snapshot.recentTrend.asOf, snapshot.asOf);
});

test('overall trend keeps the student scope but ignores duplicate-only filtering and refreshes after commits', (t) => {
  const { store } = fixture(t);
  const asset = (id, sha, path, studentId = 'student-a') => ({
    assetId: id, sha1: sha.repeat(40), filename: `${id}.pdf`, ownerStudentId: studentId,
    path, uploadedAt: '2026-11-01T01:00:00.000Z',
  });
  const refs = (id, studentId = 'student-a') => [{
    referenceId: `${id}-ref`, spaceType: 'student', spaceId: studentId, studentId, role: 'raw',
    path: `D:/${id}.pdf`, linkedAt: '2026-11-01T02:00:00.000Z',
  }];
  store.upsertAsset(asset('duplicate', 'a', 'D:/duplicate.pdf'), [
    ...refs('duplicate'), { ...refs('duplicate')[0], referenceId: 'duplicate-ref-2', path: 'D:/duplicate-copy.pdf' },
  ]);
  store.upsertAsset(asset('other-student', 'b', 'D:/other-student.pdf', 'student-b'), refs('other-student', 'student-b'));
  const filter = { studentId: 'student-a', duplicateOnly: true };
  const before = store.statisticsSnapshot(filter);
  assert.equal(before.total, 1);
  assert.equal(before.recentTrend.addedTotal, 1);
  assert.equal(before.overallRecentTrend.addedTotal, 1);
  assert.equal(before.overallRecentTrend.referenceTotal, 2);

  store.upsertAsset(asset('unique', 'c', 'D:/unique.pdf'), refs('unique'));
  const after = store.statisticsSnapshot(filter);
  assert.equal(after.total, 1);
  assert.equal(after.recentTrend.addedTotal, 1);
  assert.equal(after.overallRecentTrend.addedTotal, 2);
  assert.equal(after.overallRecentTrend.referenceTotal, 3);
  assert.ok(after.generation > before.generation);
  assert.equal(after.overallRecentTrend.asOf, after.asOf);
});

test('renderer subscribes to committed changes and rejects stale list generations', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.cjs'), 'utf8');
  const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.tsx'), 'utf8');
  assert.match(main, /bridge:getAssetStatisticsSnapshot/);
  assert.match(main, /asset-index:changed/);
  assert.match(main, /assetStore\(\)\.statisticsState\(\)/);
  assert.match(preload, /onAssetIndexChanged\(callback\)/);
  assert.match(preload, /asset-index:changed/);
  assert.match(ui, /assetStatisticsGenerationRef/);
  assert.match(ui, /snapshot\.generation !== page\.generation/);
  assert.match(ui, /snapshot\.generation < assetStatisticsGenerationRef\.current/);
});
