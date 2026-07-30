const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');
const {
  normalizeDirectEndpoint,
  routeDirectEndpoints,
  sha256,
  signDirectRequest,
} = require('./collaboration-lan-direct.cjs');

const REMOTE_ARCHIVE_REQUEST_SCHEMA = 'edu-manager.remote-archive-request.v1';
const REMOTE_ARCHIVE_RESPONSE_SCHEMA = 'edu-manager.remote-archive-response.v1';
const REMOTE_ARCHIVE_PATH = '/api/collaboration/archive/query';
const REMOTE_ARCHIVE_QUERY_TYPES = new Set(['search', 'get_resource', 'list_changes', 'context_bundle']);

function text(value, limit = 500) {
  return String(value || '').trim().slice(0, limit);
}

function stableRemoteArchiveKey(input = {}) {
  return crypto.createHash('sha256').update(JSON.stringify({
    targetNodeId: text(input.targetNodeId, 160),
    scopeType: text(input.scopeType, 20),
    scopeId: text(input.scopeId, 200),
    queryType: text(input.queryType, 40),
    query: text(input.query, 2000),
    searchQueries: (Array.isArray(input.searchQueries) ? input.searchQueries : [])
      .map((item) => text(item, 2000))
      .filter(Boolean)
      .slice(0, 6),
    studentSelector: text(input.studentSelector, 200),
    uri: text(input.uri, 2000),
    since: text(input.since, 80),
    limit: Number(input.limit || 0),
    teamQuery: Boolean(input.teamQuery),
  })).digest('hex');
}

function normalizeRemoteArchiveRequest(input = {}) {
  const queryType = text(input.queryType || 'search', 40);
  if (!REMOTE_ARCHIVE_QUERY_TYPES.has(queryType)) throw new Error(`不支持的远程档案查询类型：${queryType || '空'}。`);
  const scopeType = text(input.scopeType, 20);
  if (!['student', 'project', 'team'].includes(scopeType)) throw new Error('远程档案查询范围必须是 student 或 project；团队聚合协议可使用 team。');
  if (scopeType === 'team' && !input.teamQuery) throw new Error('团队远程档案查询缺少团队策略标记。');
  const requesterNodeId = text(input.requesterNodeId, 160);
  const targetNodeId = text(input.targetNodeId, 160);
  const scopeId = text(input.scopeId, 200);
  if (!requesterNodeId || !targetNodeId || !scopeId) throw new Error('远程档案查询缺少请求节点、目标节点或知识范围。');
  const requestedAt = text(input.requestedAt || new Date().toISOString(), 80);
  if (!Number.isFinite(Date.parse(requestedAt))) throw new Error('远程档案查询时间无效。');
  const request = {
    schema: REMOTE_ARCHIVE_REQUEST_SCHEMA,
    protocolVersion: '1.0',
    requestId: text(input.requestId || `remote-archive-${crypto.randomUUID()}`, 200),
    requesterNodeId,
    targetNodeId,
    bindingId: text(input.bindingId, 200),
    scopeType,
    scopeId,
    localScopeId: text(input.localScopeId, 200),
    projectLineageId: text(input.projectLineageId, 240),
    teamQuery: Boolean(input.teamQuery),
    studentSelector: text(input.studentSelector, 200),
    queryType,
    query: text(input.query, 2000),
    searchQueries: (Array.isArray(input.searchQueries) ? input.searchQueries : [])
      .map((item) => text(item, 2000))
      .filter(Boolean)
      .slice(0, 6),
    uri: text(input.uri, 2000),
    since: text(input.since, 80),
    limit: Math.max(1, Math.min(queryType === 'list_changes' ? 100 : 50, Number(input.limit || 12))),
    requestedAt,
    idempotencyKey: text(input.idempotencyKey, 200),
  };
  request.idempotencyKey = request.idempotencyKey || stableRemoteArchiveKey(request);
  return request;
}

function withoutLocalPaths(value) {
  if (Array.isArray(value)) return value.map(withoutLocalPaths);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'path' || key === 'root' || key === 'excludedRoots') continue;
    output[key] = withoutLocalPaths(entry);
  }
  return output;
}

function normalizeRemoteArchiveResponse(input = {}, request = {}) {
  const servedAt = text(input.servedAt || new Date().toISOString(), 80);
  return {
    schema: REMOTE_ARCHIVE_RESPONSE_SCHEMA,
    protocolVersion: '1.0',
    requestId: text(input.requestId || request.requestId, 200),
    idempotencyKey: text(input.idempotencyKey || request.idempotencyKey, 200),
    sourceNodeId: text(input.sourceNodeId || request.targetNodeId, 160),
    requesterNodeId: text(input.requesterNodeId || request.requesterNodeId, 160),
    scope: {
      type: text(input.scope?.type || request.scopeType, 20),
      id: text(input.scope?.id || request.scopeId, 200),
      localId: text(input.scope?.localId || request.localScopeId, 200),
    },
    queryType: text(input.queryType || request.queryType, 40),
    servedAt,
    freshness: text(input.freshness || 'live', 40),
    cachedAt: text(input.cachedAt, 80),
    result: withoutLocalPaths(input.result || {}),
  };
}

function archiveResultHasKnowledge(response = {}) {
  const result = response.result || response;
  if (Array.isArray(result.resources)) return result.resources.length > 0;
  if (Array.isArray(result.changes)) return result.changes.length > 0;
  if (result.resource) return true;
  return Number(result.count || 0) > 0;
}

function invokeLocalArchive(access, request) {
  if (request.queryType === 'get_resource') return access.getResource({ uri: request.uri, maxChars: 20_000 });
  if (request.queryType === 'list_changes') return access.listChanges({
    scopeType: request.scopeType,
    scopeId: request.localScopeId || request.scopeId,
    since: request.since,
    limit: request.limit,
  });
  if (request.queryType === 'context_bundle') return access.buildContextBundle({
    scopeType: request.scopeType,
    scopeId: request.localScopeId || request.scopeId,
    query: request.query,
    limit: request.limit,
  });
  return access.search({
    scopeType: request.scopeType,
    scopeId: request.localScopeId || request.scopeId,
    query: request.query,
    limit: request.limit,
  });
}

function invokeLocalArchiveScopes(access, request, scopes = []) {
  const allowedScopes = Array.from(new Map(
    (Array.isArray(scopes) ? scopes : [])
      .map((scope) => ({
        scopeType: text(scope?.scopeType, 20),
        scopeId: text(scope?.scopeId, 200),
      }))
      .filter((scope) => ['student', 'project'].includes(scope.scopeType) && scope.scopeId)
      .map((scope) => [`${scope.scopeType}:${scope.scopeId}`, scope]),
  ).values());
  if (!allowedScopes.length) return invokeLocalArchive(access, request);
  if (request.queryType === 'get_resource') {
    const result = invokeLocalArchive(access, request);
    if (!result?.resource) return result;
    const permitted = allowedScopes.some((scope) => (
      scope.scopeType === result.resource.scopeType
      && String(scope.scopeId) === String(result.resource.scopeId)
    ));
    return permitted
      ? result
      : { ok: false, code: 'resource_not_in_scope', message: '该知识引用不属于当前学生或其关联项目。' };
  }

  const limit = Math.max(1, Math.min(request.queryType === 'list_changes' ? 100 : 50, Number(request.limit || 12)));
  const results = allowedScopes.map((scope) => invokeLocalArchive(access, {
    ...request,
    scopeType: scope.scopeType,
    localScopeId: scope.scopeId,
  }));
  if (request.queryType === 'list_changes') {
    const changes = Array.from(new Map(
      results.flatMap((result) => result.changes || []).map((item) => [String(item.uri || ''), item]),
    ).values())
      .sort((left, right) => String(right.modifiedAt || '').localeCompare(String(left.modifiedAt || '')))
      .slice(0, limit);
    return {
      ok: true,
      schema: results[0]?.schema,
      since: String(request.since || ''),
      scopes: allowedScopes,
      changes,
      count: changes.length,
    };
  }
  const resources = Array.from(new Map(
    results.flatMap((result) => result.resources || []).map((item) => [String(item.uri || ''), item]),
  ).values())
    .sort((left, right) => (
      Number(right.matchScore || 0) - Number(left.matchScore || 0)
      || String(right.modifiedAt || '').localeCompare(String(left.modifiedAt || ''))
    ))
    .slice(0, limit);
  if (request.queryType === 'context_bundle') {
    return {
      ok: true,
      schema: results[0]?.schema,
      generatedAt: new Date().toISOString(),
      scope: { type: request.scopeType, id: request.localScopeId || request.scopeId },
      scopes: allowedScopes,
      query: String(request.query || ''),
      resources,
      count: resources.length,
      citationRule: results[0]?.citationRule,
    };
  }
  return {
    ok: true,
    schema: results[0]?.schema,
    query: String(request.query || '').trim().toLocaleLowerCase(),
    scopes: allowedScopes,
    resources,
    count: resources.length,
  };
}

function requestJson(endpoint, request, auth, timeoutMs = 8_000) {
  const baseUrl = normalizeDirectEndpoint(endpoint);
  if (!baseUrl) return Promise.reject(new Error('远程知识地址无效。'));
  const body = Buffer.from(JSON.stringify(request), 'utf8');
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    ...signDirectRequest({
      secret: auth.secret,
      bindingId: auth.bindingId,
      nodeId: auth.nodeId,
      method: 'POST',
      pathname: REMOTE_ARCHIVE_PATH,
      contentSha256: sha256(body),
    }),
  };
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}${REMOTE_ARCHIVE_PATH}`);
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(url, { method: 'POST', headers }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) {
          res.destroy(new Error('远程知识响应超出限制。'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        let payload = {};
        try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
        catch { payload = { ok: false, message: '远程知识响应无法解析。' }; }
        if ((res.statusCode || 500) >= 400 || payload.ok === false) {
          reject(new Error(payload.message || `远程知识请求失败（${res.statusCode}）。`));
          return;
        }
        resolve(payload);
      });
    });
    req.on('error', reject);
    req.setTimeout(Math.max(1_000, Number(timeoutMs || 8_000)), () => req.destroy(new Error('远程知识请求超时。')));
    req.end(body);
  });
}

async function queryRemoteArchive(options = {}) {
  const request = normalizeRemoteArchiveRequest(options.request || {});
  const endpoints = routeDirectEndpoints(options.endpoints || []);
  if (!endpoints.length) throw new Error('协作关系尚无可用局域网或 Tailscale 地址。');
  let lastError = null;
  for (const endpoint of endpoints) {
    try {
      const payload = await requestJson(endpoint, request, options.auth || {}, options.timeoutMs);
      return { ...payload, endpoint, transport: endpoint.includes('100.') ? 'tailscale' : 'lan' };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('远程知识节点不可达。');
}

async function localFirstArchiveQuery(options = {}) {
  const request = normalizeRemoteArchiveRequest(options.request || {});
  if (options.localAccess && options.preferLocal !== false && !options.forceRemote) {
    const localResult = invokeLocalArchive(options.localAccess, request);
    const localResponse = normalizeRemoteArchiveResponse({
      sourceNodeId: request.requesterNodeId,
      freshness: 'local',
      result: localResult,
    }, request);
    if (archiveResultHasKnowledge(localResponse)) return { ok: true, source: 'local', response: localResponse };
  }
  try {
    const remote = await queryRemoteArchive({ ...options, request });
    const response = normalizeRemoteArchiveResponse(remote.response || remote, request);
    if (typeof options.saveSnapshot === 'function') options.saveSnapshot(request.idempotencyKey, response);
    return { ok: true, source: 'remote', endpoint: remote.endpoint, transport: remote.transport, response };
  } catch (error) {
    const snapshot = typeof options.loadSnapshot === 'function' ? options.loadSnapshot(request.idempotencyKey) : null;
    if (snapshot) {
      return {
        ok: true,
        source: 'offline_snapshot',
        warning: error.message,
        response: normalizeRemoteArchiveResponse({
          ...snapshot,
          freshness: 'offline_snapshot',
          cachedAt: snapshot.cachedAt || snapshot.servedAt,
        }, request),
      };
    }
    return { ok: false, source: 'waiting', retryable: true, message: error.message };
  }
}

module.exports = {
  REMOTE_ARCHIVE_PATH,
  REMOTE_ARCHIVE_QUERY_TYPES,
  REMOTE_ARCHIVE_REQUEST_SCHEMA,
  REMOTE_ARCHIVE_RESPONSE_SCHEMA,
  archiveResultHasKnowledge,
  invokeLocalArchive,
  invokeLocalArchiveScopes,
  localFirstArchiveQuery,
  normalizeRemoteArchiveRequest,
  normalizeRemoteArchiveResponse,
  queryRemoteArchive,
  stableRemoteArchiveKey,
  withoutLocalPaths,
};
