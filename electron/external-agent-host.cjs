'use strict';
const crypto = require('node:crypto');
const { fail } = require('./external-agent-connector.cjs');
const { validateWriteInput } = require('./agent-write-intents.cjs');
const { CAPABILITIES, validateCapabilityInput } = require('./agent-capability-contract.cjs');
function readInput(name, input) {
  const spec = CAPABILITIES[name];
  if (!spec || spec.risk !== 'read') throw fail('READ_CAPABILITY_REQUIRED');
  // Only omitted optional read inputs normalize to {}; null/scalars/arrays and
  // unknown fields remain errors. Never coerce or drop a misspelled query.
  const value = input === undefined ? {} : input;
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !validateCapabilityInput(name, { ...value, studentId: 'scope-validation' }).ok) {
    throw fail('INVALID_INPUT', `${name} 参数无效；仅接受：${Object.keys(spec.schema.properties).filter(k => k !== 'studentId').join(', ') || '空 input 或省略 input'}。`);
  }
  return value;
}
function createExternalGateway({ connectors, writer, invoke, memory, projects }) {
  return async function request(token, body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail('INVALID_INPUT');
    if (body.action === 'health') {
      const auth = connectors.auth(token);
      if (!auth) throw fail('CONNECTION_INACTIVE');
      if (typeof body.nonce !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(body.nonce)) throw fail('INVALID_INPUT');
      return { ok: true, nonce: body.nonce, connectionId: auth.connectionId, accessMode: connectors.read().policy.accessMode, capabilities: auth.capabilities };
    }
    if (body.studentIds !== undefined && body.action !== 'queryMany') throw fail('AMBIGUOUS_STUDENT_SCOPE', '当前不支持批量写入；每项操作须明确唯一目标学生');
    if (body.action === 'describe') {
      const auth = connectors.auth(token); if (!auth) throw fail('CONNECTION_INACTIVE');
      return { ok: true, capabilities: auth.capabilities };
    }
    if (body.action === 'open') return connectors.open(token, body.sessionId);
    if (body.action === 'students') return { ok: true, students: connectors.directory(token, body.sessionId, body.contextRevision) };
    if (['status', 'execute', 'retryProcessing', 'verifyIndex'].includes(body.action)) return writer[body.action](token, body);
    if (body.action === 'queryMany') {
      const session = connectors.sessionAuth(token, body.sessionId, body.contextRevision);
      if (session.accessMode !== 'all_authorized_students') throw fail('STUDENT_SCOPE_DENIED');
      if (CAPABILITIES[body.name]?.risk !== 'read' || !['knowledge.query', 'student.overview', 'archive.list', 'task.status', 'report.list'].includes(body.name)) throw fail('READ_CAPABILITY_REQUIRED');
      if (body.targetStudentId !== undefined || body.input && (Object.hasOwn(body.input, 'studentId') || Object.hasOwn(body.input, 'projectId'))) throw fail('AMBIGUOUS_STUDENT_SCOPE');
      const query = readInput(body.name, body.input);
      const available = connectors.directory(token, body.sessionId, body.contextRevision);
      const ids = body.studentIds === 'all' ? available.map(s => s.studentId) : body.studentIds;
      if (!Array.isArray(ids) || !ids.length || ids.length > 50 || new Set(ids).size !== ids.length) throw fail('INVALID_STUDENT_SELECTION', '每次查询选择 1–50 名学生；更多学生请分批');
      // Preflight every ID before invoking any query, then recheck immediately per student.
      for (const studentId of ids) connectors.resolve(token, body.sessionId, body.contextRevision, studentId);
      const results = [];
      for (const studentId of ids) {
        const auth = connectors.resolve(token, body.sessionId, body.contextRevision, studentId);
        const result = await invoke({ authContext: auth }, body.name, { ...query, studentId });
        connectors.resolve(token, body.sessionId, body.contextRevision, studentId);
        results.push({ studentId, name: available.find(s => s.studentId === studentId)?.name, result });
      }
      return { ok: true, results };
    }
    const auth = connectors.resolve(token, body.sessionId, body.contextRevision, body.targetStudentId);
    if (body.action === 'submit') return writer.submit(token, body);
    const input = { ...(body.action === 'invoke' ? readInput(body.name, body.input) : body.input || {}), studentId: auth.studentId };
    if (body.input?.studentId && body.input.studentId !== auth.studentId) throw fail('STUDENT_SCOPE_DENIED');
    if (body.action === 'invoke') return invoke({ authContext: auth }, body.name, input);
    if (body.action !== 'memory') throw fail('UNKNOWN_ACTION');
    if (auth.accessMode === 'all_authorized_students') throw fail('MULTI_STUDENT_MEMORY_DISABLED', '多学生会话不自动写入单个学生的记忆；请保存明确归属的学生专属资料');
    const permission = body.operation === 'recent' ? 'memory:read' : ['accept', 'cancel', 'finalize'].includes(body.operation) ? 'handoff:manage' : 'memory:write';
    if (!auth.capabilities.includes(permission)) throw fail('CAPABILITY_DENIED');
    const projectId = input.projectId || auth.defaultProjectId;
    if (projectId && !auth.allowedProjectIds.includes(projectId)) throw fail('PROJECT_SCOPE_DENIED');
    if (body.operation !== 'recent' && projectId && projects().find(p => String(p.id) === projectId)?.status === 'sealed') throw fail('PROJECT_SEALED');
    // Memory identifiers and identity come from authenticated connection/session,
    // never from sourceAgent, sourceNodeId or content supplied by an Agent.
    const scope = { studentId: auth.studentId, projectId: projectId || '', agentId: auth.hostType,
      sessionId: crypto.createHash('sha256').update(JSON.stringify([auth.connectionId, auth.sessionId, auth.contextRevision, projectId || ''])).digest('hex'),
      sourceNodeId: auth.connectionId, origin: 'authorized_agent' };
    if (body.operation === 'recent') {
      const results = memory().recentContext({ ...scope, limit: 50 });
      results.sessions = (results.sessions || []).filter(s => !s.projectId || auth.allowedProjectIds.includes(s.projectId));
      return { ok: true, result: results };
    }
    if (auth.requireWriteConfirmation) throw fail('MEMORY_CONFIRMATION_REQUIRED', '高级逐次确认已开启，请通过对话归档提交，批准后保存');
    if (body.provenance?.sourceType?.startsWith('internal_')) throw fail('INTERNAL_FEEDBACK_DENIED');
    const store = memory();
    if (body.operation === 'start') return { ok: true, result: store.startSession({ ...scope, title: String(input.title || '外部授权会话').slice(0, 240) }) };
    if (body.operation === 'append') {
      if (validateWriteInput('conversation.submit', { studentId: auth.studentId, messages: input.messages })) throw fail('INVALID_INPUT');
      if (input.messages.some(m => typeof m.messageId !== 'string' || !m.messageId.trim() || m.messageId.length > 240)) throw fail('MESSAGE_ID_REQUIRED', '每条消息需要稳定 messageId，避免把不同轮次相同文本错误合并');
      const messages = input.messages.map(m => ({ role: m.role, content: m.content, eventId: crypto.createHash('sha256').update(JSON.stringify([scope.sessionId, m.messageId || '', m.role, m.content])).digest('hex') }));
      return { ok: true, result: store.appendMessages({ ...scope, messages }) };
    }
    if (body.operation === 'finalize') return { ok: true, result: store.finalizeSession({ ...scope, summary: input.summary, handoff: input.handoff, idempotencyKey: scope.sessionId, status: 'completed' }), note: '仅结束会话记忆；归档需要 conversation:submit，不在 read_memory 档位隐式写入资料库。' };
    if (body.operation === 'accept') return { ok: true, result: store.acceptHandoff({ ...scope, handoffId: input.handoffId }) };
    if (body.operation === 'cancel') return { ok: true, result: store.cancelHandoff({ ...scope, handoffId: input.handoffId }) };
    throw fail('UNKNOWN_MEMORY_OPERATION');
  };
}
module.exports = { createExternalGateway };
