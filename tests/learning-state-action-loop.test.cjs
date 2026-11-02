'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createLearningStateStore, SCHEMA_VERSION } = require('../electron/learning-state-store.cjs');
const { createLearningActionLoop, stableActionKey } = require('../electron/learning-action-loop.cjs');

const NOW = '2026-11-02T08:00:00.000Z';

function scope(studentId = 'student-a') {
  return { studentId, actorRole: 'system', actorId: 'learning-loop' };
}

function action(overrides = {}) {
  return {
    studentId: 'student-a', subjectType: 'problem', subjectId: 'problem-transfer', subjectRevision: 2,
    actionType: 'targeted_practice', retestWindow: '2026-11-09/2026-11-15',
    title: '函数迁移专项复测', payload: { subject: '数学', focus: '函数迁移' }, ...overrides,
  };
}

function createV2Database(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE learning_state_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
    INSERT INTO learning_state_meta VALUES('generation','4'),('changed_at','2026-11-01T00:00:00.000Z');
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
    PRAGMA user_version=2;
  `);
  db.close();
}

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-learning-action-'));
  const dbPath = path.join(root, 'learning-state.sqlite3');
  const clock = { value: Date.parse(NOW) };
  if (options.v2) createV2Database(dbPath);
  const store = createLearningStateStore({ dbPath, now: () => clock.value });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, dbPath, store, tick(iso) { clock.value = Date.parse(iso); } };
}

test('v2 upgrades to v3 with a recoverable backup and preserves learning records', (t) => {
  const { root, store } = fixture(t, { v2: true });
  assert.equal(SCHEMA_VERSION, 3);
  assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, 3);
  assert.equal(store.history('student-a').checkIns[0].checkInId, 'checkin-old');
  assert.equal(fs.readdirSync(root).filter((name) => name.includes('.pre-schema-v3-')).length, 1);
});

test('stable business key scopes one intent to student, subject instance, action type and retest window', (t) => {
  const { store } = fixture(t);
  const expected = stableActionKey(action());
  const first = store.ensureActionIntent(scope(), action(), 'intent-commit-1');
  const generation = store.state().generation;
  const replay = store.ensureActionIntent(scope(), action(), 'intent-commit-2');
  assert.equal(first.actionKey, expected);
  assert.equal(replay.actionId, first.actionId);
  assert.equal(store.state().generation, generation);
  assert.notEqual(stableActionKey(action({ studentId: 'student-b' })), expected);
  assert.notEqual(stableActionKey(action({ subjectRevision: 3 })), expected);
  assert.notEqual(stableActionKey(action({ retestWindow: '2026-11-16/2026-11-22' })), expected);
  assert.throws(() => store.ensureActionIntent(scope('student-b'), action(), 'bad-scope'), { code: 'student_scope_mismatch' });
});

test('disabled, paused, capacity-full and offline gates retain one intent and create no entity', async (t) => {
  const reasons = [
    ['automation_disabled', { automationEnabled: false }],
    ['student_paused', { automationEnabled: true, studentPaused: true }],
    ['capacity_full', { automationEnabled: true, capacityAvailable: false }],
    ['executor_offline', { automationEnabled: true, executorAvailable: false }],
  ];
  for (const [reason, gates] of reasons) {
    const { store } = fixture(t);
    let dispatches = 0;
    const loop = createLearningActionLoop({
      store, gateState: async () => gates,
      dispatchPractice: async () => { dispatches += 1; return { entityId: 'card-should-not-exist' }; },
    });
    const first = await loop.dispatch(scope(), action());
    const second = await loop.dispatch(scope(), action());
    assert.equal(first.status, 'suppressed');
    assert.equal(first.reason, reason);
    assert.equal(second.actionId, first.actionId);
    assert.equal(dispatches, 0);
    const history = store.history('student-a');
    assert.equal(history.actions.length, 1);
    assert.equal(history.bindings.length, 0);
    assert.equal(history.suppressions.length, 1, 'the same gate decision is append-only but idempotent');
  }
});

test('task and practice dispatch use existing adapters once and persist authoritative bindings', async (t) => {
  const { store } = fixture(t);
  const calls = [];
  const loop = createLearningActionLoop({
    store,
    gateState: async () => ({ automationEnabled: true, studentPaused: false, capacityAvailable: true, executorAvailable: true }),
    dispatchTask: async (input) => { calls.push(['task', input.actionKey]); return { entityId: `task-${input.actionKey.slice(-8)}`, status: 'dispatched' }; },
    dispatchPractice: async (input) => { calls.push(['card', input.actionKey]); return { entityId: `card-${input.actionKey.slice(-8)}`, status: 'dispatched' }; },
  });
  const practice = await loop.dispatch(scope(), action());
  const replay = await loop.dispatch(scope(), action());
  const taskResult = await loop.dispatch(scope(), action({ actionType: 'learning_task' }));
  assert.equal(practice.status, 'dispatched');
  assert.equal(replay.entityId, practice.entityId);
  assert.equal(taskResult.entityType, 'task');
  assert.deepEqual(calls.map((item) => item[0]), ['card', 'task']);
});

test('unknown result reconciles the original binding and never creates an alternative action', async (t) => {
  const { store } = fixture(t);
  let dispatches = 0;
  let reconciles = 0;
  const loop = createLearningActionLoop({
    store,
    gateState: async () => ({ automationEnabled: true, capacityAvailable: true, executorAvailable: true }),
    dispatchPractice: async () => { dispatches += 1; throw Object.assign(new Error('connection lost'), { resultUnknown: true }); },
    reconcileBinding: async ({ actionKey, round }) => { reconciles += 1; return { entityId: `card-${actionKey.slice(-6)}`, status: 'dispatched', receiptId: `receipt-${round}` }; },
  });
  const first = await loop.dispatch(scope(), action());
  assert.equal(first.status, 'unknown');
  const recovered = await loop.dispatch(scope(), action());
  assert.equal(recovered.status, 'dispatched');
  assert.equal(dispatches, 1);
  assert.equal(reconciles, 1);
  assert.equal(store.history('student-a').actions.length, 1);
  assert.equal(store.history('student-a').bindings.length, 1);
});

test('late receipts cannot overwrite a newer round and feedback is idempotent', (t) => {
  const { store } = fixture(t);
  const intent = store.ensureActionIntent(scope(), action(), 'intent-late');
  store.beginActionDispatch(scope(), intent.actionKey, { entityType: 'practice_card', round: 1, commitKey: 'begin-r1' });
  store.settleActionDispatch(scope(), intent.actionKey, { round: 1, status: 'failed', receiptId: 'r1-failed', commitKey: 'settle-r1' });
  store.beginActionDispatch(scope(), intent.actionKey, { entityType: 'practice_card', round: 2, commitKey: 'begin-r2' });
  store.settleActionDispatch(scope(), intent.actionKey, { round: 2, status: 'dispatched', entityId: 'card-r2', receiptId: 'r2-ok', commitKey: 'settle-r2' });
  const generation = store.state().generation;
  const late = store.settleActionDispatch(scope(), intent.actionKey, { round: 1, status: 'completed', entityId: 'card-r1', receiptId: 'r1-late', commitKey: 'late-r1' });
  assert.equal(late.ignored, true);
  assert.equal(store.getActionIntent(scope(), intent.actionKey).binding.entityId, 'card-r2');
  assert.equal(store.state().generation, generation);
  const feedback = store.recordActionFeedback(scope(), intent.actionKey, {
    round: 2, feedbackId: 'feedback-1', outcome: 'completed', payload: { difficulty: 'right' }, occurredAt: NOW,
  });
  const afterFeedback = store.state().generation;
  const replay = store.recordActionFeedback(scope(), intent.actionKey, {
    round: 2, feedbackId: 'feedback-1', outcome: 'completed', payload: { difficulty: 'right' }, occurredAt: NOW,
  });
  assert.equal(replay.feedbackId, feedback.feedbackId);
  assert.equal(store.state().generation, afterFeedback);
});

test('action projection is student-scoped and reading has zero business side effects', (t) => {
  const { store } = fixture(t);
  store.ensureActionIntent(scope('student-a'), action(), 'intent-a');
  store.ensureActionIntent(scope('student-b'), action({ studentId: 'student-b', subjectId: 'problem-b' }), 'intent-b');
  const before = store.state();
  const projection = store.getLearningState({ role: 'admin', studentId: 'student-a' }, 'student-a', NOW);
  assert.equal(projection.actions.length, 1);
  assert.equal(projection.actions[0].studentId, 'student-a');
  assert.deepEqual(store.state(), before);
});
