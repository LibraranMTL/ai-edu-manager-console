const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const sampler = path.join(repoRoot, 'scripts', 'sample-p0-live-runtime.ps1');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

test('MainPid aliases the explicit process instead of falling back to another app process', { timeout: 30_000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p0-sampler-mainpid-'));
  const studentBase = path.join(root, 'student-data');
  const output = path.join(root, 'sample.json');
  fs.mkdirSync(studentBase, { recursive: true });
  const sleeper = spawn(process.execPath, [
    '-e',
    'setTimeout(() => {}, 30000)',
    '--',
    `--user-data-dir=${root}`,
  ], { windowsHide: true, stdio: 'ignore' });
  t.after(() => {
    try { sleeper.kill(); } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    sleeper.once('spawn', resolve);
    sleeper.once('error', reject);
  });

  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    sampler,
    '-DurationSeconds',
    '1',
    '-IntervalMilliseconds',
    '1000',
    '-MainPid',
    String(sleeper.pid),
    '-UserDataDir',
    root,
    '-StudentBaseDir',
    studentBase,
    '-OutputPath',
    output,
  ], { cwd: repoRoot, encoding: 'utf8', windowsHide: true, timeout: 20_000 });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = readJson(output);
  assert.equal(report.mainProcessId, sleeper.pid);
});

test('explicit process is rejected when its command line belongs to a different user-data directory', { timeout: 30_000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p0-sampler-isolation-'));
  const otherRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'p0-sampler-other-'));
  const studentBase = path.join(root, 'student-data');
  const output = path.join(root, 'sample.json');
  fs.mkdirSync(studentBase, { recursive: true });
  const sleeper = spawn(process.execPath, [
    '-e',
    'setTimeout(() => {}, 30000)',
    '--',
    `--user-data-dir=${otherRoot}`,
  ], { windowsHide: true, stdio: 'ignore' });
  t.after(() => {
    try { sleeper.kill(); } catch {}
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(otherRoot, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    sleeper.once('spawn', resolve);
    sleeper.once('error', reject);
  });

  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    sampler,
    '-DurationSeconds',
    '1',
    '-IntervalMilliseconds',
    '1000',
    '-MainProcessId',
    String(sleeper.pid),
    '-UserDataDir',
    root,
    '-StudentBaseDir',
    studentBase,
    '-OutputPath',
    output,
  ], { cwd: repoRoot, encoding: 'utf8', windowsHide: true, timeout: 20_000 });

  assert.notEqual(result.status, 0, 'sampler unexpectedly accepted a process from another user-data directory');
  assert.match(`${result.stdout}\n${result.stderr}`, /does not belong to the isolated user-data directory/i);
  assert.equal(fs.existsSync(output), false);
});
