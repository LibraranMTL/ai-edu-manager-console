const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');

function expectedContentSha256(value) {
  const expected = String(value || '').trim().toLowerCase();
  if (expected && !/^[a-f0-9]{64}$/.test(expected)) throw new Error('上传内容 SHA-256 无效。');
  return expected;
}

async function hashRequestBody(request, options = {}) {
  const maxBytes = Number(options.maxBytes || 0);
  const expectedBytes = Number(options.expectedBytes || 0);
  if (!maxBytes || expectedBytes > maxBytes) throw new Error('上传大小限制无效。');
  const sha1 = crypto.createHash('sha1'), sha256 = crypto.createHash('sha256');
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('上传文件过大。');
    sha1.update(chunk); sha256.update(chunk);
  }
  if (expectedBytes && size !== expectedBytes) throw new Error('上传内容不完整。');
  return { size, sha1: sha1.digest('hex'), sha256: sha256.digest('hex') };
}

async function streamRequestToFile(request, options = {}) {
  const requestedTargetPath = String(options.targetPath || '').trim();
  const targetPath = requestedTargetPath ? path.resolve(requestedTargetPath) : '';
  const maxBytes = Number(options.maxBytes || 0);
  const expectedBytes = Number(options.expectedBytes || 0);
  const hashAlgorithm = String(options.hashAlgorithm || 'sha1').toLowerCase();
  const expectedSha256 = expectedContentSha256(options.expectedSha256);
  if (!targetPath || !maxBytes) throw new Error('上传目标或大小限制无效。');
  if (expectedBytes > maxBytes) throw new Error('上传文件过大。');

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.uploading`;
  if (!crypto.getHashes().includes(hashAlgorithm)) throw new Error('上传摘要算法无效。');
  const hash = crypto.createHash(hashAlgorithm);
  const contentHash = crypto.createHash('sha256');
  let size = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.length;
      if (size > maxBytes) {
        callback(new Error('上传文件过大。'));
        return;
      }
      hash.update(chunk);
      contentHash.update(chunk);
      callback(null, chunk);
    },
  });

  try {
    await pipeline(request, limiter, fs.createWriteStream(temporaryPath, { flags: 'wx' }));
    if (expectedBytes && size !== expectedBytes) throw new Error('上传内容不完整。');
    const sha256 = contentHash.digest('hex');
    if (expectedSha256 && sha256 !== expectedSha256) throw new Error('上传内容 SHA-256 与请求声明不一致。');
    fs.renameSync(temporaryPath, targetPath);
    const digest = hash.digest('hex');
    return { path: targetPath, size, digest, [hashAlgorithm]: digest, sha256 };
  } catch (error) {
    try { fs.rmSync(temporaryPath, { force: true }); } catch {}
    throw error;
  }
}

module.exports = { expectedContentSha256, hashRequestBody, streamRequestToFile };
