const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const test = require('node:test');
const { streamRequestToFile } = require('../electron/streaming-upload.cjs');

test('raw uploads stream to disk and calculate sha1 incrementally', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-stream-upload-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const targetPath = path.join(root, 'student', 'notes.txt');
  const content = Buffer.from('streamed education material');
  const result = await streamRequestToFile(Readable.from([content.subarray(0, 8), content.subarray(8)]), {
    targetPath,
    maxBytes: 1024,
    expectedBytes: content.length,
  });
  assert.equal(fs.readFileSync(targetPath, 'utf8'), content.toString('utf8'));
  assert.equal(result.size, content.length);
  assert.equal(result.sha1, crypto.createHash('sha1').update(content).digest('hex'));
});

test('oversized or incomplete uploads leave no target or temporary file', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-stream-limit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const oversizedTarget = path.join(root, 'oversized.bin');
  await assert.rejects(
    streamRequestToFile(Readable.from([Buffer.alloc(12)]), { targetPath: oversizedTarget, maxBytes: 10 }),
    /上传文件过大/,
  );
  const incompleteTarget = path.join(root, 'incomplete.bin');
  await assert.rejects(
    streamRequestToFile(Readable.from([Buffer.alloc(4)]), { targetPath: incompleteTarget, maxBytes: 10, expectedBytes: 8 }),
    /上传内容不完整/,
  );
  assert.equal(fs.existsSync(oversizedTarget), false);
  assert.equal(fs.existsSync(incompleteTarget), false);
  assert.deepEqual(fs.readdirSync(root), []);
});
