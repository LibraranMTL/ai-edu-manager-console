const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEVICE_BINDING_SCHEMA,
  STUDENT_MAP_SCHEMA,
  deriveCollaborationRelationships,
  peersForStudentMappings,
  projectPeersForStudentMappings,
  selectStudentArchiveAuthorizationBinding,
} = require('../electron/collaboration-device-binding.cjs');

function legacyBinding(id, localStudentId, peerStudentId, status = 'active') {
  return {
    bindingId: id,
    participantNodeIds: ['node-a', 'node-b'],
    status,
    roleAssignments: [
      { nodeId: 'node-a', role: 'educator', studentId: localStudentId },
      { nodeId: 'node-b', role: 'learner_authority', studentId: peerStudentId },
    ],
    transportOffers: [{ nodeId: 'node-b', transportId: 'lan_direct', endpoints: ['http://10.0.0.2:18777'] }],
    createdAt: '2026-08-09T00:00:00.000Z',
  };
}

test('legacy per-student bindings collapse into one device trust with multiple student maps', () => {
  const result = deriveCollaborationRelationships({
    bindings: [
      legacyBinding('legacy-1', 'student-a-1', 'student-b-1'),
      legacyBinding('legacy-2', 'student-a-2', 'student-b-2'),
    ],
  });
  assert.equal(result.deviceBindings.length, 1);
  assert.equal(result.deviceBindings[0].schema, DEVICE_BINDING_SCHEMA);
  assert.deepEqual(result.deviceBindings[0].transportBindingIds, ['legacy-1', 'legacy-2']);
  assert.equal(result.studentMaps.length, 2);
  assert.equal(result.studentMaps.every((item) => item.schema === STUDENT_MAP_SCHEMA), true);
});

test('student mapping resolves exact peer ids without using names or cross products', () => {
  const relationships = deriveCollaborationRelationships({
    bindings: [legacyBinding('legacy-1', 'student-a-1', 'student-b-1')],
  });
  const peers = peersForStudentMappings(relationships, 'node-a', 'student-a-1');
  assert.equal(peers.length, 1);
  assert.equal(peers[0].peerNodeId, 'node-b');
  assert.equal(peers[0].targetStudentId, 'student-b-1');
  assert.match(peers[0].lineageId, /^legacy-1:student-archive:/);
  assert.equal(peersForStudentMappings(relationships, 'node-a', 'unknown-student').length, 0);
});

test('project recipients aggregate only active exact student mappings', () => {
  const relationships = deriveCollaborationRelationships({
    bindings: [
      legacyBinding('legacy-1', 'student-a-1', 'student-b-1'),
      legacyBinding('legacy-2', 'student-a-2', 'student-b-2'),
      legacyBinding('legacy-unrelated', 'student-a-3', 'student-b-3'),
      legacyBinding('legacy-revoked', 'student-a-4', 'student-b-4', 'revoked'),
    ],
  });
  const peers = projectPeersForStudentMappings(relationships, 'node-a', ['student-a-1', 'student-a-2', 'missing']);
  assert.equal(peers.length, 1);
  assert.equal(peers[0].peerNodeId, 'node-b');
  assert.deepEqual(peers[0].targetStudentIds.sort(), ['student-b-1', 'student-b-2']);
  assert.deepEqual(peers[0].transportBindingIds.sort(), ['legacy-1', 'legacy-2']);
  assert.equal(peers[0].studentMappings.length, 2);
  assert.equal(projectPeersForStudentMappings(relationships, 'node-a', ['student-a-3']).length, 1);
  assert.equal(projectPeersForStudentMappings(relationships, 'node-a', ['student-a-4']).length, 0);
  assert.equal(projectPeersForStudentMappings(relationships, 'node-a', []).length, 0);
});

test('removing every legacy source removes its derived device and student records', () => {
  const migrated = deriveCollaborationRelationships({ bindings: [legacyBinding('legacy-1', 'student-a', 'student-b')] });
  const cleaned = deriveCollaborationRelationships({
    bindings: [],
    deviceBindings: migrated.deviceBindings,
    studentMaps: migrated.studentMaps,
  });
  assert.equal(cleaned.deviceBindings.length, 0);
  assert.equal(cleaned.studentMaps.length, 0);
});

test('deriving legacy relationships is idempotent and does not duplicate transport offers', () => {
  const binding = legacyBinding('legacy-1', 'student-a-1', 'student-b-1');
  const first = deriveCollaborationRelationships({ bindings: [binding] });
  const second = deriveCollaborationRelationships({
    bindings: [binding],
    deviceBindings: first.deviceBindings,
    studentMaps: first.studentMaps,
  });
  assert.equal(second.changed, false);
  assert.deepEqual(second.deviceBindings, first.deviceBindings);
  assert.equal(second.deviceBindings[0].transportOffers.length, 1);
});

test('student archive authorization selects the exact mapping binding instead of the routable device binding', () => {
  const deviceBinding = {
    bindingId: 'device-route-binding',
    participantNodeIds: ['node-a', 'node-b'],
    status: 'active',
    transportOffers: [{ endpoints: ['http://10.0.0.2:18777'] }],
  };
  const mappingBinding = {
    bindingId: 'student-map-binding',
    participantNodeIds: ['node-a', 'node-b'],
    status: 'active',
    roleAssignments: [
      { nodeId: 'node-a', studentId: 'student-a' },
      { nodeId: 'node-b', studentId: 'student-b' },
    ],
  };
  const selected = selectStudentArchiveAuthorizationBinding([deviceBinding, mappingBinding], {
    lineageId: 'student-map-binding:student-archive:node-a:student-a|node-b:student-b',
    localNodeId: 'node-a',
    targetNodeId: 'node-b',
    isUsable: (binding) => binding.bindingId === 'student-map-binding',
  });
  assert.equal(selected, mappingBinding);
});

test('student archive authorization rejects revoked, unusable and wrong-participant bindings', () => {
  const base = {
    bindingId: 'student-map-binding',
    participantNodeIds: ['node-a', 'node-b'],
    status: 'active',
  };
  const options = {
    lineageId: 'student-map-binding:student-archive:node-a:student-a|node-b:student-b',
    localNodeId: 'node-a',
    targetNodeId: 'node-b',
    isUsable: () => true,
  };
  assert.equal(selectStudentArchiveAuthorizationBinding([{ ...base, revokedAt: '2026-08-10' }], options), null);
  assert.equal(selectStudentArchiveAuthorizationBinding([{ ...base, participantNodeIds: ['node-a', 'node-c'] }], options), null);
  assert.equal(selectStudentArchiveAuthorizationBinding([base], { ...options, isUsable: () => false }), null);
  assert.equal(selectStudentArchiveAuthorizationBinding([base], { ...options, lineageId: 'other:student-archive:x' }), null);
});
