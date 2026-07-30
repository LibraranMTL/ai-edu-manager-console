const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createSyncManifest,
  createTombstone,
  ensureCollaborationLayout,
  fileLooksStable,
  forbiddenSyncPath,
  importDisposition,
  isSyncthingConflict,
  sha256File,
  validateSyncManifest,
  verifyManifestFiles,
} = require('../electron/collaboration-sync.cjs');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'edu-collaboration-'));
}

test('controlled collaboration layout isolates writable node namespaces', () => {
  const root = tempDir();
  const layout = ensureCollaborationLayout(root, 'node-a');
  for (const key of ['outbox', 'inbox', 'receipts', 'quarantine', 'trash', 'snapshots']) {
    assert.equal(fs.statSync(layout[key]).isDirectory(), true);
    assert.equal(layout[key].startsWith(path.join(root, 'node-a')), true);
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test('sync manifests require completion, target identity, safe paths and sha256', () => {
  const valid = createSyncManifest({
    sourceNodeId: 'node-a',
    targetNodeId: 'node-b',
    completedAt: '2026-07-24T10:00:00.000Z',
    files: [{
      objectId: 'asset-1',
      relativePath: 'content/course.pdf',
      sha256: 'a'.repeat(64),
      size: 10,
    }],
  });
  assert.equal(validateSyncManifest(valid, { targetNodeId: 'node-b' }).ok, true);
  assert.equal(validateSyncManifest({ ...valid, completedAt: '' }, { targetNodeId: 'node-b' }).ok, false);
  assert.equal(validateSyncManifest(valid, { targetNodeId: 'node-c' }).ok, false);
  assert.equal(validateSyncManifest({
    ...valid,
    files: [{ ...valid.files[0], relativePath: '../tasks.json' }],
  }, { targetNodeId: 'node-b' }).ok, false);
});

test('manifest content is not accepted before size and hash verification', () => {
  const root = tempDir();
  fs.mkdirSync(path.join(root, 'content'), { recursive: true });
  const filePath = path.join(root, 'content', 'course.txt');
  fs.writeFileSync(filePath, 'verified content', 'utf8');
  const manifest = createSyncManifest({
    sourceNodeId: 'node-a',
    targetNodeId: 'node-b',
    completedAt: new Date().toISOString(),
    files: [{
      objectId: 'asset-1',
      relativePath: 'content/course.txt',
      sha256: sha256File(filePath),
      size: fs.statSync(filePath).size,
    }],
  });
  assert.deepEqual(verifyManifestFiles(manifest, root).map((item) => item.code), ['VERIFIED']);
  fs.appendFileSync(filePath, ' changed', 'utf8');
  assert.equal(verifyManifestFiles(manifest, root)[0].ok, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('duplicate, stale, conflicting and forbidden objects never become duplicate assets', () => {
  const file = { objectId: 'asset-1', version: 2, sha256: 'b'.repeat(64), relativePath: 'content/file.pdf' };
  assert.equal(importDisposition(file, {}).action, 'import');
  assert.equal(importDisposition(file, { 'asset-1': { version: 2, sha256: file.sha256 } }).action, 'receipt_only');
  assert.equal(importDisposition(file, { 'asset-1': { version: 3, sha256: 'c'.repeat(64) } }).action, 'quarantine');
  assert.equal(importDisposition({ ...file, relativePath: 'content/file.sync-conflict-20260724-120000-ABC.pdf' }, {}).reason, 'sync_conflict');
  assert.equal(forbiddenSyncPath('runtime/tasks.json'), true);
  assert.equal(isSyncthingConflict('file.sync-conflict-20260724-120000-ABC.pdf'), true);
});

test('file stability requires unchanged size and mtime plus minimum age', () => {
  const stat = { size: 100, mtimeMs: 1_000 };
  assert.equal(fileLooksStable(stat, { ...stat }, { nowMs: 3_000, minAgeMs: 1_500 }), true);
  assert.equal(fileLooksStable(stat, { size: 101, mtimeMs: 1_000 }, { nowMs: 3_000 }), false);
  assert.equal(fileLooksStable(stat, { ...stat }, { nowMs: 1_500, minAgeMs: 1_500 }), false);
});

test('remote deletion creates a reviewable tombstone instead of deleting content', () => {
  const tombstone = createTombstone({
    objectId: 'asset-1',
    authorityNodeId: 'node-student',
    requestedByNodeId: 'node-teacher',
    reason: 'teacher requested removal',
  });
  assert.equal(tombstone.status, 'pending_review');
  assert.equal(tombstone.objectId, 'asset-1');
});
