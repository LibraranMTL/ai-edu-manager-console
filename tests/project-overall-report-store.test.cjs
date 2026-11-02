'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProjectReportStore, SCHEMA_VERSION } = require('../electron/project-report-state.cjs');

const NOW = '2026-11-02T08:00:00.000Z';
function scope() { return { projectId: 'project-demo', actorRole: 'admin', actorId: 'fixture-admin' }; }
function snapshot() { return { snapshotId: 'snapshot-1', projectId: 'project-demo', asOf: NOW, timezone: 'Asia/Shanghai',
  policyVersion: 'project-report-m1-v1', authorizationVersion: 'auth-1', inputFingerprint: 'a'.repeat(64),
  projectRevision: 7, registryRevision: 11, project: { name: '虚构项目' }, members: [], coverage: {}, evidence: [], confirmedContributions: [] }; }
function report() { return { reportType: 'stage_summary', policyVersion: 'project-report-m1-v1', summary: { currentStage: '进行中', changes: '首次阶段摘要', representativeResults: [], nextAction: '补充资料' }, claims: [], gaps: ['缺少材料'], personalContributions: [], disclaimer: '阶段摘要' }; }

test('independent report database stores immutable snapshots and idempotent versions', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-project-report-'));
  const store = createProjectReportStore({ dbPath: path.join(root, 'project-report-state.sqlite3'), now: () => Date.parse(NOW) });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  assert.equal(store.state().schemaVersion, SCHEMA_VERSION);
  const saved = store.saveSnapshot(scope(), snapshot(), 'snapshot-commit-1');
  const replay = store.saveSnapshot(scope(), snapshot(), 'snapshot-commit-1');
  assert.equal(replay.snapshotId, saved.snapshotId);
  const version = store.commitReportVersion(scope(), { snapshotId: saved.snapshotId, commitKey: 'report-commit-1', report: report() });
  const repeated = store.commitReportVersion(scope(), { snapshotId: saved.snapshotId, commitKey: 'report-commit-1', report: report() });
  assert.equal(repeated.versionId, version.versionId);
  assert.equal(store.listProjectReportVersions('project-demo').length, 1);
  const generation = store.state().generation;
  const current = store.getCurrentProjectReport('project-demo');
  assert.equal(current.version.versionId, version.versionId);
  assert.equal(current.snapshot.asOf, NOW);
  assert.equal(store.state().generation, generation, 'report reads must be zero-write');
});

test('scope mismatch and conflicting commit replay are rejected', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-project-report-scope-'));
  const store = createProjectReportStore({ dbPath: path.join(root, 'project-report-state.sqlite3'), now: () => Date.parse(NOW) });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  assert.throws(() => store.saveSnapshot({ ...scope(), projectId: 'other' }, snapshot(), 'snapshot-commit-1'), /范围/);
  store.saveSnapshot(scope(), snapshot(), 'snapshot-commit-1');
  assert.throws(() => store.saveSnapshot(scope(), { ...snapshot(), inputFingerprint: 'b'.repeat(64) }, 'snapshot-commit-1'),
    (error) => error.code === 'project_report_commit_conflict');
});

