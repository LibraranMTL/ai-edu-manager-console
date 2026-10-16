'use strict';
// Electron RUN_AS_NODE only: never launch main.cjs or open real student storage.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
async function run() {
  const archive = path.resolve(process.argv[2]);
  const source = path.resolve(process.argv[3]);
  assert.equal(path.basename(archive), 'app.asar');
  const files = ['main.cjs', 'preload.cjs', 'task-store-guard.cjs', 'task-resolution.cjs', 'task-read-model.cjs',
    'task-runtime-policy.cjs', 'task-history-policy.cjs', 'workbuddy-runtime.cjs'];
  const digest = value => crypto.createHash('sha256').update(value).digest('hex');
  for (const file of files) assert.equal(digest(fs.readFileSync(path.join(archive, 'electron', file))),
    digest(fs.readFileSync(path.join(source, 'electron', file))), `Packaged source mismatch: ${file}`);
  const { createTaskIoClient } = require(path.join(archive, 'electron/task-io-client.cjs'));
  const { createTaskStoreGuard } = require(path.join(archive, 'electron/task-store-guard.cjs'));
  const { workBuddyReadyResult } = require(path.join(archive, 'electron/workbuddy-runtime.cjs'));
  assert.equal(workBuddyReadyResult('{"result":"READY"}'), true);
  assert.equal(workBuddyReadyResult('startup log'), false);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-feedback-package-'));
  const client = createTaskIoClient();
  try {
    const file = path.join(root, 'tasks.json');
    fs.writeFileSync(file, JSON.stringify({ tasks: [{ id: 'synthetic', status: 'cancelled', recoveryState: 'unknown', executionId: 'old' }], history: [] }));
    const result = await client.request(file, 'detail', { id: 'synthetic' });
    assert.equal(result.task.resolution.kind, 'unknown');
    assert.equal(result.task.occupiesExecutionSlot, false);
    fs.writeFileSync(file, '{broken');
    const guard = createTaskStoreGuard();
    assert.throws(() => guard.read(file)); assert(guard.status());
    console.log(JSON.stringify({ ok: true, electron: process.versions.electron, sourceFilesMatched: files.length,
      packagedWorker: true, faultProtection: true, strictReady: true, realStudentAccess: false }));
  } finally { client.close(); fs.rmSync(root, { recursive: true, force: true }); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
