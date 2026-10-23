'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RELEASE_INPUT_PATHS = Object.freeze([
  'package.json', 'pnpm-lock.yaml', 'tsconfig.json', 'vite.config.ts', 'index.html',
  'src', 'electron', 'public', 'scripts', 'cloud-report-service',
]);

function git(repoRoot, args) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(String(result.stderr || result.stdout || `git ${args.join(' ')} failed`).trim());
  return String(result.stdout || '').replace(/\r\n/g, '\n').trim();
}

function digest(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex').toUpperCase();
}

function captureHeadBaseline(repoRoot) {
  const root = path.resolve(repoRoot);
  const commit = git(root, ['rev-parse', 'HEAD']);
  const branch = git(root, ['branch', '--show-current']);
  const tree = git(root, ['ls-tree', '-r', '--full-tree', commit, '--', ...RELEASE_INPUT_PATHS]);
  const scopedStatus = git(root, ['status', '--porcelain=v1', '--untracked-files=all', '--', ...RELEASE_INPUT_PATHS]);
  return {
    schema: 'edu-manager.windows-clean-build-baseline.v1',
    capturedAt: new Date().toISOString(),
    commit,
    branch,
    inputPaths: RELEASE_INPUT_PATHS,
    trackedFileCount: tree ? tree.split('\n').length : 0,
    gitTreeListingSha256: digest(tree),
    cleanCommittedTree: true,
    workingTreeMatchesHead: scopedStatus === '',
    scopedStatusSha256: digest(scopedStatus),
    scopedChangedPathCount: scopedStatus ? scopedStatus.split('\n').length : 0,
    boundary: 'The baseline fingerprints release inputs only; delivery evidence and unrelated workspace files are excluded.',
  };
}

function verifyBaseline(repoRoot, baseline) {
  const current = captureHeadBaseline(repoRoot);
  const failures = [];
  if (current.commit !== baseline.commit) failures.push('commit_changed');
  if (current.gitTreeListingSha256 !== baseline.gitTreeListingSha256) failures.push('release_input_tree_changed');
  if (!current.workingTreeMatchesHead) failures.push('release_input_worktree_dirty');
  return { ok: failures.length === 0, failures, baseline, current };
}

if (require.main === module) {
  const repoRoot = path.resolve(__dirname, '..');
  const args = process.argv.slice(2);
  const captureIndex = args.indexOf('--capture-head');
  const verifyIndex = args.indexOf('--verify');
  if (captureIndex >= 0) {
    const output = args[captureIndex + 1];
    if (!output) throw new Error('--capture-head requires an output JSON path');
    const report = captureHeadBaseline(repoRoot);
    const destination = path.resolve(repoRoot, output);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({ output: destination, ...report }, null, 2)}\n`);
  } else if (verifyIndex >= 0) {
    const input = args[verifyIndex + 1];
    if (!input) throw new Error('--verify requires a baseline JSON path');
    const result = verifyBaseline(repoRoot, JSON.parse(fs.readFileSync(path.resolve(repoRoot, input), 'utf8')));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 1;
  } else {
    const report = captureHeadBaseline(repoRoot);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.workingTreeMatchesHead) process.exitCode = 1;
  }
}

module.exports = { RELEASE_INPUT_PATHS, captureHeadBaseline, verifyBaseline };
