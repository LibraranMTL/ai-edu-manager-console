const crypto = require('crypto');

const DEFAULT_DISCLAIMER = '打开第三方课程或采集屏幕资料不代表课程完成、正确率或学情结论。';
const MAX_OFFLINE_OPEN_SECONDS = 6 * 60 * 60;

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function asIso(value, fieldName) {
  const time = Date.parse(String(value || ''));
  if (!Number.isFinite(time)) throw new Error(`${fieldName} must be an ISO date-time`);
  return new Date(time).toISOString();
}

function clampOfflineSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return MAX_OFFLINE_OPEN_SECONDS;
  return Math.min(Math.floor(seconds), MAX_OFFLINE_OPEN_SECONDS);
}

function createStudentCourseProjection(input = {}) {
  const hostId = String(input.hostId || '').trim();
  const studentId = String(input.studentId || '').trim();
  if (!hostId || !studentId) throw new Error('hostId and studentId are required');

  const generatedAt = asIso(input.generatedAt, 'generatedAt');
  const expiresAt = asIso(input.expiresAt, 'expiresAt');
  const cloudFreshUntil = asIso(input.cloudFreshUntil, 'cloudFreshUntil');
  const generatedTime = Date.parse(generatedAt);
  const expiresTime = Date.parse(expiresAt);
  if (expiresTime < generatedTime) throw new Error('expiresAt must not be before generatedAt');

  const courses = (Array.isArray(input.courses) ? input.courses : []).map((course) => {
    const offlineOpenUntil = new Date(Math.min(
      expiresTime,
      generatedTime + clampOfflineSeconds(course?.offlineOpenTtlSeconds) * 1000,
    )).toISOString();
    return { ...course, offlineOpenUntil };
  });

  const unsigned = {
    schemaVersion: 2,
    hostId,
    studentId,
    manifestRevision: String(input.manifestRevision || ''),
    policyRevision: String(input.policyRevision || ''),
    generatedAt,
    expiresAt,
    cloudFreshUntil,
    courses,
    tombstones: Array.isArray(input.tombstones) ? input.tombstones : [],
    disclaimer: String(input.disclaimer || DEFAULT_DISCLAIMER),
  };
  const projectionRevision = crypto.createHash('sha256').update(canonicalJson(unsigned)).digest('hex');
  return { ...unsigned, projectionRevision };
}

module.exports = {
  DEFAULT_DISCLAIMER,
  MAX_OFFLINE_OPEN_SECONDS,
  canonicalJson,
  createStudentCourseProjection,
};
