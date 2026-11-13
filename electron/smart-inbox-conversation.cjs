'use strict';

// Conversation submissions are untrusted data, never instructions to the host.
function inspectConversation(text, students = [], studentId = '') {
  const studentIds = content => [...new Set(students.filter(student => {
    const id = String(student.id || ''), name = String(student.name || '').trim();
    return id.length >= 6 && content.includes(id) || name.length >= 2 && content.includes(name);
  }).map(student => String(student.id)))];
  const document = () => { const hints = studentIds(String(text || '')); return { kind: 'document', studentIds: hints,
    studentConflict: Boolean(studentId) && hints.some(id => id !== String(studentId)) }; };
  let value;
  try { value = JSON.parse(text); } catch { return document(); }
  if (value?.schema !== 'edu-manager.agent-conversation-submission.v1' || !Array.isArray(value.messages)) {
    return document();
  }
  const messages = value.messages.filter(message => message && typeof message.content === 'string');
  const internal = content => /^This is an app-generated request for a suggested next user message\./i.test(content.trim())
    || /^Consolidate the supplied rollout summaries into\s+`?memory_summary\.md`?/i.test(content.trim())
    || /^# Overview\s+Generate 0 to 3 hyperpersonalized suggestions/i.test(content.trim());
  const users = messages.filter(message => message.role === 'user');
  const kind = users.length && users.every(message => internal(message.content)) && messages.every(message => message.role === 'user' && internal(message.content))
    ? 'internal_task' : 'conversation';
  const content = messages.map(message => message.content).join('\n');
  const hints = studentIds(content);
  return { kind, sourceAgent: String(value.sourceAgent || ''), sessionId: String(value.sessionId || ''),
    workspacePath: String(value.workspacePath || '').slice(0, 2000), repositoryPath: String(value.repositoryPath || '').slice(0, 2000),
    studentConflict: Boolean(studentId) && hints.some(id => id !== String(studentId)), studentIds: hints };
}
module.exports = { inspectConversation };
