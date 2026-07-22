const crypto = require('node:crypto');

const INTERACTION_SCHEMA = 'edu-manager.interaction.v1';
const CONVERSATION_ASSET_SCHEMA = 'edu-manager.conversation-asset.v1';
const KNOWLEDGE_CANDIDATE_SCHEMA = 'edu-manager.knowledge-candidate.v1';
const CANDIDATE_REGISTRY_SCHEMA = 'edu-manager.knowledge-candidate-registry.v1';
const MAX_CANDIDATES_PER_IMPORT = 80;
const MAX_PROMOTION_BATCH = 50;

const SENSITIVE_PATTERN = /身份证|证件号|住址|家庭地址|手机号|电话|病史|诊断|心理|医疗|收入|家庭关系|identity|medical|diagnosis|psycholog/i;
const PROMPT_INJECTION_PATTERN = /忽略(?:以上|此前|之前).*指令|绕过.*(?:规则|限制)|系统提示词|开发者消息|读取.*(?:密钥|token|密码)|ignore (?:all |the )?(?:previous|prior) instructions|system prompt|developer message/i;
const CONFLICT_PATTERN = /冲突|不一致|相反|待核实|contradict|conflict/i;
const TARGET_ALIASES = new Map([
  ['memory', 'memory'],
  ['memoryCandidates', 'memory'],
  ['memories', 'memory'],
  ['soul', 'soul'],
  ['soulSuggestions', 'soul'],
  ['personaSuggestions', 'soul'],
  ['qa', 'qa'],
  ['qaHighlights', 'qa'],
  ['todos', 'todo'],
  ['followUps', 'todo'],
  ['todo', 'todo'],
]);

function hashText(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function stableId(prefix, ...parts) {
  return `${prefix}-${hashText(parts.map((part) => String(part || '')).join('\u241f')).slice(0, 24)}`;
}

function tryParseJson(content) {
  try {
    return JSON.parse(String(content || '').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

function normalizeRole(value) {
  const role = String(value || '').toLowerCase();
  if (['user', 'student', 'parent', 'teacher', 'human'].includes(role) || /用户|学生|家长|教师/.test(role)) return 'user';
  if (['assistant', 'agent', 'ai', 'model'].includes(role) || /助手|智能体|模型/.test(role)) return 'assistant';
  if (role === 'tool' || /工具/.test(role)) return 'tool';
  if (role === 'system' || /系统/.test(role)) return 'system';
  return 'unknown';
}

function messageContent(item) {
  if (typeof item === 'string') return item.trim();
  if (!item || typeof item !== 'object') return '';
  const raw = item.content ?? item.text ?? item.message ?? item.value ?? '';
  if (typeof raw === 'string') return raw.trim();
  if (Array.isArray(raw)) return raw.map((part) => typeof part === 'string' ? part : part?.text || part?.content || '').filter(Boolean).join('\n').trim();
  return String(raw || '').trim();
}

function parseConversationMessages(content, interactionId) {
  const parsed = tryParseJson(content);
  const rawMessages = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.messages) ? parsed.messages : Array.isArray(parsed?.conversation) ? parsed.conversation : null;
  let messages = [];
  if (rawMessages) {
    messages = rawMessages.map((item, index) => ({
      role: normalizeRole(item?.role || item?.author || item?.speaker),
      content: messageContent(item),
      occurredAt: String(item?.createdAt || item?.timestamp || item?.time || ''),
      toolCalls: Array.isArray(item?.toolCalls) ? item.toolCalls : Array.isArray(item?.tool_calls) ? item.tool_calls : [],
      sourceIndex: index,
    })).filter((item) => item.content);
  } else {
    const blocks = String(content || '').replace(/^\uFEFF/, '').split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean);
    messages = blocks.slice(0, 500).map((block, index) => {
      const roleMatch = /^(user|assistant|system|tool|用户|助手|系统|工具|学生|家长|教师)\s*[:：]\s*/i.exec(block);
      return {
        role: normalizeRole(roleMatch?.[1] || ''),
        content: roleMatch ? block.slice(roleMatch[0].length).trim() : block,
        occurredAt: '',
        toolCalls: [],
        sourceIndex: index,
      };
    });
  }
  return messages.slice(0, 500).map((item, index) => ({
    id: stableId('message', interactionId, index, item.role, item.content),
    role: item.role,
    content: item.content,
    occurredAt: item.occurredAt,
    toolCalls: item.toolCalls,
    locator: `message:${index + 1}`,
  }));
}

function normalizeConversationImport({ studentId, tool = 'qclaw', content = '', sourcePath = '', importedAt = new Date().toISOString() } = {}) {
  const normalizedContent = String(content || '').replace(/^\uFEFF/, '');
  const contentHash = hashText(normalizedContent);
  const interactionId = stableId('interaction', studentId, tool, contentHash);
  const assetId = stableId('conversation-asset', studentId, contentHash);
  const messages = parseConversationMessages(normalizedContent, interactionId);
  const sourceUri = `conversation-asset://${assetId}`;
  return {
    interaction: {
      schema: INTERACTION_SCHEMA,
      id: interactionId,
      studentId: String(studentId || ''),
      tool: String(tool || 'qclaw'),
      sessionId: stableId('session', studentId, tool, contentHash),
      sourceUri,
      contentHash,
      importedAt,
      messageCount: messages.length,
      messages,
      immutable: true,
    },
    asset: {
      schema: CONVERSATION_ASSET_SCHEMA,
      id: assetId,
      studentId: String(studentId || ''),
      interactionId,
      sourceType: 'conversation',
      sourcePath: String(sourcePath || ''),
      sourceUri,
      contentHash,
      size: Buffer.byteLength(normalizedContent, 'utf8'),
      importedAt,
      immutable: true,
    },
    content: normalizedContent,
  };
}

function candidateValue(item) {
  if (typeof item === 'string') return item.trim();
  if (!item || typeof item !== 'object') return '';
  return String(item.content ?? item.value ?? item.text ?? item.claim ?? item.title ?? '').trim();
}

function candidateSource(item, source = {}) {
  const object = item && typeof item === 'object' ? item : {};
  const messageId = String(object.messageId || source.messageId || '');
  const validMessageIds = new Set(Array.isArray(source.validMessageIds) ? source.validMessageIds.map(String) : []);
  return {
    type: String(source.type || source.sourceType || 'conversation'),
    assetId: String(source.assetId || ''),
    interactionId: String(source.interactionId || ''),
    sourceId: String(source.sourceId || source.assetId || ''),
    sourceUri: String(source.sourceUri || ''),
    sourcePath: String(source.sourcePath || ''),
    contentHash: String(source.contentHash || ''),
    snippet: String(object.sourceSnippet || object.sourceQuote || object.quote || source.snippet || '').trim(),
    messageId,
    messageIdValid: !messageId || validMessageIds.size === 0 || validMessageIds.has(messageId),
    locator: String(object.sourceLocation || object.locator || source.locator || '').trim(),
    occurredAt: String(object.occurredAt || source.occurredAt || ''),
  };
}

function assessCandidateRisk(candidate, sourceContent = '') {
  const reasons = [];
  const source = candidate.source || {};
  const text = String(candidate.content || '');
  const missingSource = !source.sourceUri || !source.contentHash || !source.snippet || (!source.messageId && !source.locator);
  if (missingSource) reasons.push({ code: 'missing_source', label: '缺少原文片段或消息定位', blocking: true });
  if (source.messageId && source.messageIdValid === false) reasons.push({ code: 'message_locator_mismatch', label: '消息 ID 不属于原始会话', blocking: true });
  if (source.snippet && sourceContent && !String(sourceContent).includes(source.snippet)) reasons.push({ code: 'source_quote_mismatch', label: '原文片段与来源内容不匹配', blocking: true });
  if (PROMPT_INJECTION_PATTERN.test(`${text}\n${source.snippet || ''}`)) reasons.push({ code: 'prompt_injection', label: '可能包含提示注入指令', blocking: true });
  if (SENSITIVE_PATTERN.test(`${text}\n${source.snippet || ''}`)) reasons.push({ code: 'sensitive_data', label: '可能包含敏感数据', blocking: !candidate.riskAcknowledgedAt });
  if (candidate.conflictWith?.length || CONFLICT_PATTERN.test(String(candidate.conflictNote || ''))) reasons.push({ code: 'conflict', label: '存在冲突或待核实内容', blocking: true });
  return {
    level: reasons.some((item) => item.blocking) ? 'high' : reasons.length ? 'medium' : 'low',
    reasons,
    blocked: reasons.some((item) => item.blocking),
  };
}

function extractCandidateGroups(parsed = {}) {
  const result = [];
  if (Array.isArray(parsed.candidates)) {
    for (const item of parsed.candidates) {
      const target = TARGET_ALIASES.get(String(item?.target || '')) || String(item?.target || '');
      if (['memory', 'soul', 'qa', 'todo'].includes(target)) result.push({ target, item });
    }
  }
  for (const [key, target] of TARGET_ALIASES.entries()) {
    if (!Array.isArray(parsed[key])) continue;
    for (const item of parsed[key]) result.push({ target, item });
  }
  return result;
}

function buildKnowledgeCandidates(parsed = {}, { studentId = '', tool = 'qclaw', source = {}, sourceContent = '', createdAt = new Date().toISOString() } = {}) {
  const groups = extractCandidateGroups(parsed).slice(0, MAX_CANDIDATES_PER_IMPORT);
  const candidates = [];
  const seen = new Set();
  for (const { target, item } of groups) {
    const content = candidateValue(item);
    if (!content) continue;
    const fingerprint = hashText(`${target}\u241f${content.replace(/\s+/g, ' ').trim().toLowerCase()}`);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    const candidate = {
      schema: KNOWLEDGE_CANDIDATE_SCHEMA,
      id: stableId('knowledge-candidate', studentId, source.assetId || source.sourceId || source.sourceUri, target, fingerprint),
      studentId: String(studentId || ''),
      target,
      content,
      status: 'pending',
      tool: String(tool || 'qclaw'),
      fingerprint,
      source: candidateSource(item, source),
      conflictWith: Array.isArray(item?.conflictWith) ? item.conflictWith.map(String) : [],
      conflictNote: String(item?.conflictNote || ''),
      expiresAt: String(item?.expiresAt || ''),
      createdAt,
      updatedAt: createdAt,
      history: [{ action: 'created', at: createdAt, actorRole: 'agent', actorId: String(tool || 'qclaw') }],
    };
    candidate.risk = assessCandidateRisk(candidate, sourceContent);
    candidates.push(candidate);
  }
  return {
    candidates,
    truncated: extractCandidateGroups(parsed).length > MAX_CANDIDATES_PER_IMPORT,
    maxCandidates: MAX_CANDIDATES_PER_IMPORT,
  };
}

function mergeCandidateRegistry(current = {}, incoming = []) {
  const existing = Array.isArray(current.candidates) ? current.candidates : [];
  const byFingerprint = new Map(existing.map((item) => [String(item.fingerprint || ''), item]));
  const added = [];
  const duplicates = [];
  for (const candidate of incoming) {
    const duplicate = byFingerprint.get(String(candidate.fingerprint || ''));
    if (duplicate) {
      duplicates.push({ candidateId: candidate.id, existingId: duplicate.id, fingerprint: candidate.fingerprint });
      continue;
    }
    byFingerprint.set(candidate.fingerprint, candidate);
    added.push(candidate);
  }
  const now = new Date().toISOString();
  return {
    registry: {
      schema: CANDIDATE_REGISTRY_SCHEMA,
      version: 1,
      updatedAt: now,
      candidates: [...added, ...existing].slice(0, 2000),
    },
    added,
    duplicates,
  };
}

function updateCandidate(candidate, action, payload = {}, now = new Date().toISOString(), sourceContent = '') {
  const next = JSON.parse(JSON.stringify(candidate || {}));
  const previousStatus = String(next.status || 'pending');
  if (action === 'reject') next.status = 'rejected';
  else if (action === 'restore') next.status = 'pending';
  else if (action === 'expire') next.status = 'expired';
  else if (action === 'conflict') {
    next.status = 'conflict';
    next.conflictNote = String(payload.note || '人工标记冲突');
    next.conflictWith = Array.isArray(payload.conflictWith) ? payload.conflictWith.map(String) : next.conflictWith || [];
  } else if (action === 'resolve') {
    next.status = 'pending';
    next.conflictNote = '';
    next.conflictWith = [];
  } else if (action === 'acknowledge_sensitive') {
    next.riskAcknowledgedAt = now;
    next.riskAcknowledgedBy = String(payload.actorId || 'local-user');
  } else if (action === 'edit') {
    const content = String(payload.content ?? next.content ?? '').trim();
    if (!content) throw new Error('候选内容不能为空。');
    next.content = content;
    if (payload.sourceSnippet !== undefined) next.source.snippet = String(payload.sourceSnippet || '').trim();
    if (payload.messageId !== undefined) next.source.messageId = String(payload.messageId || '').trim();
    if (payload.locator !== undefined) next.source.locator = String(payload.locator || '').trim();
    next.fingerprint = hashText(`${next.target}\u241f${content.replace(/\s+/g, ' ').toLowerCase()}`);
  } else if (action === 'merge') {
    next.status = 'merged';
    next.mergedInto = String(payload.targetId || '');
    if (!next.mergedInto) throw new Error('合并操作缺少目标候选。');
  } else {
    throw new Error('不支持的候选操作。');
  }
  next.updatedAt = now;
  next.risk = assessCandidateRisk(next, sourceContent);
  next.history = [
    ...(Array.isArray(next.history) ? next.history : []),
    { action, from: previousStatus, to: next.status, at: now, actorRole: 'administrator', actorId: String(payload.actorId || 'local-user'), note: String(payload.note || '') },
  ];
  return next;
}

function canPromoteCandidate(candidate) {
  if (!candidate || candidate.status !== 'pending') return { ok: false, reason: '候选不是待审核状态。' };
  if (candidate.expiresAt && Date.parse(candidate.expiresAt) <= Date.now()) return { ok: false, reason: '候选已经过期。' };
  const risk = candidate.risk || assessCandidateRisk(candidate);
  if (risk.blocked) return { ok: false, reason: risk.reasons.filter((item) => item.blocking).map((item) => item.label).join('、') };
  return { ok: true, reason: '' };
}

module.exports = {
  CANDIDATE_REGISTRY_SCHEMA,
  CONVERSATION_ASSET_SCHEMA,
  INTERACTION_SCHEMA,
  KNOWLEDGE_CANDIDATE_SCHEMA,
  MAX_CANDIDATES_PER_IMPORT,
  MAX_PROMOTION_BATCH,
  assessCandidateRisk,
  buildKnowledgeCandidates,
  canPromoteCandidate,
  hashText,
  mergeCandidateRegistry,
  normalizeConversationImport,
  stableId,
  updateCandidate,
};
