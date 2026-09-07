const assert = require('node:assert/strict');
const test = require('node:test');

const {
  activeCaptureTarget,
  captureSwitchDecision,
  studentCaptureStatus,
} = require('../electron/agent-capture-coordinator.cjs');

const activeDescriptor = {
  authentication: { grantId: 'grant-hunter' },
  defaults: { scopeId: 'hunter', scopeName: 'Hunter' },
  lifecycleCapture: { enabled: true },
};

test('the active descriptor is the single source of truth for the machine capture target', () => {
  assert.deepEqual(activeCaptureTarget(activeDescriptor), {
    enabled: true,
    studentId: 'hunter',
    studentName: 'Hunter',
    grantId: 'grant-hunter',
  });
  assert.equal(studentCaptureStatus(activeDescriptor, 'hunter').isCurrentStudent, true);
  assert.equal(studentCaptureStatus(activeDescriptor, 'baoshuyuan').isCurrentStudent, false);
  assert.equal(activeCaptureTarget({ lifecycleCapture: { enabled: false }, defaults: { scopeId: 'hunter' } }).studentId, '');
});

test('switching students is allowed only when the previous target has no active lifecycle sessions', () => {
  const currentTarget = activeCaptureTarget(activeDescriptor);
  const idle = captureSwitchDecision({ currentTarget, targetStudentId: 'baoshuyuan', activeSessions: [] });
  assert.deepEqual(idle, { allowed: true, code: 'SWITCH' });

  const blocked = captureSwitchDecision({
    currentTarget,
    targetStudentId: 'baoshuyuan',
    activeSessions: [{
      sessionId: 'session-1',
      status: 'active',
      origin: 'authorized_agent',
      idempotencyKey: 'lifecycle:codex:native-1',
    }],
  });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.code, 'ACTIVE_SESSIONS');
  assert.equal(blocked.blockingSessions.length, 1);
});

test('non-lifecycle and finalized sessions never block a student switch', () => {
  const decision = captureSwitchDecision({
    currentTarget: activeCaptureTarget(activeDescriptor),
    targetStudentId: 'baoshuyuan',
    activeSessions: [
      { status: 'completed', origin: 'authorized_agent', idempotencyKey: 'lifecycle:codex:old' },
      { status: 'active', origin: 'manual', idempotencyKey: 'manual:1' },
    ],
  });
  assert.deepEqual(decision, { allowed: true, code: 'SWITCH' });
});

test('reactivating the current student is idempotent and an empty target activates directly', () => {
  assert.deepEqual(captureSwitchDecision({
    currentTarget: activeCaptureTarget(activeDescriptor),
    targetStudentId: 'hunter',
    activeSessions: [{ status: 'active', origin: 'authorized_agent', idempotencyKey: 'lifecycle:codex:1' }],
  }), { allowed: true, code: 'ALREADY_ACTIVE' });
  assert.deepEqual(captureSwitchDecision({ currentTarget: {}, targetStudentId: 'hunter' }), { allowed: true, code: 'ACTIVATE' });
});
