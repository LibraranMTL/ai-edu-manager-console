const assert = require('node:assert/strict');
const test = require('node:test');

const {
  issueAgentAccessGrant,
  resolveAgentAccessGrant,
} = require('../electron/agent-access-grant.cjs');

test('Agent access grant is student-scoped and stores only the token hash', () => {
  const issued = issueAgentAccessGrant({}, {
    studentId: 'student-a',
    allowedProjectIds: ['project-a'],
    now: '2026-09-05T00:00:00.000Z',
    randomBytes: () => Buffer.alloc(32, 7),
    randomUUID: () => 'grant-a',
  });
  assert.match(issued.token, /^eak_/);
  assert.doesNotMatch(JSON.stringify(issued.store), new RegExp(issued.token));
  assert.deepEqual(resolveAgentAccessGrant(issued.store, issued.token), {
    type: 'agent_grant',
    grantId: 'agent-grant-grant-a',
    studentId: 'student-a',
    allowedStudentIds: ['student-a'],
    allowedProjectIds: ['project-a'],
    capabilities: ['knowledge:query', 'conversation:submit', 'memory:read', 'memory:write', 'handoff:manage'],
    allowedAllStudents: false,
  });
  assert.equal(resolveAgentAccessGrant(issued.store, 'eak_wrong'), null);
  assert.equal(resolveAgentAccessGrant({ ...issued.store, disabledStudentIds: ['student-a'] }, issued.token), null);
});

test('Agent access grant reuses a valid student token and rotates a mismatched token', () => {
  const first = issueAgentAccessGrant({}, { studentId: 'student-a', randomBytes: () => Buffer.alloc(32, 1), randomUUID: () => 'one' });
  const reused = issueAgentAccessGrant(first.store, { studentId: 'student-a', existingToken: first.token, allowedProjectIds: ['p2'] });
  assert.equal(reused.token, first.token);
  assert.equal(reused.reused, true);
  assert.deepEqual(reused.grant.allowedProjectIds, ['p2']);
  const legacy = issueAgentAccessGrant({}, { studentId: 'student-c', capabilities: ['knowledge:query'], randomUUID: () => 'legacy' });
  const preserved = issueAgentAccessGrant(legacy.store, { studentId: 'student-c', existingToken: legacy.token });
  assert.deepEqual(preserved.grant.capabilities, ['knowledge:query']);
  const rotated = issueAgentAccessGrant(reused.store, { studentId: 'student-b', existingToken: first.token, randomBytes: () => Buffer.alloc(32, 2), randomUUID: () => 'two' });
  assert.notEqual(rotated.token, first.token);
  assert.equal(resolveAgentAccessGrant(rotated.store, rotated.token).studentId, 'student-b');
});
