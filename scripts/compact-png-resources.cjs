'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const signature = Buffer.from('89504e470d0a1a0a', 'hex');
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunksOf(bytes) {
  if (!bytes.subarray(0, 8).equals(signature)) throw new Error('Invalid PNG signature');
  const chunks = [];
  for (let offset = 8; offset < bytes.length;) {
    if (offset + 12 > bytes.length) throw new Error('Truncated PNG chunk');
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length;
    if (end > bytes.length) throw new Error('Truncated PNG data');
    const chunk = bytes.subarray(offset, end);
    if (crc32(chunk.subarray(4, -4)) !== chunk.readUInt32BE(chunk.length - 4)) throw new Error('Invalid PNG CRC');
    chunks.push({ type: chunk.toString('ascii', 4, 8), bytes: chunk, data: chunk.subarray(8, -4) });
    offset = end;
    if (chunks[chunks.length - 1].type === 'IEND') {
      // Some source assets carry an opaque trailer; preserve it byte-for-byte.
      if (offset < bytes.length) chunks.push({ type: 'trailer', bytes: bytes.subarray(offset), data: bytes.subarray(offset) });
      return chunks;
    }
  }
  throw new Error('Missing PNG end chunk');
}
function compactPng(bytes) {
  const chunks = chunksOf(bytes), imageChunks = chunks.filter(c => c.type === 'IDAT');
  if (!imageChunks.length) throw new Error('Missing PNG image data');
  const first = chunks.findIndex(c => c.type === 'IDAT');
  if (chunks.slice(first, first + imageChunks.length).some(c => c.type !== 'IDAT')) throw new Error('Nonconsecutive PNG image chunks');
  const raw = zlib.inflateSync(Buffer.concat(imageChunks.map(c => c.data)), { maxOutputLength: 64 * 1024 * 1024 });
  const compressed = zlib.deflateSync(raw, { level: 9 });
  const replacement = Buffer.alloc(compressed.length + 12);
  replacement.writeUInt32BE(compressed.length, 0); replacement.write('IDAT', 4, 'ascii');
  compressed.copy(replacement, 8);
  replacement.writeUInt32BE(crc32(replacement.subarray(4, -4)), replacement.length - 4);
  let inserted = false;
  const result = Buffer.concat([signature, ...chunks.flatMap(chunk => {
    if (chunk.type !== 'IDAT') return [chunk.bytes];
    if (inserted) return [];
    inserted = true; return [replacement];
  })]);
  // Check encoded scanlines and every non-image chunk, not just visual similarity.
  const verified = chunksOf(result);
  if (!zlib.inflateSync(Buffer.concat(verified.filter(c => c.type === 'IDAT').map(c => c.data))).equals(raw)
      || !Buffer.concat(verified.filter(c => c.type !== 'IDAT').map(c => c.bytes))
        .equals(Buffer.concat(chunks.filter(c => c.type !== 'IDAT').map(c => c.bytes)))) {
    throw new Error('Lossless PNG verification failed');
  }
  return result.length < bytes.length ? result : bytes;
}
function compactPngResources(root) {
  const audit = { filesChanged: 0, bytesSaved: 0, scanlinesAndMetadataVerified: true };
  for (const name of fs.readdirSync(root, { recursive: true })) {
    const target = path.join(root, name);
    if (!name.endsWith('.png') || !fs.statSync(target).isFile()) continue;
    const before = fs.readFileSync(target), after = compactPng(before);
    if (after.length < before.length) {
      fs.writeFileSync(target, after); audit.filesChanged++; audit.bytesSaved += before.length - after.length;
    }
  }
  return audit;
}
module.exports = { compactPng, compactPngResources, chunksOf, crc32 };
