const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectConversation } = require('../electron/smart-inbox-conversation.cjs');
const wrap = messages => JSON.stringify({ schema: 'edu-manager.agent-conversation-submission.v1', sourceAgent: 'codex', messages });
const students = [{ id: 'a', name: '甲同学' }, { id: 'b', name: '乙同学' }];
test('recognizes pure internal requests but preserves mixed user conversations', () => {
  const internal = { role: 'user', content: 'This is an app-generated request for a suggested next user message. text' };
  assert.equal(inspectConversation(wrap([internal]), students, 'a').kind, 'internal_task');
  assert.equal(inspectConversation(wrap([internal, { role: 'user', content: '请分析这个项目' }]), students, 'a').kind, 'conversation');
  assert.equal(inspectConversation(JSON.stringify({ title: 'codex 授权会话' }), students, 'a').kind, 'document');
});
test('other student mention is a conflict even when the source is bound', () => {
  assert.equal(inspectConversation(wrap([{ role: 'user', content: '请分析乙同学的学习报告' }]), students, 'a').studentConflict, true);
  assert.equal(inspectConversation(wrap([{ role: 'user', content: '请分析甲同学的学习报告' }]), students, 'a').studentConflict, false);
});
