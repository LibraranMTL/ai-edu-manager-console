const CONTRACT_VERSION = 'edu-manager.agent-capabilities.v1';

const CAPABILITIES = Object.freeze({
  'knowledge.query': { permission: 'knowledge:query', risk: 'read', scope: ['student', 'project'], schema: { type: 'object', required: ['studentId', 'question'], properties: { studentId: { type: 'string' }, projectId: { type: 'string' }, question: { type: 'string', minLength: 1, maxLength: 2000 } }, additionalProperties: false } },
  'research.search': { permission: 'research:search', risk: 'read', scope: ['student'], schema: { type: 'object', required: ['studentId', 'query'], properties: { studentId: { type: 'string' }, query: { type: 'string', minLength: 1, maxLength: 2000 }, region: { type: 'string', maxLength: 120 }, language: { type: 'string', maxLength: 20 } }, additionalProperties: false } },
  'archive.list': { permission: 'archive:read', risk: 'read', scope: ['student', 'project'], schema: { type: 'object', required: ['studentId'], properties: { studentId: { type: 'string' }, projectId: { type: 'string' }, cursor: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 50 } }, additionalProperties: false } },
  'task.status': { permission: 'task:read', risk: 'read', scope: ['student', 'project'], schema: { type: 'object', required: ['studentId'], properties: { studentId: { type: 'string' }, projectId: { type: 'string' }, cursor: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 50 } }, additionalProperties: false } },
  'student.overview': { permission: 'student:read', risk: 'read', scope: ['student'], schema: { type: 'object', required: ['studentId'], properties: { studentId: { type: 'string' } }, additionalProperties: false } },
  'project.overview': { permission: 'project:read', risk: 'read', scope: ['project'], schema: { type: 'object', required: ['studentId', 'projectId'], properties: { studentId: { type: 'string' }, projectId: { type: 'string' } }, additionalProperties: false } },
  'report.list': { permission: 'report:read', risk: 'read', scope: ['student'], schema: { type: 'object', required: ['studentId'], properties: { studentId: { type: 'string' } }, additionalProperties: false } },
  'report.read': { permission: 'report:read', risk: 'read', scope: ['student'], schema: { type: 'object', required: ['studentId', 'reportId'], properties: { studentId: { type: 'string' }, reportId: { type: 'string', description: '使用 report.list 返回的 id；整体画像为 profile，不是本地路径。' }, offset: { type: 'integer', minimum: 0, maximum: 10000000 }, limit: { type: 'integer', minimum: 1, maximum: 65536 }, contentHash: { type: 'string', maxLength: 64, description: '后续页必须原样携带第一页返回的 contentHash；内容变化时从第一页重读。' } }, additionalProperties: false } },
  'conversation.submit': { permission: 'conversation:submit', risk: 'write', approval: 'host', idempotency: 'required', scope: ['student', 'project'], schema: { type: 'object', required: ['studentId', 'messages'], properties: { studentId: { type: 'string' }, projectId: { type: 'string' }, messages: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', required: ['role', 'content'], properties: { role: { type: 'string', enum: ['user', 'assistant'] }, content: { type: 'string', minLength: 1, maxLength: 20000 } }, additionalProperties: false } }, sourceAgent: { type: 'string' }, title: { type: 'string' }, sessionId: { type: 'string' } }, additionalProperties: false } },
  'material.upload': { permission: 'material:upload', risk: 'write', approval: 'host', idempotency: 'required', scope: ['student', 'project'], schema: { type: 'object', required: ['studentId', 'filename', 'contentBase64'], properties: { studentId: { type: 'string' }, projectId: { type: 'string' }, filename: { type: 'string' }, contentBase64: { type: 'string', maxLength: 2800000 } }, additionalProperties: false } },
  'task.create': { permission: 'task:create', risk: 'write', approval: 'host', idempotency: 'required', scope: ['student', 'project'], schema: { type: 'object', required: ['studentId', 'title', 'detail'], properties: { studentId: { type: 'string' }, projectId: { type: 'string' }, title: { type: 'string' }, detail: { type: 'string' } }, additionalProperties: false } },
  'report.draft': { permission: 'report:draft', risk: 'write', approval: 'host', idempotency: 'required', scope: ['student'], schema: { type: 'object', required: ['studentId', 'reportId', 'content'], properties: { studentId: { type: 'string' }, reportId: { type: 'string' }, content: { type: 'string', maxLength: 65536 } }, additionalProperties: false } },
});

const LEGACY_AGENT_ROUTES = Object.freeze({
  'POST /api/agent/connector': 'contract:invoke',
  'POST /api/agent/knowledge/query': 'knowledge:query',
  'POST /api/agent/conversation/submit': 'conversation:submit',
  'POST /api/agent/memory/session/start': 'memory:write',
  'POST /api/agent/memory/session/append': 'memory:write',
  'POST /api/agent/memory/session/observe': 'memory:write',
  'POST /api/agent/memory/session/finalize': 'memory:write',
  'POST /api/agent/memory/recent': 'memory:read',
  'POST /api/agent/memory/handoff/accept': 'handoff:manage',
  'POST /api/agent/memory/handoff/cancel': 'handoff:manage',
  'GET /api/agent/capabilities': 'contract:read',
  'GET /api/agent/openapi': 'contract:read',
  'POST /api/agent/invoke': 'contract:invoke',
  'POST /api/agent/write/preview': 'contract:invoke',
  'POST /api/agent/write/execute': 'contract:invoke',
  'POST /api/agent/write/status': 'contract:invoke',
});

function agentRouteDecision(auth, method, pathname) {
  if (auth?.type !== 'agent_grant') return { allowed: true };
  const required = LEGACY_AGENT_ROUTES[`${String(method || '').toUpperCase()} ${pathname}`];
  if (!required) return { allowed: false, code: 'AGENT_ROUTE_DENIED' };
  if (!required.startsWith('contract:') && !auth.capabilities?.includes(required)) return { allowed: false, code: 'CAPABILITY_DENIED' };
  return { allowed: true };
}

function agentTokenFromAuthorization(header) {
  const match = /^Bearer\s+(.+)$/i.exec(String(header || ''));
  const token = match ? match[1].trim() : '';
  return token.toLowerCase().startsWith('eak_') ? token : '';
}

function validateCapabilityInput(name, input) {
  const spec = CAPABILITIES[name];
  if (!spec) return { ok: false, code: 'UNKNOWN_CAPABILITY' };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, code: 'INVALID_INPUT' };
  const properties = spec.schema.properties;
  for (const key of Object.keys(input)) if (!Object.hasOwn(properties, key)) return { ok: false, code: 'INVALID_INPUT' };
  for (const key of spec.schema.required) {
    const value = input[key];
    if (properties[key].type === 'string' && (typeof value !== 'string' || !value.trim())) return { ok: false, code: 'INVALID_INPUT' };
    if (properties[key].type === 'array' && (!Array.isArray(value) || !value.length)) return { ok: false, code: 'INVALID_INPUT' };
  }
  for (const [key, value] of Object.entries(input)) {
    const rule = properties[key];
    if (rule.type === 'string' && (typeof value !== 'string' || value.length > (rule.maxLength || 240))) return { ok: false, code: 'INVALID_INPUT' };
    if (rule.type === 'array' && !Array.isArray(value)) return { ok: false, code: 'INVALID_INPUT' };
    if (rule.type === 'integer' && (!Number.isInteger(value) || value < rule.minimum || value > (rule.maximum || 100000))) return { ok: false, code: 'INVALID_INPUT' };
  }
  return { ok: true, spec };
}

function authorizeCapability(auth, name, input, project) {
  const valid = validateCapabilityInput(name, input);
  if (!valid.ok) return valid;
  if (auth?.type !== 'agent_grant') return { ok: false, code: 'AGENT_GRANT_REQUIRED' };
  if (!auth.capabilities?.includes(valid.spec.permission)) return { ok: false, code: 'CAPABILITY_DENIED' };
  if (!auth.allowedStudentIds?.includes(String(input.studentId))) return { ok: false, code: 'STUDENT_SCOPE_DENIED' };
  if (input.projectId) {
    if (!project || String(project.id) !== input.projectId || !auth.allowedProjectIds?.includes(input.projectId)
      || !project.studentIds?.map(String).includes(input.studentId)
      || project.studentIds?.map(String).filter(Boolean).length !== 1) return { ok: false, code: 'PROJECT_SCOPE_DENIED' };
  } else if (valid.spec.scope.length === 1 && valid.spec.scope[0] === 'project') return { ok: false, code: 'PROJECT_SCOPE_REQUIRED' };
  return { ok: true, spec: valid.spec };
}

function agentKnowledgeScopePlan(auth, studentId, projects = []) {
  const id = String(studentId || '');
  if (auth?.type !== 'agent_grant' || !auth.allowedStudentIds?.includes(id)) {
    return { ok: false, code: 'STUDENT_SCOPE_DENIED' };
  }
  const linked = projects.filter((project) => (project.studentIds || []).map(String).includes(id));
  const allowed = linked.filter((project) => (
    auth.allowedProjectIds?.includes(String(project.id))
    && (project.studentIds || []).map(String).filter(Boolean).length === 1
  ));
  return {
    ok: true,
    scopes: [
      { scopeType: 'student', scopeId: id },
      ...allowed.map((project) => ({ scopeType: 'project', scopeId: String(project.id) })),
    ],
    limited: allowed.length !== linked.length,
  };
}

function knowledgeCapabilityDecision(result) {
  if (result?.ok === true) return { ok: true, outcome: 'found' };
  if (result?.lookupCompleted === true
    && ['local', 'remote', 'offline_snapshot'].includes(result?.source)
    && result?.retryable !== true
    && Array.isArray(result?.resources)
    && result.resources.length === 0) return { ok: true, outcome: 'no_evidence' };
  return { ok: false, code: 'KNOWLEDGE_UNAVAILABLE' };
}

function knowledgeCapabilityFreshness(result) {
  const origin = String(result?.freshness || '').trim();
  if (origin === 'offline_snapshot' || result?.source === 'offline_snapshot') return 'offline_snapshot';
  if (result?.source === 'waiting') return 'waiting';
  if (result?.cachedQuery === true) return 'cached';
  return origin || (result?.source === 'local' ? 'local' : 'unknown');
}

function page(items, input) {
  const cursor = input.cursor || 0;
  const limit = input.limit || 20;
  const slice = items.slice(cursor, cursor + limit);
  return { items: slice, nextCursor: cursor + limit < items.length ? cursor + limit : null, total: items.length };
}

function createAgentRateLimiter(limit = 90, windowMs = 60_000) {
  const windows = new Map();
  return (grantId, now = Date.now()) => {
    const active = (windows.get(grantId) || []).filter((at) => now - at < windowMs);
    if (active.length >= limit) return false;
    active.push(now);
    windows.set(grantId, active);
    if (windows.size > 500) for (const [key, times] of windows) if (now - times.at(-1) > windowMs) windows.delete(key);
    return true;
  };
}

function openApiDocument(capabilities = CAPABILITIES, baseUrl = 'http://127.0.0.1') {
  return {
    openapi: '3.1.0',
    info: { title: 'AI 教育管家 Agent Capability API', version: CONTRACT_VERSION },
    servers: [{ url: baseUrl }],
    security: [{ AgentBearer: [] }],
    paths: {
      '/api/agent/capabilities': { get: { operationId: 'listAgentCapabilities', responses: { 200: { description: 'Authorized capabilities' } } } },
      '/api/agent/invoke': { post: { operationId: 'invokeAgentCapability', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name', 'input'], properties: { name: { type: 'string', enum: Object.keys(capabilities) }, input: { type: 'object' } }, additionalProperties: false } } } }, responses: { 200: { description: 'Scoped receipt, including a completed knowledge query with no evidence' }, 403: { description: 'Denied with stable code' }, 429: { description: 'Rate limited' }, 503: { description: 'Knowledge lookup temporarily unavailable' } } } },
      '/api/agent/write/preview': { post: { operationId: 'previewAgentWrite', description: 'Persist a scoped write intent. Does not execute. Requires idempotencyKey.', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name', 'input', 'idempotencyKey'], properties: { name: { type: 'string', enum: Object.keys(capabilities).filter((name) => capabilities[name].risk === 'write') }, input: { type: 'object' }, idempotencyKey: { type: 'string', minLength: 1, maxLength: 128 } }, additionalProperties: false } } } }, responses: { 200: { description: 'Intent and SHA-256 input digest' }, 403: { description: 'Denied' } } } },
      '/api/agent/write/status': { post: { operationId: 'getAgentWriteStatus', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['intentId'], properties: { intentId: { type: 'string' } } } } } }, responses: { 200: { description: 'Own intent status and receipt' } } } },
      '/api/agent/write/execute': { post: { operationId: 'executeApprovedAgentWrite', description: 'Requires prior local host administrator approval.', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['intentId'], properties: { intentId: { type: 'string' } } } } } }, responses: { 200: { description: 'Idempotent receipt' }, 403: { description: 'Not approved or out of scope' } } } },
    },
    components: { securitySchemes: { AgentBearer: { type: 'http', scheme: 'bearer' } }, schemas: Object.fromEntries(Object.entries(capabilities).map(([name, spec]) => [name, spec.schema])) },
  };
}

module.exports = { CONTRACT_VERSION, CAPABILITIES, LEGACY_AGENT_ROUTES, agentRouteDecision, agentTokenFromAuthorization, validateCapabilityInput, authorizeCapability, agentKnowledgeScopePlan, knowledgeCapabilityDecision, knowledgeCapabilityFreshness, page, createAgentRateLimiter, openApiDocument };
