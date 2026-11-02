'use strict';

const fs = require('node:fs');
const path = require('node:path');

function normalizedRelativePath(value) {
  const input = String(value || '').trim().replaceAll('\\', '/');
  if (!input || path.isAbsolute(input) || /^[a-zA-Z]:\//.test(input)) return '';
  const normalized = path.posix.normalize(input).replace(/^\.\//, '');
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) return '';
  return normalized;
}

async function resolveChangedWorkspaceFiles(rootPath, relativePaths, {
  lstat = fs.promises.lstat,
  realpath = fs.promises.realpath,
  maxPaths = 1_000,
} = {}) {
  const root = await realpath(path.resolve(String(rootPath || '')));
  const candidates = [...new Map((Array.isArray(relativePaths) ? relativePaths : [])
    .map(value => ({ source: String(value || ''), normalized: normalizedRelativePath(value) }))
    .map(item => [item.normalized || `rejected:${item.source}`, item])).values()];
  const files = [];
  const rejected = [];
  const fullScanReasons = new Set();
  if (candidates.length > maxPaths) fullScanReasons.add('overflow');
  for (const candidate of candidates.slice(0, maxPaths)) {
    if (!candidate.normalized) {
      rejected.push(candidate.source);
      continue;
    }
    const selected = path.resolve(root, ...candidate.normalized.split('/'));
    const relative = path.relative(root, selected);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      rejected.push(candidate.source);
      continue;
    }
    let stat;
    try { stat = await lstat(selected); }
    catch (error) {
      if (error?.code === 'ENOENT') fullScanReasons.add('missing');
      else fullScanReasons.add('unavailable');
      continue;
    }
    if (stat.isSymbolicLink()) {
      rejected.push(candidate.source);
      continue;
    }
    if (stat.isDirectory()) {
      fullScanReasons.add('directory');
      continue;
    }
    if (!stat.isFile()) {
      rejected.push(candidate.source);
      continue;
    }
    files.push({
      filename: path.basename(selected),
      path: selected,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      fileKey: `${stat.dev}:${stat.ino}`,
      nlink: stat.nlink,
      relativePath: candidate.normalized,
    });
  }
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return { files, rejected, needsFullScan: fullScanReasons.size > 0,
    fullScanReasons: [...fullScanReasons].sort() };
}

module.exports = { normalizedRelativePath, resolveChangedWorkspaceFiles };

