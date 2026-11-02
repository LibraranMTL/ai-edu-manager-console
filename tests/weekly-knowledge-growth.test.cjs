'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLearningStateStore } = require('../electron/learning-state-store.cjs');
const { getWeeklyKnowledgeGrowth } = require('../electron/weekly-knowledge-growth.cjs');
const { appendLearningEvents, removeLearningEventsBySource } = require('../electron/learning-analytics.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-weekly-growth-'));
  const store = createLearningStateStore({
    dbPath: path.join(root, 'learning-state.sqlite3'),
    now: () => Date.parse('2026-11-04T12:00:00+08:00'),
  });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, store };
}

function event(eventId, knowledgePointId, recordedAt, sourceId = eventId) {
  return {
    eventId,
    studentId: 'student-a',
    knowledgePoint: { id: knowledgePointId, label: `知识点 ${knowledgePointId}`, subject: '数学' },
    recordedAt,
    evidenceRefs: [{ sourceType: 'material', sourceId }],
  };
}

test('first reliable registration is idempotent and survives withdrawal and re-import', (t) => {
  const { store } = fixture(t);
  const first = event('event-1', 'MATH.A', '2026-11-02T01:00:00.000Z', 'material-1');
  const review = event('event-2', 'MATH.A', '2026-11-04T01:00:00.000Z', 'material-2');
  store.reconcileEvents('student-a', [first, review]);
  const generation = store.state().generation;
  assert.equal(store.listPoints('student-a')[0].firstSeenAt, first.recordedAt);
  assert.equal(store.listPoints('student-a')[0].activeSourceCount, 2);

  store.reconcileEvents('student-a', [first, review]);
  assert.equal(store.state().generation, generation, 'replaying identical events is idempotent');

  store.reconcileEvents('student-a', [review]);
  let point = store.listPoints('student-a')[0];
  assert.equal(point.firstSeenAt, first.recordedAt, 'withdrawing the first source keeps the tombstone date');
  assert.equal(point.activeSourceCount, 1);

  store.reconcileEvents('student-a', []);
  point = store.listPoints('student-a')[0];
  assert.equal(point.firstSeenAt, first.recordedAt);
  assert.equal(point.activeSourceCount, 0);

  store.reconcileEvents('student-a', [event('event-3', 'MATH.A', '2026-11-04T02:00:00.000Z', 'material-3')]);
  point = store.listPoints('student-a')[0];
  assert.equal(point.firstSeenAt, first.recordedAt, 're-import never creates a second first-seen date');
  assert.equal(point.activeSourceCount, 1);
});

test('weekly growth counts active points by first registration and marks future days null', (t) => {
  const { store } = fixture(t);
  store.reconcileEvents('student-a', [
    event('old', 'MATH.OLD', '2026-10-30T01:00:00.000Z'),
    event('mon', 'MATH.MON', '2026-11-02T01:00:00.000Z'),
    event('wed', 'MATH.WED', '2026-11-04T01:00:00.000Z'),
    event('unknown', 'MATH.UNKNOWN', ''),
  ]);
  const growth = store.weeklyGrowth({
    studentId: 'student-a',
    asOf: '2026-11-04T04:00:00.000Z',
    timezone: 'Asia/Shanghai',
  });
  assert.equal(growth.weekStart, '2026-11-02');
  assert.equal(growth.weekEnd, '2026-11-08');
  assert.equal(growth.weeklyNewKnowledgePoints, 2);
  assert.equal(growth.unknownFirstSeenCount, 1);
  assert.deepEqual(growth.days.map((day) => day.count), [1, 0, 1, null, null, null, null]);
  assert.equal(growth.days.filter((day) => day.count !== null).reduce((sum, day) => sum + day.count, 0), 2);
});

test('weekly service retries generation changes and returns one scoped as-of snapshot', (t) => {
  const { root, store } = fixture(t);
  store.reconcileEvents('student-a', [event('mon', 'MATH.MON', '2026-11-02T01:00:00.000Z')]);
  let stateCalls = 0;
  const assetStore = {
    statisticsState() {
      stateCalls += 1;
      return { generation: stateCalls === 1 ? 4 : 5, changedAt: '2026-11-04T02:00:00.000Z' };
    },
    statisticsSnapshot(scope) {
      assert.deepEqual(scope, { studentId: 'student-a' });
      return { generation: 5, total: 128 };
    },
  };
  const result = getWeeklyKnowledgeGrowth({
    studentId: 'student-a', studentRootPath: root, learningStore: store, assetStore,
    asOf: '2026-11-04T04:00:00.000Z', timezone: 'Asia/Shanghai', authorizationVersion: 'students-v7',
  });
  assert.equal(result.ok, true);
  assert.equal(result.assetTotal, 128);
  assert.equal(result.weeklyNewKnowledgePoints, 1);
  assert.equal(result.assetGeneration, 5);
  assert.equal(result.authorizationVersion, 'students-v7');
  assert.equal(result.asOf, '2026-11-04T04:00:00.000Z');
  assert.ok(stateCalls >= 4, 'the first inconsistent read is discarded and retried');
});

test('accepted and withdrawn learning events update the persistent first-seen projection', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-weekly-ingest-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const receipt = appendLearningEvents(root, {
    studentId: 'student-a',
    recordedAt: '2026-11-02T01:00:00.000Z',
    events: [{
      studentId: 'student-a', eventId: 'event-ingest', knowledgePoint: { id: 'MATH.INGEST', label: '接纳测试', subject: '数学' },
      occurredAt: '2026-11-01T01:00:00.000Z', activityType: 'material_exposure',
      evidenceRefs: [{ sourceType: 'material', sourceId: 'material-ingest' }],
    }],
  });
  assert.equal(receipt.ok, true);
  assert.equal(receipt.firstSeenProjection.ok, true);
  const dbPath = path.join(root, '.edu-manager', 'learning-state.sqlite3');
  assert.equal(fs.existsSync(dbPath), true);
  let store = createLearningStateStore({ dbPath });
  assert.equal(store.listPoints('student-a')[0].activeSourceCount, 1);
  store.close();

  const removed = removeLearningEventsBySource(root, { studentId: 'student-a', sourceType: 'material', sourceId: 'material-ingest' });
  assert.equal(removed.ok, true);
  store = createLearningStateStore({ dbPath });
  const point = store.listPoints('student-a')[0];
  assert.equal(point.activeSourceCount, 0);
  assert.equal(point.firstSeenAt, '2026-11-02T01:00:00.000Z');
  store.close();
});
