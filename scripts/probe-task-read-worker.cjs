'use strict';
// Run with the candidate Electron executable and ELECTRON_RUN_AS_NODE=1.
// Imports only the read client from app.asar; never starts the real host.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
async function run() {
  const archive = path.resolve(process.argv[2]);
  if (path.basename(archive) !== 'app.asar') throw new Error('Expected candidate app.asar');
  const { createTaskIoClient } = require(path.join(archive, 'electron/task-io-client.cjs'));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-packaged-task-worker-'));
  const client = createTaskIoClient();
  try {
    const file = path.join(root, 'tasks.json');
    await fs.writeFile(file, JSON.stringify({ protocolVersion: '1.2', tasks: [{ id: 'synthetic-task', title: '合成测试',
      status: 'waiting_result', sourceType: 'student', sourceId: 'synthetic', executionMode: 'desktop_handoff',
      result: { handoffState: 'awaiting_user_send' } }], history: [] }));
    const result = await client.request(file, 'list');
    assert.equal(result.ok, true, result.message);
    assert.equal(result.tasks.length, 1);
    assert.equal(result.tasks[0].awaitingSend, true);
    assert.equal(result.tasks[0].hasResult, false);
    const detail = await client.request(file, 'detail', { id: 'synthetic-task' });
    assert.equal(detail.task.id, 'synthetic-task');
    console.log(JSON.stringify({ ok: true, archive, electron: process.versions.electron,
      scope: 'Packaged worker reads synthetic temporary ledger only', list: true, detail: true, realStudentAccess: false }));
  } finally { client.close(); await fs.rm(root, { recursive: true, force: true }); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
