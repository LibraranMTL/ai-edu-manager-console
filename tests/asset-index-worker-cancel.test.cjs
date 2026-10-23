const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Worker } = require('node:worker_threads');

test('asset rebuild worker accepts cancellation while enumerating', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-asset-worker-cancel-'));
  for (let index = 0; index < 300; index += 1) fs.mkdirSync(path.join(root, `folder-${index}`));
  const worker = new Worker(path.join(__dirname, '../electron/asset-index-worker.cjs'));
  t.after(async () => {
    await worker.terminate().catch(() => {});
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const result = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('worker cancellation timed out')), 3000);
    worker.on('message', message => {
      if (message.type === 'cancelled') { clearTimeout(timeout); resolve(message); }
      if (message.type === 'error') { clearTimeout(timeout); reject(new Error(message.message)); }
    });
    worker.on('error', reject);
  });
  worker.postMessage({ type: 'start', roots: [{ path: root, maxDepth: 8, context: {} }] });
  setTimeout(() => worker.postMessage({ type: 'cancel' }), 5);
  const cancelled = await result;
  assert.equal(cancelled.type, 'cancelled');
});
