'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const { parentPort } = require('node:worker_threads');
const { hashStableFile } = require('./file-fingerprint.cjs');

const ALLOWED = new Set(['.jpg','.jpeg','.png','.gif','.webp','.bmp','.pdf','.txt','.md','.doc','.docx','.xls','.xlsx','.ppt','.pptx','.csv','.zip']);
const BATCH_SIZE = 250;
let cancelled = false;
let started = false;
let activeStream = null;
let nextBatchId = 0;
const batchWaiters = new Map();

function cancellationError() {
  return Object.assign(new Error('资产索引补建已取消。'), { code: 'asset_scan_cancelled' });
}

parentPort.on('message', message => {
  if (message?.type === 'cancel') {
    cancelled = true;
    if (activeStream) activeStream.destroy(cancellationError());
    for (const waiter of batchWaiters.values()) waiter.reject(cancellationError());
    batchWaiters.clear();
    return;
  }
  if (message?.type === 'batch-ack') {
    const waiter = batchWaiters.get(String(message.batchId));
    if (waiter) { batchWaiters.delete(String(message.batchId)); waiter.resolve(); }
    return;
  }
  if (message?.type === 'start' && !started) {
    started = true;
    run(Array.isArray(message.roots) ? message.roots : []).catch(error => {
      parentPort.postMessage({ type: error.code === 'asset_scan_cancelled' ? 'cancelled' : 'error', message: error.message });
      parentPort.close();
    });
  }
});

async function* enumerate(root, maxDepth = 8) {
  const queue = [{ directory: root, depth: 0 }];
  for (let cursor = 0; cursor < queue.length && !cancelled; cursor += 1) {
    const { directory, depth } = queue[cursor];
    let entries;
    try { entries = await fsp.readdir(directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (cancelled) throw cancellationError();
      const candidate = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (depth < maxDepth) queue.push({ directory: candidate, depth: depth + 1 });
        continue;
      }
      if (entry.isFile() && ALLOWED.has(path.extname(entry.name).toLowerCase())) yield candidate;
    }
    if (cursor % 25 === 0) await new Promise(resolve => setImmediate(resolve));
  }
}

function sendBatch(batch, progress) {
  const batchId = String(++nextBatchId);
  parentPort.postMessage({ type: 'batch', batchId, batch, ...progress });
  return new Promise((resolve, reject) => batchWaiters.set(batchId, { resolve, reject }));
}

async function run(roots) {
  let discovered = 0, processed = 0, skipped = 0, failed = 0, batch = [];
  for (const root of roots) {
    parentPort.postMessage({ type: 'progress', phase: 'enumerating', discovered, processed, skipped, failed,
      currentPath: root.path, currentScopeType: root.context?.spaceType || '',
      currentScopeId: root.context?.studentId || root.context?.projectId || '',
      currentScopeName: root.context?.studentName || root.context?.projectName || '' });
    for await (const file of enumerate(root.path, root.maxDepth)) {
      if (cancelled) throw cancellationError();
      discovered += 1;
      try {
        const fingerprint = await hashStableFile(file, { onStream: stream => { activeStream = stream; } });
        activeStream = null;
        batch.push({ file, context: root.context, fingerprint });
        processed += 1;
        if (batch.length >= BATCH_SIZE) {
          const outgoing = batch;
          batch = [];
          await sendBatch(outgoing, { discovered, processed, skipped, failed, currentPath: file });
        } else if (discovered % 25 === 0) {
          parentPort.postMessage({ type: 'progress', phase: 'hashing', discovered, processed, skipped, failed, currentPath: file });
        }
      } catch (error) {
        activeStream = null;
        if (cancelled || error.code === 'asset_scan_cancelled') throw cancellationError();
        if (error.code === 'source_changed') {
          skipped += 1;
          parentPort.postMessage({ type: 'progress', phase: 'hashing', discovered, processed, skipped, failed, currentPath: file });
          continue;
        }
        failed += 1;
        parentPort.postMessage({ type: 'file-error', file, message: error.message, discovered, processed, skipped, failed });
      }
    }
  }
  if (batch.length) await sendBatch(batch, { discovered, processed, skipped, failed, currentPath: batch.at(-1).file });
  parentPort.postMessage({ type: 'completed', discovered, processed, skipped, failed });
  parentPort.close();
}
