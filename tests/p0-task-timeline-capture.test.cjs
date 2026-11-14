'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const capture = path.join(root, 'scripts', 'capture-p0-task-timeline.cjs');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('captures a chronological, redacted, read-only task timeline', async t => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'edu-p0-task-timeline-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const database = path.join(directory, 'task-state.sqlite3');
  const output = path.join(directory, 'p0-task-timeline.json');
  const provenance = path.join(directory, 'p0-candidate-provenance.json');
  const taskId = 'sensitive-task-id';
  const db = new DatabaseSync(database);
  db.exec(`
    CREATE TABLE tasks(
      task_id TEXT PRIMARY KEY,
      status TEXT,
      settlement_state TEXT,
      business_outcome TEXT,
      resource_block_json TEXT,
      updated_at TEXT
    );
    CREATE TABLE task_events(
      event_id TEXT PRIMARY KEY,
      task_id TEXT,
      event_type TEXT,
      occurred_at TEXT,
      payload_json TEXT
    );
  `);
  db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?)').run(taskId, 'succeeded', 'settled', 'completed', '{}', '2026-10-26T00:00:05.000Z');
  const insert = db.prepare('INSERT INTO task_events VALUES(?,?,?,?,?)');
  insert.run('5', taskId, 'intake_business_settled', '2026-10-26T00:00:05.000Z', '{"studentName":"must-not-leak"}');
  insert.run('2', taskId, 'resource_deferred', '2026-10-26T00:00:02.000Z', '{"path":"D:/private"}');
  insert.run('1', taskId, 'task_created', '2026-10-26T00:00:01.000Z', '{}');
  insert.run('4', taskId, 'digest_submitted_batch_reconcile_started', '2026-10-26T00:00:04.000Z', '{}');
  insert.run('3', taskId, 'adapter_started', '2026-10-26T00:00:03.000Z', '{}');
  insert.run('6', taskId, 'auto_wake_queued', '2026-10-26T00:00:00.000Z', '{}');
  insert.run('7', taskId, 'auto_wake_blocked', '2026-10-26T00:00:02.500Z', '{}');
  db.close();
  await fsp.writeFile(provenance, JSON.stringify({
    workspace: { commit: 'COMMIT' },
    chains: { diagnosticCandidate: { candidateSha256: 'CANDIDATE', status: 'same_source_verified' } },
  }));
  const before = sha256(database);

  const result = spawnSync(process.execPath, [capture,
    `--db=${database}`, `--output=${output}`, `--provenance=${provenance}`, `--task-id=${taskId}`,
    '--scenario=backlog-recovery', '--run-id=run-1'], { cwd: root, encoding: 'utf8' });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(sha256(database), before, 'read-only capture changed the source database');
  const reportText = await fsp.readFile(output, 'utf8');
  const report = JSON.parse(reportText);
  assert.equal(report.readOnly, true);
  assert.equal(report.scenario, 'backlog-recovery');
  assert.equal(report.runId, 'run-1');
  assert.equal(report.provenance.workspaceCommit, 'COMMIT');
  assert.equal(report.provenance.candidateSha256, 'CANDIDATE');
  assert.equal(report.provenance.diagnosticCandidateStatus, 'same_source_verified');
  assert.equal(report.correlationId, crypto.createHash('sha256').update(taskId).digest('hex').slice(0, 16));
  assert.deepEqual(report.events.map(event => event.stage), ['enqueue', 'enqueue', 'permit_wait', 'permit_wait', 'execution', 'reconciliation', 'settlement']);
  assert.deepEqual(report.events.map(event => event.at), [
    '2026-10-26T00:00:00.000Z', '2026-10-26T00:00:01.000Z', '2026-10-26T00:00:02.000Z',
    '2026-10-26T00:00:02.500Z', '2026-10-26T00:00:03.000Z',
    '2026-10-26T00:00:04.000Z', '2026-10-26T00:00:05.000Z',
  ]);
  assert.equal(reportText.includes(taskId), false);
  assert.equal(reportText.includes('must-not-leak'), false);
  assert.equal(reportText.includes('D:/private'), false);
});
