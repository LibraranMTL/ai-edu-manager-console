const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');

async function streamRequestToFile(request, options = {}) {
  const requestedTargetPath = String(options.targetPath || '').trim();
  const targetPath = requestedTargetPath ? path.resolve(requestedTargetPath) : '';
  const maxBytes = Number(options.maxBytes || 0);
  const expectedBytes = Number(options.expectedBytes || 0);
  const hashAlgorithm = String(options.hashAlgorithm || 'sha1').toLowerCase();
  if (!targetPath || !maxBytes) throw new Error('上传目标或大小限制无效。');
  if (expectedBytes > maxBytes) throw new Error('上传文件过大。');

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.uploading`;
  if (!crypto.getHashes().includes(hashAlgorithm)) throw new Error('上传摘要算法无效。');
  const hash = crypto.createHash(hashAlgorithm);
  let size = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.length;
      if (size > maxBytes) {
        callback(new Error('上传文件过大。'));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });

  try {
    await pipeline(request, limiter, fs.createWriteStream(temporaryPath, { flags: 'wx' }));
    if (expectedBytes && size !== expectedBytes) throw new Error('上传内容不完整。');
    fs.renameSync(temporaryPath, targetPath);
    const digest = hash.digest('hex');
    return { path: targetPath, size, digest, [hashAlgorithm]: digest };
  } catch (error) {
    try { fs.rmSync(temporaryPath, { force: true }); } catch {}
    throw error;
  }
}

module.exports = { streamRequestToFile };
