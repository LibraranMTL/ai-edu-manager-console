const crypto = require('node:crypto');

const AGENT_CONVERSATION_SUBMISSION_SCHEMA = 'edu-manager.agent-conversation-submission.v1';
const AGENT_CONVERSATION_RECEIPT_SCHEMA = 'edu-manager.agent-conversation-receipt.v1';
const MAX_MESSAGES = 300;
const MAX_CONTENT_CHARS = 60_000;
const MAX_ATTACHMENTS = 20;
const MAX_CANDIDATES = 80;

function text(value, limit = 500) {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, limit);
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function stableId(prefix, ...parts) {
  return `${prefix}-${sha256(parts.map((part) => String(part || '')).join('\u241f')).slice(0, 24)}`;
}

function normalizeRole(value) {
  const role = text(value, 40).toLowerCase();
  if (['user', 'student', 'parent', 'teacher', 'human'].includes(role) || /用户|学生|家长|教师/.test(role)) return 'user';
  if (['assistant', 'agent', 'ai', 'model'].includes(role) || /助手|智能体|模型/.test(role)) return 'assistant';
  if (role === 'tool' || /工具/.test(role)) return 'tool';
  if (role === 'system' || /系统/.test(role)) return 'system';
  return 'unknown';
}

function messageContent(message) {
  if (typeof message === 'string') return text(message, MAX_CONTENT_CHARS);
  if (!message || typeof message !== 'object') return '';
  const raw = message.content ?? message.text ?? message.message ?? '';
  if (Array.isArray(raw)) {
    return text(raw.map((part) => (
      typeof part === 'string' ? part : part?.text || part?.content || ''
    )).filter(Boolean).join('\n'), MAX_CONTENT_CHARS);
  }
  return text(raw, MAX_CONTENT_CHARS);
}

function normalizeMessage(message, index, sessionId) {
  const content = messageContent(message);
  if (!content) return null;
  const originalRole = text(message?.originalRole || message?.role || message?.author || message?.speaker, 40);
  const role = normalizeRole(originalRole);
  const rawOccurredAt = text(message?.occurredAt || message?.createdAt || message?.timestamp || message?.time, 80);
  const occurredAt = Number.isFinite(Date.parse(rawOccurredAt)) ? rawOccurredAt : '';
  const claimedActorType = text(message?.claimedActorType || message?.actorType
    || (['student', 'parent', 'teacher'].includes(originalRole.toLowerCase()) ? originalRole : ''), 20).toLowerCase();
  const actorEvidence = text(message?.actorEvidence, 240);
  const supportedActor = ['student', 'parent', 'teacher'].includes(claimedActorType);
  const messageId = text(message?.messageId || message?.id, 200)
    || stableId('agent-message', sessionId, index, role, content);
  return {
    messageId,
    role,
    originalRole,
    actorType: supportedActor && actorEvidence ? claimedActorType : 'unknown',
    claimedActorType: supportedActor ? claimedActorType : '',
    actorEvidence,
    content,
    occurredAt,
    reportedOccurredAt: rawOccurredAt,
    timeSource: occurredAt ? 'source_message' : 'unknown',
    locator: text(message?.locator, 200) || `message:${index + 1}`,
  };
}

function normalizeAttachment(attachment, index) {
  if (!attachment || typeof attachment !== 'object') return null;
  const name = text(attachment.name || attachment.filename, 240);
  const contentHash = text(attachment.contentHash || attachment.sha256, 128).toLowerCase();
  const sourcePath = text(attachment.sourcePath, 2_000);
  if (!name && !sourcePath) return null;
  return {
    attachmentId: text(attachment.attachmentId || attachment.id, 200)
      || stableId('conversation-attachment', index, name, contentHash, sourcePath),
    name: name || sourcePath.split(/[\\/]/).pop() || `attachment-${index + 1}`,
    contentType: text(attachment.contentType || attachment.type, 160),
    size: Math.max(0, Number(attachment.size || 0)),
    contentHash,
    sourcePath,
    explicitlySelected: attachment.explicitlySelected !== false,
  };
}

function normalizeCandidate(candidate, messages) {
  if (!candidate || typeof candidate !== 'object') return null;
  const content = text(candidate.content || candidate.value || candidate.text, 4_000);
  const messageId = text(candidate.messageId, 200);
  const sourceMessage = messages.find((message) => message.messageId === messageId);
  const sourceQuote = text(candidate.sourceQuote || candidate.sourceSnippet || candidate.quote, 2_000);
  if (!content || !sourceMessage || !sourceQuote || !sourceMessage.content.includes(sourceQuote)) return null;
  const requestedTarget = text(candidate.target || candidate.kind, 40).toLowerCase();
  const target = ['memory', 'soul', 'qa', 'todo'].includes(requestedTarget) ? requestedTarget : 'qa';
  return {
    target,
    content,
    messageId,
    sourceQuote,
    locator: sourceMessage.locator,
    occurredAt: sourceMessage.occurredAt,
    conflictNote: text(candidate.conflictNote, 1_000),
    conflictWith: Array.isArray(candidate.conflictWith) ? candidate.conflictWith.map((item) => text(item, 200)).filter(Boolean) : [],
    expiresAt: text(candidate.expiresAt, 80),
  };
}

function resolveLinkedConversationProject(projects, studentId, targetProject) {
  const normalizedStudentId = text(studentId, 240);
  const normalizedTarget = text(targetProject, 240);
  if (!normalizedStudentId || !normalizedTarget) {
    return { status: 'not_requested', project: null, matches: [] };
  }
  const matches = (Array.isArray(projects) ? projects : []).filter((project) => {
    const linkedStudentIds = Array.isArray(project?.studentIds) ? project.studentIds.map(String) : [];
    if (!linkedStudentIds.includes(normalizedStudentId)) return false;
    return (
      String(project?.id || '').localeCompare(normalizedTarget, undefined, { sensitivity: 'accent' }) === 0
      || String(project?.name || '').localeCompare(normalizedTarget, undefined, { sensitivity: 'accent' }) === 0
    );
  });
  if (matches.length === 1) return { status: 'resolved', project: matches[0], matches };
  return { status: matches.length > 1 ? 'ambiguous' : 'not_found', project: null, matches };
}

function normalizeAgentConversationSubmission(input = {}) {
  const sourceAgent = text(input.sourceAgent || input.agent || input.tool || 'unknown-agent', 120);
  const sourceNodeId = text(input.sourceNodeId, 160);
  const targetNodeId = text(input.targetNodeId, 160);
  const sessionId = text(input.sessionId || input.conversationId || input.threadId, 240)
    || stableId('agent-session', sourceAgent, sourceNodeId, input.title, input.submittedAt);
  const messages = (Array.isArray(input.messages) ? input.messages : [])
    .slice(0, MAX_MESSAGES)
    .map((message, index) => normalizeMessage(message, index, sessionId))
    .filter(Boolean);
  if (!messages.length) throw new Error('对话投递至少需要一条非空消息。');
  const totalChars = messages.reduce((sum, message) => sum + message.content.length, 0);
  if (totalChars > MAX_CONTENT_CHARS) throw new Error('当前对话片段超过主动投递上限，请只发送当前对话或选定片段。');
  const scopeType = text(input.scopeType || input.target?.scopeType, 20);
  const scopeId = text(input.scopeId || input.target?.scopeId, 240);
  if (scopeType && !['student', 'project'].includes(scopeType)) throw new Error('对话目标只能是学生或项目。');
  const submittedAt = text(input.submittedAt || new Date().toISOString(), 80);
  if (!Number.isFinite(Date.parse(submittedAt))) throw new Error('对话提交时间无效。');
  const contentDigest = sha256(JSON.stringify(messages.map(({ messageId, role, content, occurredAt, actorType, actorEvidence }) => ({
    messageId, role, content, occurredAt,
    ...(actorType !== 'unknown' && actorEvidence ? { actorType, actorEvidence } : {}),
  }))));
  const attachments = (Array.isArray(input.attachments) ? input.attachments : [])
    .slice(0, MAX_ATTACHMENTS)
    .map(normalizeAttachment)
    .filter((attachment) => attachment?.explicitlySelected);
  const candidates = (Array.isArray(input.candidates) ? input.candidates : [])
    .slice(0, MAX_CANDIDATES)
    .map((candidate) => normalizeCandidate(candidate, messages))
    .filter(Boolean);
  const submission = {
    schema: AGENT_CONVERSATION_SUBMISSION_SCHEMA,
    protocolVersion: '1.0',
    submissionId: text(input.submissionId, 240)
      || stableId('agent-conversation-submission', sourceNodeId, sourceAgent, sessionId, contentDigest, scopeType, scopeId),
    sourceAgent,
    sourceNodeId,
    targetNodeId,
    sessionId,
    title: text(input.title || 'Agent 对话片段', 240),
    scopeType,
    scopeId,
    studentHint: text(input.studentHint, 240),
    targetProject: text(input.targetProject || input.target?.project, 240),
    projectLineageId: text(input.projectLineageId, 240),
    workspacePath: text(input.workspacePath, 2000),
    repositoryPath: text(input.repositoryPath, 2000),
    messages,
    attachments,
    candidates,
    contentDigest,
    contentSummary: text(input.contentSummary || messages.map((message) => message.content).join(' ').slice(0, 500), 500),
    submittedAt,
    idempotencyKey: text(input.idempotencyKey, 240),
  };
  submission.idempotencyKey = submission.idempotencyKey || stableId(
    'agent-conversation-idempotency',
    sourceNodeId,
    sourceAgent,
    sessionId,
    contentDigest,
    scopeType,
    scopeId,
    submission.targetProject,
  );
  return submission;
}

function applyManualConversationAttribution(input = {}, scopeType, scopeId) {
  const normalizedScopeType = text(scopeType, 20);
  const normalizedScopeId = text(scopeId, 240);
  if (!['student', 'project'].includes(normalizedScopeType) || !normalizedScopeId) {
    throw new Error('人工归属必须指定有效的学生或项目。');
  }
  return {
    ...input,
    scopeType: normalizedScopeType,
    scopeId: normalizedScopeId,
    studentHint: normalizedScopeType === 'student' ? normalizedScopeId : '',
    targetProject: '',
    projectLineageId: '',
  };
}

function deterministicCandidateDrafts(submission) {
  if (submission.candidates?.length) return submission.candidates;
  const drafts = [];
  const marker = /^(?:[-*]\s*)?(结论|总结|要点|知识点|建议|下一步|待办|todo)\s*[:：]\s*(.+)$/i;
  for (const message of submission.messages || []) {
    if (!['assistant', 'user'].includes(message.role)) continue;
    for (const line of message.content.split(/\r?\n/)) {
      const match = marker.exec(line.trim());
      if (!match?.[2]) continue;
      const content = text(match[2], 4_000);
      if (content.length < 4) continue;
      const label = match[1].toLowerCase();
      drafts.push({
        target: /建议|下一步|待办|todo/i.test(label) ? 'todo' : 'qa',
        content,
        messageId: message.messageId,
        sourceQuote: line.trim(),
        locator: message.locator,
        occurredAt: message.occurredAt,
        conflictNote: '',
        conflictWith: [],
        expiresAt: '',
      });
      if (drafts.length >= MAX_CANDIDATES) return drafts;
    }
  }
  return drafts;
}

function conversationSubmissionReceipt(submission, input = {}) {
  return {
    schema: AGENT_CONVERSATION_RECEIPT_SCHEMA,
    protocolVersion: '1.0',
    submissionId: submission.submissionId,
    idempotencyKey: submission.idempotencyKey,
    status: text(input.status || 'stored', 40),
    scopeType: text(input.scopeType || submission.scopeType, 20),
    scopeId: text(input.scopeId || submission.scopeId, 240),
    studentId: text(input.studentId, 240),
    projectId: text(input.projectId, 240),
    interactionId: text(input.interactionId, 240),
    assetId: text(input.assetId, 240),
    materialId: text(input.materialId, 240),
    candidateCounts: {
      organized: Math.max(0, Number(input.organized || 0)),
      watching: Math.max(0, Number(input.watching || 0)),
      attention: Math.max(0, Number(input.attention || 0)),
      duplicate: Math.max(0, Number(input.duplicate || 0)),
    },
    storedAt: text(input.storedAt || new Date().toISOString(), 80),
    message: text(input.message, 1_000),
  };
}

module.exports = {
  AGENT_CONVERSATION_RECEIPT_SCHEMA,
  AGENT_CONVERSATION_SUBMISSION_SCHEMA,
  MAX_ATTACHMENTS,
  MAX_CANDIDATES,
  MAX_MESSAGES,
  applyManualConversationAttribution,
  conversationSubmissionReceipt,
  deterministicCandidateDrafts,
  normalizeAgentConversationSubmission,
  resolveLinkedConversationProject,
  stableId,
};
