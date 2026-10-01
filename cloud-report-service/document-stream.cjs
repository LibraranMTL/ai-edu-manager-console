'use strict';
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
async function receiveDocument(req, prepared, maxBytes, verifyHash) {
  const length = req.headers['content-length'];
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    req.resume(); throw Object.assign(new Error('文件大小无效'), { status: 413 });
  }
  let handle;
  let size = 0;
  let head = Buffer.alloc(0);
  const hash = crypto.createHash('sha256');
  try {
    handle = await fs.open(prepared.tempPath, 'wx', 0o600);
    for await (const chunk of req) {
      size += chunk.length;
      if (size > maxBytes) throw Object.assign(new Error('文件超过大小限制'), { status: 413 });
      if (head.length < 8) head = Buffer.concat([head, chunk.subarray(0, 8 - head.length)]);
      hash.update(chunk);
      await handle.writeFile(chunk);
    }
    await handle.sync(); await handle.close(); handle = null;
    const sha = hash.digest('hex');
    verifyHash(sha);
    return prepared.commit({ sha, size, head });
  } finally {
    await handle?.close();
    await fs.rm(prepared.tempPath, { force: true });
  }
}
module.exports = { receiveDocument };
