const crypto = require('node:crypto');
const {
  COLLABORATION_PROTOCOL_VERSION,
  createPeerBinding,
  normalizeNodeIdentity,
  normalizeTransportOffers,
} = require('./collaboration-protocol.cjs');
const { normalizeDeviceBinding, normalizeStudentMap } = require('./collaboration-device-binding.cjs');

const DEVICE_INVITATION_SCHEMA = 'edu-manager.collaboration-device-invitation.v1';
const DEVICE_CONFIRMATION_SCHEMA = 'edu-manager.collaboration-device-confirmation.v1';
const DEVICE_CONNECTION_SCHEMA = 'edu-manager.collaboration-device-connection.v1';
const STUDENT_MAPPING_OFFER_SCHEMA = 'edu-manager.collaboration-student-map-offer.v1';
const STUDENT_MAPPING_ACCEPTANCE_SCHEMA = 'edu-manager.collaboration-student-map-acceptance.v1';

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function hmac(secret, values) {
  return crypto.createHmac('sha256', String(secret || '')).update(values.map((value) => String(value || '')).join('\u001f')).digest('hex');
}

function timingSafeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sixDigitCode(value) {
  const code = String(value || '').replace(/\D/g, '');
  if (!/^\d{6}$/.test(code)) throw new Error('设备配对码必须是六位数字。');
  return code;
}

function assertNotExpired(value, nowValue = Date.now()) {
  if (Date.parse(String(value || '')) <= Number(nowValue)) throw new Error('设备配对信息已过期，请重新生成。');
}

function normalizeOffers(input) {
  return normalizeTransportOffers(Array.isArray(input) ? input : []).slice(0, 10);
}

function createDevicePairingInvitation(input = {}) {
  const inviterNode = normalizeNodeIdentity(input.inviterNode || {});
  const pairingCode = sixDigitCode(input.pairingCode || String(crypto.randomInt(0, 1_000_000)).padStart(6, '0'));
  const requestToken = String(input.requestToken || crypto.randomBytes(32).toString('base64url'));
  const createdAt = String(input.createdAt || new Date().toISOString());
  const invitationId = String(input.invitationId || `device-invitation-${crypto.randomUUID()}`);
  const transportBindingId = String(input.transportBindingId || `binding-${crypto.randomUUID()}`);
  return {
    schema: DEVICE_INVITATION_SCHEMA,
    protocolVersion: COLLABORATION_PROTOCOL_VERSION,
    invitationId,
    transportBindingId,
    inviterNode,
    transportOffers: normalizeOffers(input.transportOffers),
    requestToken,
    requestTokenHash: sha256(requestToken),
    pairingCodeHash: sha256(`${invitationId}\u001f${pairingCode}\u001f${requestToken}`),
    pairingCode,
    createdAt,
    expiresAt: String(input.expiresAt || new Date(Date.parse(createdAt) + 15 * 60 * 1000).toISOString()),
  };
}

function publicDeviceConnectionInfo(invitation) {
  if (invitation?.schema !== DEVICE_INVITATION_SCHEMA) throw new Error('设备配对邀请格式无效。');
  return {
    schema: DEVICE_CONNECTION_SCHEMA,
    protocolVersion: invitation.protocolVersion,
    invitationId: invitation.invitationId,
    nodeId: invitation.inviterNode.nodeId,
    displayName: invitation.inviterNode.displayName,
    endpoints: invitation.transportOffers.flatMap((offer) => offer.endpoints || []),
    pairingCode: invitation.pairingCode,
    expiresAt: invitation.expiresAt,
  };
}

function verifyPairingCode(invitation, pairingCode, nowValue = Date.now()) {
  if (invitation?.schema !== DEVICE_INVITATION_SCHEMA) throw new Error('设备配对邀请格式无效。');
  assertNotExpired(invitation.expiresAt, nowValue);
  const code = sixDigitCode(pairingCode);
  const expected = sha256(`${invitation.invitationId}\u001f${code}\u001f${invitation.requestToken}`);
  if (!timingSafeEqual(expected, invitation.pairingCodeHash)) throw new Error('设备配对码不正确或已经失效。');
  return true;
}

function deviceConfirmationProof(confirmation, secret) {
  return hmac(secret, [
    confirmation.invitationId,
    confirmation.transportBindingId,
    confirmation.inviterNode?.nodeId,
    confirmation.acceptingNode?.nodeId,
    confirmation.confirmedAt,
    sha256(JSON.stringify(confirmation.binding || {})),
    sha256(JSON.stringify(confirmation.deviceBinding || {})),
  ]);
}

function completeDevicePairing(invitation, acceptingNodeInput, options = {}) {
  verifyPairingCode(invitation, options.pairingCode, options.nowValue);
  const acceptingNode = normalizeNodeIdentity(acceptingNodeInput || {});
  if (acceptingNode.nodeId === invitation.inviterNode.nodeId) throw new Error('不能将本机与自身建立知识协作。');
  const binding = createPeerBinding({
    bindingId: invitation.transportBindingId,
    participantNodeIds: [invitation.inviterNode.nodeId, acceptingNode.nodeId],
    roleAssignments: [],
    sharedSecretRef: invitation.requestTokenHash,
    transportOffers: [
      ...invitation.transportOffers.map((offer) => ({ ...offer, nodeId: invitation.inviterNode.nodeId })),
      ...normalizeOffers(options.transportOffers).map((offer) => ({ ...offer, nodeId: acceptingNode.nodeId })),
    ],
    status: 'active',
    createdAt: invitation.createdAt,
  });
  const deviceBinding = normalizeDeviceBinding({
    participantNodeIds: [invitation.inviterNode.nodeId, acceptingNode.nodeId],
    status: 'active',
    capabilities: ['device-trust-v1', 'student-mapping-v1'],
    transportOffers: binding.transportOffers,
    transportBindingIds: [binding.bindingId],
    origin: 'native',
    createdAt: invitation.createdAt,
  });
  const confirmation = {
    schema: DEVICE_CONFIRMATION_SCHEMA,
    protocolVersion: COLLABORATION_PROTOCOL_VERSION,
    confirmationId: `device-confirmation-${crypto.randomUUID()}`,
    invitationId: invitation.invitationId,
    transportBindingId: invitation.transportBindingId,
    inviterNode: invitation.inviterNode,
    acceptingNode,
    binding,
    deviceBinding,
    sharedSecret: invitation.requestToken,
    confirmedAt: new Date(Number(options.nowValue || Date.now())).toISOString(),
  };
  confirmation.proof = deviceConfirmationProof(confirmation, invitation.requestToken);
  return { binding, deviceBinding, confirmation, secret: invitation.requestToken };
}

function verifyDevicePairingConfirmation(confirmation, options = {}) {
  if (confirmation?.schema !== DEVICE_CONFIRMATION_SCHEMA) throw new Error('设备配对确认格式无效。');
  if (confirmation.protocolVersion !== COLLABORATION_PROTOCOL_VERSION) throw new Error('设备配对协议版本不兼容。');
  const secret = String(confirmation.sharedSecret || '');
  if (!secret || sha256(secret) !== String(confirmation.binding?.sharedSecretRef || '')) throw new Error('设备配对共享密钥校验失败。');
  if (!timingSafeEqual(confirmation.proof, deviceConfirmationProof(confirmation, secret))) throw new Error('设备配对确认签名无效。');
  const localNodeId = String(options.localNodeId || '');
  if (localNodeId && !confirmation.binding?.participantNodeIds?.includes(localNodeId)) throw new Error('设备配对确认不属于本机。');
  const binding = createPeerBinding(confirmation.binding);
  const deviceBinding = normalizeDeviceBinding(confirmation.deviceBinding || {
    participantNodeIds: binding.participantNodeIds,
    transportOffers: binding.transportOffers,
    transportBindingIds: [binding.bindingId],
    origin: 'native',
    createdAt: binding.createdAt,
  });
  if (deviceBinding.participantNodeIds.join('|') !== [...binding.participantNodeIds].sort().join('|')) {
    throw new Error('设备配对确认中的设备关系与传输关系不一致。');
  }
  return { binding, deviceBinding, secret };
}

function mappingOfferProof(offer, secret) {
  return hmac(secret, [offer.offerId, offer.deviceBindingId, offer.transportBindingId, offer.mappingBindingId, offer.inviterNodeId, offer.inviterStudentId, offer.expiresAt]);
}

function createStudentMappingOffer(input = {}) {
  const secret = String(input.secret || '');
  if (!secret) throw new Error('协作设备缺少本机信任凭据。');
  const createdAt = String(input.createdAt || new Date().toISOString());
  const offer = {
    schema: STUDENT_MAPPING_OFFER_SCHEMA,
    protocolVersion: COLLABORATION_PROTOCOL_VERSION,
    offerId: String(input.offerId || `student-map-offer-${crypto.randomUUID()}`),
    deviceBindingId: String(input.deviceBindingId || ''),
    transportBindingId: String(input.transportBindingId || ''),
    mappingBindingId: String(input.mappingBindingId || `binding-${crypto.randomUUID()}`),
    inviterNodeId: String(input.inviterNodeId || ''),
    inviterStudentId: String(input.inviterStudentId || ''),
    inviterStudentName: String(input.inviterStudentName || '').trim().slice(0, 120),
    createdAt,
    expiresAt: String(input.expiresAt || new Date(Date.parse(createdAt) + 30 * 60 * 1000).toISOString()),
  };
  if (!offer.deviceBindingId || !offer.transportBindingId || !offer.inviterNodeId || !offer.inviterStudentId) throw new Error('学生映射邀请信息不完整。');
  offer.proof = mappingOfferProof(offer, secret);
  return offer;
}

function mappingAcceptanceProof(acceptance, secret) {
  return hmac(secret, [acceptance.offerId, acceptance.studentMap?.studentMapId, acceptance.mappingBinding?.bindingId, sha256(JSON.stringify(acceptance.studentMap || {})), sha256(JSON.stringify(acceptance.mappingBinding || {}))]);
}

function acceptStudentMappingOffer(offer, input = {}) {
  if (offer?.schema !== STUDENT_MAPPING_OFFER_SCHEMA) throw new Error('学生映射邀请格式无效。');
  assertNotExpired(offer.expiresAt, input.nowValue);
  const secret = String(input.secret || '');
  if (!secret || !timingSafeEqual(offer.proof, mappingOfferProof(offer, secret))) throw new Error('学生映射邀请未通过设备信任校验。');
  const acceptingNodeId = String(input.acceptingNodeId || '');
  const acceptingStudentId = String(input.acceptingStudentId || '');
  if (!acceptingNodeId || !acceptingStudentId || acceptingNodeId === offer.inviterNodeId) throw new Error('接收端学生映射信息无效。');
  const studentMap = normalizeStudentMap({
    deviceBindingId: offer.deviceBindingId,
    participantStudents: [
      { nodeId: offer.inviterNodeId, studentId: offer.inviterStudentId },
      { nodeId: acceptingNodeId, studentId: acceptingStudentId },
    ],
    status: 'active',
    transportBindingIds: [offer.mappingBindingId],
    origin: 'native',
    createdAt: offer.createdAt,
  });
  const roleAssignments = [
    { nodeId: offer.inviterNodeId, role: 'educator', studentId: offer.inviterStudentId },
    { nodeId: offer.inviterNodeId, role: 'learner_authority', studentId: offer.inviterStudentId },
    { nodeId: acceptingNodeId, role: 'educator', studentId: acceptingStudentId },
    { nodeId: acceptingNodeId, role: 'learner_authority', studentId: acceptingStudentId },
  ];
  const mappingBinding = createPeerBinding({
    bindingId: offer.mappingBindingId,
    participantNodeIds: [offer.inviterNodeId, acceptingNodeId],
    roleAssignments,
    sharedSecretRef: sha256(secret),
    transportOffers: Array.isArray(input.transportOffers) ? input.transportOffers : [],
    status: 'active',
    createdAt: offer.createdAt,
  });
  const acceptance = {
    schema: STUDENT_MAPPING_ACCEPTANCE_SCHEMA,
    protocolVersion: COLLABORATION_PROTOCOL_VERSION,
    acceptanceId: `student-map-acceptance-${crypto.randomUUID()}`,
    offerId: offer.offerId,
    deviceBindingId: offer.deviceBindingId,
    studentMap,
    mappingBinding,
    acceptedAt: new Date(Number(input.nowValue || Date.now())).toISOString(),
  };
  acceptance.proof = mappingAcceptanceProof(acceptance, secret);
  return { acceptance, studentMap, mappingBinding };
}

function verifyStudentMappingAcceptance(acceptance, input = {}) {
  if (acceptance?.schema !== STUDENT_MAPPING_ACCEPTANCE_SCHEMA) throw new Error('学生映射确认格式无效。');
  const offer = input.offer;
  const secret = String(input.secret || '');
  if (!offer || acceptance.offerId !== offer.offerId || acceptance.deviceBindingId !== offer.deviceBindingId) throw new Error('学生映射确认与本机邀请不匹配。');
  if (!secret || !timingSafeEqual(acceptance.proof, mappingAcceptanceProof(acceptance, secret))) throw new Error('学生映射确认未通过设备信任校验。');
  const binding = createPeerBinding(acceptance.mappingBinding);
  const studentMap = normalizeStudentMap(acceptance.studentMap);
  if (!binding.participantNodeIds.includes(offer.inviterNodeId) || studentMap.deviceBindingId !== offer.deviceBindingId) throw new Error('学生映射确认的设备范围不匹配。');
  return { studentMap, mappingBinding: binding };
}

module.exports = {
  DEVICE_CONFIRMATION_SCHEMA,
  DEVICE_CONNECTION_SCHEMA,
  DEVICE_INVITATION_SCHEMA,
  STUDENT_MAPPING_ACCEPTANCE_SCHEMA,
  STUDENT_MAPPING_OFFER_SCHEMA,
  acceptStudentMappingOffer,
  completeDevicePairing,
  createDevicePairingInvitation,
  createStudentMappingOffer,
  publicDeviceConnectionInfo,
  verifyDevicePairingConfirmation,
  verifyPairingCode,
  verifyStudentMappingAcceptance,
};
