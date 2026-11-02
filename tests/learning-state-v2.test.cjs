'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createLearningStateStore, SCHEMA_VERSION } = require('../electron/learning-state-store.cjs');

const NOW = '2026-11-02T08:00:00.000Z';

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-learning-state-v2-'));
  const dbPath = path.join(root, 'learning-state.sqlite3');
  const clock = { value: Date.parse(NOW) };
  if (options.v1) createV1Database(dbPath);
  const store = createLearningStateStore({ dbPath, now: () => clock.value });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, dbPath, store, tick(iso) { clock.value = Date.parse(iso); } };
}

function createV1Database(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE learning_state_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
    INSERT INTO learning_state_meta VALUES('generation','2'),('changed_at','2026-11-01T00:00:00.000Z');
    CREATE TABLE knowledge_first_seen (
      student_id TEXT NOT NULL, knowledge_point_id TEXT NOT NULL, label TEXT NOT NULL DEFAULT '',
      subject TEXT NOT NULL DEFAULT '', first_seen_at TEXT NOT NULL DEFAULT '', first_source_key TEXT NOT NULL DEFAULT '',
      first_source_type TEXT NOT NULL DEFAULT '', first_source_id TEXT NOT NULL DEFAULT '', unknown_first_seen INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(student_id,knowledge_point_id)
    ) WITHOUT ROWID, STRICT;
    CREATE TABLE knowledge_sources (
      student_id TEXT NOT NULL, knowledge_point_id TEXT NOT NULL, source_key TEXT NOT NULL, source_type TEXT NOT NULL DEFAULT '',
      source_id TEXT NOT NULL DEFAULT '', event_id TEXT NOT NULL DEFAULT '', recorded_at TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1,
      withdrawn_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL, PRIMARY KEY(student_id,knowledge_point_id,source_key)
    ) WITHOUT ROWID, STRICT;
    INSERT INTO knowledge_first_seen VALUES('student-a','MATH.A','函数','数学','2026-10-31T00:00:00.000Z','event:e1','material','m1',0,'2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');
    PRAGMA user_version=1;
  `);
  db.close();
}

function scope(studentId = 'student-a') {
  return { studentId, actorRole: 'admin', actorId: 'host-admin' };
}

function reader(studentId = 'student-a') {
  return { role: 'admin', studentId, authorizationVersion: 'students-v7' };
}

test('v1 upgrades to the current schema with a recoverable backup and keeps first-seen history', (t) => {
  const { root, store } = fixture(t, { v1: true });
  assert.equal(SCHEMA_VERSION, 3);
  assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, 3);
  assert.equal(store.listPoints('student-a')[0].knowledgePointId, 'MATH.A');
  assert.equal(fs.readdirSync(root).filter((name) => name.includes('.pre-schema-v3-')).length, 1);
});

test('baseline and weekly check-ins are student-scoped and idempotent', (t) => {
  const { store } = fixture(t);
  const payload = {
    kind: 'baseline', occurredAt: NOW,
    dimensions: { goalClarity: 4, confidence: 3, difficulty: null, recovery: 2, workload: 5 },
    note: '本周先稳定完成每日复习。',
  };
  const first = store.submitCheckIn(scope(), payload, 'submission-1');
  const generation = store.state().generation;
  const replay = store.submitCheckIn(scope(), payload, 'submission-1');
  assert.equal(replay.checkInId, first.checkInId);
  assert.equal(store.state().generation, generation);
  assert.throws(() => store.submitCheckIn(scope('all'), payload, 'submission-2'), { code: 'student_scope_missing' });
  assert.throws(() => store.submitCheckIn(scope('student-b'), { ...payload, studentId: 'student-a' }, 'submission-3'), { code: 'student_scope_mismatch' });
  const projection = store.getLearningState(reader(), 'student-a', NOW);
  assert.equal(projection.checkIns.length, 1);
  assert.equal(projection.checkIns[0].dimensions.difficulty, null, 'a skipped response is preserved, not scored as zero');
  assert.equal(projection.checkIns[0].sourceCategory, 'student_self_report');
});

test('goals and problems use immutable optimistic revisions and historical as-of reads', (t) => {
  const { store, tick } = fixture(t);
  const created = store.upsertGoal(scope(), {
    goalId: 'goal-math', category: 'subject', title: '稳定完成函数复习', successCriteria: '连续两周完成计划', status: 'active',
  }, 0);
  assert.equal(created.revision, 1);
  tick('2026-11-03T08:00:00.000Z');
  const updated = store.upsertGoal(scope(), { ...created, title: '稳定完成函数复习与复测', status: 'active' }, 1);
  assert.equal(updated.revision, 2);
  assert.throws(() => store.upsertGoal(scope(), { ...created, title: '过期写入' }, 1), { code: 'revision_conflict' });

  const problem = store.upsertProblem(scope(), {
    problemId: 'problem-transfer', category: 'transfer', title: '变式迁移不稳定', description: '需要继续观察', status: 'watching',
  }, 0);
  assert.equal(problem.revision, 1);
  const historical = store.getLearningState(reader(), 'student-a', '2026-11-02T12:00:00.000Z');
  assert.equal(historical.goals[0].revision, 1);
  assert.equal(historical.goals[0].title, '稳定完成函数复习');
  assert.equal(historical.problems.length, 0);
});

test('corrections and withdrawals are append-only and preserve history', (t) => {
  const { store, tick } = fixture(t);
  store.upsertGoal(scope(), { goalId: 'goal-1', category: 'skill', title: '复盘错题', status: 'active' }, 0);
  tick('2026-11-03T08:00:00.000Z');
  const correction = store.correctOrWithdraw(scope(), {
    targetType: 'goal', objectId: 'goal-1', revision: 1, action: 'withdraw', reason: '目标录入错误', commitKey: 'withdraw-goal-1-r1',
  });
  assert.equal(correction.action, 'withdraw');
  assert.equal(store.getLearningState(reader(), 'student-a', '2026-11-04T00:00:00.000Z').goals.length, 0);
  assert.equal(store.history('student-a').goals.length, 1);
  assert.equal(store.history('student-a').corrections.length, 1);
  const generation = store.state().generation;
  const replay = store.correctOrWithdraw(scope(), {
    targetType: 'goal', objectId: 'goal-1', revision: 1, action: 'withdraw', reason: '目标录入错误', commitKey: 'withdraw-goal-1-r1',
  });
  assert.equal(replay.correctionId, correction.correctionId);
  assert.equal(store.state().generation, generation);
});

test('evidence categories remain explicit and findings do not overstate weak inference', (t) => {
  const { store } = fixture(t);
  store.submitCheckIn(scope(), {
    kind: 'weekly', occurredAt: NOW, dimensions: { goalClarity: 3, confidence: 2, difficulty: 4, recovery: null, workload: 5 },
  }, 'weekly-1');
  store.ingestEvidence(scope(), {
    evidenceId: 'evidence-observed', sourceCategory: 'system_observation', sourceType: 'practice_attempt', sourceId: 'attempt-1',
    occurredAt: NOW, subject: '数学', statement: '完成一次函数复测。', dimension: 'difficulty', polarity: 'neutral',
  }, 1);
  store.ingestEvidence(scope(), {
    evidenceId: 'evidence-inferred', sourceCategory: 'system_inference', sourceType: 'rule', sourceId: 'rule-1',
    occurredAt: NOW, subject: '数学', statement: '可能需要继续观察迁移表现。', dimension: 'confidence', polarity: 'negative',
  }, 1);
  store.ingestEvidence(scope(), {
    evidenceId: 'evidence-conflict-a', sourceCategory: 'external_observation', sourceType: 'teacher_note', sourceId: 'note-a',
    occurredAt: NOW, subject: '数学', statement: '一次观察中能够独立完成迁移题。', dimension: 'transfer', polarity: 'positive',
  }, 1);
  store.ingestEvidence(scope(), {
    evidenceId: 'evidence-conflict-b', sourceCategory: 'system_observation', sourceType: 'practice_attempt', sourceId: 'attempt-b',
    occurredAt: NOW, subject: '数学', statement: '另一次变式任务未能独立完成。', dimension: 'transfer', polarity: 'negative',
  }, 1);
  const findings = store.publishFindings('student-a', NOW);
  assert.ok(findings.some((item) => item.sourceCategory === 'student_self_report' && item.status === 'published'));
  assert.ok(findings.some((item) => item.sourceCategory === 'system_observation' && item.status === 'published'));
  assert.ok(findings.some((item) => item.sourceCategory === 'system_inference' && item.status === 'pending'));
  assert.equal(findings.filter((item) => ['evidence-conflict-a', 'evidence-conflict-b'].includes(item.evidenceId)).every((item) => item.status === 'disputed'), true);
  assert.ok(findings.every((item) => item.confidence !== 'diagnostic'));
});

test('read projection is isolated, historical, and has zero business mutations', (t) => {
  const { store } = fixture(t);
  store.submitCheckIn(scope('student-a'), { kind: 'weekly', occurredAt: NOW, dimensions: { confidence: 3 } }, 'a-1');
  store.submitCheckIn(scope('student-b'), { kind: 'weekly', occurredAt: NOW, dimensions: { confidence: 5 } }, 'b-1');
  const before = store.state();
  const projection = store.getLearningState(reader('student-a'), 'student-a', NOW);
  assert.equal(projection.checkIns.length, 1);
  assert.equal(projection.checkIns[0].dimensions.confidence, 3);
  assert.deepEqual(store.state(), before);
  assert.equal(projection.asOf, NOW);
  assert.equal(projection.policyVersion, 'learning-state-1b-v1');
  assert.equal(projection.authorizationVersion, 'students-v7');
  assert.throws(() => store.getLearningState(reader('student-b'), 'student-a', NOW), { code: 'student_scope_mismatch' });
});
