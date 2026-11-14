'use strict';

const MIN_QA_OFFLINE_LEASE_SECONDS = 1;
const MAX_QA_OFFLINE_LEASE_SECONDS = 300;

function qaOfflineLeaseSeconds({ argv = [], env = process.env } = {}) {
  if (!Array.isArray(argv) || !argv.includes('--qa-isolated')) return null;
  const raw = String(env?.EDU_QA_STUDENT_COURSE_OFFLINE_LEASE_SECONDS || '').trim();
  if (!/^[0-9]+$/.test(raw)) return null;
  const seconds = Number(raw);
  if (!Number.isSafeInteger(seconds)
    || seconds < MIN_QA_OFFLINE_LEASE_SECONDS
    || seconds > MAX_QA_OFFLINE_LEASE_SECONDS) return null;
  return seconds;
}

function applyQaOfflineLease(courses, options = {}) {
  const seconds = qaOfflineLeaseSeconds(options);
  if (seconds === null) return courses;
  return (Array.isArray(courses) ? courses : []).map((course) => ({
    ...course,
    offlineOpenTtlSeconds: seconds,
  }));
}

module.exports = {
  MIN_QA_OFFLINE_LEASE_SECONDS,
  MAX_QA_OFFLINE_LEASE_SECONDS,
  qaOfflineLeaseSeconds,
  applyQaOfflineLease,
};
