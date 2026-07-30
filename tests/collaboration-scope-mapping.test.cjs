const assert = require('node:assert/strict');
const test = require('node:test');

const {
  importedProjectLocalStudentIds,
  mergeProjectStudentScope,
} = require('../electron/collaboration-scope-mapping.cjs');

const localStudents = [
  { id: 'student-local', name: '本地学生' },
  { id: 'student-other', name: '其他学生' },
];

test('imported project maps a legacy sender student ID through the active peer binding', () => {
  const ids = importedProjectLocalStudentIds({
    publication: {
      sourceNodeId: 'node-sender',
      targetStudentIds: ['student-sender'],
    },
    localStudents,
    state: {
      node: { nodeId: 'node-receiver' },
      bindings: [{
        status: 'active',
        participantNodeIds: ['node-sender', 'node-receiver'],
        roleAssignments: [
          { nodeId: 'node-sender', studentId: 'student-sender' },
          { nodeId: 'node-receiver', studentId: 'student-local' },
        ],
      }],
    },
  });
  assert.deepEqual(ids, ['student-local']);
});

test('imported project keeps a valid target student ID without adding unrelated students', () => {
  const ids = importedProjectLocalStudentIds({
    publication: {
      sourceNodeId: 'node-sender',
      targetStudentIds: ['student-local'],
    },
    localStudents,
    state: {
      node: { nodeId: 'node-receiver' },
      bindings: [],
    },
  });
  assert.deepEqual(ids, ['student-local']);
});

test('existing imported projects gain mapped student scope without losing existing local links', () => {
  const merged = mergeProjectStudentScope(
    { id: 'project-1', studentIds: ['student-other'], studentNames: ['旧名称'] },
    ['student-local'],
    localStudents,
  );
  assert.deepEqual(merged.studentIds, ['student-other', 'student-local']);
  assert.deepEqual(merged.studentNames, ['其他学生', '本地学生']);
});
