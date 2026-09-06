const crypto = require('node:crypto');

const DEVICE_BINDING_SCHEMA = 'edu-manager.collaboration-device-binding.v1';
const STUDENT_MAP_SCHEMA = 'edu-manager.student-collaboration-map.v1';
const ACTIVE_STATUSES = new Set(['active', 'paused', 'revoked']);

function strings(values, limit = 100) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean))].slice(0, limit);
}

function stableId(prefix, values) {
  const digest = crypto.createHash('sha256').update(strings(values, 20).sort().join('\u001f')).digest('hex').slice(0, 32);
  return `${prefix}-${digest}`;
}

function normalizeStatus(value) {
  const status = String(value || 'active');
  return ACTIVE_STATUSES.has(status) ? status : 'active';
}

function normalizeDeviceBinding(input = {}) {
  const participantNodeIds = strings(input.participantNodeIds, 2).sort();
  if (participantNodeIds.length !== 2) throw new Error('Device collaboration requires exactly two different nodes.');
  return {
    schema: DEVICE_BINDING_SCHEMA,
    deviceBindingId: String(input.deviceBindingId || stableId('device-binding', participantNodeIds)),
    participantNodeIds,
    status: normalizeStatus(input.status),
    capabilities: strings(input.capabilities, 100),
    transportOffers: Array.isArray(input.transportOffers) ? input.transportOffers.slice(0, 40) : [],
    transportBindingIds: strings(input.transportBindingIds || input.legacyBindingIds, 100),
    origin: String(input.origin || 'native'),
    createdAt: String(input.createdAt || new Date().toISOString()),
    updatedAt: String(input.updatedAt || input.lastSeenAt || input.createdAt || new Date().toISOString()),
    revokedAt: input.revokedAt ? String(input.revokedAt) : '',
  };
}

function normalizeStudentMap(input = {}) {
  const participantStudents = (Array.isArray(input.participantStudents) ? input.participantStudents : [])
    .map((item) => ({ nodeId: String(item?.nodeId || '').trim(), studentId: String(item?.studentId || '').trim() }))
    .filter((item) => item.nodeId && item.studentId)
    .sort((left, right) => `${left.nodeId}:${left.studentId}`.localeCompare(`${right.nodeId}:${right.studentId}`));
  if (participantStudents.length !== 2 || participantStudents[0].nodeId === participantStudents[1].nodeId) {
    throw new Error('Student collaboration requires one exact student on each of two nodes.');
  }
  const deviceBindingId = String(input.deviceBindingId || '').trim();
  if (!deviceBindingId) throw new Error('Student collaboration is missing its device binding.');
  const endpoints = participantStudents.map((item) => `${item.nodeId}:${item.studentId}`);
  return {
    schema: STUDENT_MAP_SCHEMA,
    studentMapId: String(input.studentMapId || stableId('student-map', [deviceBindingId, ...endpoints])),
    deviceBindingId,
    participantStudents,
    status: normalizeStatus(input.status),
    syncKinds: strings(input.syncKinds?.length ? input.syncKinds : [
      'confirmed_knowledge',
      'growth_model',
      'learning_report',
      'education_archive',
    ], 20),
    transportBindingIds: strings(input.transportBindingIds || input.legacyBindingIds, 100),
    origin: String(input.origin || 'native'),
    createdAt: String(input.createdAt || new Date().toISOString()),
    updatedAt: String(input.updatedAt || input.createdAt || new Date().toISOString()),
    revokedAt: input.revokedAt ? String(input.revokedAt) : '',
  };
}

function mergedStatus(bindings) {
  if (bindings.some((item) => item.status === 'active' && !item.revokedAt)) return 'active';
  if (bindings.some((item) => item.status === 'paused' && !item.revokedAt)) return 'paused';
  return 'revoked';
}

function uniqueOffers(bindings) {
  const seen = new Set();
  return bindings.flatMap((binding) => Array.isArray(binding.transportOffers) ? binding.transportOffers : []).filter((offer) => {
    const key = JSON.stringify(offer);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 40);
}

function deriveCollaborationRelationships(input = {}) {
  const legacyBindings = Array.isArray(input.bindings) ? input.bindings : [];
  const legacyIds = new Set(legacyBindings.map((binding) => String(binding?.bindingId || '')).filter(Boolean));
  const deviceById = new Map();
  for (const value of Array.isArray(input.deviceBindings) ? input.deviceBindings : []) {
    try {
      const normalized = normalizeDeviceBinding(value);
      if (normalized.origin === 'legacy_derived' && !normalized.transportBindingIds.some((id) => legacyIds.has(id))) continue;
      deviceById.set(normalized.deviceBindingId, normalized);
    } catch {
      // Invalid historical derived records are ignored and rebuilt from legacy bindings.
    }
  }

  const legacyGroups = new Map();
  for (const binding of legacyBindings) {
    const nodes = strings(binding?.participantNodeIds, 2).sort();
    if (nodes.length !== 2 || !binding?.bindingId) continue;
    const deviceBindingId = stableId('device-binding', nodes);
    const group = legacyGroups.get(deviceBindingId) || [];
    group.push(binding);
    legacyGroups.set(deviceBindingId, group);
  }
  for (const [deviceBindingId, group] of legacyGroups.entries()) {
    const current = deviceById.get(deviceBindingId);
    const participantNodeIds = strings(group.flatMap((item) => item.participantNodeIds), 2).sort();
    const createdAt = group.map((item) => String(item.createdAt || '')).filter(Boolean).sort()[0] || new Date().toISOString();
    const updatedAt = group.map((item) => String(item.lastSeenAt || item.createdAt || '')).filter(Boolean).sort().at(-1) || createdAt;
    const derived = normalizeDeviceBinding({
      ...(current || {}),
      deviceBindingId,
      participantNodeIds,
      status: current?.origin === 'native' ? current.status : mergedStatus(group),
      capabilities: strings([...(current?.capabilities || []), ...group.flatMap((item) => item.capabilities || [])], 100),
      transportOffers: uniqueOffers([...(current ? [current] : []), ...group]),
      transportBindingIds: strings([...(current?.transportBindingIds || []), ...group.map((item) => item.bindingId)], 100),
      origin: current?.origin === 'native' ? 'native' : 'legacy_derived',
      createdAt: current?.createdAt || createdAt,
      updatedAt,
      revokedAt: mergedStatus(group) === 'revoked' ? (group.map((item) => String(item.revokedAt || '')).filter(Boolean).sort().at(-1) || updatedAt) : '',
    });
    deviceById.set(deviceBindingId, derived);
  }

  const studentById = new Map();
  for (const value of Array.isArray(input.studentMaps) ? input.studentMaps : []) {
    try {
      const normalized = normalizeStudentMap(value);
      if (normalized.origin === 'legacy_derived' && !normalized.transportBindingIds.some((id) => legacyIds.has(id))) continue;
      if (deviceById.has(normalized.deviceBindingId)) studentById.set(normalized.studentMapId, normalized);
    } catch {
      // Invalid historical maps are ignored and can be recreated explicitly.
    }
  }
  for (const binding of legacyBindings) {
    const nodes = strings(binding?.participantNodeIds, 2).sort();
    if (nodes.length !== 2 || !binding?.bindingId) continue;
    const participants = nodes.map((nodeId) => {
      const studentIds = strings((binding.roleAssignments || [])
        .filter((item) => item?.nodeId === nodeId && !item?.revokedAt && item?.studentId)
        .map((item) => item.studentId), 10);
      return studentIds.length === 1 ? { nodeId, studentId: studentIds[0] } : null;
    });
    if (participants.some((item) => !item)) continue;
    const deviceBindingId = stableId('device-binding', nodes);
    const endpoints = participants.map((item) => `${item.nodeId}:${item.studentId}`);
    const studentMapId = stableId('student-map', [deviceBindingId, ...endpoints]);
    const current = studentById.get(studentMapId);
    studentById.set(studentMapId, normalizeStudentMap({
      ...(current || {}),
      studentMapId,
      deviceBindingId,
      participantStudents: participants,
      status: normalizeStatus(binding.status),
      transportBindingIds: strings([...(current?.transportBindingIds || []), binding.bindingId], 100),
      origin: current?.origin === 'native' ? 'native' : 'legacy_derived',
      createdAt: current?.createdAt || binding.createdAt,
      updatedAt: binding.lastSeenAt || binding.createdAt,
      revokedAt: binding.revokedAt,
    }));
  }

  const deviceBindings = [...deviceById.values()].sort((left, right) => left.deviceBindingId.localeCompare(right.deviceBindingId));
  const studentMaps = [...studentById.values()].sort((left, right) => left.studentMapId.localeCompare(right.studentMapId));
  const previousDevices = Array.isArray(input.deviceBindings) ? input.deviceBindings : [];
  const previousMaps = Array.isArray(input.studentMaps) ? input.studentMaps : [];
  return {
    deviceBindings,
    studentMaps,
    changed: JSON.stringify(previousDevices) !== JSON.stringify(deviceBindings) || JSON.stringify(previousMaps) !== JSON.stringify(studentMaps),
  };
}

function peersForStudentMappings(state = {}, localNodeId, localStudentId) {
  const localNode = String(localNodeId || '').trim();
  const localStudent = String(localStudentId || '').trim();
  const activeDevices = new Map((state.deviceBindings || [])
    .filter((item) => item.status === 'active' && !item.revokedAt && item.participantNodeIds?.includes(localNode))
    .map((item) => [item.deviceBindingId, item]));
  return (state.studentMaps || []).flatMap((mapping) => {
    if (mapping.status !== 'active' || mapping.revokedAt || !activeDevices.has(mapping.deviceBindingId)) return [];
    const local = (mapping.participantStudents || []).find((item) => item.nodeId === localNode && item.studentId === localStudent);
    const peer = (mapping.participantStudents || []).find((item) => item.nodeId !== localNode);
    if (!local || !peer) return [];
    const transportBindingId = mapping.transportBindingIds?.[0] || activeDevices.get(mapping.deviceBindingId)?.transportBindingIds?.[0] || '';
    const endpoints = [`${local.nodeId}:${local.studentId}`, `${peer.nodeId}:${peer.studentId}`].sort();
    return [{
      deviceBindingId: mapping.deviceBindingId,
      studentMapId: mapping.studentMapId,
      transportBindingId,
      lineageId: `${transportBindingId || mapping.deviceBindingId}:student-archive:${endpoints.join('|')}`,
      peerNodeId: peer.nodeId,
      targetStudentId: peer.studentId,
    }];
  });
}

function projectPeersForStudentMappings(state = {}, localNodeId, projectStudentIds = []) {
  const localStudentIds = strings(projectStudentIds, 100);
  const byPeer = new Map();
  for (const localStudentId of localStudentIds) {
    for (const mapping of peersForStudentMappings(state, localNodeId, localStudentId)) {
      const current = byPeer.get(mapping.peerNodeId) || {
        peerNodeId: mapping.peerNodeId,
        targetStudentIds: [],
        transportBindingIds: [],
        studentMappings: [],
      };
      current.targetStudentIds = strings([...current.targetStudentIds, mapping.targetStudentId], 100);
      current.transportBindingIds = strings([...current.transportBindingIds, mapping.transportBindingId], 100);
      current.studentMappings.push({
        localStudentId,
        targetStudentId: mapping.targetStudentId,
        studentMapId: mapping.studentMapId,
        deviceBindingId: mapping.deviceBindingId,
      });
      byPeer.set(mapping.peerNodeId, current);
    }
  }
  return [...byPeer.values()].sort((left, right) => left.peerNodeId.localeCompare(right.peerNodeId));
}

function selectStudentArchiveAuthorizationBinding(bindings = [], options = {}) {
  const lineageId = String(options.lineageId || '').trim();
  const localNodeId = String(options.localNodeId || '').trim();
  const targetNodeId = String(options.targetNodeId || '').trim();
  const isUsable = typeof options.isUsable === 'function' ? options.isUsable : () => true;
  if (!lineageId || !localNodeId || !targetNodeId || localNodeId === targetNodeId) return null;
  return (Array.isArray(bindings) ? bindings : []).find((binding) => (
    binding?.status === 'active'
    && !binding.revokedAt
    && String(binding.bindingId || '')
    && lineageId.startsWith(`${binding.bindingId}:student-archive:`)
    && binding.participantNodeIds?.includes(localNodeId)
    && binding.participantNodeIds?.includes(targetNodeId)
    && isUsable(binding)
  )) || null;
}

module.exports = {
  DEVICE_BINDING_SCHEMA,
  STUDENT_MAP_SCHEMA,
  deriveCollaborationRelationships,
  normalizeDeviceBinding,
  normalizeStudentMap,
  peersForStudentMappings,
  projectPeersForStudentMappings,
  selectStudentArchiveAuthorizationBinding,
};
