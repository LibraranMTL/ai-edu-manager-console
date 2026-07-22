const fs = require('fs');
const path = require('path');

function normalizeRoot(root) {
  return path.resolve(String(root || '')).toLowerCase();
}

function countDirectoryFiles(root, predicate = null, fsImpl = fs) {
  if (!root || !fsImpl.existsSync(root)) return 0;
  let count = 0;
  let entries = [];
  try {
    entries = fsImpl.readdirSync(root, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) count += countDirectoryFiles(full, predicate, fsImpl);
    else if (entry.isFile() && (!predicate || predicate(entry.name, full))) count += 1;
  }
  return count;
}

function relatedPath(left, right) {
  const relative = path.relative(left, right);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function createDirectoryCountCache(options = {}) {
  const ttlMs = Math.max(1000, Number(options.ttlMs || 5 * 60 * 1000));
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const fsImpl = options.fsImpl || fs;
  const cache = new Map();

  function count(root, kind = 'all', predicate = null) {
    const normalizedRoot = normalizeRoot(root);
    const key = `${kind}:${normalizedRoot}`;
    const cached = cache.get(key);
    const currentTime = Number(now());
    if (cached && cached.expiresAt > currentTime) return cached.value;
    const value = countDirectoryFiles(root, predicate, fsImpl);
    cache.set(key, { root: normalizedRoot, value, expiresAt: currentTime + ttlMs });
    return value;
  }

  function invalidate(root = '') {
    if (!root) {
      cache.clear();
      return;
    }
    const normalizedRoot = normalizeRoot(root);
    for (const [key, item] of cache.entries()) {
      if (relatedPath(item.root, normalizedRoot) || relatedPath(normalizedRoot, item.root)) cache.delete(key);
    }
  }

  return {
    count,
    invalidate,
    clear: () => cache.clear(),
    size: () => cache.size,
  };
}

module.exports = { countDirectoryFiles, createDirectoryCountCache };
