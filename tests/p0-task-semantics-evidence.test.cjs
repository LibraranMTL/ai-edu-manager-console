'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

test('task semantics evidence exposes bounded business identity and settlement fields', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p0-task-semantics-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dbPath = path.join(root, 'tasks.sqlite3');
  const output = path.join(root, 'result.json');
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE tasks(task_id TEXT,status TEXT,updated_at TEXT,payload_json TEXT); CREATE TABLE task_events(occurred_at TEXT)');
  db.prepare('INSERT INTO tasks VALUES(?,?,?,?)').run('t1', 'succeeded', '2026-10-31T00:00:00Z', JSON.stringify({
    kind: 'project_digest', workKey: 'project_digest:p1:v1', sourceVersion: 'v1',
    executionId: 'e1', businessOutcome: 'completed', settlementState: 'settled', privateBody: 'must-not-emit',
  }));
  db.prepare('INSERT INTO task_events VALUES(?)').run('2026-10-31T00:00:00Z');
  db.close();
  const result = spawnSync(process.execPath, [path.join(__dirname, '../scripts/hash-p0-task-semantics.cjs'), dbPath, output], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const task = JSON.parse(fs.readFileSync(output, 'utf8')).tasks[0];
  assert.equal(task.workKey, 'project_digest:p1:v1');
  assert.equal(task.businessOutcome, 'completed');
  assert.equal(task.settlementState, 'settled');
  assert.equal(task.privateBody, undefined);
});
