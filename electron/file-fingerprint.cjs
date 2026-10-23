'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');

function sourceChanged(message = '文件在读取期间发生变化，请稍后重试。') {
  return Object.assign(new Error(message), { code: 'source_changed' });
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

async function hashStableFile(file, { copyTo, afterRead, rejectSymbolicLink = false, onStream } = {}) {
  if (rejectSymbolicLink) {
    const linked = await fsp.lstat(file);
    if (!linked.isFile() || linked.isSymbolicLink()) {
      throw Object.assign(new Error('路径不是可读取的普通文件。'), { code: 'linked_path' });
    }
  }
  const handle = await fsp.open(file, 'r');
  let ownsCopy = false;
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw Object.assign(new Error('来源不是普通文件。'), { code: 'not_file' });
    const hashes = { sha256: crypto.createHash('sha256'), sha1: crypto.createHash('sha1') };
    const reader = handle.createReadStream({ autoClose: false });
    onStream?.(reader);
    if (copyTo) {
      const tap = new Transform({ transform(chunk, encoding, callback) {
        hashes.sha256.update(chunk); hashes.sha1.update(chunk); callback(null, chunk);
      } });
      const writer = fs.createWriteStream(copyTo, { flags: 'wx' });
      writer.once('open', () => { ownsCopy = true; });
      await pipeline(reader, tap, writer);
      const copyHandle = await fsp.open(copyTo, 'r+');
      try { await copyHandle.sync(); } finally { await copyHandle.close(); }
    } else {
      for await (const chunk of reader) { hashes.sha256.update(chunk); hashes.sha1.update(chunk); }
    }
    await afterRead?.();
    const after = await handle.stat();
    const current = await fsp.stat(file);
    if (!sameFile(before, after) || !sameFile(before, current)) throw sourceChanged();
    return { sha256: hashes.sha256.digest('hex'), sha1: hashes.sha1.digest('hex'),
      size: before.size, mtimeMs: before.mtimeMs, fileKey: `${before.dev}:${before.ino}` };
  } catch (error) {
    if (copyTo && ownsCopy) await fsp.rm(copyTo, { force: true });
    throw error;
  } finally { await handle.close(); }
}

module.exports = { hashStableFile, sameFile, sourceChanged };
