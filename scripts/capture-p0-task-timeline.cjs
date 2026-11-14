'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..');
const args = new Map(process.argv.slice(2).map(entry => {
  const separator = entry.indexOf('=');
  return separator < 0 ? [entry.replace(/^--/, ''), 'true'] : [entry.slice(0, separator).replace(/^--/, ''), entry.slice(separator + 1)];
}));

function resolveInput(value, fallback = '') {
  const selected = String(value || fallback || '').trim();
  if (!selected) return '';
  return path.isAbsolute(selected) ? selected : path.join(ROOT, selected);
}

function hashId(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

function readJson(file) {
  if (!file || !fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function eventStage(eventType) {
  const type = String(eventType || '').toLowerCase();
  if (['task_created', 'task_retried', 'intake_started', 'intake_admitted', 'auto_wake_queued'].includes(type)) return 'enqueue';
  if (type.includes('resource_deferred') || type.includes('waiting_resource') || type.includes('permit_wait') || type.includes('dispatch_deferred') || type === 'auto_wake_blocked') return 'permit_wait';
  if (type.endsWith('_reconcile_started') || type.includes('receipt_reconcile') || type === 'intake_checked' || type === 'agent_result_synced' || type === 'digest_nothing_pending_repaired_receipt') return 'reconciliation';
  if (type === 'intake_business_settled' || type === 'digest_result_auto_accepted' || type === 'report_auto_published' || type.endsWith('_finished') || type.endsWith('_completed')) return 'settlement';
  if (type === 'task_prepared' || type.endsWith('_started') || type === 'manual_execution_prepared' || type === 'auto_wake_dispatched') return 'execution';
  return '';
}

function provenanceSummary(report) {
  const diagnostic = report?.chains?.diagnosticCandidate || {};
  return {
    workspaceCommit: String(diagnostic.workspaceCommit || report?.workspace?.commit || ''),
    candidateSha256: String(diagnostic.candidateSha256 || report?.candidate?.exe?.sha256 || '').toUpperCase(),
    diagnosticCandidateStatus: String(diagnostic.status || ''),
    mappingStatus: String(report?.mapping?.status || ''),
  };
}

const databaseFile = resolveInput(args.get('db'));
const outputFile = resolveInput(args.get('output'), 'artifacts/p0-red-gate-20261025/p0-task-timeline.json');
const provenanceFile = resolveInput(args.get('provenance'), 'artifacts/p0-red-gate-20261025/p0-candidate-provenance.json');
const requestedTaskId = String(args.get('task-id') || '').trim();
const since = String(args.get('since') || '').trim();
const scenario = String(args.get('scenario') || 'unlabelled').trim();
const runId = String(args.get('run-id') || crypto.randomUUID()).trim();

if (!databaseFile || !fs.existsSync(databaseFile)) throw new Error('A readable --db task-state SQLite path is required.');
fs.mkdirSync(path.dirname(outputFile), { recursive: true });

const db = new DatabaseSync(databaseFile, { readOnly: true });
let taskId = requestedTaskId;
if (!taskId) {
  const latest = db.prepare(`SELECT t.task_id
    FROM tasks t
    WHERE EXISTS(SELECT 1 FROM task_events e WHERE e.task_id=t.task_id)
    ORDER BY COALESCE(t.updated_at,'') DESC, t.task_id
    LIMIT 1`).get();
  taskId = String(latest?.task_id || '');
}
if (!taskId) {
  db.close();
  throw new Error('No task with recorded events was found.');
}

const task = db.prepare(`SELECT status, settlement_state, business_outcome, resource_block_json, updated_at
  FROM tasks WHERE task_id=? LIMIT 1`).get(taskId);
if (!task) {
  db.close();
  throw new Error('The selected task does not exist.');
}
const eventRows = since
  ? db.prepare(`SELECT event_id,event_type,occurred_at FROM task_events
      WHERE task_id=? AND occurred_at>=? ORDER BY occurred_at,event_id`).all(taskId, since)
  : db.prepare(`SELECT event_id,event_type,occurred_at FROM task_events
      WHERE task_id=? ORDER BY occurred_at,event_id`).all(taskId);
db.close();

const events = eventRows.map(row => ({
  stage: eventStage(row.event_type),
  at: String(row.occurred_at || ''),
  eventType: String(row.event_type || ''),
  eventCorrelationId: hashId(row.event_id),
})).filter(event => event.stage && event.at);
const stageCounts = {};
for (const event of events) stageCounts[event.stage] = (stageCounts[event.stage] || 0) + 1;

const report = {
  schema: 1,
  readOnly: true,
  generatedAt: new Date().toISOString(),
  scenario,
  runId,
  provenance: provenanceSummary(readJson(provenanceFile)),
  correlationId: hashId(taskId),
  selection: {
    explicitTask: Boolean(requestedTaskId),
    since: since || null,
  },
  taskSnapshot: {
    status: String(task.status || ''),
    settlementState: String(task.settlement_state || ''),
    businessOutcome: String(task.business_outcome || ''),
    resourceBlockPresent: !['', '{}', 'null'].includes(String(task.resource_block_json || '').trim()),
    updatedAt: String(task.updated_at || ''),
  },
  summary: {
    sourceEventCount: eventRows.length,
    mappedEventCount: events.length,
    stageCounts,
    completeFlow: ['enqueue', 'permit_wait', 'execution', 'reconciliation', 'settlement'].every(stage => Number(stageCounts[stage] || 0) > 0),
  },
  events,
  limitations: [
    'Task identifiers and event identifiers are one-way hashed; event payloads are never read or exported.',
    'Missing stages mean they were not present in the selected persisted event history; the collector does not invent them.',
    'This timeline is observational evidence and must be paired with a same-source runtime sample for causal analysis.',
  ],
};

fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(report.summary)}\nOUTPUT=${outputFile}\n`);
