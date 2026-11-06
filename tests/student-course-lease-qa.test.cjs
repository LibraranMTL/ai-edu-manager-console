const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyQaOfflineLease,
  qaOfflineLeaseSeconds,
} = require('../electron/student-course-lease-qa.cjs');

test('QA offline lease override is unavailable outside an explicitly isolated process', () => {
  assert.equal(qaOfflineLeaseSeconds({
    argv: ['electron'],
    env: { EDU_QA_STUDENT_COURSE_OFFLINE_LEASE_SECONDS: '1' },
  }), null);
});

test('QA offline lease override accepts only bounded whole seconds', () => {
  assert.equal(qaOfflineLeaseSeconds({
    argv: ['electron', '--qa-isolated'],
    env: { EDU_QA_STUDENT_COURSE_OFFLINE_LEASE_SECONDS: '1' },
  }), 1);
  for (const value of ['', '0', '-1', '1.5', '301', 'NaN']) {
    assert.equal(qaOfflineLeaseSeconds({
      argv: ['electron', '--qa-isolated'],
      env: { EDU_QA_STUDENT_COURSE_OFFLINE_LEASE_SECONDS: value },
    }), null, value);
  }
});

test('QA override changes only the projected course lease field', () => {
  const courses = [{ courseId: 'platform:igsce', name: 'Course', offlineOpenTtlSeconds: 3600 }];
  assert.equal(applyQaOfflineLease(courses, { argv: ['electron'], env: { EDU_QA_STUDENT_COURSE_OFFLINE_LEASE_SECONDS: '1' } }), courses);
  const overridden = applyQaOfflineLease(courses, {
    argv: ['electron', '--qa-isolated'],
    env: { EDU_QA_STUDENT_COURSE_OFFLINE_LEASE_SECONDS: '1' },
  });
  assert.notEqual(overridden, courses);
  assert.deepEqual(overridden, [{ courseId: 'platform:igsce', name: 'Course', offlineOpenTtlSeconds: 1 }]);
});
