'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function json(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return fallback; }
}

function summarizeResearchFixture(fixtureRoot) {
  const root = path.resolve(fixtureRoot);
  const database = path.join(root, 'student-data', '.edu-manager', 'task-center', 'task-state.sqlite3');
  const db = new DatabaseSync(database, { readOnly: true });
  const row = db.prepare("SELECT task_id,status,payload_json,updated_at FROM tasks WHERE json_extract(payload_json,'$.kind')='competition_research_check' ORDER BY updated_at DESC LIMIT 1").get();
  if (!row) { db.close(); throw new Error('competition_research_check task not found'); }
  const task = JSON.parse(row.payload_json);
  const attemptRow = db.prepare(`SELECT execution_id,provider_id,phase,active,created_at,started_at,settled_at,result_kind,evidence_json
    FROM task_execution_attempts WHERE task_id=? ORDER BY created_at DESC LIMIT 1`).get(row.task_id);
  db.close();
  const students = json(path.join(root, 'students.json'), []);
  const student = students.find(item => String(item.id) === String(task.sourceId));
  const store = student?.rootPath
    ? json(path.join(student.rootPath, '.ai-manager', 'planning-guidance', 'store.json'), {})
    : {};
  const receipt = (store.checks || []).find(item => item.taskType === 'competition_research_check'
    && String(item.taskId || '') === String(task.id || row.task_id)
    && String(item.executionId || '') === String(task.executionId || '')) || null;
  const currentRevision = (store.competitionSets || [])[0] || null;
  const attempt = attemptRow ? {
    executionId: attemptRow.execution_id, providerId: attemptRow.provider_id, phase: attemptRow.phase,
    active: Boolean(attemptRow.active), createdAt: attemptRow.created_at, startedAt: attemptRow.started_at,
    settledAt: attemptRow.settled_at, resultKind: attemptRow.result_kind,
    evidence: attemptRow.evidence_json ? JSON.parse(attemptRow.evidence_json) : null,
  } : null;
  const receiptAccepted = Boolean(receipt && ['succeeded', 'unchanged', 'no_results'].includes(String(receipt.status || '')));
  const taskCompleted = row.status === 'succeeded' && task.executionPhase === 'settled'
    && task.settlementState === 'settled' && task.businessOutcome === 'completed'
    && task.result?.validation?.valid === true;
  const attemptSettled = Boolean(attempt && attempt.providerId === 'codex' && attempt.phase === 'settled'
    && attempt.active === false && attempt.settledAt);
  return {
    schema: 'edu.p0.agent-research-result.v1', fixtureRoot: root,
    task: { id: row.task_id, status: row.status, executionId: task.executionId || '', executionPhase: task.executionPhase || '',
      settlementState: task.settlementState || '', businessOutcome: task.businessOutcome || '', updatedAt: row.updated_at,
      error: task.error || null },
    attempt, receipt, currentRevision,
    businessCompleted: taskCompleted && attemptSettled && receiptAccepted,
  };
}

if (require.main === module) {
  const fixtureRoot = process.argv[2];
  if (!fixtureRoot) { console.error('usage: node agent-0228-research-result.cjs <fixtureRoot>'); process.exit(2); }
  process.stdout.write(`${JSON.stringify(summarizeResearchFixture(fixtureRoot))}\n`);
}

module.exports = { summarizeResearchFixture };
