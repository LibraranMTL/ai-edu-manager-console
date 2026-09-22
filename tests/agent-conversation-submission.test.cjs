const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  AGENT_CONVERSATION_SUBMISSION_SCHEMA,
  applyManualConversationAttribution,
  conversationSubmissionReceipt,
  deterministicCandidateDrafts,
  normalizeAgentConversationSubmission,
  resolveLinkedConversationProject,
} = require('../electron/agent-conversation-submission.cjs');

const root = path.resolve(__dirname, '..');

test('D4-C submission is versioned, bounded and idempotent for the same selected messages', () => {
  const input = {
    sourceAgent: 'qclaw',
    sourceNodeId: 'node-a',
    sessionId: 'session-1',
    scopeType: 'student',
    scopeId: 'student-1',
    messages: [
      { role: 'user', content: '请总结今天的学习。' },
      { role: 'assistant', content: '总结：已经掌握一次函数的基本定义。' },
    ],
    submittedAt: '2026-07-26T12:00:00.000Z',
  };
  const first = normalizeAgentConversationSubmission(input);
  const second = normalizeAgentConversationSubmission(input);
  assert.equal(first.schema, AGENT_CONVERSATION_SUBMISSION_SCHEMA);
  assert.equal(first.protocolVersion, '1.0');
  assert.equal(first.submissionId, second.submissionId);
  assert.equal(first.idempotencyKey, second.idempotencyKey);
  assert.equal(first.messages.length, 2);
});

test('T0 preserves original speaker while requiring evidence before attributing a student action', () => {
  const base = { sourceAgent: 'qclaw', sourceNodeId: 'node-a', sessionId: 'actor-session',
    messages: [{ id: 'm1', role: 'student', content: '我先试算一次。', occurredAt: '2026-09-10T03:04:00.000Z' }] };
  const unknown = normalizeAgentConversationSubmission(base);
  assert.equal(unknown.messages[0].role, 'user');
  assert.equal(unknown.messages[0].originalRole, 'student');
  assert.equal(unknown.messages[0].claimedActorType, 'student');
  assert.equal(unknown.messages[0].actorType, 'unknown');
  assert.equal(unknown.messages[0].timeSource, 'source_message');
  const supported = normalizeAgentConversationSubmission({ ...base, messages: [{ ...base.messages[0], actorEvidence: '已验证的学生账号' }] });
  assert.equal(supported.messages[0].actorType, 'student');
  assert.notEqual(supported.contentDigest, unknown.contentDigest, '新的行为人证据必须使旧去重键失效');
  assert.equal(normalizeAgentConversationSubmission(supported).contentDigest, supported.contentDigest);
});

test('D4-C only retains explicitly selected attachments and traceable candidate quotes', () => {
  const submission = normalizeAgentConversationSubmission({
    sourceAgent: 'codex',
    sourceNodeId: 'node-a',
    sessionId: 'session-2',
    scopeType: 'project',
    scopeId: 'project-1',
    messages: [{ id: 'm1', role: 'assistant', content: '结论：保留当前设计方向。' }],
    attachments: [
      { sourcePath: 'D:\\selected.md', explicitlySelected: true },
      { sourcePath: 'D:\\private-cache.db', explicitlySelected: false },
    ],
    candidates: [
      { target: 'qa', content: '保留当前设计方向。', messageId: 'm1', sourceQuote: '结论：保留当前设计方向。' },
      { target: 'memory', content: '无来源内容', messageId: 'missing', sourceQuote: '不存在' },
    ],
  });
  assert.equal(submission.attachments.length, 1);
  assert.equal(submission.candidates.length, 1);
  assert.equal(submission.candidates[0].messageId, 'm1');
});

test('D4-C deterministic fallback extracts only explicitly marked lines', () => {
  const submission = normalizeAgentConversationSubmission({
    sourceAgent: 'openclaw',
    sourceNodeId: 'node-a',
    sessionId: 'session-3',
    scopeType: 'student',
    scopeId: 'student-1',
    messages: [{
      role: 'assistant',
      content: '普通闲聊不会变成候选。\n知识点：二次函数图像由开口、对称轴和顶点描述。\n下一步：完成三道配套练习。',
    }],
  });
  const candidates = deterministicCandidateDrafts(submission);
  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates.map((item) => item.target), ['qa', 'todo']);
  assert.ok(candidates.every((item) => item.messageId && item.sourceQuote));
});

test('D4-C receipt separates automatic organization from attention items', () => {
  const submission = normalizeAgentConversationSubmission({
    sourceAgent: 'qclaw',
    sourceNodeId: 'node-a',
    sessionId: 'session-4',
    messages: [{ role: 'assistant', content: '总结：本次讨论完成。' }],
  });
  const receipt = conversationSubmissionReceipt(submission, {
    status: 'stored',
    studentId: 'student-1',
    organized: 2,
    watching: 1,
    attention: 1,
  });
  assert.deepEqual(receipt.candidateCounts, {
    organized: 2,
    watching: 1,
    attention: 1,
    duplicate: 0,
  });
});

test('manual student attribution overrides stale hints and removes ambiguous project targeting', () => {
  const pending = normalizeAgentConversationSubmission({
    sourceAgent: 'codex',
    sourceNodeId: 'node-a',
    sessionId: 'session-awaiting-attribution',
    studentHint: 'unknown-student',
    targetProject: 'ambiguous-project',
    projectLineageId: 'stale-lineage',
    messages: [{ role: 'assistant', content: '总结：完成两轴重力手机云台结构分析。' }],
  });
  const attributed = applyManualConversationAttribution(pending, 'student', 'student-zhaoshuyuan');
  const normalized = normalizeAgentConversationSubmission(attributed);
  assert.equal(normalized.scopeType, 'student');
  assert.equal(normalized.scopeId, 'student-zhaoshuyuan');
  assert.equal(normalized.studentHint, 'student-zhaoshuyuan');
  assert.equal(normalized.targetProject, '');
  assert.equal(normalized.projectLineageId, '');
  assert.equal(normalized.submissionId, pending.submissionId);
  assert.equal(normalized.idempotencyKey, pending.idempotencyKey);
});

test('D4-C integration reuses immutable conversation governance and direct collaboration queue', () => {
  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
  const bridge = fs.readFileSync(path.join(root, 'electron', 'agent-knowledge-mcp.ps1'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');
  assert.match(main, /normalizeAgentConversationSubmission/);
  assert.match(main, /saveAgentProjectConversationImport/);
  assert.match(main, /target\.project\s*\?\s*saveAgentProjectConversationImport/);
  assert.match(main, /path\.join\(ensuredProject\.rawPath, 'Agent对话资料'\)/);
  assert.match(main, /materializationVersion: target\.project \? 2 : 1/);
  assert.match(main, /existingProjectMaterialized/);
  assert.match(main, /对话已保存到项目“\$\{target\.project\.name\}”原始资料库/);
  assert.match(main, /queueDirectCollaborationDelivery/);
  assert.match(main, /agent_conversation_submission/);
  assert.match(main, /ingestImportedAgentConversationSubmissions/);
  assert.match(main, /bridge:submitAgentConversation/);
  assert.match(main, /\/api\/agent\/conversation\/submit/);
  assert.match(main, /handleAgentConversationSubmission/);
  assert.match(main, /agent_conversation_submitted/);
  assert.match(main, /applyManualConversationAttribution\(submission, scopeType, scopeId\)/);
  assert.match(preload, /bridge:submitAgentConversation/);
  assert.match(preload, /bridge:getAgentConversationSubmissionState/);
  assert.match(preload, /bridge:assignAgentConversationSubmission/);
  assert.match(bridge, /submit_education_conversation/);
  assert.match(bridge, /Only the current or explicitly selected messages/);
  assert.match(renderer, /需要确认归属的 Agent 对话/);
  assert.match(renderer, /只有无法自动确定学生或项目的对话才显示在这里/);
  assert.match(renderer, /最近 Agent 协作记录/);
  assert.match(renderer, /setAgentConversationInbox\(\(current\) =>/);
  assert.match(renderer, /assigningAgentConversationId === item\.submissionId/);
  assert.match(renderer, /对话已保存到教育管家/);
  assert.doesNotMatch(main, /watchAgentConversationDatabase|scanPrivateConversationDatabase/);
});

test('D4-C project targeting never falls back to another student or the student archive', () => {
  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
  const bridge = fs.readFileSync(path.join(root, 'electron', 'agent-knowledge-mcp.ps1'), 'utf8');
  assert.match(bridge, /targetProject/);
  assert.match(bridge, /targetProject = \$targetProject\.Trim\(\)/);
  assert.doesNotMatch(bridge, /\$config\.defaults\.projects[\s\S]{0,800}Nothing was stored/);
  assert.match(bridge, /studentId = \[string\]\$config\.defaults\.scopeId/);
  assert.match(main, /body\.name !== 'conversation\.submit'/);
  assert.match(main, /matches\.length !== 1 \|\| !projectAllowed\(request, matches\[0\]\)/);
  assert.match(main, /projects: linkedProjects/);
  assert.match(main, /resolveLinkedConversationProject/);
  assert.match(main, /target\.message \|\| '暂时无法唯一确定学生或项目/);
  assert.match(main, /const affectedStudentIds = mergeUnique\(\[\.\.\.previousStudentIds, \.\.\.studentIds\]\)/);
  assert.match(
    main,
    /setImmediate\(\(\) => \{[\s\S]{0,240}refreshAgentKnowledgeAccessForStudents\(affectedStudentIds\)/,
  );
  assert.match(main, /activeAgentKnowledgeDescriptorPath\(\)/);
  assert.match(main, /if \(submission\.studentHint\) return \{ status: 'awaiting_attribution', project \}/);
  assert.match(main, /replaceEducationManagerServers: true/);
  assert.match(
    main,
    /prepareAgentKnowledgeAccess\(student\.id, \{[\s\S]*?activateGlobal: Boolean\(activeStudentId && activeStudentId === String\(student\.id\)\)/,
  );
});

test('D4-C resolves a newly linked project from live host data instead of a stale MCP descriptor', () => {
  const projects = [
    { id: 'project-old', name: '旧项目', studentIds: ['student-1'] },
    { id: 'project-new', name: 'TOK展文本项目', studentIds: ['student-1'] },
    { id: 'project-other', name: 'TOK展文本项目', studentIds: ['student-2'] },
  ];
  const resolved = resolveLinkedConversationProject(projects, 'student-1', 'TOK展文本项目');
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.project.id, 'project-new');
  assert.equal(resolveLinkedConversationProject(projects, 'student-1', 'project-new').project.id, 'project-new');
  assert.equal(resolveLinkedConversationProject(projects, 'student-1', '不存在项目').status, 'not_found');
  assert.equal(resolveLinkedConversationProject(projects, 'student-2', 'project-new').status, 'not_found');

  const submission = normalizeAgentConversationSubmission({
    sourceAgent: 'codex',
    sessionId: 'session-live-project',
    scopeType: 'student',
    scopeId: 'student-1',
    studentHint: 'student-1',
    targetProject: 'TOK展文本项目',
    messages: [{ role: 'user', content: '请保存本次对话。' }],
  });
  assert.equal(submission.targetProject, 'TOK展文本项目');
  assert.match(submission.idempotencyKey, /^agent-conversation-idempotency-/);
});
