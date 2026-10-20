'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRemoteMcpHandler } = require('./remote-mcp.cjs');

function fixture() {
  const calls = [];
  const context = { sessionId: 'agent_session_1', projectId: 'project_1', scopeFingerprint: 'f'.repeat(64), status: 'running' };
  const service = {
    remoteAgentAcknowledge(token) { calls.push(['ack', token]); if (token !== 'valid-session') throw Object.assign(new Error('远程 Agent 会话无效'), { status: 401 }); return context; },
    listRemoteAgentMaterials(token, input) { this.remoteAgentAcknowledge(token); calls.push(['list', input]); return { materials: [{ revisionId: `material_rev_${'a'.repeat(48)}`, displayName: '学习资料.md', contentType: 'text/markdown', category: 'learning_material', cloudStudentId: 'student_001' }], nextCursor: '' }; },
    getRemoteAgentMaterial(token, revisionId) { this.remoteAgentAcknowledge(token); calls.push(['read', revisionId]); return { revisionId, content: Buffer.from('# 当前材料'), contentType: 'text/markdown', contentSha256: 'b'.repeat(64), cloudStudentId: 'student_001', projectId: 'project_1', scopeFingerprint: 'f'.repeat(64) }; },
    submitInboxResult(token, input) { this.remoteAgentAcknowledge(token); calls.push(['submit', input]); return { submissionId: 'submission_1', status: 'available', duplicate: false }; },
  };
  return { handle: createRemoteMcpHandler(service), calls };
}

test('MCP initialization advertises only bounded tools and resources', () => {
  const { handle } = fixture();
  const initialized = handle('valid-session', { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.equal(initialized.result.protocolVersion, '2025-06-18');
  const tools = handle('valid-session', { jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.deepEqual(tools.result.tools.map(tool => tool.name), ['education_task_context', 'list_authorized_materials', 'read_authorized_material', 'submit_project_result']);
});

test('MCP resources and reads retain the task session boundary', () => {
  const { handle, calls } = fixture();
  const listed = handle('valid-session', { jsonrpc: '2.0', id: 1, method: 'resources/list', params: {} });
  assert.match(listed.result.resources[0].uri, /^edu-cloud:\/\/material\/material_rev_/);
  const read = handle('valid-session', { jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: listed.result.resources[0].uri } });
  assert.equal(read.result.contents[0].text, '# 当前材料');
  assert.ok(calls.every(call => call[0] === 'ack' || call[0] === 'list' || call[0] === 'read'));
});

test('MCP maps expired task sessions to a stable authentication error', () => {
  const { handle } = fixture();
  const response = handle('expired-session', { jsonrpc: '2.0', id: 3, method: 'tools/list' });
  assert.equal(response.error.code, -32001);
  assert.equal(response.error.data.httpStatus, 401);
});

test('MCP submits results only through the existing idempotent inbox contract', () => {
  const { handle, calls } = fixture();
  const response = handle('valid-session', { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'submit_project_result', arguments: {
    idempotencyKey: 'result:project_1:task_1', projectId: 'project_1', scopeFingerprint: 'f'.repeat(64), payload: { output: 'ok' },
  } } });
  assert.equal(response.result.isError, false);
  assert.equal(calls.filter(call => call[0] === 'submit').length, 1);
});
