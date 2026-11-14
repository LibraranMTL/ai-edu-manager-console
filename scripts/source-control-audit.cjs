'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const GENERATED_ROOTS = [
  'artifacts',
  'release',
  '.tmp',
  '.codex_tmp',
  'node_modules',
  'android-standalone-manager/delivery',
];

function captureGit(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  }).trim();
}

function captureGitBuffer(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'buffer',
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
  });
}

function nulPaths(buffer) {
  return buffer.toString('utf8').split('\0').filter(Boolean).map(value => value.replaceAll('\\', '/'));
}

function generatedPath(relativePath) {
  const normalized = String(relativePath || '').replaceAll('\\', '/').replace(/^\.\//, '');
  if (/^\.r\d+-.*\.(json|png)$/i.test(normalized)) return true;
  if (/^\.agent-capability-build-check-[^/]+\//i.test(normalized)) return true;
  return GENERATED_ROOTS.some(root => normalized === root || normalized.startsWith(`${root}/`));
}

function createSourceControlAudit(cwd) {
  const pathspec = ['--', '.', ...GENERATED_ROOTS.map(root => `:(exclude)${root}/**`)];
  const trackedDiff = captureGitBuffer(cwd, ['diff', '--binary', '--no-ext-diff', 'HEAD', ...pathspec]);
  const trackedPaths = nulPaths(captureGitBuffer(cwd, ['diff', '--name-only', '-z', 'HEAD', ...pathspec]));
  const untrackedPaths = nulPaths(captureGitBuffer(cwd, ['ls-files', '--others', '--exclude-standard', '-z']))
    .filter(relativePath => !generatedPath(relativePath))
    .sort((left, right) => left.localeCompare(right, 'en'));
  const changedPaths = [...new Set([...trackedPaths, ...untrackedPaths])].sort((left, right) => left.localeCompare(right, 'en'));
  const digest = crypto.createHash('sha256').update('edu-manager-source-audit-v2\0', 'utf8')
    .update(trackedDiff).update('\0untracked\0', 'utf8');
  for (const relativePath of untrackedPaths) {
    const absolutePath = path.join(cwd, ...relativePath.split('/'));
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile()) continue;
    digest.update(relativePath, 'utf8').update('\0', 'utf8').update(fs.readFileSync(absolutePath)).update('\0', 'utf8');
  }
  const contentSha256 = digest.digest('hex').toUpperCase();
  return {
    auditVersion: 2,
    commit: captureGit(cwd, ['rev-parse', 'HEAD']),
    branch: captureGit(cwd, ['branch', '--show-current']),
    dirty: changedPaths.length > 0,
    changedPathCount: changedPaths.length,
    statusSha256: contentSha256,
    contentSha256,
    excludedGeneratedRoots: GENERATED_ROOTS,
  };
}

module.exports = { createSourceControlAudit, generatedPath };
