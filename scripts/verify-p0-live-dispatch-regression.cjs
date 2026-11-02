'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const databasePath = path.resolve(process.argv[2] || '');
const outputPath = path.resolve(process.argv[3] || 'p0-live-dispatch-regression.json');
const weeklyId = String(process.argv[4] || 'p0-weekly-different-work');
const sameWorkId = String(process.argv[5] || 'p0-digest-same-work');
const unknownId = String(process.argv[6] || 'p0-digest-unknown');

const database = new DatabaseSync(databasePath, { readOnly: true });
function task(id) {
  const row = database.prepare('SELECT status,payload_json FROM tasks WHERE task_id=?').get(id);
  return row ? { status: String(row.status || ''), payload: JSON.parse(row.payload_json) } : null;
}
function events(id) {
  return database.prepare('SELECT event_type,occurred_at FROM task_events WHERE task_id=? ORDER BY occurred_at,event_id').all(id)
    .map(row => ({ eventType: String(row.event_type || ''), at: String(row.occurred_at || '') }));
}
const weekly = task(weeklyId);
const sameWork = task(sameWorkId);
const unknown = task(unknownId);
const weeklyEvents = events(weeklyId);
const sameWorkEvents = events(sameWorkId);
database.close();
const queuedAt = Date.parse(weeklyEvents.find(event => event.eventType === 'auto_wake_queued')?.at || '');
const preparedAt = Date.parse(weeklyEvents.find(event => event.eventType === 'task_prepared')?.at || '');
const prepareLatencyMs = Number.isFinite(queuedAt) && Number.isFinite(preparedAt) ? preparedAt - queuedAt : null;
const dispatchBlock = sameWork?.payload?.dispatchBlock || null;
const report = {
  schema: 'edu.p0.live-dispatch-regression.v1',
  readOnly: true,
  databasePath,
  capturedAt: new Date().toISOString(),
  weekly: { taskId: weeklyId, status: weekly?.status || '', events: weeklyEvents, prepareLatencyMs },
  sameWork: { taskId: sameWorkId, status: sameWork?.status || '', dispatchBlock, events: sameWorkEvents },
  unknown: { taskId: unknownId, status: unknown?.status || '', recoveryState: String(unknown?.payload?.recoveryState || '') },
};
report.assertions = {
  weeklyPreparedWithinTenSeconds: Number.isFinite(prepareLatencyMs) && prepareLatencyMs >= 0 && prepareLatencyMs <= 10_000,
  weeklyDifferentWorkNotBlocked: !weekly?.payload?.dispatchBlock,
  sameWorkBlocked: dispatchBlock?.code === 'execution_unknown_same_work'
    && dispatchBlock?.blockerTaskId === unknownId && Boolean(dispatchBlock?.nextCheckAt),
  unknownStillProtected: unknown?.payload?.recoveryState === 'unknown'
    && ['cancelled', 'waiting_result'].includes(String(unknown?.status || '')),
};
report.passed = Object.values(report.assertions).every(Boolean);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.passed ? 0 : 1;
