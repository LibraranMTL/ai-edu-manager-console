const assert = require('node:assert/strict');
const test = require('node:test');

const {
  mergeMaterialFromUpload,
  reconcileCompletedMaterialRevisions,
} = require('../electron/material-ledger-reconciliation.cjs');

test('capture updates refresh fingerprints while preserving a repaired physical path', () => {
  const merged = mergeMaterialFromUpload({
    id: 'capture-1',
    path: 'repaired/capture.md',
    absolutePath: 'D:\\student\\repaired\\capture.md',
    size: 10,
    sha1: 'old',
    status: 'pending_digest',
    pathRepair: { method: 'manual_verified_selection' },
  }, {
    id: 'capture-1',
    path: 'original/capture.md',
    absolutePath: 'D:\\student\\original\\capture.md',
    size: 20,
    sha1: 'new',
    status: 'pending_digest',
    captureBundleId: 'bundle-final',
  });

  assert.equal(merged.path, 'repaired/capture.md');
  assert.equal(merged.absolutePath, 'D:\\student\\repaired\\capture.md');
  assert.equal(merged.size, 20);
  assert.equal(merged.sha1, 'new');
  assert.equal(merged.captureBundleId, 'bundle-final');
  assert.equal(merged.pathRepair.method, 'manual_verified_selection');
});

test('a completed filesystem revision settles its matching capture record and audit row', () => {
  const materials = [
    { id: 'fs-final', revisionOf: 'capture-1', path: 'screen/capture.md', sha1: 'final-sha', status: 'processed', statusUpdatedAt: '2026-09-23T00:28:49.600Z', digestedAt: '2026-09-23T00:28:49.600Z', digestBatchId: 'batch-1' },
    { id: 'capture-1', path: 'screen/capture.md', sha1: 'final-sha', status: 'pending_digest' },
  ];
  const uploads = [{ id: 'capture-1', path: 'D:\\student\\screen\\capture.md', sha1: 'final-sha', status: 'pending_digest' }];
  const result = reconcileCompletedMaterialRevisions(materials, uploads);

  assert.equal(result.reconciled.length, 1);
  assert.equal(result.materials[1].status, 'ignored');
  assert.equal(result.materials[1].digestDisposition, 'superseded');
  assert.equal(result.materials[1].supersededBy, 'fs-final');
  assert.equal(result.materials[1].digestBatchId, 'batch-1');
  assert.equal(result.uploadRecords[0].status, 'ignored');
  assert.equal(result.uploadRecords[0].supersededBy, 'fs-final');
});

test('a revision with different content never settles the earlier material', () => {
  const result = reconcileCompletedMaterialRevisions([
    { id: 'fs-final', revisionOf: 'capture-1', path: 'screen/capture.md', sha1: 'new-sha', status: 'processed' },
    { id: 'capture-1', path: 'screen/capture.md', sha1: 'old-sha', status: 'pending_digest' },
  ], [{ id: 'capture-1', sha1: 'old-sha', status: 'pending_digest' }]);

  assert.equal(result.reconciled.length, 0);
  assert.equal(result.materials[1].status, 'pending_digest');
  assert.equal(result.uploadRecords[0].status, 'pending_digest');
});
