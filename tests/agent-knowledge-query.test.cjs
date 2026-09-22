const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const {
  AGENT_KNOWLEDGE_QUERY_SCHEMA,
  AGENT_KNOWLEDGE_RESULT_SCHEMA,
  buildGroundedAgentPrompt,
  extractAgentKnowledgeSearchQueries,
  normalizeAgentKnowledgeQuestion,
  normalizeKnowledgeResult,
  resolveAgentKnowledgeStudentScope,
} = require('../electron/agent-knowledge-query.cjs');
const { createArchiveAccess } = require('../electron/archive-access.cjs');

test('natural-language questions extract stable identifiers before the full sentence', () => {
  const question = '请查找 REMOTE-TEST-0726-X7Q9，并说明对应的学习进展。';
  const queries = extractAgentKnowledgeSearchQueries(question);
  assert.equal(queries[0], 'REMOTE-TEST-0726-X7Q9');
  assert.ok(queries.includes('学习进展'));
  assert.ok(queries.includes('请查找 REMOTE-TEST-0726-X7Q9 并说明对应的学习进展'));
});

test('archive search ranks multi-term natural-language cores without exact-sentence matching', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-agent-search-'));
  try {
    fs.writeFileSync(path.join(root, '数学学习进展.md'), '本周数学学习正在稳定进步，能够独立完成三位数除法验算。', 'utf8');
    const access = createArchiveAccess({
      descriptors: [{ scopeType: 'student', scopeId: 'student-1', scopeName: '测试学生', root }],
    });
    const result = access.search({ scopeType: 'student', scopeId: 'student-1', query: '数学 稳定进步', limit: 8 });
    assert.equal(result.count, 1);
    assert.match(result.resources[0].title, /数学学习进展/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('D4-B ordinary question is versioned, bounded and scope-isolated', () => {
  const query = normalizeAgentKnowledgeQuestion({
    scopeType: 'student',
    scopeId: 'student-1',
    question: `二次函数${'问题'.repeat(2_000)}`,
    limit: 500,
  });
  assert.equal(query.schema, AGENT_KNOWLEDGE_QUERY_SCHEMA);
  assert.equal(query.scopeId, 'student-1');
  assert.equal(query.question.length, 2_000);
  assert.equal(query.limit, 12);
  assert.throws(() => normalizeAgentKnowledgeQuestion({ scopeType: 'all', scopeId: 'x', question: '问题' }), /student 或 project/);
  assert.throws(() => normalizeAgentKnowledgeQuestion({ scopeType: 'student', scopeId: '', question: '问题' }), /缺少学生或项目范围/);
});

test('limited Agent knowledge prompt states that unapproved projects were not queried', () => {
  const prompt = buildGroundedAgentPrompt({
    question: '获奖时间是什么？',
    scope: { type: 'student', id: 'student-1', name: '测试学生' },
    source: 'local',
    coverage: { limited: true, reason: 'linked_projects_excluded' },
    warning: '部分关联项目未获授权或属于多人项目，已从本次查询中排除。',
    resources: [],
  });
  assert.match(prompt, /已授权的单学生项目/);
  assert.match(prompt, /未授权或多人项目未查询/);
  assert.doesNotMatch(prompt, /仅限学生“测试学生”及其关联项目/);
});

test('explicit student names route only through the active global broker', () => {
  const students = [
    { id: 'student-hunter', name: 'Hunter' },
    { id: 'student-baoshuyuan', name: '包书源' },
  ];
  const active = resolveAgentKnowledgeStudentScope({
    scopeType: 'student',
    scopeId: 'student-hunter',
    scopePolicy: 'active_student_or_explicit',
    question: '从教育管家的包书源学情汇总中查询申请 New media 专业的进展情况',
  }, students);
  assert.equal(active.scopeId, 'student-baoshuyuan');
  assert.equal(active.scopeName, '包书源');

  assert.throws(() => resolveAgentKnowledgeStudentScope({
    scopeType: 'student',
    scopeId: 'student-hunter',
    scopePolicy: 'fixed_student',
    question: '查询包书源的学情',
  }, students), /仅绑定“Hunter”.*不能查询“包书源”.*未读取其他学生资料/);

  const unchanged = resolveAgentKnowledgeStudentScope({
    scopeType: 'student',
    scopeId: 'student-hunter',
    scopePolicy: 'active_student_or_explicit',
    question: '查询当前学生最近的学习进展',
  }, students);
  assert.equal(unchanged.scopeId, 'student-hunter');
  assert.equal(unchanged.scopeName, 'Hunter');
});

test('unknown or ambiguous student selectors stop instead of falling back', () => {
  const students = [
    { id: 'student-a', name: '学生甲' },
    { id: 'student-b', name: '学生乙' },
  ];
  assert.throws(() => resolveAgentKnowledgeStudentScope({
    scopeType: 'student',
    scopeId: 'student-a',
    scopePolicy: 'active_student_or_explicit',
    student: '不存在学生',
    question: '查询学习进展',
  }, students), /未找到唯一匹配.*已停止查询/);
  assert.throws(() => resolveAgentKnowledgeStudentScope({
    scopeType: 'student',
    scopeId: 'student-a',
    scopePolicy: 'active_student_or_explicit',
    question: '比较学生甲和学生乙的学习进展',
  }, students), /匹配到多个学生/);
});

test('D4-B result retains citations and snapshot time without local absolute paths', () => {
  const query = normalizeAgentKnowledgeQuestion({ scopeType: 'student', scopeId: 'student-1', scopeName: '测试学生', question: '最近进步' });
  const result = normalizeKnowledgeResult(query, {
    ok: true,
    source: 'offline_snapshot',
    response: {
      freshness: 'offline_snapshot',
      cachedAt: '2026-07-26T01:02:03.000Z',
      sourceNodeId: 'node-a',
      result: {
        resources: [{
          uri: 'edu://student/student-1/knowledge/report.md',
          title: '学情报告',
          relativePath: '学情报告/report.md',
          path: 'D:\\学生资料\\report.md',
          excerpt: '最近能够独立完成二次函数题。',
          modifiedAt: '2026-07-25T01:02:03.000Z',
        }],
      },
    },
  }, { durationMs: 12 });
  assert.equal(result.schema, AGENT_KNOWLEDGE_RESULT_SCHEMA);
  assert.equal(result.resources.length, 1);
  assert.equal('path' in result.resources[0], false);
  const prompt = buildGroundedAgentPrompt(result);
  assert.match(prompt, /离线快照/);
  assert.match(prompt, /edu:\/\/student/);
  assert.match(prompt, /仅限学生“测试学生”及其关联项目/);
  assert.match(prompt, /不要编造|只依据/);
});

test('D4-B P0-P1 is wired to ordinary QA, authenticated Agent API and lazy diagnostics', () => {
  const root = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');
  const localCheck = main.indexOf('if (!args.forceRemote || args.localOnly)');
  const bindingResolution = main.indexOf('resolveRemoteArchiveBinding(scopeType, localScopeId', localCheck);
  assert.ok(localCheck >= 0 && bindingResolution > localCheck, 'local knowledge must be checked before collaboration endpoint resolution');
  assert.match(main, /pathname === '\/api\/agent\/knowledge\/query'/);
  assert.match(main, /requireAuth\(request, response\)/);
  assert.match(main, /prepareAllAgentKnowledgeAccess\(\)/);
  assert.match(
    main,
    /function prepareAllAgentKnowledgeAccess\(\)[\s\S]*activeAgentKnowledgeDescriptorPath\(\)[\s\S]*activateGlobal: Boolean\(activeStudentId && activeStudentId === String\(student\.id\)\)/,
  );
  assert.match(main, /ordinaryUserConfigurationRequired: false/);
  assert.match(main, /agent_knowledge_query_completed/);
  assert.match(main, /agent_knowledge_query_waiting/);
  assert.match(preload, /queryAgentKnowledge\(optionsJson\)/);
  assert.match(ui, /查询并交给/);
  assert.match(ui, /本机有依据时不会访问远程主机/);
  assert.match(ui, /<summary>高级诊断<\/summary>/);
  assert.doesNotMatch(main, /setInterval\([^)]*remoteArchive/i);
});

test('D4-B diagnostics exclude the question body and credentials', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  const start = main.indexOf('function appendAgentKnowledgeDiagnostic');
  const end = main.indexOf('function getAgentKnowledgeDiagnostics', start);
  const implementation = main.slice(start, end);
  assert.doesNotMatch(implementation, /question:/);
  assert.doesNotMatch(implementation, /apiToken|secret|tokenPath/);
});

test('QClaw and Codex receive workspace and user-discoverable MCP registrations without embedding the API token', () => {
  const root = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
  const bridge = fs.readFileSync(path.join(root, 'electron', 'agent-knowledge-mcp.ps1'), 'utf8');
  assert.match(main, /config', 'mcporter\.json'/);
  assert.match(main, /os\.homedir\(\), '\.mcporter', 'mcporter\.json'/);
  assert.match(main, /upsertQClawNativeMcpServer/);
  assert.match(main, /activeAgentKnowledgeDescriptorPath/);
  assert.match(main, /scopePolicy: 'fixed_student'/);
  assert.match(main, /ensureStudentAgentAccessToken/);
  assert.match(main, /resolveAgentAccessGrant/);
  assert.match(main, /resolveAgentKnowledgeStudentScope\(incoming, readStudentsIndex\(\)\.map\(toHostStudent\)\)/);
  assert.match(main, /qclawNativeRegistered/);
  assert.match(main, /\.codex', 'config\.toml'/);
  assert.match(main, /codexGlobalConfigPath/);
  assert.match(main, /qclawAgent\?\.workspace/);
  assert.match(main, /\[mcp_servers\.\$\{serverName\}\]/);
  assert.match(main, /const toolNames = \['query_education_knowledge', 'submit_education_conversation', 'list_education_archive', 'get_education_task_status', 'execute_education_write', 'get_education_write_status'/);
  assert.match(main, /allowedTools: toolNames/);
  assert.match(main, /AGENTS\.md/);
  assert.match(bridge, /query_education_knowledge/);
  assert.match(bridge, /student = \@\{/);
  assert.match(bridge, /never substitute the active student/);
  assert.match(bridge, /submit_education_conversation/);
  assert.match(bridge, /get_recent_education_context/);
  assert.match(bridge, /authentication\.tokenFile/);
  assert.match(bridge, /-TimeoutSec 75/);
  assert.doesNotMatch(main, /mcp_servers[\s\S]{0,600}Bearer [A-Za-z0-9]/);
});

test('native MCP bridge exposes the education knowledge tool over stdio', () => {
  const script = path.join(__dirname, '..', 'electron', 'agent-knowledge-mcp.ps1');
  const descriptor = path.join(os.tmpdir(), `edu-agent-knowledge-descriptor-${process.pid}.json`);
  fs.writeFileSync(descriptor, JSON.stringify({
    defaults: {
      scopeType: 'student',
      scopeId: 'student-1',
      scopeName: '测试学生',
      scopePolicy: 'fixed_student',
      projects: [{ id: 'project-1', name: '无人机项目' }],
    },
    memoryEndpoints: {
      start: 'http://127.0.0.1/start',
      observe: 'http://127.0.0.1/observe',
      finalize: 'http://127.0.0.1/finalize',
      recent: 'http://127.0.0.1/recent',
      acceptHandoff: 'http://127.0.0.1/accept',
      cancelHandoff: 'http://127.0.0.1/cancel',
    },
  }), 'utf8');
  const input = [
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }),
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    '',
  ].join('\n');
  try {
    const result = spawnSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', script,
      '-Descriptor', descriptor,
    ], { input, encoding: 'utf8', timeout: 15_000 });
    assert.equal(result.status, 0, result.stderr);
    const messages = result.stdout.trim().split(/\r?\n/u).map((line) => JSON.parse(line));
    assert.equal(messages[0].result.serverInfo.name, 'edu-manager-knowledge');
    assert.equal(messages[1].result.tools[0].name, 'query_education_knowledge');
    assert.match(messages[1].result.tools[0].title, /测试学生/);
    assert.match(messages[1].result.tools[0].description, /linked learning-project knowledge/);
    assert.equal(messages[1].result.tools[0].inputSchema.properties.student.type, 'string');
    assert.equal(messages[1].result.tools[1].name, 'submit_education_conversation');
    assert.match(messages[1].result.tools[1].description, /无人机项目/);
    assert.equal(messages[1].result.tools[1].inputSchema.properties.targetProject.type, 'string');
    assert.deepEqual(messages[1].result.tools.slice(2).map((tool) => tool.name), [
      'get_recent_education_context',
      'start_education_session',
      'record_authorized_education_turn',
      'finalize_education_session',
      'accept_education_handoff',
      'cancel_education_handoff',
    ]);
  } finally {
    fs.rmSync(descriptor, { force: true });
  }
});
