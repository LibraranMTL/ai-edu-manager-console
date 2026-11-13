'use strict';
// Packaged Electron RUN_AS_NODE smoke test; never start main.cjs or use real student data.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
async function run() {
  const archive = path.resolve(process.argv[2]), source = path.resolve(process.argv[3]);
  assert.equal(path.basename(archive), 'app.asar');
  const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const files = ['main.cjs', 'task-store-guard.cjs', 'task-recovery-policy.cjs', 'task-retry-queue.cjs', 'task-read-model.cjs'];
  for (const name of files) assert.equal(hash(await fs.readFile(path.join(archive, 'electron', name))), hash(await fs.readFile(path.join(source, 'electron', name))));
  const { taskRetryDecision, taskRetryEligible, reconcileInterruptedExecutions } = require(path.join(archive, 'electron/task-recovery-policy.cjs'));
  const { createTaskIoClient } = require(path.join(archive, 'electron/task-io-client.cjs'));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-recovery-package-'));
  const client = createTaskIoClient();
  try {
    const waiting = { id: 'wait', sourceId: 'synthetic', sourceType: 'student', attempt: 1, maxAttempts: 3, autoRetry: true, executionId: 'e1', status: 'failed' };
    Object.assign(waiting, taskRetryDecision(waiting, { code: '503' }, { stopConfirmed: true }));
    assert.equal(taskRetryEligible(JSON.parse(JSON.stringify(waiting)), Infinity), true);
    const interrupted = { ...waiting, id: 'interrupted', status: 'running', executionMode: 'automatic', adapterId: 'codex' };
    const store = { tasks: [waiting, interrupted], history: [] };
    assert.equal(reconcileInterruptedExecutions(store).length, 1);
    const file = path.join(root, 'tasks.json');
    await fs.writeFile(file, JSON.stringify(store));
    // The Worker now requires an explicit SQLite store_open before list;
    // reading the legacy JSON without opening returns ready:false by design.
    const opened = await client.request(file, 'store_open');
    assert.equal(opened.ok, true);
    const result = await client.request(file, 'list');
    assert.equal(result.ok, true);
    assert.equal(result.tasks.find(t => t.id === 'wait').phaseLabel, '稍后继续');
    const unresolved = result.tasks.find(t => t.id === 'interrupted');
    const detail = await client.request(file, 'detail', { id: 'interrupted' });
    assert.equal(detail.ok, true);
    assert.equal(detail.task.recoveryState, 'unknown');
    assert.equal(detail.task.autoRetry, false);
    assert.equal(unresolved.phaseLabel, '需要你帮助');
    console.log(JSON.stringify({ ok: true, electron: process.versions.electron, sourceFilesMatched: files.length, workerReadModel: true,
      persistedRetryIdentity: true, unknownExecutionPreserved: true, realStudentAccess: false, liveAgentCall: false }));
  } finally {
    await client.close();
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-recovery-package-'));
    await fs.rm(root, { recursive: true, force: true });
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
