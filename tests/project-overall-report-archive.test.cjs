'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createProjectReportStore, SCHEMA_VERSION } = require('../electron/project-report-state.cjs');
const { createProjectReportService } = require('../electron/project-report-service.cjs');

const NOW = '2026-11-02T08:00:00.000Z';
const TRANSACTION_ID = 'archive-tx-11111111-1111-4111-8111-111111111111';
const scope = () => ({ projectId: 'project-demo', actorRole: 'system', actorId: 'archive-receipt-consumer' });
const reader = () => ({ role: 'admin', readerId: 'windows-host', allowedStudentIds: ['student-a'] });
const material = () => ({ materialId: 'final-work', version: 1, sha256: 'a'.repeat(64),
  location: { kind: 'workspace', rootId: 'workspace', relativePath: '最终成果/支架原型.md' }, availability: 'available',
  adoption: { state: 'accepted' }, processing: { state: 'completed', processedVersion: 1 } });
const registry = () => ({ projectId: 'project-demo', revision: 2, updatedAt: NOW,
  materials: [material()], knowledge: [{ knowledgeId: 'final-summary', relativePath: '摘要/结项.md', status: 'verified', committedAt: NOW }], evidenceBindings: [] });
const activeProject = () => ({ id: 'project-demo', revision: 1, name: '虚构云台支架', type: '设计项目', status: 'active',
  objective: '俯仰 ±30° 全程不碰线', description: '结项测试夹具', deliverables: ['支架原型'], studentIds: ['student-a'], studentEvidence: [] });

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-project-report-m3-'));
  const dbPath = path.join(root, 'project-report-state.sqlite3');
  const store = createProjectReportStore({ dbPath, now: () => Date.parse(NOW) });
  let project = activeProject();
  const service = createProjectReportService({ store, now: () => Date.parse(NOW),
    loadProject: async () => structuredClone(project), loadRegistry: async () => structuredClone(registry()),
    authorizationVersion: (value) => `auth:${value.studentIds.join(',')}` });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, dbPath, store, service, setProject(value) { project = value; } };
}

async function seedM2(service) {
  const requested = await service.requestUpdate(scope(), reader(), 'project-demo', { trigger: 'manual' });
  return service.settleUpdate(scope(), reader(), { taskId: requested.task.id, executionId: 'm2-execution', candidate: { claims: [] } });
}

test('schema v3 commits exactly one completion version from one successful archive transaction', async (t) => {
  const { store, service, setProject } = fixture(t);
  assert.equal(SCHEMA_VERSION, 3);
  const phase = await seedM2(service);
  setProject({ ...activeProject(), revision: 2, status: 'archived', archivedAt: NOW, archiveTransactionId: 'archive-business-run-1' });
  const receipt = { transactionId: TRANSACTION_ID, operation: 'execute_archive_plan', state: 'committed', ok: true, committedAt: NOW };
  const completion = await service.finalizeCompletion(scope(), reader(), 'project-demo', receipt);
  const replay = await service.finalizeCompletion(scope(), reader(), 'project-demo', receipt);
  assert.equal(completion.reportType, 'completion');
  assert.equal(completion.completion.archiveTransactionId, TRANSACTION_ID);
  assert.equal(completion.previousVersionId, phase.versionId);
  assert.equal(replay.versionId, completion.versionId);
  assert.equal(store.listProjectReportVersions('project-demo').filter((item) => item.reportType === 'completion').length, 1);
  assert.equal(store.getCompletionReceipt('project-demo').versionId, completion.versionId);
  await assert.rejects(() => service.requestUpdate(scope(), reader(), 'project-demo', { trigger: 'manual' }),
    (error) => error.code === 'project_report_already_completed');
});

test('queued, failed or mismatched archive operations never publish a pseudo completion', async (t) => {
  const { store, service, setProject } = fixture(t);
  const phase = await seedM2(service);
  setProject({ ...activeProject(), revision: 2, status: 'archived', archivedAt: NOW });
  for (const receipt of [
    { transactionId: TRANSACTION_ID, operation: 'execute_archive_plan', state: 'prepared', ok: true },
    { transactionId: TRANSACTION_ID, operation: 'execute_archive_plan', state: 'committed', ok: false },
    { transactionId: TRANSACTION_ID, operation: 'publish_growth_evidence', state: 'committed', ok: true },
  ]) {
    await assert.rejects(() => service.finalizeCompletion(scope(), reader(), 'project-demo', receipt),
      (error) => error.code === 'project_report_archive_receipt_invalid');
  }
  assert.equal(store.getCurrentProjectReport('project-demo').version.versionId, phase.versionId);
  assert.equal(store.getCompletionReceipt('project-demo'), null);
});

test('a committed receipt survives reopen and recovery returns the same final version without another archive', async (t) => {
  const { root, dbPath, store, service, setProject } = fixture(t);
  await seedM2(service);
  setProject({ ...activeProject(), revision: 2, status: 'archived', archivedAt: NOW, archiveTransactionId: 'archive-business-run-1' });
  const receipt = { transactionId: TRANSACTION_ID, operation: 'execute_archive_plan', state: 'committed', ok: true, committedAt: NOW };
  const first = await service.finalizeCompletion(scope(), reader(), 'project-demo', receipt);
  store.close();
  const reopened = createProjectReportStore({ dbPath, now: () => Date.parse(NOW) });
  const recovered = createProjectReportService({ store: reopened, now: () => Date.parse(NOW),
    loadProject: async () => ({ ...activeProject(), revision: 2, status: 'archived', archivedAt: NOW, archiveTransactionId: 'archive-business-run-1' }),
    loadRegistry: async () => registry(), authorizationVersion: () => 'auth:student-a' });
  const replay = await recovered.finalizeCompletion(scope(), reader(), 'project-demo', receipt);
  assert.equal(replay.versionId, first.versionId);
  assert.equal(reopened.listProjectReportVersions('project-demo').filter((item) => item.reportType === 'completion').length, 1);
  reopened.close();
  // Prevent fixture cleanup from closing the already closed handle twice.
  store.close = () => {};
  assert.ok(fs.existsSync(root));
});

test('opening a v2 database creates a recoverable backup and migrates completion receipts', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-project-report-m3-migrate-'));
  const dbPath = path.join(root, 'project-report-state.sqlite3');
  const initial = createProjectReportStore({ dbPath, now: () => Date.parse(NOW) }); initial.close();
  const legacy = new DatabaseSync(dbPath);
  legacy.exec('DROP TABLE project_report_completion_receipts; DROP INDEX project_report_versions_one_completion; PRAGMA user_version=2;');
  legacy.close();
  const migrated = createProjectReportStore({ dbPath, now: () => Date.parse(NOW) });
  t.after(() => { migrated.close(); fs.rmSync(root, { recursive: true, force: true }); });
  assert.equal(migrated.state().schemaVersion, 3);
  assert.ok(fs.readdirSync(root).some((name) => name.includes('.pre-schema-v3-') && name.endsWith('.sqlite3')));
});
