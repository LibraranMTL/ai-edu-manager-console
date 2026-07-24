const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  ARCHIVE_ACCESS_SCHEMA,
  createArchiveAccess,
  handleArchiveAccessRpc,
} = require('../electron/archive-access.cjs');

test('ArchiveAccess searches only the requested student or project knowledge scope', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-archive-access-'));
  try {
    const studentRoot = path.join(root, 'student');
    const rawRoot = path.join(studentRoot, '原始资料');
    const summaryRoot = path.join(studentRoot, '学情分析汇总');
    const projectRoot = path.join(root, 'project');
    fs.mkdirSync(rawRoot, { recursive: true });
    fs.mkdirSync(summaryRoot, { recursive: true });
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(path.join(rawRoot, 'private-source.md'), '原始资料中的火箭内容', 'utf8');
    fs.writeFileSync(path.join(summaryRoot, 'profile.md'), '已确认的火箭项目学习总结', 'utf8');
    fs.writeFileSync(path.join(projectRoot, 'concept.md'), '火箭推进概念', 'utf8');
    const access = createArchiveAccess({
      descriptors: [
        { scopeType: 'student', scopeId: 'student-1', root: studentRoot, excludedRoots: [rawRoot] },
        { scopeType: 'project', scopeId: 'project-1', root: projectRoot },
      ],
    });
    const studentHits = access.search({ query: '火箭', scopeType: 'student', scopeId: 'student-1' });
    assert.equal(studentHits.count, 1);
    assert.match(studentHits.resources[0].uri, /^edu:\/\/student\/student-1\/knowledge\//);
    assert.doesNotMatch(studentHits.resources[0].relativePath, /原始资料/);
    const projectHits = access.search({ query: '火箭', scopeType: 'project', scopeId: 'project-1' });
    assert.equal(projectHits.count, 1);
    assert.equal(projectHits.resources[0].scopeId, 'project-1');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ArchiveAccess resolves only indexed edu URIs and returns source-linked context bundles', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-archive-resource-'));
  try {
    fs.writeFileSync(path.join(root, 'report.md'), '阶段学习报告：证据来源明确。', 'utf8');
    const access = createArchiveAccess({ descriptors: [{ scopeType: 'student', scopeId: 'student-2', root }] });
    const hit = access.search({ query: '阶段学习', scopeType: 'student', scopeId: 'student-2' }).resources[0];
    const resource = access.getResource({ uri: hit.uri });
    assert.equal(resource.ok, true);
    assert.equal(resource.schema, ARCHIVE_ACCESS_SCHEMA);
    assert.match(resource.resource.content, /证据来源明确/);
    assert.equal(access.getResource({ uri: 'edu://student/student-2/knowledge/../../secret.md' }).ok, false);
    const bundle = access.buildContextBundle({ query: '阶段学习', scopeType: 'student', scopeId: 'student-2' });
    assert.equal(bundle.resources[0].uri, hit.uri);
    assert.match(bundle.citationRule, /resource\.uri/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the embedded read-only RPC exposes ArchiveAccess tools without opening a network service', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-archive-rpc-'));
  try {
    fs.writeFileSync(path.join(root, 'index.md'), '知识索引', 'utf8');
    const access = createArchiveAccess({ descriptors: [{ scopeType: 'project', scopeId: 'project-2', root }] });
    const listed = handleArchiveAccessRpc(access, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    assert.equal(listed.result.tools.length, 4);
    const called = handleArchiveAccessRpc(access, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'archive.search', arguments: { query: '知识', scopeType: 'project', scopeId: 'project-2' } },
    });
    assert.equal(called.result.count, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('task packets embed the minimum archive context and expose an asynchronous read-only bridge', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.cjs'), 'utf8');
  assert.match(main, /archiveAccess\.contextBundle/);
  assert.match(main, /mode: 'embedded_read_only'/);
  assert.match(main, /ipcMain\.handle\('bridge:archiveAccessRpc'/);
  assert.match(preload, /ipcRenderer\.invoke\('bridge:archiveAccessRpc'/);
  assert.doesNotMatch(main, /listen\([^)]*archiveAccess/);
});
