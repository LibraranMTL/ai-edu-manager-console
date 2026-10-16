'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), { EventEmitter } = require('node:events');
const { startWorkBuddyLogin, isOfficialLoginUrl } = require('../electron/workbuddy-login.cjs');
test('official login URL is strict and rejects lookalikes and credentials', () => {
  assert.equal(isOfficialLoginUrl('https://www.workbuddy.cn/login?state=test'), true);
  for (const url of ['http://www.workbuddy.cn/login', 'https://www.workbuddy.cn.evil/login', 'https://secret@www.workbuddy.cn/login', 'https://www.workbuddy.cn:4433/login', 'https://www.workbuddy.cn/else']) assert.equal(isOfficialLoginUrl(url), false);
});
function setup() {
  const child = new EventEmitter(); child.stdin = { end() {} }; child.stdout = child.stderr = { resume() {} }; child.kill = () => child.emit('close', 0);
  return { child, invocation: { executable: 'node', args: ['official.js', '--tools', ''], cwd: 'synthetic', env: { CODEBUDDY_GATEWAY_AUTH: 'none' } } };
}
test('login uses password-protected loopback official REST, never logs or persists credentials', async () => {
  const f = setup(); let launch, opened, requests = [], states = [], calls = 0;
  let done; const completion = new Promise(r => { done = r; });
  await startWorkBuddyLogin({ ...f, portProvider: async () => 45678,
    spawn: (exe, args, opts) => { launch = { exe, args, opts }; return f.child; }, openUrl: async url => { opened = url; },
    update: (state, message) => { states.push({ state, message }); if (state !== 'running') done(); },
    fetchImpl: async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => ({ data: url.endsWith('/login') ? { authUrl: 'https://www.workbuddy.cn/login?state=test' } : { authenticated: calls++ > 0 } }) }; },
  });
  await completion;
  assert.equal(launch.opts.env.CODEBUDDY_GATEWAY_AUTH, 'password'); assert.equal(launch.opts.env.SERVER__HOST, '127.0.0.1');
  assert.equal(launch.opts.env.CODEBUDDY_GATEWAY_PASSWORD.length, 64); assert.ok(launch.args.includes('--serve')); assert.ok(!launch.args.includes('/login'));
  assert.equal(opened, 'https://www.workbuddy.cn/login?state=test'); assert.equal(states.at(-1).state, 'finished');
  assert.equal(JSON.stringify(states).includes(launch.opts.env.CODEBUDDY_GATEWAY_PASSWORD), false);
  assert.ok(requests.every(r => r.options.redirect === 'error' && r.options.headers['x-codebuddy-request'] === '1' && r.options.headers.Authorization === `Bearer ${launch.opts.env.CODEBUDDY_GATEWAY_PASSWORD}`));
});
test('login spawn failure is terminal and never advertises successful authorization', async () => {
  let state;
  await startWorkBuddyLogin({ ...setup(), portProvider: async () => 45678, spawn: () => { throw Error('synthetic'); }, update: value => { state = value; } });
  assert.equal(state, 'failed');
});
