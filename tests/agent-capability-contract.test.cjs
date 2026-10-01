const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const http = require('node:http');
const { CAPABILITIES, LEGACY_AGENT_ROUTES, agentRouteDecision, agentTokenFromAuthorization, authorizeCapability, agentKnowledgeScopePlan, knowledgeCapabilityDecision, knowledgeCapabilityFreshness, page, createAgentRateLimiter } = require('../electron/agent-capability-contract.cjs');
const { issueAgentAccessGrant, resolveAgentAccessGrant, revokeAgentAccessGrant } = require('../electron/agent-access-grant.cjs');
const { normalizeAgentKnowledgeQuestion, normalizeKnowledgeResult } = require('../electron/agent-knowledge-query.cjs');
const { run: runCli } = require('../electron/agent-capability-cli.cjs');

const auth = { type: 'agent_grant', grantId: 'g1', allowedStudentIds: ['s1'], allowedProjectIds: ['p1'], capabilities: ['knowledge:query', 'archive:read', 'task:read', 'student:read', 'project:read', 'report:read', 'research:search'] };
const project = { id: 'p1', studentIds: ['s1'] };

test('Agent token has a closed route allowlist, including migration and upload denial', () => {
  assert.equal(agentTokenFromAuthorization('Bearer eak_example   '), 'eak_example');
  assert.equal(agentTokenFromAuthorization('Bearer\teak_example'), 'eak_example');
  assert.equal(agentTokenFromAuthorization('Bearer admin-token'), '');
  for (const [method, path] of [
    ['POST', '/api/students/s1/materials'],
    ['POST', '/api/projects/p1/materials'],
    ['POST', '/api/students/s1/portable-migrations'],
    ['GET', '/api/students/s1/portable-migrations/m1/download'],
    ['GET', '/api/projects/p1/archive/file'],
    ['GET', '/api/assets'],
    ['GET', '/api/health'],
    ['POST', '/api/agent/unknown'],
  ]) assert.deepEqual(agentRouteDecision(auth, method, path), { allowed: false, code: 'AGENT_ROUTE_DENIED' });
  assert.equal(agentRouteDecision(auth, 'POST', '/api/agent/invoke').allowed, true);
  assert.equal(Object.keys(LEGACY_AGENT_ROUTES).length, 15);
  assert.deepEqual(agentRouteDecision({ ...auth, capabilities: [] }, 'POST', '/api/agent/knowledge/query'), { allowed: false, code: 'CAPABILITY_DENIED' });
});

test('Every capability requires exact student, project and operation scope', () => {
  for (const name of Object.keys(CAPABILITIES).filter((item) => CAPABILITIES[item].risk === 'read')) {
    const input = { studentId: 's1' };
    if (name === 'knowledge.query') input.question = 'What happened?';
    if (name === 'research.search') Object.assign(input, { query: 'official admissions requirements', region: 'Beijing' });
    if (name === 'project.overview') input.projectId = 'p1';
    if (name === 'report.read') input.reportId = 'profile';
    assert.equal(authorizeCapability(auth, name, input, project).ok, true, name);
    assert.equal(authorizeCapability(auth, name, { ...input, studentId: 's2' }, project).code, 'STUDENT_SCOPE_DENIED', name);
    assert.equal(authorizeCapability({ ...auth, capabilities: [] }, name, input, project).code, 'CAPABILITY_DENIED', name);
  }
  assert.equal(authorizeCapability(auth, 'archive.list', { studentId: 's1', projectId: 'p2' }, project).code, 'PROJECT_SCOPE_DENIED');
  assert.equal(authorizeCapability(auth, 'archive.list', { studentId: 's1', projectId: 'p1' }, { id: 'p1', studentIds: ['s2'] }).code, 'PROJECT_SCOPE_DENIED');
  assert.equal(authorizeCapability(auth, 'archive.list', { studentId: 's1', projectId: 'p1' }, { id: 'p1', studentIds: ['s1', 's2'] }).code, 'PROJECT_SCOPE_DENIED');
  assert.equal(authorizeCapability(auth, 'archive.list', { studentId: 's1', cursor: -1 }, null).code, 'INVALID_INPUT');
  assert.equal(authorizeCapability(auth, 'archive.list', { studentId: 's1', extra: true }, null).code, 'INVALID_INPUT');
});

test('Agent student knowledge excludes unauthorized and shared projects without widening student scope', () => {
  const projects = [
    { id: 'p1', studentIds: ['s1'] },
    { id: 'p2', studentIds: ['s1'] },
    { id: 'p3', studentIds: ['s1', 's2'] },
    { id: 'p4', studentIds: ['s2'] },
  ];
  assert.deepEqual(agentKnowledgeScopePlan(auth, 's1', projects), {
    ok: true,
    scopes: [{ scopeType: 'student', scopeId: 's1' }, { scopeType: 'project', scopeId: 'p1' }],
    limited: true,
  });
  assert.deepEqual(agentKnowledgeScopePlan({ ...auth, allowedProjectIds: ['p1', 'p3'] }, 's1', projects).scopes, [
    { scopeType: 'student', scopeId: 's1' },
    { scopeType: 'project', scopeId: 'p1' },
  ]);
  assert.equal(agentKnowledgeScopePlan(auth, 's2', projects).code, 'STUDENT_SCOPE_DENIED');
  assert.deepEqual(agentKnowledgeScopePlan(auth, 's1', [projects[0]]), {
    ok: true,
    scopes: [{ scopeType: 'student', scopeId: 's1' }, { scopeType: 'project', scopeId: 'p1' }],
    limited: false,
  });
});

test('Completed knowledge lookup without evidence is not a denial; unavailable lookup remains distinct', () => {
  const query = normalizeAgentKnowledgeQuestion({ scopeType: 'student', scopeId: 's1', question: '有获奖证据吗？' });
  const empty = normalizeKnowledgeResult(query, { ok: true, source: 'local', response: { freshness: 'local', result: { resources: [] } } });
  assert.equal(empty.ok, false);
  assert.equal(empty.lookupCompleted, true);
  assert.deepEqual(knowledgeCapabilityDecision(empty), { ok: true, outcome: 'no_evidence' });
  assert.equal(knowledgeCapabilityFreshness(empty), 'local');
  const waiting = normalizeKnowledgeResult(query, { ok: false, source: 'waiting', retryable: true });
  assert.equal(waiting.lookupCompleted, false);
  assert.deepEqual(knowledgeCapabilityDecision(waiting), { ok: false, code: 'KNOWLEDGE_UNAVAILABLE' });
  assert.equal(knowledgeCapabilityFreshness({ ...waiting, cachedQuery: true }), 'waiting');
  const failedLocal = normalizeKnowledgeResult(query, { ok: false, source: 'local', response: { result: { resources: [] } } });
  assert.deepEqual(knowledgeCapabilityDecision(failedLocal), { ok: false, code: 'KNOWLEDGE_UNAVAILABLE' });
});

test('Knowledge capability freshness reflects snapshots and cached query results', () => {
  const query = normalizeAgentKnowledgeQuestion({ scopeType: 'student', scopeId: 's1', question: '最近进展？' });
  const snapshot = normalizeKnowledgeResult(query, { ok: true, source: 'offline_snapshot', response: { freshness: 'offline_snapshot', result: { resources: [{ uri: 'edu://student/s1/report' }] } } });
  assert.deepEqual(knowledgeCapabilityDecision(snapshot), { ok: true, outcome: 'found' });
  assert.equal(knowledgeCapabilityFreshness(snapshot), 'offline_snapshot');
  assert.equal(knowledgeCapabilityFreshness({ ...snapshot, cachedQuery: true }), 'offline_snapshot');
  assert.equal(knowledgeCapabilityFreshness({ ...snapshot, source: 'remote', freshness: 'live', cachedQuery: true }), 'cached');
  assert.equal(knowledgeCapabilityFreshness({ ...snapshot, source: 'remote', freshness: 'live' }), 'live');
  assert.equal(knowledgeCapabilityFreshness({ source: 'remote' }), 'unknown');
});

test('Grant revocation denies token and pagination stays bounded', () => {
  const issued = issueAgentAccessGrant({}, { studentId: 's1' });
  assert.equal(resolveAgentAccessGrant(issued.store, issued.token).studentId, 's1');
  issued.store.grants[0].revokedAt = new Date().toISOString();
  assert.equal(resolveAgentAccessGrant(issued.store, issued.token), null);
  const revoked = revokeAgentAccessGrant(issued.store, 's1');
  assert.throws(() => issueAgentAccessGrant(revoked, { studentId: 's1' }), /Explicit reauthorization/);
  const reauthorized = issueAgentAccessGrant(revoked, { studentId: 's1', reauthorize: true });
  assert.equal(resolveAgentAccessGrant(reauthorized.store, reauthorized.token).studentId, 's1');
  assert.deepEqual(page([1, 2, 3], { cursor: 1, limit: 1 }), { items: [2], nextCursor: 2, total: 3 });
});

test('Agent rate limit is grant-isolated and resets after the bounded window', () => {
  const allowed = createAgentRateLimiter(3, 1000);
  assert.deepEqual([allowed('g1', 0), allowed('g1', 0), allowed('g1', 0), allowed('g1', 0)], [true, true, true, false]);
  assert.equal(allowed('g2', 0), true);
  assert.equal(allowed('g1', 1001), true);
});

test('CLI preserves exact scope and uses the same host invoke endpoint', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-agent-cli-'));
  const descriptorPath = path.join(directory, 'descriptor.json');
  const tokenPath = path.join(directory, 'token.txt');
  fs.writeFileSync(tokenPath, 'eak_test_token');
  fs.writeFileSync(descriptorPath, JSON.stringify({ capabilityEndpoint: 'http://127.0.0.1:17777/api/agent/invoke', authentication: { tokenFile: tokenPath } }));
  const originalFetch = global.fetch;
  let call;
  global.fetch = async (url, options) => {
    call = { url, options };
    return { status: 200, json: async () => ({ ok: true, schema: 'edu-manager.agent-capabilities.v1' }) };
  };
  try {
    const result = await runCli(['--descriptor', descriptorPath, '--name', 'archive.list', '--studentId', 's1', '--projectId', 'p1', '--limit', '3']);
    assert.equal(result.exitCode, 0);
    assert.equal(call.url, 'http://127.0.0.1:17777/api/agent/invoke');
    assert.deepEqual(JSON.parse(call.options.body), { name: 'archive.list', input: { studentId: 's1', projectId: 'p1', limit: 3 } });
    assert.equal(call.options.headers.authorization, 'Bearer eak_test_token');
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('CLI write phases carry an idempotency key and require exact file scope', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-agent-cli-write-'));
  const descriptorPath = path.join(directory, 'descriptor.json');
  const tokenPath = path.join(directory, 'token.txt');
  const inputPath = path.join(directory, 'input.json');
  fs.writeFileSync(tokenPath, 'eak_test_token');
  fs.writeFileSync(descriptorPath, JSON.stringify({ capabilityEndpoint: 'http://127.0.0.1:17777/api/agent/invoke', authentication: { tokenFile: tokenPath } }));
  fs.writeFileSync(inputPath, JSON.stringify({ studentId: 's1', title: 'Review', detail: 'Draft' }));
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return { status: 200, json: async () => ({ ok: true }) }; };
  try {
    const mismatch = await runCli(['--descriptor', descriptorPath, '--phase', 'preview', '--name', 'task.create', '--studentId', 's2', '--inputFile', inputPath, '--idempotencyKey', 'key']);
    assert.equal(mismatch.output.code, 'SCOPE_MISMATCH');
    const preview = await runCli(['--descriptor', descriptorPath, '--phase', 'preview', '--name', 'task.create', '--studentId', 's1', '--inputFile', inputPath, '--idempotencyKey', 'key']);
    assert.equal(preview.exitCode, 0);
    assert.equal(calls[0].url, 'http://127.0.0.1:17777/api/agent/write/preview');
    assert.equal(calls[0].body.idempotencyKey, 'key');
    const execute = await runCli(['--descriptor', descriptorPath, '--phase', 'execute', '--intentId', 'intent-1']);
    assert.equal(execute.exitCode, 0);
    assert.deepEqual(calls[1].body, { intentId: 'intent-1' });
  } finally { global.fetch = originalFetch; fs.rmSync(directory, { recursive: true, force: true }); }
});

test('MCP lists the bounded capability tools and approved-write flow', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-agent-mcp-'));
  const descriptor = path.join(directory, 'descriptor.json');
  fs.writeFileSync(descriptor, JSON.stringify({ defaults: { scopeType: 'student', scopeId: 's1', scopeName: 'Student', scopePolicy: 'fixed_student', projects: [] }, capabilityEndpoint: 'http://127.0.0.1:17777/api/agent/invoke', capabilityCatalogEndpoint: 'http://127.0.0.1:17777/api/agent/capabilities', agentCapabilities: ['archive:read', 'task:read', 'conversation:submit'] }));
  const input = `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })}\n${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'resources/list', params: {} })}\n`;
  try {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '..', 'electron', 'agent-knowledge-mcp.ps1'), '-Descriptor', descriptor], { input, encoding: 'utf8', timeout: 15_000 });
    assert.equal(result.status, 0, result.stderr);
    const messages = result.stdout.trim().split(/\r?\n/u).map(JSON.parse);
    const tools = messages[0].result.tools.map((item) => item.name);
    for (const name of ['list_education_archive', 'get_education_task_status', 'execute_education_write', 'get_education_write_status']) assert.ok(tools.includes(name), name);
    assert.equal(messages[1].result.resources?.[0]?.uri, 'edu://agent/capabilities', JSON.stringify(messages[1]));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('MCP read and conversation preview use the same scoped host contract', { timeout: 15_000 }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-agent-mcp-call-'));
  const tokenPath = path.join(directory, 'token.txt');
  const descriptor = path.join(directory, 'descriptor.json');
  fs.writeFileSync(tokenPath, 'eak_test_token');
  const calls = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      calls.push({ url: request.url, auth: request.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, schema: 'edu-manager.agent-capabilities.v1', intent: { id: 'i1', status: 'pending_approval' } }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  fs.writeFileSync(descriptor, JSON.stringify({ defaults: { scopeId: 's1', scopeName: 'Student', projects: [] }, capabilityEndpoint: `http://127.0.0.1:${port}/api/agent/invoke`, authentication: { tokenFile: tokenPath } }));
  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '..', 'electron', 'agent-knowledge-mcp.ps1'), '-Descriptor', descriptor]);
      let stdout = ''; let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stdout, stderr }));
      child.stdin.end([
        JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_education_archive', arguments: { studentId: 's1', limit: 5 } } }),
        JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'submit_education_conversation', arguments: { messages: [{ role: 'user', content: 'Current question' }], sourceAgent: 'codex', sessionId: 'session-1' } } }),
        '',
      ].join('\n'));
    });
    assert.equal(result.code, 0, result.stderr);
    const messages = result.stdout.trim().split(/\r?\n/u).map(JSON.parse);
    assert.equal(messages.length, 2);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map((item) => item.url), ['/api/agent/invoke', '/api/agent/write/preview']);
    assert.ok(calls.every((item) => item.auth === 'Bearer eak_test_token'));
    assert.deepEqual(calls[0].body, { name: 'archive.list', input: { studentId: 's1', limit: 5 } });
    assert.equal(calls[1].body.name, 'conversation.submit');
    assert.equal(calls[1].body.input.studentId, 's1');
    assert.equal(calls[1].body.input.messages[0].content, 'Current question');
    assert.ok(calls[1].body.idempotencyKey);
  } finally {
    server.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Host approval UI is wired through licensed IPC without exposing bearer tokens', () => {
  const root = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');
  for (const method of ['getAgentCapabilityManagement', 'setAgentCapabilityAuthorization', 'reviewAgentWriteIntent', 'decideAgentWriteIntent']) {
    assert.match(main, new RegExp(`bridge:${method}`));
    assert.match(preload, new RegExp(`bridge:${method}`));
    assert.match(renderer, new RegExp(method));
  }
  assert.match(renderer, /agentWriteReview\.intent\.inputDigest/);
  assert.match(renderer, /window\.confirm\(action === 'approve'/);
  assert.doesNotMatch(renderer, /agentKnowledgeTokenPath|ensureApiToken/);
  assert.match(main, /const decision = knowledgeCapabilityDecision\(result\)/);
  assert.match(main, /outcome = decision\.outcome/);
  assert.match(main, /freshness: name === 'knowledge\.query' \? knowledgeCapabilityFreshness\(result\) : 'live'/);
  assert.match(main, /receipt\.code === 'KNOWLEDGE_UNAVAILABLE' \? 503 : 403/);
});
