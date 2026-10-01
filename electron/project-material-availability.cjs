const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { identifier, invariant, relativeMaterialPath } = require('./project-material-contract.cjs');

const EXCLUDED_DIRECTORY_NAMES = new Set([
  '.edu-manager', '.git', '.cache', '.vite', 'node_modules', 'dist', 'build', 'out', 'win-unpacked',
]);
const EXCLUDED_FILENAMES = new Set(['工作空间结构.md', 'desktop.ini', 'thumbs.db',
  'staging-index.json', '研究暂存清单.md', '研究暂存治理建议.md']);
const key = (value) => process.platform === 'win32' ? value.toLowerCase() : value;
const withinPrefix = (relative, prefix) => !prefix || key(relative) === key(prefix)
  || key(relative).startsWith(`${key(prefix)}/`);

function scanRootIdentity(root) {
  try {
    const real = fs.realpathSync.native(root);
    const stat = fs.statSync(real, { bigint: true });
    if (!stat.isDirectory() || stat.ino <= 0n) return null;
    return JSON.stringify([key(path.resolve(real)), String(stat.dev), String(stat.ino)]);
  } catch { return null; }
}

function relativePrefix(root, directory) {
  if (!directory || !path.isAbsolute(directory)) return '';
  const relative = path.relative(path.resolve(root), path.resolve(directory)).replace(/\\/g, '/');
  if (!relative || relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) return '';
  return relativeMaterialPath(relative);
}

function eligibleLocation(location, { rootId, includePrefix = '', excludePrefixes = [] }) {
  if (location?.rootId !== rootId) return false;
  const relative = relativeMaterialPath(location.relativePath);
  if (!withinPrefix(relative, includePrefix)) return false;
  if (excludePrefixes.some((prefix) => withinPrefix(relative, prefix))) return false;
  const parts = relative.split('/');
  if (parts.slice(0, -1).some((part) => EXCLUDED_DIRECTORY_NAMES.has(part.toLowerCase()))) return false;
  const filename = parts.at(-1).toLowerCase();
  if (EXCLUDED_FILENAMES.has(filename) || /^\._edu-import-[a-f0-9-]{36}\.partial$/.test(filename)) return false;
  return true;
}

async function applyMaterialScanPage(store, {
  sessionId, scopeKey, rootId, includePrefix = '', excludePrefixes = [],
  seenLocations, complete = false, trustworthy = false, checkedAt = new Date().toISOString(),
}) {
  identifier(sessionId, '扫描会话ID');
  invariant(['workspace', 'legacy-staging'].includes(scopeKey), 'invalid_scope', '资料扫描范围无效。');
  identifier(rootId, '资料根ID');
  invariant(Array.isArray(seenLocations) && seenLocations.length <= 10000,
    'invalid_observation', '扫描页资料范围无效。');
  const scope = { rootId, includePrefix: includePrefix ? relativeMaterialPath(includePrefix) : '',
    excludePrefixes: excludePrefixes.map(relativeMaterialPath) };
  const seen = new Set(seenLocations.filter((location) => eligibleLocation(location, scope))
    .map((location) => key(relativeMaterialPath(location.relativePath))));
  const baseline = await store.read();
  const applicable = baseline.materials.filter((item) => eligibleLocation(item.location, scope));
  if (!applicable.length) return { seen: 0, missing: 0, unavailable: 0,
    complete: Boolean(complete && trustworthy) };
  const absent = new Map();
  let unavailable = 0;
  if (complete && trustworthy) {
    for (const record of applicable) {
      if (seen.has(key(record.location.relativePath)) || record.scanSeen?.[scopeKey] === sessionId
        || record.availability === 'missing') continue;
      try {
        const source = await store.locationPath(record.location);
        const stat = await fsp.stat(source);
        if (!stat.isFile()) absent.set(record.materialId, record.recordRevision);
      } catch (error) {
        if (error.code === 'ENOENT') absent.set(record.materialId, record.recordRevision);
        else unavailable++;
      }
    }
  }
  const { result } = await store.mutate((index) => {
    let marked = 0;
    let missing = 0;
    for (const record of index.materials) {
      if (!eligibleLocation(record.location, scope)) continue;
      if (seen.has(key(record.location.relativePath))) {
        record.scanSeen ||= {};
        record.scanSeen[scopeKey] = sessionId;
        marked++;
      }
      if (complete && trustworthy && absent.get(record.materialId) === record.recordRevision
        && record.scanSeen?.[scopeKey] !== sessionId
        && record.availability !== 'missing') {
        record.availability = 'missing';
        record.availabilityCheckedAt = checkedAt;
        record.recordRevision++;
        record.updatedAt = checkedAt;
        missing++;
      }
    }
    return { seen: marked, missing, unavailable,
      complete: Boolean(complete && trustworthy && !unavailable) };
  });
  return result;
}

async function markMaterialRootUnavailable(store, { rootId, includePrefix = '', excludePrefixes = [],
  checkedAt = new Date().toISOString() }) {
  identifier(rootId, '资料根ID');
  const scope = { rootId, includePrefix: includePrefix ? relativeMaterialPath(includePrefix) : '',
    excludePrefixes: excludePrefixes.map(relativeMaterialPath) };
  const baseline = await store.read();
  if (!baseline.materials.some((item) => eligibleLocation(item.location, scope)
    && item.availability !== 'unavailable')) return { unavailable: 0 };
  const { result } = await store.mutate((index) => {
    let unavailable = 0;
    for (const record of index.materials) {
      if (!eligibleLocation(record.location, scope) || record.availability === 'unavailable') continue;
      record.availability = 'unavailable';
      record.availabilityCheckedAt = checkedAt;
      record.recordRevision++;
      record.updatedAt = checkedAt;
      unavailable++;
    }
    return { unavailable };
  });
  return result;
}

module.exports = { scanRootIdentity, relativePrefix, eligibleLocation, applyMaterialScanPage,
  markMaterialRootUnavailable };
