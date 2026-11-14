'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { extract } = require('./material-index-worker.cjs');

test('plain text originals are indexed only when their bytes match the recorded source', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'material-index-text-'));
  const objectPath = path.join(dir, 'synthetic.txt');
  const bytes = Buffer.from('合成学习资料\n');
  try {
    await fs.writeFile(objectPath, bytes);
    const job = { objectPath, byteSize: bytes.length, contentType: 'text/plain', contentSha256: crypto.createHash('sha256').update(bytes).digest('hex') };
    assert.equal((await extract(job)).text, '合成学习资料');
    await assert.rejects(extract({ ...job, contentSha256: '0'.repeat(64) }), /指纹不符/);
    await assert.rejects(extract({ ...job, contentType: 'application/octet-stream' }), /不支持/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
