function activeCaptureTarget(descriptor = {}) {
  const enabled = descriptor?.lifecycleCapture?.enabled === true;
  const studentId = enabled ? String(descriptor?.defaults?.scopeId || '') : '';
  return {
    enabled: Boolean(enabled && studentId),
    studentId,
    studentName: studentId ? String(descriptor?.defaults?.scopeName || '') : '',
    grantId: studentId ? String(descriptor?.authentication?.grantId || '') : '',
  };
}

function captureSwitchDecision({ currentTarget = {}, targetStudentId = '', activeSessions = [] } = {}) {
  const targetId = String(targetStudentId || '');
  const currentId = String(currentTarget?.studentId || '');
  if (!targetId) return { allowed: false, code: 'INVALID_TARGET' };
  if (currentTarget?.enabled === true && currentId === targetId) {
    return { allowed: true, code: 'ALREADY_ACTIVE' };
  }
  const blockingSessions = (Array.isArray(activeSessions) ? activeSessions : []).filter((session) => (
    session?.status === 'active'
    && session?.origin === 'authorized_agent'
    && String(session?.idempotencyKey || '').startsWith('lifecycle:')
  ));
  if (currentId && currentId !== targetId && blockingSessions.length) {
    return { allowed: false, code: 'ACTIVE_SESSIONS', blockingSessions };
  }
  return { allowed: true, code: currentId ? 'SWITCH' : 'ACTIVATE' };
}

function studentCaptureStatus(descriptor, studentId) {
  const target = activeCaptureTarget(descriptor);
  return {
    ...target,
    isCurrentStudent: Boolean(target.enabled && target.studentId === String(studentId || '')),
  };
}

module.exports = {
  activeCaptureTarget,
  captureSwitchDecision,
  studentCaptureStatus,
};
