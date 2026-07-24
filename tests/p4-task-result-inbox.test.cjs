const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { discoverTaskPayloads, taskPayloadKind } = require('../electron/task-result-inbox.cjs');

test('TaskResult and claim payloads are identified by structured identity instead of filenames', () => {
  assert.equal(taskPayloadKind({ taskId: 'task-1', executionId: 'run-1', status: 'completed' }), 'result');
  assert.equal(taskPayloadKind({ taskId: 'task-1', executionId: 'run-1', agentId: 'qclaw', claimedAt: '2026-07-23T00:00:00Z' }), 'claim');
  assert.equal(taskPayloadKind({ digestBatchId: 'batch-1', status: 'completed' }), '');
});

test('the inbox discovers QClaw-compatible aliases while ignoring unrelated JSON', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-task-inbox-'));
  try {
    fs.writeFileSync(path.join(root, 'qclaw-finished-any-name.json'), JSON.stringify({
      protocolVersion: '1.0',
      taskId: 'task-1',
      executionId: 'run-1',
      status: 'completed',
      artifacts: [],
    }));
    fs.writeFileSync(path.join(root, 'worker-accepted.json'), JSON.stringify({
      protocolVersion: '1.0',
      taskId: 'task-2',
      executionId: 'run-2',
      agentId: 'qclaw',
      claimedAt: '2026-07-23T00:00:00Z',
    }));
    fs.writeFileSync(path.join(root, 'notes.json'), JSON.stringify({ title: 'unrelated' }));
    const found = discoverTaskPayloads(root);
    assert.equal(found.results.length, 1);
    assert.equal(found.claims.length, 1);
    assert.equal(found.results[0].payload.taskId, 'task-1');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
