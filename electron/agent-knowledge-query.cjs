const crypto = require('node:crypto');

const AGENT_KNOWLEDGE_QUERY_SCHEMA = 'edu-manager.agent-knowledge-query.v1';
const AGENT_KNOWLEDGE_RESULT_SCHEMA = 'edu-manager.agent-knowledge-result.v1';

function boundedText(value, limit = 2_000) {
  return String(value || '').trim().slice(0, limit);
}

const QUESTION_NOISE_PATTERNS = [
  /^(?:请|麻烦|帮我|请帮我|能否|可以|我想|想要)\s*/u,
  /(?:请)?(?:查找|查询|搜索|检索|寻找|了解|查看|说明|分析|总结|告诉我)/gu,
  /(?:对应的|相关的|有关的|一下|一下子|具体|情况|内容)/gu,
  /(?:有哪些|有什么|是什么|怎么样|如何|为何|为什么|是否)/gu,
  /(?:并且|以及|并|和|与|然后|再)/gu,
];

function uniqueSearchQuery(target, value) {
  const normalized = boundedText(value, 400)
    .replace(/[，。！？；、,:;!?()[\]{}<>《》“”"'`]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (normalized.length < 2) return;
  const key = normalized.toLocaleLowerCase();
  if (!target.some((item) => item.toLocaleLowerCase() === key)) target.push(normalized);
}

function extractAgentKnowledgeSearchQueries(question, maxQueries = 6) {
  const original = boundedText(question, 2_000);
  const queries = [];

  for (const match of original.matchAll(/[A-Za-z0-9][A-Za-z0-9_.:/-]{3,}/g)) {
    uniqueSearchQuery(queries, match[0]);
  }
  for (const match of original.matchAll(/[“"']([^”"']{2,120})[”"']/gu)) {
    uniqueSearchQuery(queries, match[1]);
  }

  let cleaned = original;
  for (const pattern of QUESTION_NOISE_PATTERNS) cleaned = cleaned.replace(pattern, ' ');
  const coreParts = cleaned
    .split(/[\s，。！？；、,:;!?()[\]{}<>《》“”"'`]+/u)
    .map((item) => item.replace(/^(?:的|在|对|把|从|中|里|上|下)+|(?:的|吗|呢|吧|了)$/gu, '').trim())
    .filter((item) => item.length >= 2 && !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{3,}$/u.test(item));

  if (coreParts.length) uniqueSearchQuery(queries, coreParts.join(' '));
  for (const part of coreParts.sort((a, b) => b.length - a.length)) uniqueSearchQuery(queries, part);
  uniqueSearchQuery(queries, original);
  return queries.slice(0, Math.max(1, Math.min(8, Number(maxQueries || 6))));
}

function normalizeAgentKnowledgeQuestion(input = {}) {
  const requestedQueryScope = boundedText(input.queryScope || input.scope, 40);
  if (requestedQueryScope && !['current_student', 'local_team', 'collaboration_team', 'all_allowed'].includes(requestedQueryScope)) {
    throw new Error('查询 scope 必须是 current_student、local_team、collaboration_team 或 all_allowed。');
  }
  const inferredScopeType = requestedQueryScope === 'current_student'
    ? 'student'
    : requestedQueryScope
      ? 'team'
      : boundedText(input.scopeType || 'student', 20);
  const scopeType = inferredScopeType;
  if (!['student', 'project', 'team'].includes(scopeType)) throw new Error('知识查询范围必须是 student 或 project；完整可用范围为 student、project 或 team。');
  const scopeId = scopeType === 'team' ? 'team' : boundedText(input.scopeId, 200);
  if (!scopeId) throw new Error('知识查询缺少学生或项目范围。');
  const question = boundedText(input.question, 2_000);
  if (!question) throw new Error('请输入要查询的问题。');
  const query = {
    schema: AGENT_KNOWLEDGE_QUERY_SCHEMA,
    queryId: boundedText(input.queryId || `agent-knowledge-${crypto.randomUUID()}`, 200),
    scopeType,
    scopeId,
    queryScope: requestedQueryScope || (scopeType === 'team' ? 'all_allowed' : 'current_student'),
    scopeName: boundedText(input.scopeName, 200),
    student: boundedText(input.student, 200),
    question,
    searchQueries: extractAgentKnowledgeSearchQueries(question),
    targetNodeId: boundedText(input.targetNodeId, 160),
    forceRemote: Boolean(input.forceRemote),
    limit: Math.max(1, Math.min(12, Number(input.limit || 8))),
    requestedAt: boundedText(input.requestedAt || new Date().toISOString(), 80),
  };
  if (!Number.isFinite(Date.parse(query.requestedAt))) throw new Error('知识查询时间无效。');
  return query;
}

function resolveAgentKnowledgeStudentScope(input = {}, students = []) {
  if (String(input.scopeType || 'student') !== 'student') return { ...input };
  const scopeId = boundedText(input.scopeId, 200);
  const policy = boundedText(input.scopePolicy || 'fixed_student', 80);
  const available = (Array.isArray(students) ? students : [])
    .map((student) => ({
      id: boundedText(student?.id, 200),
      name: boundedText(student?.name, 200),
    }))
    .filter((student) => student.id && student.name);
  const selector = boundedText(input.student, 200);
  let matches = [];
  if (selector) {
    matches = available.filter((student) => (
      student.id.localeCompare(selector, undefined, { sensitivity: 'accent' }) === 0
      || student.name.localeCompare(selector, undefined, { sensitivity: 'accent' }) === 0
    ));
    if (matches.length !== 1) throw new Error(`未找到唯一匹配的学生“${selector}”，已停止查询。`);
  } else {
    const question = boundedText(input.question, 2_000).toLocaleLowerCase();
    matches = available.filter((student) => (
      question.includes(student.name.toLocaleLowerCase())
      || (student.id.length >= 6 && question.includes(student.id.toLocaleLowerCase()))
    ));
    if (matches.length > 1) throw new Error('问题中匹配到多个学生，请明确指定一名学生后再查询。');
  }
  const matched = matches[0] || null;
  if (!matched || matched.id === scopeId) {
    const current = available.find((student) => student.id === scopeId);
    return { ...input, scopeId, scopeName: matched?.name || current?.name || '' };
  }
  if (policy !== 'active_student_or_explicit') {
    const current = available.find((student) => student.id === scopeId);
    throw new Error(`当前知识工具仅绑定“${current?.name || scopeId}”，不能查询“${matched.name}”；已停止查询，未读取其他学生资料。`);
  }
  return { ...input, scopeId: matched.id, scopeName: matched.name };
}

function resultResources(route = {}) {
  const result = route?.response?.result || {};
  if (Array.isArray(result.resources)) return result.resources;
  if (result.resource) return [result.resource];
  return [];
}

function normalizeKnowledgeResult(query, route = {}, options = {}) {
  const resources = resultResources(route).slice(0, query.limit).map((item) => ({
    uri: boundedText(item.uri, 2_000),
    title: boundedText(item.title || item.relativePath || '知识记录', 300),
    relativePath: boundedText(item.relativePath, 1_000),
    scopeType: boundedText(item.scopeType || route?.response?.scope?.type || query.scopeType, 20),
    scopeId: boundedText(item.scopeId || route?.response?.scope?.id || query.scopeId, 200),
    scopeName: boundedText(item.scopeName, 200),
    studentId: boundedText(item.studentId, 200),
    studentName: boundedText(item.studentName, 200),
    studentIds: (Array.isArray(item.studentIds) ? item.studentIds : []).map((value) => boundedText(value, 200)).filter(Boolean).slice(0, 20),
    studentNames: (Array.isArray(item.studentNames) ? item.studentNames : []).map((value) => boundedText(value, 200)).filter(Boolean).slice(0, 20),
    projectId: boundedText(item.projectId, 200),
    projectName: boundedText(item.projectName, 200),
    sourceNodeId: boundedText(item.sourceNodeId || route?.response?.sourceNodeId, 160),
    freshness: boundedText(item.freshness || route?.response?.freshness, 40),
    transport: boundedText(item.transport || route?.transport, 40),
    excerpt: boundedText(item.excerpt || item.content, 1_500),
    modifiedAt: boundedText(item.modifiedAt || route?.response?.servedAt, 80),
  }));
  const source = boundedText(route.source || (route.ok ? 'local' : 'waiting'), 40);
  const freshness = boundedText(route?.response?.freshness || (source === 'local' ? 'local' : ''), 40);
  const hasKnowledge = resources.length > 0;
  return {
    schema: AGENT_KNOWLEDGE_RESULT_SCHEMA,
    ok: Boolean(route.ok && hasKnowledge),
    lookupCompleted: Boolean(route.ok),
    queryId: query.queryId,
    question: query.question,
    scope: {
      type: query.scopeType,
      id: query.scopeId,
      queryScope: query.queryScope,
      name: query.scopeName || (query.scopeType === 'team' ? '允许的团队范围' : ''),
    },
    source,
    transport: boundedText(route.transport, 40),
    freshness,
    sourceNodeId: boundedText(route?.response?.sourceNodeId, 160),
    servedAt: boundedText(route?.response?.servedAt, 80),
    cachedAt: boundedText(route?.response?.cachedAt, 80),
    resources,
    count: resources.length,
    retryable: Boolean(route.retryable),
    warning: boundedText(route.warning, 500),
    message: boundedText(
      route.message
      || options.message
      || (route.ok && !hasKnowledge ? '已完成知识查询，但本机和当前协作范围内没有找到直接依据。' : ''),
      500,
    ),
    durationMs: Math.max(0, Number(options.durationMs || 0)),
  };
}

function knowledgeSourceLabel(result = {}) {
  if (result.source === 'local') return '本机知识';
  if (result.source === 'offline_snapshot') return '协作主机离线快照';
  if (result.source === 'remote') return result.transport === 'tailscale' ? '协作主机（Tailscale）' : '协作主机（局域网）';
  if (result.source === 'waiting') return '等待协作主机';
  return '知识查询';
}

function buildGroundedAgentPrompt(result = {}) {
  const citations = (result.resources || []).map((item, index) => (
    `${index + 1}. ${item.title}\n`
    + `   归属：${[(item.studentNames || []).join('、') || item.studentName, item.projectName, item.sourceNodeId ? `节点 ${item.sourceNodeId}` : '', item.transport, item.freshness].filter(Boolean).join(' / ') || '当前知识范围'}\n`
    + `   引用：${item.uri || '无'}\n`
    + `   更新：${item.modifiedAt || result.servedAt || '未知'}\n`
    + `   摘要：${item.excerpt || '未提供摘要'}`
  )).join('\n\n');
  const freshnessNote = result.source === 'offline_snapshot'
    ? `注意：以下资料是 ${result.cachedAt || result.servedAt || '时间未知'} 的离线快照，不应表述为实时状态。`
    : '';
  return [
    `请回答这个教育问题：${result.question || ''}`,
    result.scope?.type === 'team'
      ? '查询范围：系统设置允许的本机团队与远程协作团队；明确学生时仍只查询该学生及其关联项目'
      : result.coverage?.limited
        ? `查询范围：仅限学生“${result.scope?.name || result.scope?.id || ''}”的本机学生档案和已授权的单学生项目；未授权或多人项目未查询。`
        : result.scope?.name ? `查询范围：仅限学生“${result.scope.name}”及其关联项目` : '',
    '',
    `知识来源：${knowledgeSourceLabel(result)}`,
    freshnessNote,
    result.warning || '',
    '',
    citations || '当前没有找到可引用的知识。请明确说明依据不足，不要编造。',
    '',
    '回答要求：只依据以上知识片段作答；保留 edu:// 引用；区分事实、推断和待观察内容。',
  ].filter(Boolean).join('\n');
}

module.exports = {
  AGENT_KNOWLEDGE_QUERY_SCHEMA,
  AGENT_KNOWLEDGE_RESULT_SCHEMA,
  buildGroundedAgentPrompt,
  extractAgentKnowledgeSearchQueries,
  knowledgeSourceLabel,
  normalizeAgentKnowledgeQuestion,
  normalizeKnowledgeResult,
  resolveAgentKnowledgeStudentScope,
};
