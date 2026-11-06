const test = require('node:test');
const assert = require('node:assert/strict');
const { createStudentCourseProjection } = require('../electron/student-course-projection.cjs');

function projection(overrides = {}) {
  return createStudentCourseProjection({
    hostId: 'host-a',
    studentId: 'student-a',
    manifestRevision: 'manifest-1',
    publisherKeyId: 'course-catalog-primary-2026',
    trustPolicyRevision: 'course-trust-transition-2026-11-06-v1',
    policyRevision: 'policy-1',
    generatedAt: '2026-11-05T00:00:00.000Z',
    expiresAt: '2026-11-05T08:00:00.000Z',
    cloudFreshUntil: '2026-11-05T00:15:00.000Z',
    courses: [{ courseId: 'platform:igsce', offlineOpenTtlSeconds: 900 }],
    tombstones: [{ courseId: 'platform:withdrawn', withdrawnAt: '2026-11-04T12:00:00.000Z' }],
    ...overrides,
  });
}

test('projection revision is deterministic and representation-bound', () => {
  const first = projection();
  const second = projection();
  assert.equal(first.projectionRevision, second.projectionRevision);
  assert.match(first.projectionRevision, /^[a-f0-9]{64}$/);
  assert.notEqual(first.projectionRevision, projection({ policyRevision: 'policy-2' }).projectionRevision);
  assert.notEqual(first.projectionRevision, projection({ publisherKeyId: 'course-catalog-candidate-20261106' }).projectionRevision);
  assert.notEqual(first.projectionRevision, projection({ trustPolicyRevision: 'course-trust-transition-next' }).projectionRevision);
  assert.notEqual(first.projectionRevision, projection({ courses: [{ courseId: 'platform:igsce', name: 'Changed' }] }).projectionRevision);
});

test('publisher key and trust policy are mandatory projection fields', () => {
  assert.throws(() => projection({ publisherKeyId: '' }), /publisherKeyId/);
  assert.throws(() => projection({ trustPolicyRevision: '' }), /trustPolicyRevision/);
});

test('student and host are part of the cache namespace and revision', () => {
  const first = projection();
  const otherStudent = projection({ studentId: 'student-b' });
  const otherHost = projection({ hostId: 'host-b' });
  assert.notEqual(first.projectionRevision, otherStudent.projectionRevision);
  assert.notEqual(first.projectionRevision, otherHost.projectionRevision);
  assert.equal(otherStudent.studentId, 'student-b');
});

test('offline open lease is capped at six hours and never exceeds projection expiry', () => {
  const result = projection({
    expiresAt: '2026-11-05T02:00:00.000Z',
    courses: [
      { courseId: 'short', offlineOpenTtlSeconds: 60 },
      { courseId: 'long', offlineOpenTtlSeconds: 99_999 },
    ],
  });
  assert.equal(result.courses[0].offlineOpenUntil, '2026-11-05T00:01:00.000Z');
  assert.equal(result.courses[1].offlineOpenUntil, '2026-11-05T02:00:00.000Z');
});

test('tombstones remain in the signed projection representation', () => {
  const withTombstone = projection();
  const withoutTombstone = projection({ tombstones: [] });
  assert.equal(withTombstone.tombstones.length, 1);
  assert.notEqual(withTombstone.projectionRevision, withoutTombstone.projectionRevision);
});
