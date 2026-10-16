'use strict';
// Inbound authorization only. No provider dispatch or vendor credentials live here.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { writeJsonAtomic } = require('./project-materials.cjs');
const { CAPABILITIES } = require('./agent-capability-contract.cjs');
const SCHEMA = 'edu-manager.external-connectors.v1';
const PERMISSIONS = Object.freeze([
  ['knowledge:query', '知识查询', 'read'], ['archive:read', '档案来源', 'read'],
  ['task:read', '任务与回执', 'read'], ['student:read', '学生概览', 'read'],
  ['project:read', '项目概览', 'read'], ['report:read', '报告读取', 'read'],
  ['memory:read', '会话记忆读取', 'memory'], ['memory:write', '当前会话记忆保存', 'memory'],
  ['handoff:manage', '会话交接', 'memory'], ['conversation:submit', '对话归档', 'write'],
  ['material:upload', '资料保存', 'write'], ['task:create', '任务草稿', 'write'], ['report:draft', '报告草稿', 'write'],
].map(([id, label, group]) => ({ id, label, group, exposedOperations: Object.entries(CAPABILITIES).filter(([, s]) => s.permission === id).map(([name]) => name).concat({ 'memory:read': ['memory.recent'], 'memory:write': ['memory.start', 'memory.append'], 'handoff:manage': ['memory.finalize', 'memory.accept', 'memory.cancel'] }[id] || []) })));
const PRESETS = Object.freeze(Object.fromEntries(['read', 'read_memory', 'full'].map(p => [p, PERMISSIONS.filter(x => p === 'full' || x.group === 'read' || p === 'read_memory' && x.group === 'memory').map(x => x.id)])));
const fail = (code, message = code) => Object.assign(new Error(message), { code });
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const id = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 240;
function restrictions(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !['excludedStudentIds', 'excludedProjectIds', 'disabledPermissions', 'expiresAt', 'requireWriteConfirmation'].includes(k))) throw fail('INVALID_RESTRICTIONS', '高级设置只能减权');
  const result = {};
  for (const k of ['excludedStudentIds', 'excludedProjectIds', 'disabledPermissions']) {
    if (value[k] !== undefined && (!Array.isArray(value[k]) || value[k].length > 1000 || value[k].some(v => !id(v)))) throw fail('INVALID_RESTRICTIONS');
    result[k] = [...new Set(value[k] || [])];
  }
  if (result.disabledPermissions.some(v => !PERMISSIONS.some(p => p.id === v))) throw fail('UNKNOWN_PERMISSION');
  if (value.expiresAt && !Number.isFinite(Date.parse(value.expiresAt))) throw fail('INVALID_EXPIRY');
  if (value.requireWriteConfirmation !== undefined && typeof value.requireWriteConfirmation !== 'boolean') throw fail('INVALID_RESTRICTIONS');
  return { ...result, expiresAt: value.expiresAt || '', requireWriteConfirmation: value.requireWriteConfirmation === true };
}
function initialStore() {
  return { schema: SCHEMA, revision: 0, policy: { status: 'unconfigured', preset: 'read', accessMode: 'session_bound', paused: false, inheritForNewStudents: true, inheritForNewConnections: true, authorizationEpoch: '', revision: 0, restrictions: restrictions() }, connections: [], sessions: [], history: [] };
}
function eligibleStudents(store, students, connection) {
  const excluded = [...store.policy.restrictions.excludedStudentIds, ...(connection?.restrictions.excludedStudentIds || [])];
  return students.filter(s => !s.archived && s.status !== 'archived' && !excluded.includes(String(s.id)) && (store.policy.inheritForNewStudents || store.policy.studentIds?.includes(String(s.id))));
}
function effective(store, connection, students, projects, session, now = Date.now()) {
  const policy = store.policy;
  if (policy.status !== 'active' || policy.paused) throw fail('EXTERNAL_AUTH_INACTIVE', '外部连接授权已暂停、撤销或尚未设置');
  if (!connection || connection.status !== 'active' || connection.authorizationEpoch !== policy.authorizationEpoch) throw fail('CONNECTION_INACTIVE', '连接尚未授权或已撤销');
  const limits = [policy.restrictions, connection.restrictions];
  if (limits.some(r => r.expiresAt && Date.parse(r.expiresAt) <= now)) throw fail('EXTERNAL_AUTH_EXPIRED');
  const capabilities = PRESETS[policy.preset].filter(p => !limits.some(r => r.disabledPermissions.includes(p)));
  const studentId = session?.studentId || '';
  if (studentId && !eligibleStudents(store, students, connection).some(s => String(s.id) === studentId)) throw fail('STUDENT_SCOPE_DENIED');
  const allowedProjectIds = projects.filter(p => p.status !== 'archived' && (p.studentIds || []).length === 1 && String(p.studentIds[0]) === studentId && !limits.some(r => r.excludedProjectIds.includes(String(p.id)))).map(p => String(p.id));
  return { type: 'agent_grant', grantId: connection.connectionId, connectionId: connection.connectionId, hostType: connection.hostType,
    studentId, allowedStudentIds: studentId ? [studentId] : [], allowedProjectIds, capabilities, allowedAllStudents: false,
    sessionId: session?.sessionId || '', contextRevision: session?.contextRevision || 0, defaultProjectId: session?.defaultProjectId || '',
    policyRevision: policy.revision, authorizationEpoch: policy.authorizationEpoch,
    accessMode: session?.accessMode || 'session_bound',
    requireWriteConfirmation: limits.some(r => r.requireWriteConfirmation) };
}
function createConnectorStore(file, { students = () => [], projects = () => [], legacyFiles = [] } = {}) {
  let queue = Promise.resolve();
  function read() {
    try {
      const s = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (s.schema !== SCHEMA || !PRESETS[s.policy?.preset] || !Array.isArray(s.connections) || !Array.isArray(s.sessions)) throw Error('schema');
      s.policy.restrictions = restrictions(s.policy.restrictions);
      s.policy.accessMode ||= 'session_bound';
      if (!['session_bound', 'all_authorized_students'].includes(s.policy.accessMode)) throw Error('scope');
      for (const c of s.connections) c.restrictions = restrictions(c.restrictions);
      return s;
    } catch (e) { if (e.code === 'ENOENT') return initialStore(); throw fail('CONNECTOR_STORE_INVALID', '外部连接授权文件损坏，已阻止访问；请修复而非恢复旧授权备份'); }
  }
  const transact = fn => {
    const work = queue.then(async () => {
      const s = read(), result = fn(s);
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      // Backup is diagnostic only: never load it as live authorization on a read failure.
      if (!s.migratedAt) {
        for (const legacy of legacyFiles) if (fs.existsSync(legacy) && !fs.existsSync(legacy + '.pre-r21.bak')) await fs.promises.copyFile(legacy, legacy + '.pre-r21.bak', fs.constants.COPYFILE_EXCL);
        s.migratedAt = new Date().toISOString();
        s.migration = 'legacy_tokens_scope_preserved_pending_writes_not_approved';
      }
      s.revision++; await writeJsonAtomic(file, s); return result;
    });
    queue = work.catch(() => {}); return work;
  };
  function auth(token, sessionId = '') {
    const s = read(), h = hash(token), c = s.connections.find(c => c.tokenHash === h);
    if (!c) return null;
    const session = sessionId ? s.sessions.find(x => x.connectionId === c.connectionId && x.sessionId === sessionId) : null;
    if (sessionId && !session) throw fail('SESSION_NOT_FOUND');
    return effective(s, c, students(), projects(), session);
  }
  function snapshot() {
    const s = read();
    return { ...s, permissions: PERMISSIONS, presets: PRESETS,
      students: students().filter(s => !s.archived && s.status !== 'archived').map(s => ({ id: String(s.id), name: s.name })),
      projects: projects().map(p => ({ id: String(p.id), name: p.name, studentIds: p.studentIds, status: p.status })),
      connections: s.connections.map(({ tokenHash, ...c }) => c) };
  }
  async function action(action, input = {}) {
    if (action === 'snapshot') return snapshot();
    const result = await transact(s => {
      const at = new Date().toISOString();
      if (action === 'savePolicy') {
        if (Number(input.revision) !== s.policy.revision) throw fail('POLICY_CONFLICT', '授权已变化，请刷新后重试');
        if (!PRESETS[input.preset] || input.confirmed !== true) throw fail('CONSENT_REQUIRED');
        const fresh = s.policy.status !== 'active';
        const accessMode = input.accessMode || s.policy.accessMode || 'session_bound';
        if (!['session_bound', 'all_authorized_students'].includes(accessMode)) throw fail('INVALID_ACCESS_MODE');
        if (accessMode !== (s.policy.accessMode || 'session_bound')) {
          for (const session of s.sessions) Object.assign(session, { accessMode, studentId: '', defaultProjectId: '', contextRevision: session.contextRevision + 1 });
        }
        s.policy = { ...s.policy, status: 'active', preset: input.preset, paused: fresh ? false : s.policy.paused, revision: s.policy.revision + 1,
          accessMode,
          authorizationEpoch: fresh ? crypto.randomUUID() : s.policy.authorizationEpoch, authorizedAt: fresh ? at : s.policy.authorizedAt,
          inheritForNewStudents: input.inheritForNewStudents !== false, inheritForNewConnections: input.inheritForNewConnections !== false,
          studentIds: !fresh && s.policy.inheritForNewStudents === false && input.inheritForNewStudents === false ? s.policy.studentIds : students().map(s => String(s.id)), restrictions: restrictions(input.restrictions || s.policy.restrictions) };
      } else if (['pause', 'resume', 'revoke'].includes(action)) {
        if (s.policy.status !== 'active') throw fail('EXTERNAL_AUTH_INACTIVE');
        s.policy.paused = action === 'pause'; s.policy.revision++;
        if (action === 'revoke') { s.policy.status = 'revoked'; s.legacyDenied = true; s.policy.authorizationEpoch = crypto.randomUUID(); for (const c of s.connections) { c.status = 'revoked'; c.revokedAt = at; } }
      } else if (action === 'createConnection') {
        if (!id(input.label) || !['workbuddy', 'codex', 'generic'].includes(input.hostType)) throw fail('INVALID_CONNECTION');
        if (s.policy.status !== 'active' || s.policy.paused) throw fail('EXTERNAL_AUTH_INACTIVE');
        if (s.connections.length >= 500) throw fail('CONNECTION_LIMIT');
        const token = `eak_r21_${crypto.randomBytes(32).toString('hex')}`;
        const connection = { connectionId: `external-${crypto.randomUUID()}`, label: input.label, hostType: input.hostType, tokenHash: hash(token), credentialVersion: 1,
          status: s.policy.inheritForNewConnections ? 'active' : 'disabled', authorizationEpoch: s.policy.authorizationEpoch, acceptedPolicyRevision: s.policy.revision, restrictions: restrictions(), createdAt: at };
        s.connections.push(connection);
        s.history = [...s.history, { action, connectionId: connection.connectionId, revision: s.policy.revision, at }].slice(-200);
        return { connectionId: connection.connectionId, token };
      } else if (action === 'connection') {
        const c = s.connections.find(c => c.connectionId === input.connectionId);
        if (!c || c.status === 'revoked') throw fail('CONNECTION_REVOKED');
        if (!['active', 'disabled', 'revoked'].includes(input.status)) throw fail('INVALID_CONNECTION');
        c.status = input.status; c.restrictions = restrictions(input.restrictions || c.restrictions);
        if (c.status === 'revoked') c.revokedAt = at;
      } else if (action === 'deleteConnection') {
        if (input.confirmed !== true) throw fail('CONSENT_REQUIRED', '请确认删除已撤销连接记录');
        const c = s.connections.find(c => c.connectionId === input.connectionId);
        if (!c) throw fail('CONNECTION_NOT_FOUND', '连接记录已不存在，请刷新');
        if (c.status !== 'revoked') throw fail('CONNECTION_NOT_REVOKED', '请先撤销连接，再删除记录');
        s.connections = s.connections.filter(item => item.connectionId !== c.connectionId);
        s.sessions = s.sessions.filter(item => item.connectionId !== c.connectionId);
        s.history = [...s.history, { action, connectionId: c.connectionId, hostType: c.hostType, label: c.label, revision: s.policy.revision, at }].slice(-200);
        return { message: '已删除撤销的连接记录及其会话绑定。旧凭据仍失效；学生资料、写入回执和审计记录保留。此操作不卸载 Agent 中的配置。' };
      } else if (action === 'bindSession') {
        const c = s.connections.find(c => c.connectionId === input.connectionId);
        const session = s.sessions.find(x => x.connectionId === input.connectionId && x.sessionId === input.sessionId);
        if (!session || input.confirmed !== true) throw fail('SESSION_SELECTION_REQUIRED');
        if (session.accessMode === 'all_authorized_students') throw fail('ALL_STUDENT_SESSION', '此会话按每次请求的目标学生执行，不设置共享当前学生');
        if (session.contextRevision !== Number(input.contextRevision)) throw fail('CONTEXT_CHANGED');
        const probe = { ...session, studentId: String(input.studentId || '') };
        if (!probe.studentId) throw fail('STUDENT_SCOPE_REQUIRED');
        const a = effective(s, c, students(), projects(), probe);
        if (input.projectId && !a.allowedProjectIds.includes(input.projectId)) throw fail('PROJECT_SCOPE_DENIED');
        Object.assign(session, { studentId: probe.studentId, defaultProjectId: input.projectId || '', contextRevision: session.contextRevision + 1, boundAt: at });
      } else throw fail('UNKNOWN_ACTION');
      s.history = [...s.history, { action, connectionId: input.connectionId || '', revision: s.policy.revision, at }].slice(-200);
      return { message: '外部连接设置已保存。内部 Agent 调度设置未改变。' };
    });
    return result;
  }
  async function open(token, sessionId) {
    if (!id(sessionId)) throw fail('SESSION_ID_REQUIRED');
    await transact(s => {
      const c = s.connections.find(c => c.tokenHash === hash(token));
      effective(s, c, students(), projects());
      let session = s.sessions.find(x => x.connectionId === c.connectionId && x.sessionId === sessionId);
      if (!session) {
        if (s.sessions.length >= 10000) throw fail('SESSION_LIMIT');
        const eligible = eligibleStudents(s, students(), c);
        const accessMode = s.policy.accessMode || 'session_bound';
        session = { connectionId: c.connectionId, sessionId, accessMode, studentId: accessMode === 'session_bound' && eligible.length === 1 ? String(eligible[0].id) : '', defaultProjectId: '', contextRevision: 1, boundAt: new Date().toISOString() };
        s.sessions.push(session);
      }
    });
    const a = auth(token, sessionId);
    return { ok: true, sessionId, accessMode: a.accessMode, studentId: a.studentId, contextRevision: a.contextRevision, defaultProjectId: a.defaultProjectId, capabilities: a.capabilities,
      bindingRequired: a.accessMode === 'session_bound' && !a.studentId, message: a.accessMode === 'all_authorized_students' ? '允许跨学生只读查询；每项写入必须指定 targetStudentId。禁止自动归档混合对话。' : a.studentId ? '会话归属已固定，页面切换不会改变。' : '请在教育管家外部连接设置中为此会话选择学生。' };
  }
  function sessionAuth(token, sessionId, contextRevision) {
    const a = auth(token, sessionId);
    if (!a || !sessionId) throw fail('SESSION_SELECTION_REQUIRED');
    if (a.contextRevision !== contextRevision) throw fail('CONTEXT_CHANGED', '会话归属已变化，请重新读取会话状态');
    return a;
  }
  function directory(token, sessionId, contextRevision) {
    const a = sessionAuth(token, sessionId, contextRevision);
    if (!a.capabilities.includes('student:read')) throw fail('CAPABILITY_DENIED');
    const s = read(), c = s.connections.find(c => c.connectionId === a.connectionId);
    return eligibleStudents(s, students(), c).filter(x => a.accessMode === 'all_authorized_students' || !a.studentId || String(x.id) === a.studentId).map(x => ({ studentId: String(x.id), name: x.name }));
  }
  function resolve(token, sessionId, contextRevision, targetStudentId) {
    const a = sessionAuth(token, sessionId, contextRevision);
    if (a.accessMode !== 'all_authorized_students') {
      if (!a.studentId) throw fail('SESSION_SELECTION_REQUIRED');
      if (targetStudentId !== undefined && targetStudentId !== a.studentId) throw fail('STUDENT_SCOPE_DENIED');
      return a;
    }
    if (!id(targetStudentId)) throw fail('TARGET_STUDENT_REQUIRED', '请从授权学生目录选择唯一 targetStudentId，不按姓名猜测');
    const s = read(), c = s.connections.find(c => c.connectionId === a.connectionId);
    return effective(s, c, students(), projects(), { sessionId, studentId: targetStudentId, contextRevision, accessMode: a.accessMode });
  }
  function resolveOperation(token, body, intent, readOnly = false) {
    const s = read(), c = s.connections.find(c => c.tokenHash === hash(token));
    if (!c || c.connectionId !== intent.connectionId || body.sessionId !== intent.sessionId || intent.authorizationEpoch !== s.policy.authorizationEpoch) throw fail('INTENT_SCOPE_DENIED');
    // Only previously started recovery and receipt reads can use the frozen scope.
    if (!readOnly && !['executing', 'recoverable'].includes(intent.status)) resolve(token, body.sessionId, intent.contextRevision, intent.studentId);
    const a = effective(s, c, students(), projects(), { sessionId: intent.sessionId, studentId: intent.studentId, contextRevision: intent.contextRevision });
    if (!a.capabilities.includes(CAPABILITIES[intent.name]?.permission) || intent.projectId && !a.allowedProjectIds.includes(intent.projectId)) throw fail('CAPABILITY_DENIED');
    return a;
  }
  return { read, snapshot, action, auth, open, resolve, resolveOperation, sessionAuth, directory };
}
module.exports = { SCHEMA, PERMISSIONS, PRESETS, restrictions, effective, initialStore, createConnectorStore, hash, fail };
