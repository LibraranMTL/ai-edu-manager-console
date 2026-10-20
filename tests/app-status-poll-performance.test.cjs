'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'src/main.tsx'), 'utf8');
const pnpm = path.join(root, 'node_modules/.pnpm');
const esbuild = require(path.join(pnpm, fs.readdirSync(pnpm).find(n => n.startsWith('esbuild@')), 'node_modules/esbuild'));
const pollSource = ui.slice(ui.indexOf('let appStatusPending = false;'), ui.indexOf('const hostTimer = window.setInterval'));
function fixture(api) {
  let tick;
  const changes = [], document = { hidden: false };
  const context = { document, bridge: () => api, window: { setInterval(callback, delay) { assert.equal(delay, 10000); tick = callback; return 1; } } };
  for (const [, name] of pollSource.matchAll(/\b(set[A-Z]\w+)\(/g)) context[name] = value => changes.push({ name, value });
  const code = esbuild.transformSync(`(() => { ${pollSource}; return { dispose() { appStatusDisposed = true; } }; })()`, { loader: 'ts' }).code;
  const controls = vm.runInNewContext(code, context);
  return { tick: () => tick(), document, changes, ...controls };
}
test('visible periodic status prefers asynchronous IPC and permits only one pending request', async () => {
  let resolve, calls = 0;
  const f = fixture({ getAppStatusAsync() { calls++; return new Promise(r => { resolve = r; }); }, getAppStatus() { throw Error('sync fallback must not run'); } });
  const first = f.tick(); await f.tick();
  assert.equal(calls, 1); assert.equal(f.changes.length, 0);
  resolve(JSON.stringify({ codexOpened: true })); await first;
  assert.equal(f.changes.find(c => c.name === 'setCodexOpened').value, true);
  assert.equal(f.changes.length, 12);
});
test('hidden/disposed views do not poll or apply stale asynchronous responses', async () => {
  let resolve, calls = 0;
  const f = fixture({ getAppStatusAsync() { calls++; return new Promise(r => { resolve = r; }); } });
  f.document.hidden = true; await f.tick(); assert.equal(calls, 0);
  f.document.hidden = false; const pending = f.tick(); f.dispose(); resolve('{}'); await pending;
  assert.equal(f.changes.length, 0); await f.tick(); assert.equal(calls, 1);
});
test('legacy synchronous bridge remains supported and failed requests can retry', async () => {
  const legacy = fixture({ getAppStatus: () => '{"workbuddyOpened":true}', getSharedInboxStatus: () => '{"count":4}' });
  await legacy.tick(); assert.equal(legacy.changes.find(c => c.name === 'setSharedInboxCount').value, 4);
  let count = 0;
  const retry = fixture({ async getAppStatusAsync() { if (++count === 1) throw Error('temporary'); return '{}'; } });
  await retry.tick(); assert.equal(retry.changes.length, 0); await retry.tick(); assert.equal(retry.changes.length, 12);
});
test('async and legacy main-process app status have identical fields', () => {
  const main = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8');
  const sync = main.match(/ipcMain.on\('bridge:getAppStatus'[\s\S]*?JSON.stringify\((\{[^}]+\})\)/)[1];
  const asyncFields = main.match(/ipcMain.handle\('bridge:getAppStatusAsync'[\s\S]*?JSON.stringify\((\{[^}]+\})\)/)[1];
  assert.equal(asyncFields, sync);
  const preload = fs.readFileSync(path.join(root, 'electron/preload.cjs'), 'utf8');
  assert.match(preload, /getAppStatusAsync\(\) \{\s*return ipcRenderer.invoke\('bridge:getAppStatusAsync'\)/);
});
