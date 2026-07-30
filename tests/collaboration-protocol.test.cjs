const assert = require('node:assert/strict');
const test = require('node:test');

const {
  authorityAllowsWrite,
  acceptCollaborationInvitation,
  createCollaborationInvitation,
  createPeerBinding,
  grantAllows,
  nodeHasRole,
  normalizeCollaborationGrant,
  normalizeNodeIdentity,
  stableNodeId,
  transitionPeerBinding,
  verifyCollaborationAcceptance,
} = require('../electron/collaboration-protocol.cjs');

test('node identities are neutral and migrate existing host identities without a fixed role', () => {
  const node = normalizeNodeIdentity({
    hostId: 'host-existing-1',
    displayName: '家庭电脑',
    machineCode: 'H-ABCD-2345',
    capabilities: ['tasks', 'knowledge'],
  });
  assert.equal(node.nodeId, 'host-existing-1');
  assert.equal(Object.hasOwn(node, 'nodeType'), false);
  assert.deepEqual(node.capabilities, ['tasks', 'knowledge']);
  assert.equal(stableNodeId('same-seed'), stableNodeId('same-seed'));
});

test('the same node can hold different roles in different collaboration bindings', () => {
  const first = createPeerBinding({
    participantNodeIds: ['node-a', 'node-b'],
    roleAssignments: [
      { nodeId: 'node-a', role: 'educator', studentId: 'student-b' },
      { nodeId: 'node-b', role: 'learner_authority', studentId: 'student-b' },
    ],
  });
  const second = createPeerBinding({
    participantNodeIds: ['node-a', 'node-c'],
    roleAssignments: [
      { nodeId: 'node-c', role: 'educator', studentId: 'student-a' },
      { nodeId: 'node-a', role: 'learner_authority', studentId: 'student-a' },
    ],
  });
  assert.equal(nodeHasRole(first, 'node-a', 'educator', 'student-b'), true);
  assert.equal(nodeHasRole(second, 'node-a', 'learner_authority', 'student-a'), true);
  assert.equal(nodeHasRole(first, 'node-a', 'learner_authority', 'student-b'), false);
});

test('learner authority roles require a student and roles cannot target unbound nodes', () => {
  assert.throws(() => createPeerBinding({
    participantNodeIds: ['node-a', 'node-b'],
    roleAssignments: [{ nodeId: 'node-a', role: 'learner_authority' }],
  }), /studentId/);
  assert.throws(() => createPeerBinding({
    participantNodeIds: ['node-a', 'node-b'],
    roleAssignments: [{ nodeId: 'node-c', role: 'educator' }],
  }), /不属于当前绑定/);
});

test('collaboration grants enforce node, student, project, operation and expiry', () => {
  const grant = normalizeCollaborationGrant({
    bindingId: 'binding-1',
    issuerNodeId: 'node-student',
    granteeNodeId: 'node-teacher',
    authorityNodeId: 'node-student',
    studentId: 'student-1',
    projectIds: ['project-1'],
    operations: ['material:stats:read', 'knowledge:search'],
    expiresAt: '2026-08-01T00:00:00.000Z',
  });
  const now = Date.parse('2026-07-24T00:00:00.000Z');
  assert.equal(grantAllows(grant, {
    granteeNodeId: 'node-teacher',
    authorityNodeId: 'node-student',
    studentId: 'student-1',
    projectId: 'project-1',
    operation: 'material:stats:read',
  }, now).ok, true);
  assert.equal(grantAllows(grant, { granteeNodeId: 'other-node' }, now).code, 'GRANTEE_MISMATCH');
  assert.equal(grantAllows(grant, { studentId: 'student-2' }, now).code, 'STUDENT_SCOPE_MISMATCH');
  assert.equal(grantAllows(grant, { operation: 'asset:download' }, now).code, 'OPERATION_NOT_ALLOWED');
  assert.equal(grantAllows(grant, {}, Date.parse('2026-08-02T00:00:00.000Z')).code, 'GRANT_EXPIRED');
});

test('navigation role never grants write authority', () => {
  const record = { objectId: 'knowledge-1', authorityNodeId: 'node-student' };
  assert.equal(authorityAllowsWrite(record, 'node-student'), true);
  assert.equal(authorityAllowsWrite(record, 'node-teacher'), false);
});

test('peer bindings can pause and resume, while revoked bindings stay revoked', () => {
  const binding = createPeerBinding({
    participantNodeIds: ['node-a', 'node-b'],
    roleAssignments: [
      { nodeId: 'node-a', role: 'educator' },
      { nodeId: 'node-b', role: 'learner_authority', studentId: 'student-1' },
    ],
  });
  const paused = transitionPeerBinding(binding, 'paused', '2026-07-24T10:00:00.000Z');
  assert.equal(paused.status, 'paused');
  const resumed = transitionPeerBinding(paused, 'active', '2026-07-24T11:00:00.000Z');
  assert.equal(resumed.status, 'active');
  const revoked = transitionPeerBinding(resumed, 'revoked', '2026-07-24T12:00:00.000Z');
  assert.throws(() => transitionPeerBinding(revoked, 'active'), /不能恢复/);
});

test('manual collaboration invitations produce a bilateral verified binding', () => {
  const invitation = createCollaborationInvitation({
    inviterNode: { nodeId: 'node-student', displayName: '学生电脑' },
    inviterRole: { role: 'learner_authority', studentId: 'student-1' },
    requestedRole: 'educator',
    studentId: 'student-1',
    studentName: '学生一',
    createdAt: '2026-07-24T10:00:00.000Z',
    expiresAt: '2026-07-24T10:15:00.000Z',
    requestToken: 'test-only-random-token',
  });
  const accepted = acceptCollaborationInvitation(
    invitation,
    { nodeId: 'node-teacher', displayName: '教师电脑' },
    Date.parse('2026-07-24T10:05:00.000Z'),
  );
  const verified = verifyCollaborationAcceptance(accepted.acceptance, invitation);
  assert.equal(nodeHasRole(verified, 'node-student', 'learner_authority', 'student-1'), true);
  assert.equal(nodeHasRole(verified, 'node-teacher', 'educator', 'student-1'), true);
  assert.throws(
    () => acceptCollaborationInvitation(invitation, { nodeId: 'node-teacher' }, Date.parse('2026-07-24T10:16:00.000Z')),
    /已过期/,
  );
});

test('manual collaboration invitations keep separate local student ids on each host', () => {
  const invitation = createCollaborationInvitation({
    inviterNode: { nodeId: 'node-teacher', displayName: 'Teacher host' },
    inviterRole: { role: 'educator', studentId: 'teacher-local-student' },
    requestedRole: 'learner_authority',
    studentId: 'teacher-local-student',
    studentName: 'Same student',
    createdAt: '2026-07-25T10:00:00.000Z',
    expiresAt: '2026-07-25T10:15:00.000Z',
    requestToken: 'test-only-cross-host-token',
  });
  const accepted = acceptCollaborationInvitation(
    invitation,
    { nodeId: 'node-student', displayName: 'Student host' },
    Date.parse('2026-07-25T10:05:00.000Z'),
    { studentId: 'student-host-local-student' },
  );
  const verified = verifyCollaborationAcceptance(accepted.acceptance, invitation);
  assert.equal(nodeHasRole(verified, 'node-teacher', 'educator', 'teacher-local-student'), true);
  assert.equal(nodeHasRole(verified, 'node-student', 'learner_authority', 'student-host-local-student'), true);
});

test('manual collaboration binding negotiates direct endpoints without exposing a network bearer token', () => {
  const educatorNode = { nodeId: 'node-educator-direct', displayName: 'Educator host' };
  const learnerNode = { nodeId: 'node-learner-direct', displayName: 'Learner host' };
  const invitation = createCollaborationInvitation({
    inviterNode: educatorNode,
    inviterRole: { role: 'educator', studentId: 'student-educator-local' },
    requestedRole: 'learner_authority',
    transportOffers: [{
      transportId: 'lan_direct',
      protocolVersion: '1.0',
      endpoints: ['http://192.168.1.10:18777'],
      preferred: true,
    }],
  });
  const accepted = acceptCollaborationInvitation(invitation, learnerNode, Date.now(), {
    studentId: 'student-learner-local',
    transportOffers: [{
      transportId: 'lan_direct',
      protocolVersion: '1.0',
      endpoints: ['http://192.168.1.11:18777'],
      preferred: true,
    }],
  });
  assert.equal(accepted.binding.sharedSecretRef, invitation.requestTokenHash);
  assert.deepEqual(
    accepted.binding.transportOffers.map((item) => [item.nodeId, item.endpoints[0]]),
    [
      [educatorNode.nodeId, 'http://192.168.1.10:18777'],
      [learnerNode.nodeId, 'http://192.168.1.11:18777'],
    ],
  );
  assert.equal(JSON.stringify(accepted.acceptance).includes(invitation.requestToken), false);
});
