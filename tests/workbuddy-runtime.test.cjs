const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  buildWorkBuddyInvocation,
  discoverWorkBuddyRuntime,
} = require('../electron/workbuddy-runtime.cjs');

test('WorkBuddy runtime discovers the bundled headless CLI and host-node fallback', () => {
  const exePath = path.resolve('D:/Program Files/WorkBuddy/WorkBuddy.exe');
  const cliPath = path.resolve('D:/Program Files/WorkBuddy/resources/app.asar.unpacked/cli/bin/codebuddy');
  const hostNodePath = path.resolve('D:/Apps/AI Education Manager.exe');
  const runtime = discoverWorkBuddyRuntime(exePath, {
    exists: (candidate) => candidate === cliPath,
    findExecutable: () => '',
    hostNodePath,
  });
  assert.equal(runtime.available, true);
  assert.equal(runtime.cliPath, cliPath);
  assert.equal(runtime.nodePath, hostNodePath);
  assert.equal(runtime.useElectronNode, true);
});

test('WorkBuddy invocation is non-interactive, bounded and receives the prompt through stdin', () => {
  const runtime = {
    available: true,
    mode: 'node',
    cliPath: path.resolve('D:/WorkBuddy/cli/bin/codebuddy'),
    nodePath: path.resolve('C:/node/node.exe'),
    useElectronNode: false,
  };
  const invocation = buildWorkBuddyInvocation(runtime, {
    cwd: path.resolve('D:/student/knowledge'),
    additionalRoots: [path.resolve('D:/student/reports')],
    command: '生成学情报告草稿。',
    maxTurns: 18,
    baseEnv: { TEST_ENV: '1' },
  });
  assert.equal(invocation.executable, runtime.nodePath);
  assert.deepEqual(invocation.args.slice(0, 2), [runtime.cliPath, '--print']);
  assert.ok(invocation.args.includes('acceptEdits'));
  assert.ok(invocation.args.includes('--no-session-persistence'));
  assert.ok(invocation.args.includes('--add-dir'));
  assert.match(invocation.stdinText, /生成学情报告草稿/);
  assert.doesNotMatch(invocation.args.join(' '), /bypassPermissions|dangerously-skip-permissions/i);
});
