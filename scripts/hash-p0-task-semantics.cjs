'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const databasePath = path.resolve(process.argv[2] || '');
const outputPath = path.resolve(process.argv[3] || 'p0-task-semantics.json');
const report = {
  schema: 'edu.p0.task-semantics.v1',
  readOnly: true,
  databasePath,
  capturedAt: new Date().toISOString(),
  exists: fs.existsSync(databasePath),
};

if (report.exists) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const tasks = database.prepare('SELECT task_id,status,updated_at,payload_json FROM tasks ORDER BY task_id').all();
    const eventSummary = database.prepare('SELECT COUNT(*) count, MIN(occurred_at) first_at, MAX(occurred_at) last_at FROM task_events').get();
    const semantic = JSON.stringify({ tasks, eventSummary });
    report.taskCount = tasks.length;
    report.eventCount = Number(eventSummary.count || 0);
    report.firstEventAt = String(eventSummary.first_at || '');
    report.lastEventAt = String(eventSummary.last_at || '');
    report.sha256 = crypto.createHash('sha256').update(semantic).digest('hex').toUpperCase();
    report.tasks = tasks.map(row => {
      let payload = {};
      try { payload = JSON.parse(String(row.payload_json || '{}')); } catch {}
      return {
        taskId: String(row.task_id),
        status: String(row.status || ''),
        kind: String(payload.kind || ''),
        executor: String(payload.executor || payload.requestedExecutor || ''),
        workKey: String(payload.workKey || ''),
        sourceVersion: String(payload.sourceVersion || ''),
        executionId: String(payload.executionId || ''),
        businessOutcome: String(payload.businessOutcome || ''),
        settlementState: String(payload.settlementState || ''),
        updatedAt: String(row.updated_at || ''),
      };
    });
  } finally {
    database.close();
  }
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(report)}\n`);
