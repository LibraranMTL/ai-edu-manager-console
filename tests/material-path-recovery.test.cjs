const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  compactActiveMaterialRecords,
  inventoryRawFiles,
  resolveStudentMaterialPaths,
  selectDigestBatchFiles,
} = require('../electron/material-path-recovery.cjs');

function fixture() { return fs.mkdtempSync(path.join(os.tmpdir(), 'edu-material-recovery-')); }
function sha1(value) { return crypto.createHash('sha1').update(value).digest('hex'); }
function material(id, fileName, content, absolutePath) {
  return { id, fileName, path: absolutePath, absolutePath, size: Buffer.byteLength(content), sha1: sha1(content), status: 'pending_digest' };
}

test('repairs a moved material only when the unique current-root file has the same hash', () => {
  const root = fixture();
  const current = path.join(root, '课程截图', '页面.jpg');
  fs.mkdirSync(path.dirname(current), { recursive: true });
  fs.writeFileSync(current, 'same-image-bytes');
  const result = resolveStudentMaterialPaths({
    rawRoot: root,
    materials: [material('m1', '页面.jpg', 'same-image-bytes', 'D:\\old\\页面.jpg')],
    nowMs: Date.now() + 5_000,
  });
  assert.equal(result.repaired.length, 1);
  assert.equal(result.blocked.length, 0);
  assert.equal(result.repaired[0].relativePath, '课程截图/页面.jpg');
  assert.equal(result.repaired[0].absolutePath, fs.realpathSync(current));
});

test('keeps missing, unstable, hash-mismatched and ambiguous materials out of the resolved set', () => {
  const root = fixture();
  const recent = path.join(root, 'recent.jpg');
  const mismatch = path.join(root, 'mismatch.jpg');
  const duplicateA = path.join(root, 'a', 'duplicate.jpg');
  const duplicateB = path.join(root, 'b', 'duplicate.jpg');
  fs.mkdirSync(path.dirname(duplicateA), { recursive: true });
  fs.mkdirSync(path.dirname(duplicateB), { recursive: true });
  fs.writeFileSync(recent, 'recent');
  fs.writeFileSync(mismatch, 'different');
  fs.writeFileSync(duplicateA, 'duplicate');
  fs.writeFileSync(duplicateB, 'duplicate');
  const settledAt = new Date(Date.now() - 10_000);
  fs.utimesSync(mismatch, settledAt, settledAt);
  fs.utimesSync(duplicateA, settledAt, settledAt);
  fs.utimesSync(duplicateB, settledAt, settledAt);
  const result = resolveStudentMaterialPaths({
    rawRoot: root,
    materials: [
      material('missing', 'missing.jpg', 'missing', 'D:\\old\\missing.jpg'),
      material('recent', 'recent.jpg', 'recent', recent),
      material('mismatch', 'mismatch.jpg', 'expected', mismatch),
      material('duplicate', 'duplicate.jpg', 'duplicate', 'D:\\old\\duplicate.jpg'),
    ],
    nowMs: Date.now(),
  });
  assert.equal(result.resolved.length, 0);
  assert.deepEqual(new Set(result.blocked.map((item) => item.code)), new Set(['missing', 'unstable', 'ambiguous']));
});

test('does not follow a symlink outside the exact student raw root', { skip: process.platform === 'win32' }, () => {
  const root = fixture();
  const outside = fixture();
  const secret = path.join(outside, 'other-student.jpg');
  fs.writeFileSync(secret, 'other-student');
  fs.symlinkSync(secret, path.join(root, 'linked.jpg'));
  const inventory = inventoryRawFiles(root);
  assert.equal(inventory.length, 0);
});

test('a stale discovery cache cannot hide a second same-hash candidate', () => {
  const root = fixture();
  const first = path.join(root, 'old-name.jpg');
  const second = path.join(root, 'new-name.jpg');
  fs.writeFileSync(first, 'same-content');
  fs.writeFileSync(second, 'same-content');
  const settledAt = new Date(Date.now() - 10_000);
  fs.utimesSync(first, settledAt, settledAt);
  fs.utimesSync(second, settledAt, settledAt);
  const stat = fs.statSync(first);
  const result = resolveStudentMaterialPaths({
    rawRoot: root,
    materials: [material('cached', 'missing-name.jpg', 'same-content', 'D:\\old\\missing-name.jpg')],
    discoveryState: { entries: { 'old-name.jpg': { sha1: sha1('same-content'), fingerprint: `${stat.size}:${Math.floor(stat.mtimeMs)}` } } },
    nowMs: Date.now(),
  });
  assert.equal(result.resolved.length, 0);
  assert.equal(result.blocked[0]?.code, 'ambiguous');
});

test('selects bounded digest batches without dropping deferred files', () => {
  const resolved = [...Array.from({ length: 475 }, (_, index) => ({ materialId: `m${index}`, size: 1024 })), { materialId: 'oversized', size: 600 * 1024 * 1024 }];
  const result = selectDigestBatchFiles(resolved, { maxFiles: 100, maxBytes: 512 * 1024 * 1024 });
  assert.equal(result.selected.length, 100);
  assert.equal(result.deferred.length, 375);
  assert.equal(result.oversized.length, 1);
  assert.equal(result.selectedBytes, 100 * 1024);
});

test('persistence compaction retains every active record beyond the old 200 and 1000 caps', () => {
  const active = Array.from({ length: 1_205 }, (_, index) => ({ id: `active-${index}`, status: 'pending_digest' }));
  const terminal = Array.from({ length: 20 }, (_, index) => ({ id: `done-${index}`, status: 'processed', statusUpdatedAt: String(index).padStart(2, '0') }));
  const result = compactActiveMaterialRecords([...terminal, ...active], { terminalLimit: 5 });
  assert.equal(result.filter((item) => item.status === 'pending_digest').length, 1_205);
  assert.equal(result.filter((item) => item.status === 'processed').length, 5);
});
