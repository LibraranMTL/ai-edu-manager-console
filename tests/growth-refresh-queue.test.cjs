const assert = require('node:assert/strict');
const test = require('node:test');

const {
  claimDueGrowthRefreshes,
  completeGrowthRefresh,
  dirtyStudentIds,
  markGrowthDirty,
  normalizeGrowthRefreshState,
} = require('../electron/growth-refresh-queue.cjs');

test('growth refresh queue only marks affected students and merges repeated events', () => {
  let state = normalizeGrowthRefreshState();
  state = markGrowthDirty(state, ['student-a'], 'evidence_changed', '2026-07-24T01:00:00.000Z');
  state = markGrowthDirty(state, ['student-a'], 'project_changed', '2026-07-24T01:00:01.000Z');

  assert.deepEqual(dirtyStudentIds(state), ['student-a']);
  assert.deepEqual(state.entries['student-a'].reasons, ['evidence_changed', 'project_changed']);
});

test('claim is bounded and successful completion stores fingerprint', () => {
  let state = normalizeGrowthRefreshState();
  state = markGrowthDirty(state, ['student-a', 'student-b'], 'source_changed', '2026-07-24T01:00:00.000Z');
  const claimed = claimDueGrowthRefreshes(state, { now: '2026-07-24T01:00:02.000Z', limit: 1 });

  assert.equal(claimed.claimed.length, 1);
  assert.equal(claimed.claimed[0].studentId, 'student-a');
  state = completeGrowthRefresh(claimed.state, claimed.claimed[0], { ok: true, fingerprint: 'fp-a' }, '2026-07-24T01:00:03.000Z');
  assert.equal(state.entries['student-a'].status, 'clean');
  assert.equal(state.entries['student-a'].lastFingerprint, 'fp-a');
  assert.deepEqual(dirtyStudentIds(state), ['student-b']);
});

test('event arriving during rebuild is not lost even in the same millisecond', () => {
  let state = markGrowthDirty({}, 'student-a', 'first', '2026-07-24T01:00:00.000Z');
  const claimed = claimDueGrowthRefreshes(state, { now: '2026-07-24T01:00:01.000Z' });
  state = markGrowthDirty(claimed.state, 'student-a', 'newer', '2026-07-24T01:00:00.000Z');
  state = completeGrowthRefresh(state, claimed.claimed[0], { ok: true, fingerprint: 'old-fp' }, '2026-07-24T01:00:03.000Z');

  assert.equal(state.entries['student-a'].status, 'dirty');
  assert.deepEqual(state.entries['student-a'].reasons, ['first', 'newer']);
});

test('failed refresh backs off without blocking other students', () => {
  let state = markGrowthDirty({}, ['student-a', 'student-b'], 'source_changed', '2026-07-24T01:00:00.000Z');
  const claimed = claimDueGrowthRefreshes(state, { now: '2026-07-24T01:00:01.000Z', limit: 2 });
  const claimA = claimed.claimed.find((item) => item.studentId === 'student-a');
  const claimB = claimed.claimed.find((item) => item.studentId === 'student-b');
  state = completeGrowthRefresh(claimed.state, claimA, { ok: false, error: 'offline', backoffBaseMs: 30_000 }, '2026-07-24T01:00:02.000Z');
  state = completeGrowthRefresh(state, claimB, { ok: true, fingerprint: 'fp-b' }, '2026-07-24T01:00:03.000Z');

  assert.equal(state.entries['student-a'].status, 'dirty');
  assert.equal(state.entries['student-a'].nextAttemptAt, '2026-07-24T01:00:32.000Z');
  assert.equal(state.entries['student-b'].status, 'clean');
});
