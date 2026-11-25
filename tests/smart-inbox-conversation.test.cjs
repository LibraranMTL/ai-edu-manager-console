const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectConversation, explicitStudentSubject } = require('../electron/smart-inbox-conversation.cjs');
const wrap = messages => JSON.stringify({ schema: 'edu-manager.agent-conversation-submission.v1', sourceAgent: 'codex', messages });
const students = [{ id: 'a', name: '甲同学' }, { id: 'b', name: '乙同学' }];
test('recognizes pure internal requests but preserves mixed user conversations', () => {
  const internal = { role: 'user', content: 'This is an app-generated request for a suggested next user message. text' };
  assert.equal(inspectConversation(wrap([internal]), students, 'a').kind, 'internal_task');
  assert.equal(inspectConversation(wrap([internal, { role: 'assistant', content: '建议下一条消息。' }]), students, 'a').kind, 'internal_task');
  assert.equal(inspectConversation(wrap([internal, { role: 'user', content: '请分析这个项目' }]), students, 'a').kind, 'conversation');
  assert.equal(inspectConversation(JSON.stringify({ title: 'codex 授权会话' }), students, 'a').kind, 'document');
});
test('other student mention is a conflict even when the source is bound', () => {
  assert.equal(inspectConversation(wrap([{ role: 'user', content: '请分析乙同学的学习报告' }]), students, 'a').studentConflict, true);
  assert.equal(inspectConversation(wrap([{ role: 'user', content: '请分析甲同学的学习报告' }]), students, 'a').studentConflict, false);
});
test('explicit subject headers identify one student while references and conflicting headers remain unresolved', () => {
  assert.equal(explicitStudentSubject('所属学生：甲同学\n学习笔记。', students).studentId, 'a');
  assert.equal(explicitStudentSubject('参考乙同学的例子。', students), null);
  assert.equal(explicitStudentSubject('所属学生：甲同学\n资料主体：乙同学', students), null);
  assert.equal(explicitStudentSubject(wrap([{ role: 'assistant', content: '所属学生：乙同学' }, { role: 'user', content: '学习笔记。' }]), students), null);
});

test('explicit subject wins over comparison references while multiple real subjects remain ambiguous', () => {
  const text = wrap([{ role: 'user', content: '所属学生：甲同学\n参考乙同学的实验方法。' }]);
  assert.equal(inspectConversation(text, students, 'a').studentConflict, false);
  assert.equal(explicitStudentSubject('请分析乙同学的学习报告。', students).studentId, 'b');
  assert.equal(explicitStudentSubject('请分析甲同学的学习报告。\n请分析乙同学的学习报告。', students), null);
});

test('quoted files, assistant text, internal memory and metadata cannot establish a subject', () => {
  for (const content of ['> 所属学生：乙同学', '```text\n所属学生：乙同学\n```',
    'Consolidate the supplied rollout summaries into memory_summary.md\n所属学生：乙同学']) {
    assert.equal(explicitStudentSubject(wrap([{ role: 'user', content }]), students), null);
  }
  assert.equal(explicitStudentSubject(wrap([{ role: 'user', content: '学习记录' }, { role: 'assistant', content: '请分析乙同学的学习报告。' }]), students), null);
});
