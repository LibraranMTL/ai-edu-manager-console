'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync, backup: backupSqlite } = require('node:sqlite');
const { createLearningStateStore, SCHEMA_VERSION } = require('../electron/learning-state-store.cjs');
const {
  buildFiveDimensionSnapshot,
  reportCycleKey,
} = require('../electron/learning-role-reports.cjs');

const NOW = '2026-11-02T08:00:00.000Z';
const mainSource = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
const scope = (studentId = 'student-a') => ({ studentId, actorRole: 'admin', actorId: 'windows-host' });
const reader = (studentId = 'student-a') => ({ role: 'admin', studentId, authorizationVersion: 'students-v9' });

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-learning-role-reports-'));
  const dbPath = path.join(root, 'learning-state.sqlite3');
  const store = createLearningStateStore({ dbPath, now: () => Date.parse(NOW) });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, dbPath, store };
}

function bindMainFunction(targetScope, name) {
  const start = mainSource.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} missing`);
  const begin = mainSource.slice(start - 6, start) === 'async ' ? start - 6 : start;
  targetScope[name] = Function('scope', `with (scope) { return (${mainSource.slice(begin, mainSource.indexOf('\n}', start) + 2)}); }`)(targetScope);
}

function seed(store, studentId = 'student-a') {
  store.submitCheckIn(scope(studentId), {
    studentId, kind: 'baseline', occurredAt: '2026-10-20T08:00:00.000Z',
    dimensions: { goalClarity: 4, confidence: 3, difficulty: 2, recovery: 4, workload: 3 },
    note: '希望先把函数基础补齐。', sourceCategory: 'student_self_report',
  }, `${studentId}-baseline`);
  store.upsertGoal(scope(studentId), {
    goalId: 'goal-functions', category: '数学', title: '掌握函数基础', successCriteria: '独立完成 3 道变式题',
    dueAt: '2026-11-09T08:00:00.000Z', status: 'active',
  }, 0);
  store.upsertProblem(scope(studentId), {
    problemId: 'problem-transfer', category: '数学', title: '函数迁移不稳定', description: '遇到变式时步骤容易遗漏', status: 'active',
  }, 0);
  store.ingestEvidence(scope(studentId), {
    evidenceId: 'evidence-transfer', sourceCategory: 'system_observation', sourceType: 'practice_review', sourceId: 'attempt-1',
    occurredAt: '2026-11-01T08:00:00.000Z', subject: '数学', statement: '函数变式中出现步骤遗漏。',
    dimension: 'difficulty', polarity: 'challenge',
  }, 1);
}

test('schema v5 persists immutable five-dimension snapshots idempotently', (t) => {
  const { store } = fixture(t);
  seed(store);
  assert.equal(SCHEMA_VERSION, 5);
  const state = store.getLearningState(reader(), 'student-a', NOW);
  const snapshot = buildFiveDimensionSnapshot(state, { cycleKey: '2026-W45', asOf: NOW });
  assert.equal(snapshot.schema, 'edu-manager.learning-report-snapshot.v2');
  const first = store.ensureLearningReportSnapshot(scope(), snapshot, 'snapshot:student-a:2026-W45:v1');
  const replay = store.ensureLearningReportSnapshot(scope(), snapshot, 'snapshot:student-a:2026-W45:v1');
  assert.equal(first.snapshotId, replay.snapshotId);
  assert.equal(replay.replayed, true);
  assert.deepEqual(Object.keys(snapshot.dimensions), ['goals', 'mindset', 'problems', 'methods', 'efficiency']);
  assert.equal('score' in snapshot, false);
  assert.equal('overallScore' in snapshot, false);
  assert.equal(snapshot.boundaries.noCompositeScore, true);
  const laterRead = buildFiveDimensionSnapshot({ ...state, asOf: '2026-11-02T09:00:00.000Z' }, {
    cycleKey: '2026-W45', asOf: '2026-11-02T09:00:00.000Z',
  });
  assert.equal(laterRead.inputFingerprint, snapshot.inputFingerprint, 'read time alone must not reopen the same report cycle');
});

test('the unified five-dimension snapshot preserves complete learning details without role allowlists', (t) => {
  const { store } = fixture(t);
  seed(store, 'student-a');
  seed(store, 'student-b');
  const snapshot = buildFiveDimensionSnapshot(store.getLearningState(reader('student-a'), 'student-a', NOW), {
    cycleKey: '2026-W45', asOf: NOW,
  });
  assert.equal(snapshot.studentId, 'student-a');
  assert.ok(snapshot.dimensions.mindset.selfReport);
  assert.equal(snapshot.dimensions.mindset.privateNote, '希望先把函数基础补齐。');
  assert.equal(snapshot.governance.inputEvidenceIds.includes('evidence-transfer'), true);
  assert.equal(JSON.stringify(snapshot).includes('student-b'), false);
  assert.equal('fieldAllowlist' in snapshot, false);
  assert.equal('projectionRole' in snapshot, false);
});

test('report cycle keys are stable and weekly action uses the same cycle across regeneration', () => {
  assert.equal(reportCycleKey('weekly_action', '2026-11-02T08:00:00.000Z', 'Asia/Shanghai'), 'weekly_action:2026-11-02');
  assert.equal(reportCycleKey('weekly_action', '2026-11-08T12:00:00.000Z', 'Asia/Shanghai'), 'weekly_action:2026-11-02');
  assert.equal(reportCycleKey('learning_profile', '2026-11-02T08:00:00.000Z', 'Asia/Shanghai'), 'learning_profile:2026-11');
});

test('stage-nine unified report and backup integration contracts are wired', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const main = fs.readFileSync(path.join(projectRoot, 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /fiveDimensionSnapshot/);
  assert.match(main, /learningStateFingerprint/);
  assert.match(main, /backupLearningStateDatabases/);
  assert.match(main, /restoreLearningStateDatabases/);
  assert.doesNotMatch(main, /action === 'role-report'/);
  assert.doesNotMatch(main, /projectLearningRoleReport|roleProjections|roleProjectionPolicy/);
  assert.match(main, /persistLearningReportSnapshot/);
  assert.match(main, /阶段 9 五维学情输入/);
  assert.match(main, /学生端和教师端使用同一份完整学情资料/);
  assert.match(main, /同一 actionCycleKey/);
});

test('student and teacher terminal readers receive the same complete projection and five-dimension snapshot', () => {
  const functionStart = mainSource.indexOf('function terminalLearningStateProjection');
  const functionEnd = mainSource.indexOf('\nasync function handleTerminalLearningState', functionStart);
  const source = mainSource.slice(functionStart, functionEnd);
  assert.match(source, /fiveDimensionSnapshot/);
  assert.match(source, /return \{ \.\.\.projection, fiveDimensionSnapshot \}/);
  assert.doesNotMatch(source, /roleReport|role !== 'teacher'|_note|_statement/);

  const panel = fs.readFileSync(path.join(__dirname, '../src/LearningStatePanel.tsx'), 'utf8');
  assert.match(panel, /学生端和教师端均可查看完整学情资料/);
  assert.doesNotMatch(panel, /分角色报告预览|家长授权导出预览|previewRoleReport|fieldAllowlist/);
});

test('host backup and restore preserve corrections and action bindings in the complete learning-state database', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-learning-state-backup-v5-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, 'source');
  const sourcePath = path.join(sourceRoot, '.edu-manager', 'learning-state.sqlite3');
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  const source = new DatabaseSync(sourcePath);
  source.exec(`CREATE TABLE learning_corrections(id TEXT); INSERT INTO learning_corrections VALUES('withdraw-1');
    CREATE TABLE learning_action_bindings(id TEXT); INSERT INTO learning_action_bindings VALUES('binding-1');
    PRAGMA user_version=5;`);
  source.close();
  const container = new DatabaseSync(path.join(root, 'container.sqlite3'));
  const backupScope = {
    fs, path, os, crypto, DatabaseSync, backupSqlite,
    toHostStudent: (student) => student,
    learningStatePath: (studentRoot) => path.join(studentRoot, '.edu-manager', 'learning-state.sqlite3'),
    getStudentRootDir: () => sourceRoot,
  };
  bindMainFunction(backupScope, 'backupLearningStateDatabases');
  const summary = await backupScope.backupLearningStateDatabases(container, [{ id: 'student-a', name: 'A', rootPath: sourceRoot }]);
  assert.equal(summary.length, 1);
  const row = container.prepare('SELECT * FROM host_backup_learning_state').get();
  container.close();

  const restoreRoot = path.join(root, 'restore');
  const restoreScope = {
    fs, path, os, crypto, DatabaseSync, LEARNING_STATE_SCHEMA_VERSION: 5,
    toHostStudent: (student) => student,
    learningStatePath: (studentRoot) => path.join(studentRoot, '.edu-manager', 'learning-state.sqlite3'),
    getStudentRootDir: () => restoreRoot,
    timestampForFilename: () => 'v5-test',
  };
  bindMainFunction(restoreScope, 'validateLearningStateDatabaseBytes');
  bindMainFunction(restoreScope, 'restoreLearningStateDatabases');
  const restored = restoreScope.restoreLearningStateDatabases([{
    studentId: row.student_id, sha256: row.sha256, databaseBytes: row.database_bytes,
  }], [{ id: 'student-a', name: 'A', rootPath: restoreRoot }]);
  assert.equal(restored.count, 1);
  const restoredDb = new DatabaseSync(path.join(restoreRoot, '.edu-manager', 'learning-state.sqlite3'), { readOnly: true });
  assert.equal(restoredDb.prepare('SELECT id FROM learning_corrections').get().id, 'withdraw-1');
  assert.equal(restoredDb.prepare('SELECT id FROM learning_action_bindings').get().id, 'binding-1');
  restoredDb.close();
});
