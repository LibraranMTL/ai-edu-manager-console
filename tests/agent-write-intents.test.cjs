const test = require('node:test');
const assert = require('node:assert/strict');
const { previewIntent, approveIntent, rejectIntent, beginExecution, finishExecution, recoverExecution, publicIntent } = require('../electron/agent-write-intents.cjs');
const { CAPABILITIES, authorizeCapability } = require('../electron/agent-capability-contract.cjs');

const grant = { type: 'agent_grant', grantId: 'g1', allowedStudentIds: ['s1'], allowedProjectIds: ['p1'], capabilities: ['conversation:submit', 'material:upload', 'task:create', 'report:draft'] };
const studentProject = { id: 'p1', studentIds: ['s1'] };
const cases = [
  ['conversation.submit', { studentId: 's1', messages: [{ role: 'user', content: '本次问题' }] }],
  ['material.upload', { studentId: 's1', filename: 'note.txt', contentBase64: Buffer.from('study').toString('base64') }],
  ['task.create', { studentId: 's1', title: 'Review', detail: 'Draft a study plan' }],
  ['report.draft', { studentId: 's1', reportId: 'profile', content: '# Draft' }],
];

test('Write capabilities require explicit exact scope and host approval metadata', () => {
  for (const [name, input] of cases) {
    assert.equal(CAPABILITIES[name].approval, 'host');
    assert.equal(CAPABILITIES[name].idempotency, 'required');
    assert.equal(authorizeCapability(grant, name, input, null).ok, true);
    assert.equal(authorizeCapability(grant, name, { ...input, studentId: 's2' }, null).code, 'STUDENT_SCOPE_DENIED');
  }
  assert.equal(authorizeCapability(grant, 'material.upload', { ...cases[1][1], projectId: 'p1' }, studentProject).ok, true);
  assert.equal(authorizeCapability(grant, 'material.upload', { ...cases[1][1], projectId: 'p1' }, { id: 'p1', studentIds: ['s1', 's2'] }).code, 'PROJECT_SCOPE_DENIED');
});

test('Preview, approval, execution and retry are digest-bound and idempotent', () => {
  for (const [name, input] of cases) {
    const first = previewIntent({}, { name, input, idempotencyKey: `${name}-key`, grantId: 'g1' });
    assert.equal(first.ok, true);
    assert.equal(first.intent.status, 'pending_approval');
    assert.doesNotMatch(JSON.stringify(publicIntent(first.intent)), /contentBase64|本次问题|Draft a study plan|# Draft/);
    assert.equal(beginExecution(first.store, first.intent.id, 'g1').code, 'INTENT_NOT_APPROVED');
    assert.equal(approveIntent(first.store, first.intent.id, 'wrong').code, 'INTENT_DIGEST_MISMATCH');
    const reused = previewIntent(first.store, { name, input, idempotencyKey: `${name}-key`, grantId: 'g1' });
    assert.equal(reused.reused, true);
    assert.equal(previewIntent(first.store, { name, input: { ...input, studentId: 's2' }, idempotencyKey: `${name}-key`, grantId: 'g1' }).code, 'IDEMPOTENCY_CONFLICT');
    const approved = approveIntent(first.store, first.intent.id, first.intent.inputDigest);
    assert.equal(approved.ok, true);
    assert.equal(beginExecution(approved.store, approved.intent.id, 'other').code, 'INTENT_SCOPE_DENIED');
    const begun = beginExecution(approved.store, approved.intent.id, 'g1');
    assert.equal(begun.ok, true);
    const recovered = recoverExecution(begun.store, begun.intent.id);
    const resumed = beginExecution(recovered.store, begun.intent.id, 'g1');
    assert.equal(resumed.ok, true);
    const completed = finishExecution(resumed.store, begun.intent.id, { status: 'stored' });
    assert.equal(completed.ok, true);
    assert.equal(completed.intent.input, null);
    assert.equal(beginExecution(completed.store, completed.intent.id, 'g1').duplicate, true);
  }
});

test('Unsafe message roles, oversized material and unexpected fields are rejected before persistence', () => {
  const invalid = [
    ['conversation.submit', { studentId: 's1', messages: [{ role: 'system', content: 'secret' }] }],
    ['conversation.submit', { studentId: 's1', messages: [{ role: 'user', content: 'hello' }], targetNodeId: 'other' }],
    ['material.upload', { studentId: 's1', filename: 'a.bin', contentBase64: 'not base64' }],
    ['task.create', { studentId: 's1', title: 'x', detail: '', extra: true }],
  ];
  for (const [name, input] of invalid) assert.equal(previewIntent({}, { name, input, idempotencyKey: 'k', grantId: 'g1' }).code, 'INVALID_INPUT');
});

test('Host rejection discards private input and forbids later execution', () => {
  const preview = previewIntent({}, { name: 'report.draft', input: { studentId: 's1', reportId: 'profile', content: 'Private draft' }, idempotencyKey: 'reject-1', grantId: 'g1' });
  const rejected = rejectIntent(preview.store, preview.intent.id, preview.intent.inputDigest);
  assert.equal(rejected.ok, true);
  assert.equal(rejected.intent.input, null);
  assert.equal(beginExecution(rejected.store, rejected.intent.id, 'g1').code, 'INTENT_NOT_APPROVED');
});
