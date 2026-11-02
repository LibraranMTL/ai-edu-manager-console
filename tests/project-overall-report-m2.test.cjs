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
function scope() { return { projectId: 'project-demo', actorRole: 'admin', actorId: 'fixture-admin' }; }
function reader() { return { role: 'admin', readerId: 'fixture-admin', allowedStudentIds: ['student-a'] }; }
function project(revision = 1) { return { id: 'project-demo', revision, name: '虚构云台支架', type: '设计项目', status: 'active',
  objective: '俯仰 ±30° 全程不碰线', description: '验证走线与俯仰范围', deliverables: ['支架原型', '测试记录'],
  studentIds: ['student-a'], studentEvidence: [] }; }
function material(id, name, version = 1) { return { materialId: id, version, recordRevision: version, sha256: id.padEnd(64, 'a').slice(0, 64),
  size: 200, location: { kind: 'workspace', rootId: 'workspace', relativePath: `过程文档/${name}` }, availability: 'available',
  adoption: { state: 'accepted' }, processing: { state: 'completed', processedVersion: version }, links: { knowledge: [] } }; }
function registry(revision = 1, materials = [material('cad-v2', 'CAD-v2.md')]) { return { projectId: 'project-demo', revision, updatedAt: NOW,
  materials, knowledge: [{ knowledgeId: 'knowledge-cad', relativePath: '摘要/CAD-v2.md', status: 'verified', committedAt: NOW, sources: [] }], evidenceBindings: [] }; }

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-project-report-m2-'));
  const store = createProjectReportStore({ dbPath: path.join(root, 'project-report-state.sqlite3'), now: () => Date.parse(NOW) });
  let currentProject = project();
  let currentRegistry = registry();
  const enqueued = [];
  const service = createProjectReportService({ store, now: () => Date.parse(NOW),
    loadProject: async () => structuredClone(currentProject), loadRegistry: async () => structuredClone(currentRegistry),
    authorizationVersion: (value) => `auth:${value.studentIds.join(',')}`,
    enqueueTask: async (task) => { enqueued.push(structuredClone(task)); return task; } });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { store, service, enqueued,
    setProject(value) { currentProject = value; }, setRegistry(value) { currentRegistry = value; } };
}

test('schema v2 stores governed generation runs and arbitrary immutable report versions', async (t) => {
  const { store, service } = fixture(t);
  assert.equal(SCHEMA_VERSION, 2);
  const request = await service.requestUpdate(scope(), reader(), 'project-demo', { trigger: 'manual' });
  const settled = await service.settleUpdate(scope(), reader(), {
    taskId: request.task.id, executionId: 'execution-1', candidate: { claims: [] },
  });
  assert.equal(settled.status, 'ready');
  assert.equal(settled.sections.length, 7);
  assert.equal(store.listProjectReportVersions('project-demo').length, 1);
  assert.equal(store.getGenerationRun(request.task.id).status, 'succeeded');
  const historical = await service.getVersion(reader(), 'project-demo', settled.versionId);
  assert.equal(historical.versionId, settled.versionId);
  assert.equal(historical.sections.length, 7);
});

test('manual and automatic requests for one frozen input share one task and one execution', async (t) => {
  const { store, service, enqueued } = fixture(t);
  const manual = await service.requestUpdate(scope(), reader(), 'project-demo', { trigger: 'manual' });
  const automatic = await service.requestUpdate(scope(), reader(), 'project-demo', { trigger: 'automatic' });
  assert.equal(automatic.task.id, manual.task.id);
  assert.equal(automatic.reused, true);
  assert.equal(enqueued.length, 1);
  await service.settleUpdate(scope(), reader(), { taskId: manual.task.id, executionId: 'execution-1', candidate: { claims: [] } });
  const replay = await service.settleUpdate(scope(), reader(), { taskId: manual.task.id, executionId: 'execution-1', candidate: { claims: [] } });
  assert.equal(replay.versionId, store.getGenerationRun(manual.task.id).versionId);
  assert.equal(store.listProjectReportVersions('project-demo').length, 1);
});

test('a failed host validation can retry the same frozen task without creating another version', async (t) => {
  const { store, service } = fixture(t);
  const request = await service.requestUpdate(scope(), reader(), 'project-demo', { trigger: 'manual' });
  await assert.rejects(() => service.settleUpdate(scope(), reader(), {
    taskId: request.task.id, executionId: 'execution-invalid',
    candidate: { claims: [{ claimKey: 'bad', section: 'outcomes', statement: '无依据结论', evidenceIds: ['outside-snapshot'] }] },
  }), (error) => error.code === 'project_report_candidate_invalid');
  assert.equal(store.getGenerationRun(request.task.id).status, 'failed');
  const retried = await service.settleUpdate(scope(), reader(), {
    taskId: request.task.id, executionId: 'execution-retry', candidate: { claims: [] },
  });
  assert.equal(retried.status, 'ready');
  assert.equal(store.listProjectReportVersions('project-demo').length, 1);
});

test('new evidence creates a second version with stable-claim differences and leaves reads zero-write', async (t) => {
  const { store, service, setProject, setRegistry } = fixture(t);
  const firstRequest = await service.requestUpdate(scope(), reader(), 'project-demo', { trigger: 'manual' });
  const first = await service.settleUpdate(scope(), reader(), { taskId: firstRequest.task.id, executionId: 'execution-1', candidate: { claims: [] } });
  setProject(project(2));
  setRegistry(registry(2, [material('cad-v2', 'CAD-v2.md'), material('test-t1', 'T1-测试表.csv')]));
  const secondRequest = await service.requestUpdate(scope(), reader(), 'project-demo', { trigger: 'automatic' });
  const frozen = store.getSnapshot(secondRequest.run.snapshotId);
  const testEvidence = frozen.evidence.find((item) => item.sourceId === 'test-t1');
  const second = await service.settleUpdate(scope(), reader(), { taskId: secondRequest.task.id, executionId: 'execution-2', candidate: { claims: [{
    claimKey: 'objective-attainment', section: 'outcomes', kind: 'judgement', status: 'not_achieved',
    statement: '候选表述不会绕过宿主的结构化测量校验。', evidenceIds: [testEvidence.evidenceId],
    measurement: { kind: 'range', requiredMin: -30, requiredMax: 30, observedMin: -20, observedMax: 30, unit: '度' },
  }] } });
  assert.notEqual(second.versionId, first.versionId);
  assert.equal(second.previousVersionId, first.versionId);
  assert.ok(second.changes.added.length + second.changes.revised.length > 0);
  const outcome = second.claims.find((item) => item.claimKey === 'objective-attainment');
  assert.equal(outcome.status, 'partially_achieved');
  assert.match(outcome.statement, /-30 至 30 度/);
  assert.match(outcome.statement, /-20 至 30 度/);
  const generation = store.state().generation;
  const versions = await service.listVersions(reader(), 'project-demo');
  const difference = await service.compareVersions(reader(), 'project-demo', first.versionId, second.versionId);
  assert.equal(versions.length, 2);
  assert.equal(difference.toVersionId, second.versionId);
  assert.equal(store.state().generation, generation, 'version browsing and diffing must be zero-write');
});

test('opening a v1 database creates a recoverable backup and migrates forward to v2', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-project-report-migrate-'));
  const dbPath = path.join(root, 'project-report-state.sqlite3');
  const initial = createProjectReportStore({ dbPath, now: () => Date.parse(NOW) });
  initial.close();
  const legacy = new DatabaseSync(dbPath);
  legacy.exec('DROP TABLE project_report_generation_runs; PRAGMA user_version=1;');
  legacy.close();
  const migrated = createProjectReportStore({ dbPath, now: () => Date.parse(NOW) });
  t.after(() => { migrated.close(); fs.rmSync(root, { recursive: true, force: true }); });
  assert.equal(migrated.state().schemaVersion, 2);
  assert.ok(fs.readdirSync(root).some((name) => name.includes('.pre-schema-v2-') && name.endsWith('.sqlite3')));
});

test('scope or evidence changes after execution starts reject the result and preserve the old current version', async (t) => {
  const { store, service, setProject, setRegistry } = fixture(t);
  const initialRequest = await service.requestUpdate(scope(), reader(), 'project-demo', { trigger: 'manual' });
  const initial = await service.settleUpdate(scope(), reader(), { taskId: initialRequest.task.id, executionId: 'execution-initial', candidate: { claims: [] } });
  setProject(project(2));
  setRegistry(registry(2, [material('cad-v2', 'CAD-v2.md'), material('test-t1', 'T1.csv')]));
  const stale = await service.requestUpdate(scope(), reader(), 'project-demo', { trigger: 'automatic' });
  setProject(project(3));
  await assert.rejects(() => service.settleUpdate(scope(), reader(), {
    taskId: stale.task.id, executionId: 'execution-stale', candidate: { claims: [] },
  }), (error) => error.code === 'project_report_input_changed');
  assert.equal(store.getCurrentProjectReport('project-demo').version.versionId, initial.versionId);
  assert.equal(store.getGenerationRun(stale.task.id).status, 'stale');
});

test('late older result cannot replace a newer committed report and candidate citations are bounded', async (t) => {
  const { store, service, setProject, setRegistry } = fixture(t);
  const older = await service.requestUpdate(scope(), reader(), 'project-demo', { trigger: 'automatic' });
  setProject(project(2));
  setRegistry(registry(2, [material('cad-v2', 'CAD-v2.md'), material('test-t1', 'T1.csv')]));
  const newer = await service.requestUpdate(scope(), reader(), 'project-demo', { trigger: 'manual' });
  const latest = await service.settleUpdate(scope(), reader(), { taskId: newer.task.id, executionId: 'execution-new', candidate: { claims: [] } });
  await assert.rejects(() => service.settleUpdate(scope(), reader(), {
    taskId: older.task.id, executionId: 'execution-old', candidate: { claims: [{ claimKey: 'forged', section: 'outcomes', statement: '伪造', evidenceIds: ['not-in-snapshot'] }] },
  }), (error) => ['project_report_input_changed', 'project_report_candidate_invalid', 'project_report_current_changed'].includes(error.code));
  assert.equal(store.getCurrentProjectReport('project-demo').version.versionId, latest.versionId);
});
