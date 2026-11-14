function validateStudentCourseProjection(payload, scope = {}, trustPolicy) {
  const hostId = String(scope.hostId || '');
  const studentId = String(scope.studentId || '');
  if (Number(payload?.schemaVersion) !== 2 || String(payload?.hostId || '') !== hostId || String(payload?.studentId || '') !== studentId) {
    throw new Error('课程投影的主机或学生范围不匹配。');
  }
  if (!trustPolicy || String(payload.trustPolicyRevision || '') !== trustPolicy.policyRevision) {
    throw new Error('课程投影信任策略与学生端版本不一致，请升级或刷新主机。');
  }
  if (!trustPolicy.accepts(payload.publisherKeyId)) {
    throw new Error(`课程投影发布密钥不受信任：${String(payload.publisherKeyId || '空')}`);
  }
  return payload;
}

// A verified projection can be opened until its local lease expires when the
// host is temporarily unreachable.  A response that proves the token or
// assignment is invalid must still fail closed; 404 is retained solely for
// older hosts which predate the optional course-start pinning endpoint.
function isCourseStartFallbackAllowed(error) {
  const status = Number(error?.status || 0);
  return status === 404 || !status || status >= 500;
}

module.exports = { validateStudentCourseProjection, isCourseStartFallbackAllowed };
