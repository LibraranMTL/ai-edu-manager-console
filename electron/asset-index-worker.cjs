'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { parentPort } = require('node:worker_threads');

const ALLOWED = new Set(['.jpg','.jpeg','.png','.gif','.webp','.bmp','.pdf','.txt','.md','.doc','.docx','.xls','.xlsx','.ppt','.pptx','.csv','.zip']);
let cancelled = false;
parentPort.on('message', message => { if (message?.type === 'cancel') cancelled = true; });

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const sha1 = crypto.createHash('sha1'), sha256 = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', chunk => { sha1.update(chunk); sha256.update(chunk); });
    stream.on('error', reject);
    stream.on('end', () => resolve({ sha1: sha1.digest('hex'), sha256: sha256.digest('hex') }));
  });
}

function enumerate(root, maxDepth = 8) {
  const files = [], queue = [{ directory: root, depth: 0 }];
  while (queue.length && !cancelled) {
    const { directory, depth } = queue.shift();
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { if (depth < maxDepth) queue.push({ directory: candidate, depth: depth + 1 }); continue; }
      if (entry.isFile() && ALLOWED.has(path.extname(entry.name).toLowerCase())) files.push(candidate);
    }
  }
  return files;
}

async function run(roots) {
  const files = [];
  for (const root of roots) {
    for (const file of enumerate(root.path, root.maxDepth)) files.push({ file, root });
    parentPort.postMessage({ type: 'progress', phase: 'enumerating', discovered: files.length });
  }
  const discovered = files.length;
  parentPort.postMessage({ type: 'progress', phase: 'hashing', discovered });
  let processed = 0, skipped = 0, failed = 0, batch = [];
  for (const { file, root } of files) {
      if (cancelled) {
        parentPort.postMessage({ type: 'cancelled', discovered, processed, skipped, failed });
        parentPort.close();
        return;
      }
      try {
        const before = fs.statSync(file);
        const hashes = await hashFile(file);
        const after = fs.statSync(file);
        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || `${before.dev}:${before.ino}` !== `${after.dev}:${after.ino}`) { skipped += 1; continue; }
        batch.push({ file, context: root.context, fingerprint: { ...hashes, size: after.size, mtimeMs: after.mtimeMs, fileKey: `${after.dev}:${after.ino}` } });
        processed += 1;
        if (batch.length >= 250) { parentPort.postMessage({ type: 'batch', batch, discovered, processed, skipped, failed, currentPath: file }); batch = []; }
      } catch (error) { failed += 1; parentPort.postMessage({ type: 'file-error', file, message: error.message, discovered, processed, skipped, failed }); }
  }
  if (batch.length) parentPort.postMessage({ type: 'batch', batch, discovered, processed, skipped, failed, currentPath: batch.at(-1).file });
  parentPort.postMessage({ type: 'completed', discovered, processed, skipped, failed });
  parentPort.close();
}

parentPort.once('message', message => {
  if (message?.type !== 'start') return;
  run(Array.isArray(message.roots) ? message.roots : []).catch(error => {
    parentPort.postMessage({ type: 'error', message: error.message });
    parentPort.close();
  });
});
