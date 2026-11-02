'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/0230/shared-contracts.json');
const {
  subjectScope,
  evidenceRef,
  asOfContext,
  accessProjection,
  assertProjectionCanRead,
  stableCommitKey,
  correctionRecord,
  shouldAcceptGeneration,
} = require('../electron/shared-contracts.cjs');

test('subject scope keeps two students explicit and rejects cross-student reads', () => {
  const scope = subjectScope({
    actorId: 'host-user-fixture',
    actorRole: 'manager',
    studentIds: fixture.project.studentIds,
    projectId: fixture.project.id,
  });
  assert.deepEqual(scope.studentIds, ['student-fixture-a', 'student-fixture-b']);

  const projection = accessProjection({ ...fixture.readers[0], authorizationVersion: 3 });
  assert.equal(assertProjectionCanRead(projection, { studentId: 'student-fixture-a', field: 'summary' }), true);
  assert.throws(
    () => assertProjectionCanRead(projection, { studentId: 'student-fixture-b', field: 'summary' }),
    (error) => error.code === 'subject_scope_forbidden',
  );
});

test('evidence contract preserves withdrawal and never treats it as active evidence', () => {
  const active = evidenceRef(fixture.evidence[0]);
  const withdrawn = evidenceRef(fixture.evidence[1]);
  assert.equal(active.usable, true);
  assert.equal(withdrawn.availability, 'withdrawn');
  assert.equal(withdrawn.usable, false);
});

test('commit keys are deterministic for retries and distinct across revisions', () => {
  const first = stableCommitKey('learning-check-in', ['student-fixture-a', 'week-2026-44', 1]);
  const retry = stableCommitKey('learning-check-in', ['student-fixture-a', 'week-2026-44', 1]);
  const next = stableCommitKey('learning-check-in', ['student-fixture-a', 'week-2026-44', 2]);
  assert.equal(first, retry);
  assert.notEqual(first, next);
  assert.match(first, /^learning-check-in:[a-f0-9]{64}$/);
});

test('late lower-generation response cannot overwrite a newer snapshot', () => {
  assert.equal(shouldAcceptGeneration(11, 12), true);
  assert.equal(shouldAcceptGeneration(12, 11), false);
  assert.equal(shouldAcceptGeneration(12, 12), true);
});

test('as-of and correction records carry policy, data and authorization revisions', () => {
  const context = asOfContext({
    asOf: '2026-11-02T10:00:00.000+08:00',
    timezone: 'Asia/Shanghai',
    policyVersion: 'learning-state-v1',
    dataGeneration: 12,
    authorizationVersion: 3,
  });
  const correction = correctionRecord({
    objectType: 'learning_finding',
    objectId: 'finding-fixture-1',
    expectedRevision: 2,
    action: 'withdraw',
    reason: '来源已撤回',
    actorId: 'host-user-fixture',
    createdAt: context.asOf,
    commitKey: stableCommitKey('correction', ['finding-fixture-1', 2, 'withdraw']),
  });
  assert.equal(context.dataGeneration, 12);
  assert.equal(context.authorizationVersion, 3);
  assert.equal(correction.action, 'withdraw');
  assert.equal(correction.expectedRevision, 2);
});

test('contract builders are pure and do not mutate their inputs', () => {
  const input = { ...fixture.readers[1], authorizationVersion: 4 };
  const before = JSON.stringify(input);
  accessProjection(input);
  assert.equal(JSON.stringify(input), before);
});
