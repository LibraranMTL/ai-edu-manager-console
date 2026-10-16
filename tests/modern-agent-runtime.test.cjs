const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildQoderInvocation, buildTraeInvocation, modernAgentRuntime } = require('../electron/modern-agent-runtime.cjs');

test('TRAE invocation uses the official non-interactive command and native sandbox', () => {
  const invocation = buildTraeInvocation({ cliPath: 'C:\\Tools\\traecli.exe' }, {
    cwd: 'D:\\Student', command: '整理资料', readOnly: true,
  });
  assert.equal(invocation.executable, 'C:\\Tools\\traecli.exe');
  assert.deepEqual(invocation.args, ['exec', '--cd', path.resolve('D:\\Student'), '--sandbox', 'read-only', '--ask-for-approval', 'never', '-']);
  assert.equal(invocation.stdinText, '整理资料\n');
});

test('Qoder invocation requests JSON output and limits read-only tasks to read tools', () => {
  const invocation = buildQoderInvocation({ cliPath: 'C:\\Tools\\qoder.cmd' }, {
    cwd: 'D:\\Student', command: '检查资料', readOnly: true, additionalRoots: ['D:\\Knowledge'],
  });
  assert.equal(invocation.args.includes('--print'), true);
  assert.equal(invocation.args.includes('json'), true);
  assert.deepEqual(invocation.args.slice(invocation.args.indexOf('--tools'), invocation.args.indexOf('--tools') + 2), ['--tools', 'Read,Grep,Glob']);
  assert.equal(invocation.args.at(-1), '检查资料');
});

test('desktop-only installations are handoff runtimes rather than automatic executors', () => {
  assert.deepEqual(modernAgentRuntime({ desktop: { installed: true, exePath: 'C:\\Apps\\QoderWork.exe' } }), {
    installed: true, desktopPath: 'C:\\Apps\\QoderWork.exe', cliPath: '', automatic: false, desktopHandoff: true,
  });
});
