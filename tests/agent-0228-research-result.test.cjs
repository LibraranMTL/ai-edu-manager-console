'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { summarizeResearchFixture } = require('../scripts/lib/agent-0228-research-result.cjs');

test('research business evidence requires a settled production task and matching planning receipt', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-research-result-'));
  const studentRoot = path.join(root, 'student-data', 'research-student');
  const taskDir = path.join(root, 'student-data', '.edu-manager', 'task-center');
  const planningDir = path.join(studentRoot, '.ai-manager', 'planning-guidance');
  fs.mkdirSync(taskDir, { recursive: true });
  fs.mkdirSync(planningDir, { recursive: true });
  fs.writeFileSync(path.join(root, 'students.json'), JSON.stringify([{ id: 'student-1', rootPath: studentRoot }]), 'utf8');
  const db = new DatabaseSync(path.join(taskDir, 'task-state.sqlite3'));
  db.exec(`CREATE TABLE tasks(task_id TEXT, status TEXT, payload_json TEXT, updated_at TEXT);
    CREATE TABLE task_execution_attempts(execution_id TEXT,task_id TEXT,provider_id TEXT,phase TEXT,active INTEGER,
      created_at TEXT,started_at TEXT,settled_at TEXT,result_kind TEXT,evidence_json TEXT);`);
  const payload = { id: 'research-task', kind: 'competition_research_check', status: 'succeeded', sourceId: 'student-1',
    executionId: 'exec-1', executionPhase: 'settled', settlementState: 'settled', businessOutcome: 'completed',
    result: { validation: { valid: true } } };
  db.prepare('INSERT INTO tasks VALUES(?,?,?,?)').run('research-task', payload.status, JSON.stringify(payload), new Date().toISOString());
  db.prepare('INSERT INTO task_execution_attempts VALUES(?,?,?,?,?,?,?,?,?,?)').run('exec-1', 'research-task', 'codex', 'settled', 0,
    '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:01.000Z', '2026-11-01T00:00:05.000Z', 'completed', '{}');
  db.close();
  fs.writeFileSync(path.join(planningDir, 'store.json'), JSON.stringify({ checks: [{ taskType: payload.kind, taskId: payload.id,
    executionId: payload.executionId, status: 'succeeded', checkedAt: '2026-11-01T00:00:05.000Z' }],
    competitionSets: [{ id: 'revision-1', studentId: 'student-1', sources: [{ url: 'https://example.org/rules' }] }] }), 'utf8');

  const report = summarizeResearchFixture(root);
  assert.equal(report.businessCompleted, true);
  assert.equal(report.task.status, 'succeeded');
  assert.equal(report.attempt.providerId, 'codex');
  assert.equal(report.receipt.executionId, 'exec-1');
  assert.equal(report.currentRevision.id, 'revision-1');
});
