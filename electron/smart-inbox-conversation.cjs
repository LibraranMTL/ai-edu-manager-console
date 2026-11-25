'use strict';

const isInternalRequest = content => /^This is an app-generated request for a suggested next user message\./i.test(content.trim())
  || /^Consolidate the supplied rollout summaries into\s+`?memory_summary\.md`?/i.test(content.trim())
  || /^# Overview\s+Generate 0 to 3 hyperpersonalized suggestions/i.test(content.trim());
function userMessages(text) {
  try {
    const value = JSON.parse(text);
    if (value?.schema === 'edu-manager.agent-conversation-submission.v1' && Array.isArray(value.messages)) {
      return value.messages.filter(m => m.role === 'user' && typeof m.content === 'string').map(m => m.content);
    }
  } catch { /* Ordinary documents are their own content. */ }
  return null;
}
// Metadata, assistant answers, quoted examples and fenced source files cannot
// authorize an ignore rule or establish a student's ownership.
const unquoted = text => String(text).replace(/```[\s\S]*?```/g, '').replace(/^\s*>.*$/gm, '');
function businessMessages(text) {
  const users = userMessages(text);
  return users ? users.filter(value => !isInternalRequest(value)).map(unquoted) : [unquoted(text)];
}

// Conversation submissions are untrusted data, never instructions to the host.
function inspectConversation(text, students = [], studentId = '') {
  const studentIds = content => [...new Set(students.filter(student => {
    const id = String(student.id || ''), name = String(student.name || '').trim();
    return id.length >= 6 && content.includes(id) || name.length >= 2 && content.includes(name);
  }).map(student => String(student.id)))];
  const document = () => { const hints = studentIds(businessMessages(text).join('\n'));
    const subject = explicitStudentSubject(text, students); return { kind: 'document', subject, studentIds: hints,
    studentConflict: Boolean(studentId) && (subject ? subject.studentId !== String(studentId) : hints.some(id => id !== String(studentId))) }; };
  let value;
  try { value = JSON.parse(text); } catch { return document(); }
  if (value?.schema !== 'edu-manager.agent-conversation-submission.v1' || !Array.isArray(value.messages)) {
    return document();
  }
  const messages = value.messages.filter(message => message && typeof message.content === 'string');
  const users = messages.filter(message => message.role === 'user');
  const kind = users.length && users.every(message => isInternalRequest(message.content))
    && messages.every(message => ['user', 'assistant', 'system', 'tool'].includes(message.role))
    ? 'internal_task' : 'conversation';
  const content = messages.map(message => message.content).join('\n');
  const hints = studentIds(content);
  const userHints = studentIds(users.map(message => message.content).join('\n'));
  const subject = explicitStudentSubject(text, students);
  return { kind, subject, sourceAgent: String(value.sourceAgent || ''), sessionId: String(value.sessionId || ''),
    workspacePath: String(value.workspacePath || '').slice(0, 2000), repositoryPath: String(value.repositoryPath || '').slice(0, 2000),
    studentConflict: Boolean(studentId) && (subject ? subject.studentId !== String(studentId) : userHints.some(id => id !== String(studentId))), studentIds: hints,
    referencedStudentIds: hints.filter(id => !userHints.includes(id)), userStudentIds: userHints };
}
function explicitStudentSubject(text, students) {
  const content = businessMessages(text).join('\n');
  const matches = [];
  for (const student of students) {
    const name = String(student.name || '').trim();
    if (name.length < 2) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const expression = new RegExp(`(?:^|\\n)\\s*(?:学生姓名|所属学生|资料主体|学习者|学生|请为学生|请检查学生)\\s*[:：为是]?\\s*[「“"【]?${escaped}(?:[」”"】]|(?=\\s|[，。,:：]|$))`, 'u');
    const request = new RegExp(`(?:^|\\n|[。；;])\\s*(?:请|帮助|帮我)?(?:为|给)?(?:分析|评估|检查|整理|消化|总结|生成|更新|查看|撰写)(?:一下|学生)?\\s*[「“\"【]?${escaped}[」”\"】]?\\s*(?:的|同学的)\\s*(?:学习|学情|能力|成长|作业|报告|资料|项目|整体画像)`, 'u');
    const match = String(content).match(expression) || String(content).match(request);
    if (match) matches.push({ studentId: String(student.id), evidence: match[0].trim() });
  }
  return matches.length === 1 ? matches[0] : null;
}
module.exports = { inspectConversation, explicitStudentSubject, businessMessages, userMessages, isInternalRequest };
