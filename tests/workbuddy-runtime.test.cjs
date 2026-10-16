const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  buildWorkBuddyTaskDeepLink,
  buildWorkBuddyInvocation,
  buildControlledWorkBuddyInvocation,
  buildControlledWorkBuddyResearchInvocation,
  probeWorkBuddyAuthorization,
  discoverWorkBuddyRuntime,
  workBuddyAuthenticationRequired,
  WORKBUDDY_AUTH_PROBE_TIMEOUT_MS,
} = require('../electron/workbuddy-runtime.cjs');

test('WorkBuddy authorization probe allows bounded first-run initialization', () => {
  assert.equal(WORKBUDDY_AUTH_PROBE_TIMEOUT_MS, 30000);
});

test('controlled research profile permits only WebSearch and preserves the authenticated profile', () => {
  const invocation = buildControlledWorkBuddyResearchInvocation({ available: true, mode: 'node', cliPath: '/synthetic-cli', nodePath: process.execPath },
    { cwd: process.cwd(), command: 'synthetic research', tools: ['Bash'], maxTurns: 40, additionalRoots: ['/private'] });
  assert.equal(invocation.args[invocation.args.indexOf('--tools') + 1], 'WebSearch');
  assert.equal(invocation.args.includes('--allowedTools'), false);
  assert.equal(invocation.args.includes('-y'), false);
  assert.equal(invocation.env.CODEBUDDY_IS_SANDBOX, '0');
  assert.equal(invocation.args[invocation.args.indexOf('--permission-mode') + 1], 'dontAsk');
  assert.equal(invocation.args[invocation.args.indexOf('--max-turns') + 1], '12');
  assert.equal(invocation.args.includes('--add-dir'), false);
  assert.ok(invocation.args.includes('--strict-mcp-config'));
  assert.ok(invocation.args.includes('--no-plugin-management'));
});

test('controlled profile cannot inherit inline plugins, node preloads, background tasks or broader caller tools', () => {
  const env = { Node_Options: '--require untrusted.cjs', NODE_PATH: 'untrusted', CODEBUDDY_PLUGIN_DIRS: 'untrusted-plugin',
    CODEBUDDY_SESSION_SKILL_DIRS: 'untrusted-skills', CODEBUDDY_IS_SANDBOX: '1', CBC_SANDBOX_APPROVAL_TIMEOUT_MS: '9999999', KEEP_ME: 'yes' };
  const invocation = buildControlledWorkBuddyInvocation({ available: true, mode: 'node', cliPath: '/synthetic-cli', nodePath: process.execPath },
    { cwd: process.cwd(), command: 'synthetic', tools: ['Bash'], permissionMode: 'bypassPermissions', maxTurns: 40, additionalRoots: ['/private'], baseEnv: env });
  assert.equal(invocation.args[invocation.args.indexOf('--tools') + 1], '');
  assert.equal(invocation.args[invocation.args.indexOf('--permission-mode') + 1], 'dontAsk');
  assert.equal(invocation.args[invocation.args.indexOf('--max-turns') + 1], '1');
  assert.equal(invocation.args.includes('--add-dir'), false);
  assert.ok(invocation.args.includes('--no-plugin-management'));
  assert.equal(invocation.args.includes('--no-plugin-manager'), false);
  assert.deepEqual(JSON.parse(invocation.args[invocation.args.indexOf('--settings') + 1]), { disableAllHooks: true });
  for (const name of ['Node_Options', 'NODE_PATH', 'CODEBUDDY_PLUGIN_DIRS', 'CODEBUDDY_SESSION_SKILL_DIRS']) assert.equal(invocation.env[name], undefined);
  for (const name of ['CODEBUDDY_DISABLE_PLUGIN_INSTALLS', 'CODEBUDDY_DISABLE_HOT_RELOAD', 'CODEBUDDY_DISABLE_AUTO_MEMORY', 'CODEBUDDY_DISABLE_CRON']) assert.equal(invocation.env[name], '1');
  assert.equal(invocation.env.CODEBUDDY_IS_SANDBOX, '0'); assert.equal(invocation.env.KEEP_ME, 'yes');
  assert.equal(env.CODEBUDDY_IS_SANDBOX, '1'); // Never modify the user's environment.
  assert.equal(invocation.env.CBC_SANDBOX_APPROVAL_TIMEOUT_MS, '1000');
  assert.equal(env.CBC_SANDBOX_APPROVAL_TIMEOUT_MS, '9999999');
});

test('desktop IPC availability does not authorize a CLI whose real response requires authentication', async () => {
  const { EventEmitter } = require('node:events'); let args;
  const result = await probeWorkBuddyAuthorization({ available: true, mode: 'node', cliPath: '/synthetic-cli', nodePath: process.execPath, desktopSessionAvailable: true },
    { spawnProcess: (_exe, captured) => {
      args = captured; const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
      child.stdin.end = () => setImmediate(() => { child.stderr.emit('data', 'Authentication required. Please use /login'); child.emit('close', 0); });
      return child;
    } });
  assert.equal(result.authorized, false); assert.equal(result.authRequired, true); assert.ok(args.includes('--no-plugin-management'));
});

test('WorkBuddy desktop task deeplink uses the signed-in desktop surface without broad permissions', () => {
  const url = new URL(buildWorkBuddyTaskDeepLink({ exePath: path.resolve('D:/Program Files/WorkBuddy/WorkBuddy.exe') }, {
    cwd: path.resolve('D:/student/knowledge'),
    command: '整理 IB EE 资料并生成草稿。',
  }));
  assert.equal(url.protocol, 'workbuddy:');
  assert.equal(url.hostname, 'task');
  assert.equal(url.searchParams.get('action'), 'start');
  assert.equal(url.searchParams.get('prompt'), '整理 IB EE 资料并生成草稿。');
  assert.equal(url.searchParams.get('cwd'), path.resolve('D:/student/knowledge'));
  assert.equal(url.searchParams.get('welcomeMode'), 'work');
  assert.equal(url.searchParams.get('permissionMode'), 'default');
});

test('WorkBuddy runtime detects a desktop IPC session without exposing its ticket', () => {
  const exePath = path.resolve('D:/Program Files/WorkBuddy/WorkBuddy.exe');
  const homeDir = path.resolve('C:/Users/tester');
  const configDir = path.join(homeDir, '.workbuddy');
  const endpointPath = path.join(configDir, 'wbipc', 'endpoint.json');
  const runtime = discoverWorkBuddyRuntime(exePath, {
    exists: (candidate) => [configDir, endpointPath].includes(candidate),
    readFile: () => JSON.stringify({ endpoint: '\\\\.\\pipe\\wbipc-test', ticket: 'private-ticket' }),
    homeDir,
  });
  assert.equal(runtime.desktopSessionAvailable, true);
  assert.equal(runtime.endpointPath, endpointPath);
  assert.equal(Object.prototype.hasOwnProperty.call(runtime, 'ticket'), false);
});

test('WorkBuddy runtime discovers the bundled headless CLI and host-node fallback', () => {
  const exePath = path.resolve('D:/Program Files/WorkBuddy/WorkBuddy.exe');
  const cliPath = path.resolve('D:/Program Files/WorkBuddy/resources/app.asar.unpacked/cli/bin/codebuddy');
  const productConfigPath = path.resolve('D:/Program Files/WorkBuddy/resources/app.asar.unpacked/cli/product.json');
  const hostNodePath = path.resolve('D:/Apps/AI Education Manager.exe');
  const homeDir = path.resolve('C:/Users/tester');
  const configDir = path.join(homeDir, '.workbuddy');
  const runtime = discoverWorkBuddyRuntime(exePath, {
    exists: (candidate) => [cliPath, productConfigPath, configDir].includes(candidate),
    findExecutable: () => '',
    hostNodePath,
    homeDir,
  });
  assert.equal(runtime.available, true);
  assert.equal(runtime.cliPath, cliPath);
  assert.equal(runtime.nodePath, hostNodePath);
  assert.equal(runtime.useElectronNode, true);
  assert.equal(runtime.productConfigPath, productConfigPath);
  assert.equal(runtime.configDir, configDir);
});

test('WorkBuddy invocation is non-interactive, bounded and receives the prompt through stdin', () => {
  const runtime = {
    available: true,
    mode: 'node',
    cliPath: path.resolve('D:/WorkBuddy/cli/bin/codebuddy'),
    nodePath: path.resolve('C:/node/node.exe'),
    useElectronNode: false,
    productConfigPath: path.resolve('D:/WorkBuddy/cli/product.json'),
    configDir: path.resolve('C:/Users/tester/.workbuddy'),
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
  assert.ok(invocation.args.includes('--tools'));
  assert.ok(invocation.args.includes('Read,Glob,Grep,Write,Edit'));
  assert.ok(invocation.args.includes('--strict-mcp-config'));
  assert.ok(invocation.args.includes('{"mcpServers":{}}'));
  assert.ok(invocation.args.includes('--no-session-persistence'));
  assert.ok(invocation.args.includes('--add-dir'));
  assert.match(invocation.stdinText, /生成学情报告草稿/);
  assert.doesNotMatch(invocation.args.join(' '), /bypassPermissions|dangerously-skip-permissions/i);
  assert.equal(invocation.env.ACC_PRODUCT_CONFIG_PATH, runtime.productConfigPath);
  assert.equal(invocation.env.CODEBUDDY_FORCE_LITE_WB_BUNDLE, '1');
  assert.equal(invocation.env.CODEBUDDY_DISABLE_IDE, '1');
  assert.equal(invocation.env.SERVER__HOST, '127.0.0.1');
  assert.equal(invocation.env.SERVER__PORT, '0');
  assert.equal(invocation.env.WORKBUDDY_CONFIG_DIR, runtime.configDir);
  assert.equal(invocation.env.CODEBUDDY_CONFIG_DIR, runtime.configDir);
});

test('WorkBuddy runtime prefers an explicitly configured desktop root', () => {
  const configuredRoot = path.resolve('D:/WorkBuddyProfile');
  const runtime = discoverWorkBuddyRuntime('', {
    env: { WORKBUDDY_CONFIG_DIR: configuredRoot },
    exists: (candidate) => candidate === configuredRoot,
    homeDir: path.resolve('C:/Users/tester'),
  });
  assert.equal(runtime.configDir, configuredRoot);
});

test('WorkBuddy authentication failure is recognized even when the process exits successfully', () => {
  assert.equal(workBuddyAuthenticationRequired('Authentication required. Please use /login command to sign in to your account'), true);
  assert.equal(workBuddyAuthenticationRequired('{"result":"READY"}'), false);
});
