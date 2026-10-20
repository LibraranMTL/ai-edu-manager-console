'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { bundleSkillArchiveRuntime } = require('../scripts/build-skill-runtime.cjs');
const repo = path.resolve(__dirname, '..');

test('release Skills service scans and parses ZIP without any source node_modules', async () => {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-skill-no-dependencies-'));
  fs.mkdirSync(path.join(stage, 'electron'));
  for (const name of fs.readdirSync(path.join(repo, 'electron')).filter(name => /^skill-.*\.cjs$/.test(name))) {
    fs.copyFileSync(path.join(repo, 'electron', name), path.join(stage, 'electron', name));
  }
  const env = { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' };
  const args = [path.join(repo, 'scripts/verify-skill-packaged-runtime.cjs'), path.join(stage, 'electron'), path.join(stage, 'verification.json')];
  const red = spawnSync(process.execPath, args, { env, encoding: 'utf8', windowsHide: true, timeout: 20000 });
  assert.notEqual(red.status, 0, 'unbundled package must reproduce original regression');
  assert.match(red.stderr, /Cannot find module 'yauzl'/);
  const pnpm = path.join(repo, 'node_modules/.pnpm');
  const esbuild = require(path.join(pnpm, fs.readdirSync(pnpm).find(name => name.startsWith('esbuild@')), 'node_modules/esbuild'));
  bundleSkillArchiveRuntime(repo, stage, esbuild);
  const green = spawnSync(process.execPath, args, { env, encoding: 'utf8', windowsHide: true, timeout: 20000 });
  assert.equal(green.status, 0, `${green.error || ''}\n${green.stderr}\n${green.stdout}`);
  const report = JSON.parse(fs.readFileSync(path.join(stage, 'verification.json'), 'utf8'));
  assert.equal(report.workerScanPassed, true);
  assert.equal(report.zipExtractPassed, true);
  assert.equal(report.zipTraversalBlocked, true);
  if (process.platform === 'win32') {
    const asar = require(path.join(pnpm, fs.readdirSync(pnpm).find(name => name.startsWith('@electron+asar@')), 'node_modules/@electron/asar'));
    const archive = path.join(stage, 'app.asar');
    await asar.createPackage(path.join(stage, 'electron'), archive);
    const electron = spawnSync(process.execPath, [path.join(repo, 'scripts/verify-skill-asar.cjs'), archive, path.join(stage, 'asar-verification.json')], { env, encoding: 'utf8', windowsHide: true, timeout: 110000 });
    assert.equal(electron.status, 0, `${electron.error || ''}\n${electron.stderr}\n${electron.stdout}`);
  }
});
