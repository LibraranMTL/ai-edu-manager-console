'use strict';

const MAX_MCP_CONTENT_BYTES = 4 * 1024 * 1024;
const PROTOCOL_VERSION = '2025-06-18';

function textContent(value) {
  return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }];
}

function toolDefinitions() {
  return [
    { name: 'cloud_connection_get_scope', description: '读取当前短期云端任务的学生、项目、权限范围和到期时间。',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'cloud_student_profile_read', description: '读取当前会话明确授权学生的已同步基础信息字段。',
      inputSchema: { type: 'object', properties: { cloudStudentId: { type: 'string' } }, additionalProperties: false } },
    { name: 'cloud_material_list', description: '列出当前会话获准读取的最新版材料，不返回历史修订。',
      inputSchema: { type: 'object', properties: { category: { type: 'string' }, cursor: { type: 'string' } }, additionalProperties: false } },
    { name: 'cloud_material_read', description: '读取一个获准的当前材料修订。',
      inputSchema: { type: 'object', required: ['revisionId'], properties: { revisionId: { type: 'string' } }, additionalProperties: false } },
    { name: 'cloud_report_list', description: '列出当前会话范围内的最新版云端学情报告。',
      inputSchema: { type: 'object', properties: { cursor: { type: 'string' } }, additionalProperties: false } },
    { name: 'cloud_report_read', description: '读取一个获准的云端学情报告修订。',
      inputSchema: { type: 'object', required: ['revisionId'], properties: { revisionId: { type: 'string' } }, additionalProperties: false } },
    { name: 'cloud_material_search', description: '搜索当前会话获准读取且已完成索引的当前资料修订；历史修订不会返回。',
      inputSchema: { type: 'object', required: ['query'], properties: { query: { type: 'string', minLength: 1, maxLength: 100 }, category: { type: 'string' } }, additionalProperties: false } },
    { name: 'education_task_context', description: '读取当前短期任务的学生、项目、权限范围和幂等合同。',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'list_authorized_materials', description: '列出当前任务获准读取的最新版材料，不返回历史修订。',
      inputSchema: { type: 'object', properties: { category: { type: 'string' }, cursor: { type: 'string' } }, additionalProperties: false } },
    { name: 'read_authorized_material', description: '读取列表中一个获准材料修订。',
      inputSchema: { type: 'object', required: ['revisionId'], properties: { revisionId: { type: 'string' } }, additionalProperties: false } },
    { name: 'submit_project_result', description: '按冻结的项目范围和幂等键提交任务成果到云端收件箱。',
      inputSchema: { type: 'object', required: ['idempotencyKey', 'projectId', 'scopeFingerprint', 'payload'], properties: {
        idempotencyKey: { type: 'string' }, projectId: { type: 'string' }, scopeFingerprint: { type: 'string' }, payload: { type: 'object' },
      }, additionalProperties: false } },
    { name: 'cloud_inbox_submit', description: '按冻结的项目范围和幂等键提交成果到目标主机云端收件箱。',
      inputSchema: { type: 'object', required: ['idempotencyKey', 'projectId', 'scopeFingerprint', 'payload'], properties: {
        idempotencyKey: { type: 'string' }, projectId: { type: 'string' }, scopeFingerprint: { type: 'string' }, payload: { type: 'object' },
      }, additionalProperties: false } },
    { name: 'cloud_inbox_status', description: '查询当前远程任务已经提交的成果处理状态。',
      inputSchema: { type: 'object', properties: { submissionId: { type: 'string' } }, additionalProperties: false } },
  ];
}

function materialResource(item) {
  return { uri: `edu-cloud://material/${item.revisionId}`, name: item.displayName,
    mimeType: item.contentType, description: `${item.category} · ${item.cloudStudentId} · 当前修订`,
    annotations: { audience: ['assistant'], priority: 0.8 } };
}

function result(id, value) { return { jsonrpc: '2.0', id, result: value }; }
function failure(id, code, message, data) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data ? { data } : {}) } };
}

function createRemoteMcpHandler(service) {
  if (!service || typeof service.remoteAgentAcknowledge !== 'function') throw new TypeError('Remote Agent service is required');
  return function handleRemoteMcp(token, message) {
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return failure(message?.id, -32600, '请求格式无效');
    const id = message.id;
    if (message.method === 'notifications/initialized') return null;
    try {
      if (message.method === 'initialize') return result(id, { protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false } },
        serverInfo: { name: 'ai-education-manager-cloud', version: '2.1.0' },
        instructions: '仅可访问本任务短期会话明确授权的学生、项目与最新版材料；不得推断或扩大范围。' });
      if (message.method === 'ping') return result(id, {});
      if (message.method === 'tools/list') {
        service.remoteAgentAcknowledge(token);
        return result(id, { tools: toolDefinitions() });
      }
      if (message.method === 'resources/list') {
        const listed = service.listRemoteAgentMaterials(token, { cursor: String(message.params?.cursor || '') });
        return result(id, { resources: listed.materials.map(materialResource), nextCursor: listed.nextCursor || undefined });
      }
      if (message.method === 'resources/read') {
        const match = String(message.params?.uri || '').match(/^edu-cloud:\/\/material\/(material_rev_[a-f0-9]{48})$/);
        if (!match) return failure(id, -32602, '材料资源地址无效');
        const item = service.getRemoteAgentMaterial(token, match[1]);
        if (item.content.length > MAX_MCP_CONTENT_BYTES) return failure(id, -32013, '材料超过 MCP 单次读取上限，请缩小授权材料或使用受控分段读取');
        const resource = { uri: message.params.uri, mimeType: item.contentType };
        if (item.contentType.startsWith('text/') || item.contentType === 'application/json') resource.text = item.content.toString('utf8');
        else resource.blob = item.content.toString('base64');
        return result(id, { contents: [resource] });
      }
      if (message.method === 'tools/call') {
        const name = String(message.params?.name || '');
        const args = message.params?.arguments || {};
        if (['education_task_context', 'cloud_connection_get_scope'].includes(name)) return result(id, { content: textContent(service.remoteAgentAcknowledge(token)), isError: false });
        if (name === 'cloud_student_profile_read') return result(id, { content: textContent(service.getRemoteAgentStudentProfile(token, String(args.cloudStudentId || ''))), isError: false });
        if (['list_authorized_materials', 'cloud_material_list'].includes(name)) return result(id, { content: textContent(service.listRemoteAgentMaterials(token, {
          category: String(args.category || ''), cursor: String(args.cursor || ''),
        })), isError: false });
        if (name === 'cloud_report_list') return result(id, { content: textContent(service.listRemoteAgentMaterials(token, {
          category: 'learning_report', cursor: String(args.cursor || ''),
        })), isError: false });
        if (name === 'cloud_material_search') {
          const query = String(args.query || '').trim().toLocaleLowerCase('zh-CN');
          if (!query || [...query].length > 100) return result(id, { content: textContent('搜索关键词必须为1到100个字符。'), isError: true });
          return result(id, { content: textContent(service.searchRemoteAgentMaterials(token, {
            query, category: String(args.category || ''),
          })), isError: false });
        }
        if (['read_authorized_material', 'cloud_material_read', 'cloud_report_read'].includes(name)) {
          const item = service.getRemoteAgentMaterial(token, String(args.revisionId || ''));
          if (name === 'cloud_report_read' && item.category !== 'learning_report') return result(id, { content: textContent('所选修订不是学情报告。'), isError: true });
          if (item.content.length > MAX_MCP_CONTENT_BYTES) return result(id, { content: textContent('材料超过单次读取上限，未返回内容。'), isError: true });
          return result(id, { content: item.contentType.startsWith('text/')
            ? [{ type: 'text', text: item.content.toString('utf8') }]
            : [{ type: 'resource', resource: { uri: `edu-cloud://material/${item.revisionId}`, mimeType: item.contentType, blob: item.content.toString('base64') } }],
          isError: false, structuredContent: { revisionId: item.revisionId, contentSha256: item.contentSha256,
            cloudStudentId: item.cloudStudentId, projectId: item.projectId, scopeFingerprint: item.scopeFingerprint } });
        }
        if (['submit_project_result', 'cloud_inbox_submit'].includes(name)) return result(id, { content: textContent(service.submitInboxResult(token, args)), isError: false });
        if (name === 'cloud_inbox_status') return result(id, { content: textContent(service.getInboxSubmissionStatus(token, String(args.submissionId || ''))), isError: false });
        return failure(id, -32602, '工具名称无效');
      }
      return failure(id, -32601, '方法不存在');
    } catch (error) {
      const status = Number(error.status || 500);
      const code = status === 401 ? -32001 : status === 403 ? -32003 : status === 404 ? -32004 : status === 409 ? -32009 : -32000;
      return failure(id, code, status >= 500 ? '云端服务暂时不可用' : error.message, { httpStatus: status });
    }
  };
}

module.exports = { createRemoteMcpHandler, MAX_MCP_CONTENT_BYTES, PROTOCOL_VERSION };
