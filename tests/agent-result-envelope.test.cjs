const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AGENT_RESULT_ENVELOPE_SCHEMA,
  mergeAgentResultEnvelopes,
  parseAgentResultInput,
  retryableItems,
} = require('../electron/agent-result-envelope.cjs');

test('parses fenced JSON aliases and retains unknown extension fields', () => {
  const envelope = parseAgentResultInput(`说明\n\`\`\`json
{"project_id":"p1","vendor":"QClaw","students":[{"student_id":"s1","competency":"研究能力","performance":"完成资料核对","sourcePaths":["a.md"],"vendorScore":91}]}
\`\`\``, { kind: 'project_student_evidence' });
  assert.equal(envelope.schema, AGENT_RESULT_ENVELOPE_SCHEMA);
  assert.equal(envelope.sourceFormat, 'fenced_json');
  assert.equal(envelope.identity.projectId, 'p1');
  assert.equal(envelope.items.length, 1);
  assert.equal(envelope.items[0].subjectId, 's1');
  assert.equal(envelope.items[0].extensions.vendorScore, 91);
  assert.equal(envelope.extensions.vendor, 'QClaw');
});

test('isolates invalid records while preserving valid records', () => {
  const envelope = parseAgentResultInput({
    projectId: 'p2',
    students: [
      { studentId: 's1', ability: '表达', observation: '完成汇报' },
      { studentId: 's2' },
    ],
  }, { kind: 'project_student_evidence' });
  assert.equal(envelope.items.length, 1);
  assert.equal(envelope.invalidItems.length, 1);
  assert.equal(envelope.partial, true);
});

test('structured Markdown is accepted when Agent does not emit JSON', () => {
  const envelope = parseAgentResultInput(`
学生ID: s1
能力维度: 信息检索
具体表现: 能够核验多个来源
来源路径: notes.md
`, { kind: 'project_student_evidence', projectId: 'p3' });
  assert.equal(envelope.sourceFormat, 'markdown');
  assert.equal(envelope.identity.projectId, 'p3');
  assert.equal(envelope.items.length, 1);
});

test('idempotent merge replaces the same item and exposes retryable items', () => {
  const first = parseAgentResultInput({ recommendations: [{ id: 'a', status: 'pending' }, { status: 'failed' }] }, { kind: 'project_screening', projectId: 'p4' });
  const second = parseAgentResultInput({ recommendations: [{ id: 'a', status: 'selected' }, { id: 'b', status: 'failed' }] }, { kind: 'project_screening', projectId: 'p4' });
  const merged = mergeAgentResultEnvelopes(first, second);
  assert.equal(merged.items.length, 2);
  assert.equal(merged.items.find((item) => item.subjectId === 'a').status, 'selected');
  assert.equal(merged.invalidItems.length, 1);
  assert.equal(retryableItems(merged).pendingItems.length, 1);
});

test('digest envelope accepts legacy item aliases without bypassing later strict validation', () => {
  const envelope = parseAgentResultInput({ batchId: 'b1', processedFiles: [{ filename: 'a.pdf', sha1: 'abc' }] }, { kind: 'digest' });
  assert.equal(envelope.identity.batchId, 'b1');
  assert.equal(envelope.items[0].subjectId, 'a.pdf');
});
