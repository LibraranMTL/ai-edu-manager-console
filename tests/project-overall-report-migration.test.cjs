'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createProjectReportStore, SCHEMA_VERSION } = require('../electron/project-report-state.cjs');

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');

function extractFunction(name) {
  const start = mainSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const bodyStart = mainSource.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < mainSource.length; index += 1) {
    const character = mainSource[index];
    if (character === '{') depth += 1;
    else if (character === '}' && --depth === 0) return mainSource.slice(start, index + 1);
  }
  throw new Error(`Unable to extract ${name}`);
}

const validateProjectReportMigrationSnapshot = new Function('DatabaseSync', 'PROJECT_REPORT_SCHEMA_VERSION',
  `${extractFunction('validateProjectReportMigrationSnapshot')}; return validateProjectReportMigrationSnapshot;`)(DatabaseSync, SCHEMA_VERSION);

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-project-report-migration-'));
  const dbPath = path.join(root, 'project-report-state.sqlite3');
  const store = createProjectReportStore({ dbPath, now: () => Date.parse('2026-11-02T08:00:00.000Z') });
  const scope = { projectId: 'p1', actorRole: 'admin', actorId: 'migration-test' };
  const fingerprint = crypto.createHash('sha256').update('migration-fixture').digest('hex');
  const snapshot = store.saveSnapshot(scope, {
    snapshotId: 'project-report-snapshot-migration', projectId: 'p1', inputFingerprint: fingerprint,
    asOf: '2026-11-02T08:00:00.000Z', authorizationVersion: 'auth-p1-v1', policyVersion: 'project-report-m2-v1',
    project: { id: 'p1', name: '迁移测试项目', status: 'active' }, coverage: {}, evidence: [], claims: [], citations: [],
  }, 'migration-snapshot');
  store.commitReportVersion(scope, { snapshotId: snapshot.snapshotId, commitKey: 'migration-version',
    report: { reportType: 'overall', policyVersion: 'project-report-m2-v1', summary: {}, claims: [], gaps: [] } });
  store.close();
  return { root, dbPath };
}

test('cross-host validation binds every report snapshot and version to the restored project and authorization revision', (t) => {
  const item = fixture(); t.after(() => fs.rmSync(item.root, { recursive: true, force: true }));
  const result = validateProjectReportMigrationSnapshot(item.dbPath, [{ id: 'p1' }]);
  assert.deepEqual(result, { schemaVersion: 3, snapshotCount: 1, versionCount: 1, completionCount: 0 });
  assert.throws(() => validateProjectReportMigrationSnapshot(item.dbPath, [{ id: 'another-project' }]), /不存在的项目/);
});

test('cross-host validation rejects a changed snapshot authorization receipt before replacement', (t) => {
  const item = fixture(); t.after(() => fs.rmSync(item.root, { recursive: true, force: true }));
  const db = new DatabaseSync(item.dbPath);
  db.prepare("UPDATE project_report_snapshots SET authorization_version='' WHERE snapshot_id=?")
    .run('project-report-snapshot-migration');
  db.close();
  assert.throws(() => validateProjectReportMigrationSnapshot(item.dbPath, [{ id: 'p1' }]), /授权版本无效/);
});

test('cross-host validation accepts a pre-task M1 report database for forward migration', (t) => {
  const item = fixture(); t.after(() => fs.rmSync(item.root, { recursive: true, force: true }));
  const db = new DatabaseSync(item.dbPath);
  db.exec('DROP TABLE project_report_completion_receipts; DROP TABLE project_report_generation_runs; PRAGMA user_version=1;');
  db.close();
  const result = validateProjectReportMigrationSnapshot(item.dbPath, [{ id: 'p1' }]);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.versionCount, 1);
});
