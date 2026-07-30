const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createArchiveAccess } = require('../electron/archive-access.cjs');
const {
  REMOTE_ARCHIVE_REQUEST_SCHEMA,
  REMOTE_ARCHIVE_RESPONSE_SCHEMA,
  archiveResultHasKnowledge,
  invokeLocalArchiveScopes,
  localFirstArchiveQuery,
  normalizeRemoteArchiveRequest,
  normalizeRemoteArchiveResponse,
  stableRemoteArchiveKey,
} = require('../electron/collaboration-remote-archive.cjs');

test('student knowledge queries include knowledge from projects linked to that student', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-related-project-search-'));
  const studentRoot = path.join(root, 'student');
  const projectRoot = path.join(root, 'project');
  try {
    fs.mkdirSync(studentRoot, { recursive: true });
    fs.mkdirSync(projectRoot, { recursive: true });
    for (let index = 0; index < 3; index += 1) {
      fs.writeFileSync(path.join(studentRoot, `student-history-${index}.md`), `student history ${index}`, 'utf8');
    }
    fs.writeFileSync(path.join(projectRoot, '无人机进展.md'), 'REMOTE-PROJECT-X7Q9 已完成飞控参数验证。', 'utf8');
    const access = createArchiveAccess({
      maxResources: 3,
      descriptors: [
        { scopeType: 'student', scopeId: 'student-a', scopeName: '学生 A', root: studentRoot },
        { scopeType: 'project', scopeId: 'project-uav', scopeName: '无人机项目', root: projectRoot },
      ],
    });
    const result = invokeLocalArchiveScopes(access, {
      scopeType: 'student',
      scopeId: 'student-a',
      localScopeId: 'student-a',
      queryType: 'context_bundle',
      query: 'REMOTE-PROJECT-X7Q9',
      limit: 8,
    }, [
      { scopeType: 'student', scopeId: 'student-a' },
      { scopeType: 'project', scopeId: 'project-uav' },
    ]);
    assert.equal(result.count, 1);
    assert.equal(result.resources[0].scopeType, 'project');
    assert.equal(result.resources[0].scopeId, 'project-uav');
    assert.equal(result.resources[0].uri.startsWith('edu://project/project-uav/'), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an exact linked-project marker outranks newer partial matches from the student archive', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-project-marker-ranking-'));
  const studentRoot = path.join(root, 'student');
  const projectRoot = path.join(root, 'project');
  try {
    fs.mkdirSync(studentRoot, { recursive: true });
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(path.join(studentRoot, 'newer-similar.md'), 'PROJECT MCP 0727 其他相似记录', 'utf8');
    fs.writeFileSync(path.join(projectRoot, 'PROJECT-MCP-0727-B2.md'), 'PROJECT-MCP-0727-B2 项目正在打印 3D 零件。', 'utf8');
    const access = createArchiveAccess({
      descriptors: [
        { scopeType: 'student', scopeId: 'student-a', root: studentRoot },
        { scopeType: 'project', scopeId: 'project-uav', root: projectRoot },
      ],
    });
    const result = invokeLocalArchiveScopes(access, {
      scopeType: 'student',
      scopeId: 'student-a',
      queryType: 'context_bundle',
      query: 'PROJECT-MCP-0727-B2',
      limit: 8,
    }, [
      { scopeType: 'student', scopeId: 'student-a' },
      { scopeType: 'project', scopeId: 'project-uav' },
    ]);
    assert.equal(result.resources[0].title, 'PROJECT-MCP-0727-B2.md');
    assert.equal(result.resources[0].scopeType, 'project');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('D4-B remote archive requests are versioned, bounded and idempotent', () => {
  const request = normalizeRemoteArchiveRequest({
    requesterNodeId: 'node-b',
    targetNodeId: 'node-a',
    bindingId: 'binding-1',
    scopeType: 'student',
    scopeId: 'student-a',
    localScopeId: 'student-b',
    queryType: 'search',
    query: '二次函数',
    limit: 500,
  });
  assert.equal(request.schema, REMOTE_ARCHIVE_REQUEST_SCHEMA);
  assert.equal(request.limit, 50);
  assert.equal(request.idempotencyKey, stableRemoteArchiveKey(request));
  assert.throws(() => normalizeRemoteArchiveRequest({ ...request, scopeType: 'all' }), /student 或 project/);
  assert.throws(() => normalizeRemoteArchiveRequest({ ...request, queryType: 'write' }), /不支持/);
});

test('D4-B responses retain citations and timestamps without exposing absolute paths', () => {
  const request = normalizeRemoteArchiveRequest({
    requesterNodeId: 'node-b',
    targetNodeId: 'node-a',
    scopeType: 'student',
    scopeId: 'student-a',
    queryType: 'search',
    query: '实验',
  });
  const response = normalizeRemoteArchiveResponse({
    sourceNodeId: 'node-a',
    result: {
      ok: true,
      count: 1,
      resources: [{
        uri: 'edu://student/student-a/knowledge/report.md',
        title: '报告',
        relativePath: '报告/report.md',
        path: 'D:\\学生资料\\报告\\report.md',
        modifiedAt: '2026-07-26T00:00:00.000Z',
        excerpt: '实验结论',
      }],
    },
  }, request);
  assert.equal(response.schema, REMOTE_ARCHIVE_RESPONSE_SCHEMA);
  assert.equal(response.sourceNodeId, 'node-a');
  assert.equal(response.result.resources[0].uri.startsWith('edu://'), true);
  assert.equal('path' in response.result.resources[0], false);
  assert.equal(archiveResultHasKnowledge(response), true);
});

test('D4-B local-first policy avoids a remote request when local knowledge matches', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-remote-local-first-'));
  try {
    fs.writeFileSync(path.join(root, 'report.md'), '# 数学报告\n二次函数顶点分析。', 'utf8');
    const localAccess = createArchiveAccess({
      descriptors: [{ scopeType: 'student', scopeId: 'student-b', root }],
    });
    const result = await localFirstArchiveQuery({
      request: {
        requesterNodeId: 'node-b',
        targetNodeId: 'node-a',
        scopeType: 'student',
        scopeId: 'student-a',
        localScopeId: 'student-b',
        queryType: 'search',
        query: '二次函数',
      },
      localAccess,
      endpoints: ['http://127.0.0.1:1'],
      auth: { bindingId: 'binding-1', nodeId: 'node-b', secret: 'secret' },
    });
    assert.equal(result.ok, true);
    assert.equal(result.source, 'local');
    assert.equal(result.response.result.count, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('D4-B integration exposes one authenticated read-only route and internal Agent bridge', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.cjs'), 'utf8');
  assert.match(main, /REMOTE_ARCHIVE_PATH/);
  assert.match(main, /authenticateDirectRequest\(request, pathname/);
  assert.match(main, /resolveIncomingRemoteArchiveScope/);
  assert.match(main, /bridge:remoteArchiveAccessRpc/);
  assert.match(main, /remotePolicy: 'local_first_then_remote_on_demand'/);
  assert.match(preload, /ipcRenderer\.invoke\('bridge:remoteArchiveAccessRpc'/);
  assert.doesNotMatch(main, /remoteArchive.*writeFileSync/i);
});
