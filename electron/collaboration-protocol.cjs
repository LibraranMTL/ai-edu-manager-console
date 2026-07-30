const crypto = require('node:crypto');

const COLLABORATION_PROTOCOL_VERSION = '1.0';
const NODE_SCHEMA = 'edu-manager.collaboration-node.v1';
const BINDING_SCHEMA = 'edu-manager.peer-binding.v1';
const GRANT_SCHEMA = 'edu-manager.collaboration-grant.v1';
const INVITATION_SCHEMA = 'edu-manager.collaboration-invitation.v1';
const ACCEPTANCE_SCHEMA = 'edu-manager.collaboration-acceptance.v1';
const NODE_ROLES = new Set(['educator', 'learner_authority']);
const GRANT_OPERATIONS = new Set([
  'task:assign',
  'material:send',
  'material:stats:read',
  'submission:read',
  'knowledge:search',
  'knowledge:read',
  'asset:preview',
  'asset:download',
  'agent:execute',
  'contribution:create',
]);
const BINDING_STATUSES = new Set(['active', 'paused', 'revoked']);

function stringList(value, limit = 100) {
  return Array.from(new Set((Array.isArray(value) ? value : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)))
    .slice(0, limit);
}

function normalizeTransportOffers(input = []) {
  return (Array.isArray(input) ? input : [])
    .map((item) => ({
      transportId: String(item?.transportId || '').trim(),
      protocolVersion: String(item?.protocolVersion || '').trim(),
      endpoints: stringList(item?.endpoints, 20),
      preferred: Boolean(item?.preferred),
    }))
    .filter((item) => item.transportId && item.endpoints.length)
    .slice(0, 10);
}

function normalizeBindingTransportOffers(input = []) {
  return (Array.isArray(input) ? input : [])
    .map((item) => ({
      ...normalizeTransportOffers([item])[0],
      nodeId: String(item?.nodeId || '').trim(),
    }))
    .filter((item) => item.transportId && item.nodeId && item.endpoints.length)
    .slice(0, 20);
}

function stableNodeId(seed) {
  const source = String(seed || '').trim();
  if (!source) return `node-${crypto.randomUUID()}`;
  return `node-${crypto.createHash('sha256').update(source).digest('hex').slice(0, 24)}`;
}

function normalizeNodeIdentity(input = {}) {
  const legacyId = String(input.nodeId || input.hostId || input.deviceId || '').trim();
  const nodeId = legacyId || stableNodeId(input.machineCode || input.publicKey || input.displayName);
  return {
    schema: NODE_SCHEMA,
    protocolVersion: COLLABORATION_PROTOCOL_VERSION,
    nodeId,
    displayName: String(input.displayName || input.hostName || input.deviceName || '教育管家节点').trim().slice(0, 80),
    machineCode: String(input.machineCode || '').trim().toUpperCase(),
    ownerIdentityId: String(input.ownerIdentityId || '').trim(),
    publicKey: String(input.publicKey || '').trim(),
    capabilities: stringList(input.capabilities, 50),
    transportOffers: normalizeTransportOffers(input.transportOffers),
    createdAt: String(input.createdAt || new Date().toISOString()),
    revokedAt: input.revokedAt ? String(input.revokedAt) : '',
  };
}

function normalizeRoleAssignment(input = {}) {
  const role = String(input.role || '').trim();
  if (!NODE_ROLES.has(role)) {
    throw new Error(`不支持的协作角色：${role || '空'}`);
  }
  const nodeId = String(input.nodeId || '').trim();
  if (!nodeId) throw new Error('角色分配缺少 nodeId。');
  const studentId = String(input.studentId || '').trim();
  if (role === 'learner_authority' && !studentId) {
    throw new Error('learner_authority 必须关联 studentId。');
  }
  return {
    nodeId,
    actorId: String(input.actorId || '').trim(),
    role,
    studentId,
    scope: stringList(input.scope, 100),
    createdAt: String(input.createdAt || new Date().toISOString()),
    revokedAt: input.revokedAt ? String(input.revokedAt) : '',
  };
}

function createPeerBinding(input = {}) {
  const participantNodeIds = stringList(input.participantNodeIds, 10);
  if (participantNodeIds.length < 2) throw new Error('协作绑定至少需要两个不同节点。');
  const roleAssignments = (Array.isArray(input.roleAssignments) ? input.roleAssignments : [])
    .map(normalizeRoleAssignment);
  const participantSet = new Set(participantNodeIds);
  if (roleAssignments.some((item) => !participantSet.has(item.nodeId))) {
    throw new Error('角色分配中的节点不属于当前绑定。');
  }
  return {
    schema: BINDING_SCHEMA,
    protocolVersion: COLLABORATION_PROTOCOL_VERSION,
    bindingId: String(input.bindingId || `binding-${crypto.randomUUID()}`),
    participantNodeIds,
    roleAssignments,
    sharedSecretRef: String(input.sharedSecretRef || '').trim(),
    status: String(input.status || 'active'),
    capabilities: stringList(input.capabilities, 50),
    transportOffers: normalizeBindingTransportOffers(input.transportOffers),
    createdAt: String(input.createdAt || new Date().toISOString()),
    lastSeenAt: input.lastSeenAt ? String(input.lastSeenAt) : '',
    revokedAt: input.revokedAt ? String(input.revokedAt) : '',
  };
}

function transitionPeerBinding(binding, status, now = new Date().toISOString()) {
  if (!binding?.bindingId) throw new Error('协作关系缺少 bindingId。');
  const nextStatus = String(status || '').trim();
  if (!BINDING_STATUSES.has(nextStatus)) throw new Error(`不支持的协作关系状态：${nextStatus || '空'}`);
  if (binding.status === 'revoked' && nextStatus !== 'revoked') {
    throw new Error('已撤销的协作关系不能恢复，请重新建立协作关系。');
  }
  return {
    ...binding,
    status: nextStatus,
    pausedAt: nextStatus === 'paused' ? now : '',
    revokedAt: nextStatus === 'revoked' ? now : '',
    lastSeenAt: nextStatus === 'active' ? now : binding.lastSeenAt || '',
  };
}

function createCollaborationInvitation(input = {}) {
  const inviterNode = normalizeNodeIdentity(input.inviterNode || {});
  const inviterRole = normalizeRoleAssignment({ ...(input.inviterRole || {}), nodeId: inviterNode.nodeId });
  const requestedRole = String(input.requestedRole || '').trim();
  if (!NODE_ROLES.has(requestedRole) || requestedRole === inviterRole.role) {
    throw new Error('协作邀请必须指定与邀请方互补的角色。');
  }
  const requestToken = String(input.requestToken || crypto.randomBytes(24).toString('base64url'));
  const createdAt = String(input.createdAt || new Date().toISOString());
  const expiresAt = String(input.expiresAt || new Date(Date.parse(createdAt) + 15 * 60 * 1000).toISOString());
  return {
    schema: INVITATION_SCHEMA,
    protocolVersion: COLLABORATION_PROTOCOL_VERSION,
    invitationId: String(input.invitationId || `invitation-${crypto.randomUUID()}`),
    bindingId: String(input.bindingId || `binding-${crypto.randomUUID()}`),
    inviterNode,
    inviterRole,
    requestedRole,
    studentId: String(input.studentId || inviterRole.studentId || ''),
    studentName: String(input.studentName || '').trim().slice(0, 120),
    requestToken,
    requestTokenHash: crypto.createHash('sha256').update(requestToken).digest('hex'),
    transportOffers: normalizeTransportOffers(input.transportOffers),
    createdAt,
    expiresAt,
  };
}

function acceptCollaborationInvitation(invitation, acceptingNodeInput, nowValue = Date.now(), options = {}) {
  if (invitation?.schema !== INVITATION_SCHEMA) throw new Error('协作邀请格式无效。');
  if (invitation.protocolVersion !== COLLABORATION_PROTOCOL_VERSION) throw new Error('协作邀请协议版本不兼容。');
  if (!invitation.requestToken || !invitation.requestTokenHash) throw new Error('协作邀请缺少请求令牌。');
  if (crypto.createHash('sha256').update(String(invitation.requestToken)).digest('hex') !== invitation.requestTokenHash) {
    throw new Error('协作邀请请求令牌校验失败。');
  }
  if (Date.parse(String(invitation.expiresAt || '')) <= Number(nowValue)) throw new Error('协作邀请已过期。');
  const acceptingNode = normalizeNodeIdentity(acceptingNodeInput || {});
  if (acceptingNode.nodeId === invitation.inviterNode.nodeId) throw new Error('不能接受本机发出的协作邀请。');
  const acceptingRole = normalizeRoleAssignment({
    nodeId: acceptingNode.nodeId,
    role: invitation.requestedRole,
    studentId: String(options.studentId || invitation.studentId || '').trim(),
  });
  const binding = createPeerBinding({
    bindingId: invitation.bindingId,
    participantNodeIds: [invitation.inviterNode.nodeId, acceptingNode.nodeId],
    roleAssignments: [invitation.inviterRole, acceptingRole],
    sharedSecretRef: invitation.requestTokenHash,
    transportOffers: [
      ...normalizeTransportOffers(invitation.transportOffers).map((item) => ({ ...item, nodeId: invitation.inviterNode.nodeId })),
      ...normalizeTransportOffers(options.transportOffers).map((item) => ({ ...item, nodeId: acceptingNode.nodeId })),
    ],
    status: 'active',
  });
  const acceptance = {
    schema: ACCEPTANCE_SCHEMA,
    protocolVersion: COLLABORATION_PROTOCOL_VERSION,
    acceptanceId: `acceptance-${crypto.randomUUID()}`,
    invitationId: invitation.invitationId,
    binding,
    acceptingNode,
    transportOffers: normalizeTransportOffers(options.transportOffers),
    requestTokenHash: invitation.requestTokenHash,
    acceptedAt: new Date(Number(nowValue)).toISOString(),
  };
  return { binding, acceptance };
}

function verifyCollaborationAcceptance(acceptance, pendingInvitation) {
  if (acceptance?.schema !== ACCEPTANCE_SCHEMA) throw new Error('协作接受回执格式无效。');
  if (!pendingInvitation || acceptance.invitationId !== pendingInvitation.invitationId) {
    throw new Error('协作接受回执与本机待处理邀请不匹配。');
  }
  if (acceptance.requestTokenHash !== pendingInvitation.requestTokenHash) {
    throw new Error('协作接受回执令牌不匹配。');
  }
  if (acceptance.binding?.bindingId !== pendingInvitation.bindingId) {
    throw new Error('协作接受回执绑定标识不匹配。');
  }
  return createPeerBinding(acceptance.binding);
}

function activeRoleAssignments(binding, options = {}) {
  const nodeId = String(options.nodeId || '').trim();
  const studentId = String(options.studentId || '').trim();
  const role = String(options.role || '').trim();
  if (!binding || binding.status !== 'active' || binding.revokedAt) return [];
  return (Array.isArray(binding.roleAssignments) ? binding.roleAssignments : []).filter((item) => (
    !item.revokedAt
    && (!nodeId || item.nodeId === nodeId)
    && (!studentId || item.studentId === studentId)
    && (!role || item.role === role)
  ));
}

function nodeHasRole(binding, nodeId, role, studentId = '') {
  return activeRoleAssignments(binding, { nodeId, role, studentId }).length > 0;
}

function normalizeCollaborationGrant(input = {}) {
  const operations = stringList(input.operations, 50);
  const invalid = operations.find((operation) => !GRANT_OPERATIONS.has(operation));
  if (invalid) throw new Error(`不支持的协作权限：${invalid}`);
  return {
    schema: GRANT_SCHEMA,
    protocolVersion: COLLABORATION_PROTOCOL_VERSION,
    grantId: String(input.grantId || `grant-${crypto.randomUUID()}`),
    bindingId: String(input.bindingId || '').trim(),
    issuerNodeId: String(input.issuerNodeId || '').trim(),
    granteeNodeId: String(input.granteeNodeId || '').trim(),
    authorityNodeId: String(input.authorityNodeId || '').trim(),
    studentId: String(input.studentId || '').trim(),
    projectIds: stringList(input.projectIds, 200),
    operations,
    knowledgeTypes: stringList(input.knowledgeTypes, 50),
    assetIds: stringList(input.assetIds, 500),
    createdAt: String(input.createdAt || new Date().toISOString()),
    expiresAt: input.expiresAt ? String(input.expiresAt) : '',
    revokedAt: input.revokedAt ? String(input.revokedAt) : '',
  };
}

function grantAllows(grant, request = {}, nowValue = Date.now()) {
  if (!grant || grant.revokedAt) return { ok: false, code: 'GRANT_REVOKED', message: '协作授权已撤销。' };
  const expiresAt = Date.parse(String(grant.expiresAt || ''));
  if (Number.isFinite(expiresAt) && expiresAt <= Number(nowValue)) {
    return { ok: false, code: 'GRANT_EXPIRED', message: '协作授权已过期。' };
  }
  if (request.granteeNodeId && String(request.granteeNodeId) !== String(grant.granteeNodeId)) {
    return { ok: false, code: 'GRANTEE_MISMATCH', message: '请求节点不在授权范围内。' };
  }
  if (request.authorityNodeId && String(request.authorityNodeId) !== String(grant.authorityNodeId)) {
    return { ok: false, code: 'AUTHORITY_MISMATCH', message: '目标数据权威节点不匹配。' };
  }
  if (request.studentId && String(request.studentId) !== String(grant.studentId)) {
    return { ok: false, code: 'STUDENT_SCOPE_MISMATCH', message: '请求学生不在授权范围内。' };
  }
  if (request.operation && !grant.operations.includes(String(request.operation))) {
    return { ok: false, code: 'OPERATION_NOT_ALLOWED', message: '当前授权不允许此操作。' };
  }
  if (request.projectId && grant.projectIds.length && !grant.projectIds.includes(String(request.projectId))) {
    return { ok: false, code: 'PROJECT_SCOPE_MISMATCH', message: '请求项目不在授权范围内。' };
  }
  return { ok: true };
}

function authorityAllowsWrite(object, nodeId) {
  const authorityNodeId = String(object?.authorityNodeId || '').trim();
  return Boolean(authorityNodeId && authorityNodeId === String(nodeId || '').trim());
}

module.exports = {
  BINDING_SCHEMA,
  ACCEPTANCE_SCHEMA,
  COLLABORATION_PROTOCOL_VERSION,
  GRANT_OPERATIONS,
  GRANT_SCHEMA,
  INVITATION_SCHEMA,
  NODE_ROLES,
  NODE_SCHEMA,
  activeRoleAssignments,
  authorityAllowsWrite,
  acceptCollaborationInvitation,
  createCollaborationInvitation,
  createPeerBinding,
  grantAllows,
  nodeHasRole,
  normalizeCollaborationGrant,
  normalizeNodeIdentity,
  normalizeRoleAssignment,
  normalizeTransportOffers,
  stableNodeId,
  transitionPeerBinding,
  verifyCollaborationAcceptance,
};
