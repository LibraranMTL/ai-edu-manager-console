'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createLearningStateStore, SCHEMA_VERSION } = require('../electron/learning-state-store.cjs');
const { analyzeMethodExperiment, createLearningMethodService } = require('../electron/learning-method-analysis.cjs');

const NOW = '2026-11-02T08:00:00.000Z';

function scope(studentId = 'student-a') {
  return { studentId, actorRole: 'admin', actorId: 'windows-host' };
}

function reader(studentId = 'student-a') {
  return { role: 'admin', studentId, authorizationVersion: 'students-v8' };
}

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-learning-methods-'));
  const dbPath = path.join(root, 'learning-state.sqlite3');
  const clock = { value: Date.parse(NOW) };
  if (options.v3) createV3Database(dbPath);
  const store = createLearningStateStore({ dbPath, now: () => clock.value });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, dbPath, store, tick(iso) { clock.value = Date.parse(iso); } };
}

function createV3Database(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE learning_state_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
    INSERT INTO learning_state_meta VALUES('generation','8'),('changed_at','2026-11-01T00:00:00.000Z');
    CREATE TABLE learning_checkins (
      student_id TEXT NOT NULL, checkin_id TEXT NOT NULL, client_submission_id TEXT NOT NULL,
      kind TEXT NOT NULL, occurred_at TEXT NOT NULL, dimensions_json TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '', source_category TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(student_id,checkin_id), UNIQUE(student_id,client_submission_id)
    ) WITHOUT ROWID, STRICT;
    INSERT INTO learning_checkins VALUES(
      'student-a','checkin-old','submission-old','weekly','2026-11-01T00:00:00.000Z',
      '{"confidence":3}','','student_self_report','2026-11-01T00:00:00.000Z'
    );
    PRAGMA user_version=3;
  `);
  db.close();
}

function signal(overrides = {}) {
  return {
    signalId: 'signal-before', revision: 1, signalType: 'practice_attempt', occurredAt: '2026-10-25T08:00:00.000Z',
    rootAttemptId: 'root-before', taskId: 'task-before', subject: '数学', taskType: '函数变式', targetKey: '函数迁移',
    difficultyBand: 'medium', assistance: 'none', independent: true, evaluable: true, completed: true,
    correct: false, evidenceBackedOutput: true, effortMinutes: 18, reworkRound: 0, reworkReason: '',
    ...overrides,
  };
}

test('v3 upgrades to v4 with a recoverable backup and preserves existing learning records', (t) => {
  const { root, store } = fixture(t, { v3: true });
  assert.equal(SCHEMA_VERSION, 4);
  assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, 4);
  assert.equal(store.history('student-a').checkIns[0].checkInId, 'checkin-old');
  assert.equal(fs.readdirSync(root).filter((name) => name.includes('.pre-schema-v4-')).length, 1);
});

test('method effect separates student report from system evidence and refuses incomparable tasks', () => {
  const experiment = {
    methodKey: 'split-steps', hypothesis: '先拆分步骤有助于函数迁移', studentReport: { helpful: true, note: '感觉更清楚' },
    conditions: { subject: '数学', taskType: '函数变式', targetKey: '函数迁移' },
  };
  const selfOnly = analyzeMethodExperiment(experiment, []);
  assert.equal(selfOnly.status, 'student_reported');
  assert.match(selfOnly.statement, /学生认为/);

  const incomparable = analyzeMethodExperiment(experiment, [
    signal(),
    signal({ signalId: 'signal-after', rootAttemptId: 'root-after', taskId: 'task-after', occurredAt: '2026-11-01T08:00:00.000Z', difficultyBand: 'hard', correct: true }),
  ]);
  assert.equal(incomparable.status, 'incomparable');
  assert.equal(incomparable.definitive, false);
  assert.match(incomparable.statement, /不可比/);

  const unknownAssistance = analyzeMethodExperiment(experiment, [
    signal({ assistance: 'unknown' }),
    signal({ signalId: 'signal-after-unknown', rootAttemptId: 'root-after-unknown', taskId: 'task-after-unknown', occurredAt: '2026-11-01T08:00:00.000Z', assistance: 'unknown', correct: true }),
  ]);
  assert.equal(unknownAssistance.status, 'incomparable');
});

test('comparable independent tasks retain numerator denominator and sample size without a composite score', (t) => {
  const { store } = fixture(t);
  store.recordProcessSignal(scope(), signal(), 'signal-before-r1');
  store.recordProcessSignal(scope(), signal({
    signalId: 'signal-after', rootAttemptId: 'root-after', taskId: 'task-after',
    occurredAt: '2026-11-01T08:00:00.000Z', correct: true, effortMinutes: 12, reworkRound: 1, reworkReason: '计算步骤遗漏',
  }), 'signal-after-r1');
  store.recordProcessSignal(scope(), signal({
    signalId: 'signal-retest', signalType: 'delayed_retest', rootAttemptId: 'root-retest', taskId: 'task-retest',
    occurredAt: '2026-11-02T07:00:00.000Z', correct: true, effortMinutes: 10, delayedRetest: true,
  }), 'signal-retest-r1');
  const projection = store.getLearningState(reader(), 'student-a', NOW);
  assert.equal(projection.efficiency.independentCompletion.numerator, 3);
  assert.equal(projection.efficiency.independentCompletion.denominator, 3);
  assert.equal(projection.efficiency.independentCompletion.sampleSize, 3);
  assert.equal(projection.efficiency.rework.rounds, 1);
  assert.deepEqual(projection.efficiency.rework.reasons, [{ reason: '计算步骤遗漏', count: 1 }]);
  assert.equal(projection.efficiency.delayedRetention.numerator, 1);
  assert.equal('score' in projection.efficiency, false);
  assert.equal('efficiencyScore' in projection.efficiency, false);
});

test('background activity alone cannot produce progress findings or learning actions', async (t) => {
  const { store } = fixture(t);
  store.recordProcessSignal(scope(), {
    signalId: 'background-1', revision: 1, signalType: 'background_activity', occurredAt: NOW,
    background: { screenMinutes: 240, fileCount: 80, loginCount: 12 },
  }, 'background-r1');
  const calls = [];
  const service = createLearningMethodService({ store, dispatchAction: async (_actor, action) => { calls.push(action); return action; } });
  const result = await service.reconcile(scope(), NOW);
  const projection = store.getLearningState(reader(), 'student-a', NOW);
  assert.equal(result.actions.length, 0);
  assert.equal(calls.length, 0);
  assert.deepEqual(projection.efficiency.background, { screenMinutes: 240, fileCount: 80, loginCount: 12 });
  assert.equal(projection.methods.length, 0);
});

test('new comparable evidence opens one method action while replay creates no duplicate write or action', async (t) => {
  const { store, tick } = fixture(t);
  tick('2026-10-30T08:00:00.000Z');
  store.upsertMethodExperiment(scope(), {
    experimentId: 'experiment-split-steps', methodKey: 'split-steps', title: '先拆分步骤', hypothesis: '减少函数迁移错误',
    practice: '每道题先写三个步骤', conditions: { subject: '数学', taskType: '函数变式', targetKey: '函数迁移' },
    studentReport: { helpful: true, note: '更容易检查' }, status: 'active',
  }, 0);
  tick(NOW);
  store.recordProcessSignal(scope(), signal(), 'signal-before-r1');
  store.recordProcessSignal(scope(), signal({
    signalId: 'signal-after', rootAttemptId: 'root-after', taskId: 'task-after',
    occurredAt: '2026-11-01T08:00:00.000Z', correct: true,
  }), 'signal-after-r1');
  const actions = [];
  const service = createLearningMethodService({
    store,
    dispatchAction: async (actor, action) => {
      actions.push(action);
      return store.ensureActionIntent(actor, action, `method:${action.payload.evidenceFingerprint}`);
    },
  });
  const first = await service.reconcile(scope(), NOW);
  const generation = store.state().generation;
  const replaySignal = store.recordProcessSignal(scope(), signal({
    signalId: 'signal-after', rootAttemptId: 'root-after', taskId: 'task-after',
    occurredAt: '2026-11-01T08:00:00.000Z', correct: true,
  }), 'signal-after-r1');
  const second = await service.reconcile(scope(), NOW);
  assert.equal(first.actions.length, 1);
  assert.equal(second.actions.length, 1);
  assert.equal(actions.length, 1);
  assert.equal(replaySignal.replayed, true);
  assert.equal(store.state().generation, generation);
  assert.equal(store.history('student-a').actions.length, 1);
  assert.equal(store.getLearningState(reader(), 'student-a', NOW).methods[0].analysis.status, 'observed_difference');
});

test('renderer and host expose phase-two methods and efficiency without a composite result', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const main = fs.readFileSync(path.join(projectRoot, 'electron', 'main.cjs'), 'utf8');
  const panel = fs.readFileSync(path.join(projectRoot, 'src', 'LearningStatePanel.tsx'), 'utf8');
  assert.match(main, /upsertMethodExperiment/);
  assert.match(main, /recordProcessSignal/);
  assert.match(main, /createLearningMethodService/);
  assert.match(panel, /学习方法实验/);
  assert.match(panel, /效率明细/);
  assert.match(panel, /分子、分母与样本量，不合成总分/);
  assert.doesNotMatch(panel, /efficiencyScore|综合效率分/);
});
