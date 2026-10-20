'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  CONTRACT_VERSION,
  buildProjectExecutionScope,
  sameProjectExecutionScope,
  pathWithinProjectScope,
  projectScopePermissions,
} = require('../electron/project-execution-scope.cjs');
const { validatePermissionDeclaration } = require('../electron/task-protocol.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-project-scope-'));
  const knowledge = path.join(root, '项目知识空间');
  fs.mkdirSync(knowledge, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, knowledge,
    project: { id: 'project-one', status: 'active', studentIds: ['student-b', 'student-a', 'student-a'], knowledgeRootPath: knowledge },
    students: [{ id: 'student-a' }, { id: 'student-b' }],
    globalPolicy: { enabled: true, version: 7 } };
}

test('global authorization freezes a canonical multi-student project-only scope', t => {
  const value = fixture(t);
  const scope = buildProjectExecutionScope({ ...value, taskProfile: 'digest_host_mediated.v1', now: () => '2026-10-18T00:00:00.000Z' });
  assert.equal(scope.contractVersion, CONTRACT_VERSION);
  assert.deepEqual(scope.studentIds, ['student-a', 'student-b']);
  assert.deepEqual(projectScopePermissions(scope), {
    read: [fs.realpathSync.native(value.knowledge)], write: [fs.realpathSync.native(value.knowledge)], operations: ['read', 'write_project_knowledge'],
  });
  assert.equal(pathWithinProjectScope(path.join(value.knowledge, '摘要库', 'one.md'), scope), true);
  assert.equal(pathWithinProjectScope(path.join(value.root, '学生个人档案'), scope), false);
  assert.equal(scope.scopeFingerprint.length, 64);
});

test('member order is stable while membership, path and policy changes invalidate the frozen scope', t => {
  const value = fixture(t);
  const frozen = buildProjectExecutionScope({ ...value, taskProfile: 'digest_host_mediated.v1' });
  const reordered = buildProjectExecutionScope({ ...value, project: { ...value.project, studentIds: ['student-a', 'student-b'] }, taskProfile: 'digest_host_mediated.v1' });
  assert.equal(sameProjectExecutionScope(frozen, reordered), true);
  const changedMembers = buildProjectExecutionScope({ ...value,
    project: { ...value.project, studentIds: ['student-a'] }, taskProfile: 'digest_host_mediated.v1' });
  assert.equal(sameProjectExecutionScope(frozen, changedMembers), false);
  const changedPolicy = buildProjectExecutionScope({ ...value,
    globalPolicy: { enabled: true, version: 8 }, taskProfile: 'digest_host_mediated.v1' });
  assert.equal(sameProjectExecutionScope(frozen, changedPolicy), false);
  const other = path.join(value.root, 'other-knowledge'); fs.mkdirSync(other);
  const changedPath = buildProjectExecutionScope({ ...value,
    project: { ...value.project, knowledgeRootPath: other }, taskProfile: 'digest_host_mediated.v1' });
  assert.equal(sameProjectExecutionScope(frozen, changedPath), false);
});

test('legacy and inactive membership remain denied and directory links cannot escape scope', t => {
  const value = fixture(t);
  assert.throws(() => buildProjectExecutionScope({ ...value, globalPolicy: { enabled: false, version: 7 }, taskProfile: 'digest_host_mediated.v1' }), { code: 'PROJECT_SCOPE_LEGACY' });
  assert.throws(() => buildProjectExecutionScope({ ...value, students: [{ id: 'student-a' }, { id: 'student-b', archived: true }], taskProfile: 'digest_host_mediated.v1' }), { code: 'PROJECT_SCOPE_INVALID' });
  const scope = buildProjectExecutionScope({ ...value, taskProfile: 'digest_host_mediated.v1' });
  const outside = path.join(value.root, 'outside'); fs.mkdirSync(outside);
  const link = path.join(value.knowledge, 'linked-outside');
  try {
    fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(pathWithinProjectScope(link, scope), false);
  } catch (error) {
    if (!['EPERM', 'EACCES'].includes(error.code)) throw error;
  }
});

test('host-managed project receipts do not expand the Agent project write scope', t => {
  const value = fixture(t);
  const scope = buildProjectExecutionScope({ ...value, taskProfile: 'digest_host_mediated.v1' });
  const permissions = projectScopePermissions(scope);
  const hostReceipt = path.join(value.root, '.edu-manager', 'project-digest-receipt.json');
  assert.equal(validatePermissionDeclaration({ kind: 'project_digest', permissions,
    expectedOutput: { type: 'project_digest_host_receipt', hostManaged: true } }).ok, true);
  assert.equal(validatePermissionDeclaration({ kind: 'project_digest', permissions,
    expectedOutput: { type: 'project_digest_receipt', path: hostReceipt } }).ok, false);
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
  assert.match(main, /globalProjectScopeEnabled = Boolean\(isWorkspaceMaterialProject\(project\)/);
  assert.match(main, /\{ type: 'project_digest_host_receipt', hostManaged: true \}/);
  assert.doesNotMatch(main, /project_digest_host_receipt'[^\n]+hostReceiptPath/);
});
