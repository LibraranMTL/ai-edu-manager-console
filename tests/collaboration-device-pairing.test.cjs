const test = require('node:test');
const assert = require('node:assert/strict');
const {
  acceptStudentMappingOffer,
  completeDevicePairing,
  createDevicePairingInvitation,
  createStudentMappingOffer,
  publicDeviceConnectionInfo,
  verifyDevicePairingConfirmation,
  verifyPairingCode,
  verifyStudentMappingAcceptance,
} = require('../electron/collaboration-device-pairing.cjs');

const nodeA = { nodeId: 'node-a', displayName: '主机 A' };
const nodeB = { nodeId: 'node-b', displayName: '主机 B' };
const offersA = [{ transportId: 'lan_direct', protocolVersion: '1.1', endpoints: ['http://10.0.0.1:18777'] }];
const offersB = [{ transportId: 'lan_direct', protocolVersion: '1.1', endpoints: ['http://10.0.0.2:18777'] }];

test('six-digit device pairing creates one role-neutral trusted transport binding', () => {
  const invitation = createDevicePairingInvitation({ inviterNode: nodeA, pairingCode: '123456', requestToken: 'test-secret', transportOffers: offersA, createdAt: '2026-08-10T00:00:00.000Z', expiresAt: '2026-08-10T01:00:00.000Z' });
  const publicInfo = publicDeviceConnectionInfo(invitation);
  assert.equal(publicInfo.pairingCode, '123456');
  assert.equal('requestToken' in publicInfo, false);
  assert.equal(verifyPairingCode(invitation, '123456', Date.parse('2026-08-10T00:05:00.000Z')), true);
  const completed = completeDevicePairing(invitation, nodeB, { pairingCode: '123456', transportOffers: offersB, nowValue: Date.parse('2026-08-10T00:05:00.000Z') });
  assert.equal(completed.binding.roleAssignments.length, 0);
  assert.deepEqual(completed.binding.participantNodeIds, ['node-a', 'node-b']);
  assert.equal(completed.deviceBinding.origin, 'native');
  const verified = verifyDevicePairingConfirmation(completed.confirmation, { localNodeId: 'node-b' });
  assert.equal(verified.secret, 'test-secret');
  assert.equal(verified.binding.bindingId, invitation.transportBindingId);
  assert.equal(verified.deviceBinding.deviceBindingId, completed.deviceBinding.deviceBindingId);
});

test('device pairing rejects wrong and expired codes', () => {
  const invitation = createDevicePairingInvitation({ inviterNode: nodeA, pairingCode: '123456', requestToken: 'test-secret', createdAt: '2026-08-10T00:00:00.000Z', expiresAt: '2026-08-10T00:15:00.000Z' });
  assert.throws(() => verifyPairingCode(invitation, '654321', Date.parse('2026-08-10T00:05:00.000Z')), /不正确/);
  assert.throws(() => verifyPairingCode(invitation, '123456', Date.parse('2026-08-10T00:16:00.000Z')), /过期/);
});

test('trusted devices add exact symmetric student mappings without another device pairing', () => {
  const secret = 'device-shared-secret';
  const offer = createStudentMappingOffer({
    deviceBindingId: 'device-binding-1',
    transportBindingId: 'binding-device',
    inviterNodeId: 'node-a',
    inviterStudentId: 'student-a',
    inviterStudentName: '学生甲',
    secret,
    createdAt: '2026-08-10T00:00:00.000Z',
    expiresAt: '2026-08-10T01:00:00.000Z',
  });
  const accepted = acceptStudentMappingOffer(offer, {
    acceptingNodeId: 'node-b',
    acceptingStudentId: 'student-b',
    secret,
    nowValue: Date.parse('2026-08-10T00:05:00.000Z'),
  });
  assert.deepEqual(accepted.studentMap.participantStudents, [
    { nodeId: 'node-a', studentId: 'student-a' },
    { nodeId: 'node-b', studentId: 'student-b' },
  ]);
  assert.equal(accepted.mappingBinding.roleAssignments.length, 4);
  const verified = verifyStudentMappingAcceptance(accepted.acceptance, { offer, secret });
  assert.equal(verified.studentMap.studentMapId, accepted.studentMap.studentMapId);
  assert.equal(verified.mappingBinding.bindingId, offer.mappingBindingId);
});
