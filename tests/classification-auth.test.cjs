'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), { EventEmitter } = require('node:events');
const { createClassificationAuth } = require('../electron/classification-auth.cjs');
const { buildControlledWorkBuddyInvocation } = require('../electron/workbuddy-runtime.cjs');
test('official login and actual classification use the same durable authentication environment', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'classification-auth-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const bundle = path.join(dir, 'official'); await fs.mkdir(path.join(bundle, 'dist'), { recursive: true });
  await fs.writeFile(path.join(bundle, 'package.json'), JSON.stringify({ name: '@tencent-ai/codebuddy-code', version: '2.164.0' }));
  await fs.writeFile(path.join(bundle, 'dist', 'codebuddy.js'), 'synthetic');
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {}; let launch, url;
  let prepared = 0;
  const options = { directory: path.join(dir, 'persist'), cliManager: { ensure: async () => { prepared++; return { cliPath: path.join(bundle, 'dist', 'codebuddy.js') }; } },
    spawn: (executable, args, opts) => { launch = { executable, args, ...opts }; return child; }, openUrl: value => { url = value; },
    workBuddyLogin: async ({ invocation, openUrl }) => { launch = invocation; await openUrl('https://www.workbuddy.cn/login?state=synthetic'); } };
  const auth = createClassificationAuth(options), runtime = { available: true, mode: 'node', cliPath: path.join(dir, 'bin', 'codebuddy'), nodePath: process.execPath };
  const start1 = auth.start('workbuddy', { runtime }, 'request-a'), start2 = auth.start('workbuddy', { runtime }, 'request-a');
  assert.equal(start1, start2); await start1;
  assert.equal(prepared, 1);
  t.after(() => child.emit('close', 0));
  assert.match(url, /^https:\/\/www.workbuddy.cn\/login/);
  const state = await createClassificationAuth(options).read('workbuddy');
  const actual = buildControlledWorkBuddyInvocation(auth.apply(runtime, state), { cwd: path.join(dir, 'empty'), command: 'synthetic' });
  for (const key of ['HOME', 'USERPROFILE', 'WORKBUDDY_CONFIG_DIR', 'CODEBUDDY_CONFIG_DIR', 'LOCALAPPDATA', 'APPDATA']) assert.equal(actual.env[key], launch.env[key]);
  assert.ok(!launch.args.includes('/login')); assert.ok(!launch.args.includes('--print')); assert.ok(actual.args.includes('--print'));
  assert.ok(!JSON.stringify(state).includes('secret')); assert.ok(state.root.startsWith(options.directory));
  assert.equal((await auth.invalidate('workbuddy')).version, state.version + 1);
});

test('WorkBuddy authorization returns while the interactive login is still running', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'classification-auth-nonblocking-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const cliPath = path.join(dir, 'codebuddy.js'); await fs.writeFile(cliPath, 'synthetic');
  let finishLogin;
  const loginFinished = new Promise(resolve => { finishLogin = resolve; });
  let started = false;
  const auth = createClassificationAuth({ directory: path.join(dir, 'persist'), cliManager: { ensure: async () => ({ cliPath }) },
    workBuddyLogin: async ({ update }) => { started = true; update('running', '等待浏览器完成官方登录'); await loginFinished; update('finished', '登录完成'); } });
  const result = await Promise.race([
    auth.start('workbuddy', { runtime: { available: true, mode: 'node', cliPath, nodePath: process.execPath } }, 'request-b'),
    new Promise((_, reject) => setTimeout(() => reject(Error('授权请求没有立即返回')), 250)),
  ]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, true);
  assert.match(result.message, /正在启动官方登录/);
  assert.equal(auth.status('workbuddy').state, 'running');
  finishLogin();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(auth.status('workbuddy').state, 'finished');
  auth.complete('workbuddy');
  assert.equal(auth.status('workbuddy'), null);
});
