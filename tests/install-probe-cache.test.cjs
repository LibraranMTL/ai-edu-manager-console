const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createInstallProbeCache } = require('../electron/install-probe-cache.cjs');

test('cold discovery returns immediately; concurrent reads share one bounded OS query', () => {
  const calls = []; let settled = 0;
  const cache = createInstallProbeCache({ run: (...args) => calls.push(args), onSettled: () => settled++ });
  for (let i = 0; i < 100; i++) assert.equal(cache.get('a', 'reg.exe', ['query']), '');
  assert.equal(calls.length, 1);
  assert.equal(cache.pending, true);
  assert.equal(calls[0][2].timeout, 8000);
  assert.equal(calls[0][2].windowsHide, true);
  calls[0][3](null, 'installed');
  assert.equal(cache.get('a', 'reg.exe', ['query']), 'installed');
  assert.equal(cache.pending, false);
  assert.equal(settled, 1);
});

test('missing apps and failed queries are cached; stale result survives refresh failure', () => {
  const calls = []; let time = 0;
  const cache = createInstallProbeCache({ run: (...args) => calls.push(args), now: () => time, ttlMs: 100 });
  cache.get('a', 'where.exe', ['absent']); calls[0][3](new Error('missing'));
  assert.equal(cache.get('a', 'where.exe', ['absent']), '');
  assert.equal(calls.length, 1);
  time = 101; cache.get('a', 'where.exe', ['absent']); calls[1][3](null, 'found');
  time = 202; assert.equal(cache.get('a', 'where.exe', ['absent']), 'found');
  calls[2][3](new Error('timeout'));
  assert.equal(cache.get('a', 'where.exe', ['absent']), 'found');
  assert.equal(calls.length, 3);
});

test('queries respect concurrency limit and callbacks settle only once', () => {
  const calls = [];
  const cache = createInstallProbeCache({ run: (...args) => calls.push(args) });
  for (let i = 0; i < 6; i++) cache.get(String(i), 'reg.exe', [String(i)]);
  assert.equal(calls.length, 2);
  calls[0][3](null, 'one'); calls[0][3](null, 'duplicate');
  assert.equal(calls.length, 3);
  for (let i = 1; i < 6; i++) calls[i][3](null, 'done');
  assert.equal(cache.pending, false);
  assert.equal(cache.get('0', 'reg.exe', ['0']), 'one');
});

test('synchronous launch failure is contained and negative cached', () => {
  let calls = 0;
  const cache = createInstallProbeCache({ run: () => { calls++; throw new Error('spawn denied'); } });
  assert.equal(cache.get('a', 'reg.exe', []), '');
  assert.equal(cache.get('a', 'reg.exe', []), '');
  assert.equal(cache.pending, false); assert.equal(calls, 1);
});

test('real slow child does not block the parent event loop', async () => {
  let resolveDone;
  const completed = new Promise(resolve => { resolveDone = resolve; });
  const cache = createInstallProbeCache({ onSettled: resolveDone });
  assert.equal(cache.get('slow', process.execPath, ['-e', "setTimeout(()=>process.stdout.write('ready'),200)"]), '');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(cache.pending, true);
  await completed;
  assert.equal(cache.get('slow', process.execPath, []), 'ready');
});

test('all installation discovery paths avoid synchronous external commands and protect incomplete status', () => {
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
  const discovery = main.slice(main.indexOf('function queryUninstallEntries()'), main.indexOf('function findFile(root,'));
  assert.doesNotMatch(discovery, /execFileSync|spawnSync/);
  assert.match(main, /if \(installProbeCache.pending\) return false/);
  const ui = fs.readFileSync(path.join(__dirname, '../src/main.tsx'), 'utf8');
  assert.match(ui, /if \(status.probing\) return current/);
  assert.match(ui, /onNativeAgentToolInstallChanged = refreshInstallStatus/);
});
