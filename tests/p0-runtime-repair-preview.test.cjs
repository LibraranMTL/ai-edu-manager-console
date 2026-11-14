'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');

const { previewRuntimeRepair } = require('../scripts/preview-p0-runtime-repair.cjs');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function createTaskDatabase(file, tasks) {
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE tasks(task_id TEXT PRIMARY KEY,status TEXT,updated_at TEXT,payload_json TEXT NOT NULL)');
  const insert = db.prepare('INSERT INTO tasks(task_id,status,updated_at,payload_json) VALUES(?,?,?,?)');
  for (const task of tasks) insert.run(task.id, task.status, task.updatedAt || '', JSON.stringify(task));
  db.close();
}

test('preview identifies Zhao/Bao-style rows without changing source files', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-p0-repair-preview-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const taskDb = path.join(root, 'task-state.sqlite3');
  const materials = path.join(root, 'materials.json');
  const firewall = path.join(root, 'firewall.json');
  const now = '2026-10-28T00:00:00.000Z';
  createTaskDatabase(taskDb, [
    {
      id: 'bao-digest-unknown', kind: 'student_digest', sourceType: 'student', sourceId: 'bao',
      status: 'cancelled', recoveryState: 'unknown', executionId: 'wb-unknown-1', adapterId: 'workbuddy',
      executionMode: 'automatic', automaticExecution: true, workKey: 'student_digest:bao:content-a',
      error: { code: 'EXECUTION_UNRESOLVED', message: 'WorkBuddy 执行超时，尚未确认停止' },
    },
    {
      id: 'bao-weekly-overdue', kind: 'weekly_action', sourceType: 'student', sourceId: 'bao',
      status: 'queued', trigger: 'schedule', scheduledAt: '2026-10-27T00:00:00.000Z',
      automaticExecution: true, workKey: 'weekly_action:bao:2026-W44:growth-a',
    },
    {
      id: 'bao-digest-same-work', kind: 'student_digest', sourceType: 'student', sourceId: 'bao',
      status: 'queued', trigger: 'event', scheduledAt: '2026-10-27T00:00:00.000Z',
      automaticExecution: true, workKey: 'student_digest:bao:content-a',
    },
    {
      id: 'zhao-legacy-unknown', kind: 'student_digest', sourceType: 'student', sourceId: 'zhao',
      status: 'waiting_result', recoveryState: 'unknown', executionId: 'codex-legacy-1', adapterId: 'codex',
      executionMode: 'automatic', automaticExecution: true, workKey: 'student_digest:zhao:content-z',
      error: { code: 'EXECUTION_UNRESOLVED', message: '结果未知' },
    },
  ]);
  fs.writeFileSync(materials, JSON.stringify({ rows: [{ id: 'material-a', status: 'submitted' }] }, null, 2));
  fs.writeFileSync(firewall, JSON.stringify({ networkProfiles: ['Public'], rules: [], legacyRules: [{ name: 'legacy-path-rule' }] }, null, 2));
  const before = { taskDbSha256: sha256(taskDb), materialsSha256: sha256(materials), firewallSha256: sha256(firewall) };

  const report = await previewRuntimeRepair({ taskStorePath: taskDb, materialsPath: materials,
    firewallInspectionPath: firewall, now, tcpPort: 18777, discoveryPort: 18778 });

  const after = { taskDbSha256: sha256(taskDb), materialsSha256: sha256(materials), firewallSha256: sha256(firewall) };
  assert.equal(after.taskDbSha256, before.taskDbSha256);
  assert.equal(after.materialsSha256, before.materialsSha256);
  assert.equal(after.firewallSha256, before.firewallSha256);
  assert.deepEqual(report.wouldRedispatchUnknown, []);
  assert.deepEqual(report.newlyDispatchable.map((item) => item.taskId), ['bao-weekly-overdue']);
  assert.equal(report.blocked.find((item) => item.taskId === 'bao-digest-same-work')?.reasonCode,
    'execution_unknown_same_work');
  assert.equal(report.blocked.find((item) => item.taskId === 'bao-digest-unknown')?.reasonCode,
    'execution_unknown_self');
  assert.deepEqual(report.wouldGainRecoveryMetadata.map((item) => item.taskId).sort(),
    ['bao-digest-unknown', 'zhao-legacy-unknown']);
  assert.equal(report.firewall.requiresUserAuthorizedRepair, true);
  assert.equal(report.firewall.reasonCode, 'network_not_private');
  assert.deepEqual(report.sourceHashes.before, report.sourceHashes.after);
  assert.equal(report.readOnlyVerified, true);
});
