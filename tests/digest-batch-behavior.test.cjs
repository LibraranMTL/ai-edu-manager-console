const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { DIGEST_BATCH_SCHEMA, buildDigestBatch, digestIdempotencyKey, readDigestBatch, writeJsonAtomic } = require('../electron/digest-batch.cjs');

const HASH_A = 'a'.repeat(40);
const HASH_B = 'b'.repeat(40);

test('buildDigestBatch freezes normalized files and stable idempotency key', () => {
  const scope = { type: 'student', id: 's1', name: '学生甲' };
  const files = [
    { id: 'm2', relativePath: '原始资料\\b.pdf', sha1: HASH_B, size: 20 },
    { id: 'm1', relativePath: './原始资料/a.pdf', sha1: HASH_A, size: 10 },
  ];
  const batch = buildDigestBatch({ scope, files, batchId: 'digest-1', createdAt: '2026-07-22T00:00:00.000Z' });
  assert.equal(batch.schema, DIGEST_BATCH_SCHEMA);
  assert.deepEqual(batch.files.map((file) => file.relativePath), ['原始资料/b.pdf', '原始资料/a.pdf']);
  assert.equal(batch.idempotencyKey, digestIdempotencyKey(scope, files));
  assert.match(batch.idempotencyKey, /^digest:student:s1:[a-f0-9]{40}$/);
});

test('buildDigestBatch rejects empty and non-hashed batches', () => {
  assert.throws(() => buildDigestBatch({ scope: { type: 'student', id: 's1' }, files: [] }), /空消化批次/);
  assert.throws(() => buildDigestBatch({ scope: { type: 'student', id: 's1' }, files: [{ id: 'm1', relativePath: 'a.pdf', sha1: '' }] }), /SHA-1/);
});

test('digest batch atomic persistence round-trips', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-digest-batch-'));
  const file = path.join(dir, 'digest-batch.json');
  const batch = buildDigestBatch({ scope: { type: 'project', id: 'p1' }, files: [{ id: 'm1', relativePath: 'a.pdf', sha1: HASH_A }] });
  writeJsonAtomic(file, batch);
  assert.deepEqual(readDigestBatch(file), batch);
  const updated = { ...batch, status: 'completed', completedAt: '2026-07-22T01:00:00.000Z' };
  writeJsonAtomic(file, updated);
  assert.deepEqual(readDigestBatch(file), updated);
  assert.deepEqual(fs.readdirSync(dir), ['digest-batch.json']);
  fs.rmSync(dir, { recursive: true, force: true });
});
