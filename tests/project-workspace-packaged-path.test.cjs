const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { inspectWorkspacePath } = require('../electron/project-workspace.cjs');

test('packaged app.asar can never become a project workspace', () => {
  const resources = path.join('D:\\release', 'windows-terminal', 'win-unpacked', 'resources');
  const result = inspectWorkspacePath(path.join(resources, 'app.asar'), resources);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'runtime_artifact');
});

test('a missing linked workspace returns an actionable status instead of an asar ENOENT', () => {
  const result = inspectWorkspacePath(path.join('Z:\\definitely-missing', 'project-workspace'), '');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'missing');
  assert.match(result.message, /不存在/);
});
