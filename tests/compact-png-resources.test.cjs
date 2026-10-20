'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { compactPng, chunksOf } = require('../scripts/compact-png-resources.cjs');
for (const name of ['robogala-hands.png', 'robogala-round.png', 'robogala-wordmark.png']) {
  test(`lossless PNG compaction preserves all scanlines and metadata: ${name}`, () => {
    const before = fs.readFileSync(path.join(__dirname, '../public/brand', name));
    const after = compactPng(before), a = chunksOf(before), b = chunksOf(after);
    assert.ok(after.length < before.length);
    const raw = chunks => zlib.inflateSync(Buffer.concat(chunks.filter(c => c.type === 'IDAT').map(c => c.data)));
    assert.deepEqual(raw(a), raw(b));
    assert.deepEqual(a.filter(c => c.type !== 'IDAT'), b.filter(c => c.type !== 'IDAT'));
    assert.deepEqual(compactPng(after), after);
  });
}
test('PNG optimizer rejects corrupt input instead of silently altering assets', () => {
  assert.throws(() => compactPng(Buffer.from('not png')), /signature/);
  const original = fs.readFileSync(path.join(__dirname, '../public/brand/robogala-hands.png'));
  assert.throws(() => compactPng(original.subarray(0, 100)), /Truncated/);
  const corrupt = Buffer.from(original); corrupt[25] ^= 1;
  assert.throws(() => compactPng(corrupt), /CRC/);
});
