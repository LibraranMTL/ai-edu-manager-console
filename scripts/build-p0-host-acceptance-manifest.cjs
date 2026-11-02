'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(process.argv[2] || 'artifacts/p0-host-acceptance-20261028');
const output = path.resolve(process.argv[3] || path.join(root, 'manifest.json'));
const repo = path.resolve(__dirname, '..');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

function listFiles(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (path.resolve(full) === output) continue;
    if (entry.isDirectory()) result.push(...listFiles(full));
    else if (entry.isFile()) result.push(full);
  }
  return result;
}

const artifactFiles = listFiles(root).sort().map(file => ({
  path: path.relative(repo, file).replaceAll('\\', '/'),
  bytes: fs.statSync(file).size,
  sha256: sha256(file),
}));
const sourcePaths = [
  'electron/main.cjs',
  'electron/task-auto-dispatch.cjs',
  'tests/task-auto-dispatch.test.cjs',
  'scripts/create-p0-runtime-fixture.cjs',
  'scripts/create-p0-dispatch-conflict-fixture.cjs',
  'scripts/p0-cdp-evaluate.cjs',
  'electron/windows-firewall.cjs',
  'electron/windows-firewall.ps1',
  'tests/windows-private-firewall.test.cjs',
];
const sourceFiles = sourcePaths.map(relative => {
  const file = path.join(repo, relative);
  return { path: relative, bytes: fs.statSync(file).size, sha256: sha256(file) };
});
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
const status = execFileSync('git', ['status', '--short'], { cwd: repo, encoding: 'utf8' });
const manifest = {
  schema: 'edu.p0.host-acceptance-manifest.v1',
  generatedAt: new Date().toISOString(),
  syntheticOnly: true,
  formalStudentDataTouched: false,
  source: { commit, dirtyStatusSha256: crypto.createHash('sha256').update(status).digest('hex').toUpperCase(), files: sourceFiles },
  gates: Object.fromEntries(['workbuddy-success','codex-success','failure-matrix','phone-acceptance'].map(name => {
    const file = path.join(root, name + '.json');
    if (!fs.existsSync(file)) return [name, 'not_run'];
    try { const report = JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
      return [name, report.passed === true ? (name === 'failure-matrix' ? 'contract_injected_passed' : 'passed_with_recorded_scope') : 'failed'];
    } catch { return [name,'invalid_evidence']; }
  })),
  releaseReady: false,
  blockingReasons: ['requires_0228_real_closure_and_paired_performance_acceptance'],
  artifacts: artifactFiles,
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ output, artifactCount: artifactFiles.length, releaseReady: false })}\n`);
