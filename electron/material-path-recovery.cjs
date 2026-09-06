const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SETTLE_MS = 3_000;
const DEFAULT_BATCH_FILE_LIMIT = 100;
const DEFAULT_BATCH_BYTE_LIMIT = 512 * 1024 * 1024;
const ACTIVE_MATERIAL_STATUSES = new Set(['pending_digest', 'submitted', 'digesting', 'failed']);
const EXCLUDED_DIRECTORIES = new Set(['.edu-manager', '.ai-manager', '.git', 'node_modules']);

function comparable(value) {
  const resolved = path.resolve(String(value || ''));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isPathInside(root, candidate) {
  const rootValue = comparable(root);
  const candidateValue = comparable(candidate);
  return candidateValue === rootValue || candidateValue.startsWith(`${rootValue}${path.sep}`);
}

function normalizeRelative(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');
}

function fingerprint(stat) {
  return `${Number(stat.size || 0)}:${Math.floor(Number(stat.mtimeMs || 0))}`;
}

function inventoryRawFiles(rawRoot) {
  const root = path.resolve(String(rawRoot || ''));
  if (!rawRoot || !fs.existsSync(root)) return [];
  const output = [];
  const directories = [root];
  while (directories.length) {
    const directory = directories.pop();
    let entries = [];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && !EXCLUDED_DIRECTORIES.has(entry.name)) directories.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const realPath = fs.realpathSync(fullPath);
        if (!isPathInside(root, realPath)) continue;
        const stat = fs.statSync(realPath);
        if (!stat.isFile() || stat.size <= 0) continue;
        output.push({
          absolutePath: realPath,
          relativePath: normalizeRelative(path.relative(root, realPath)),
          fileName: path.basename(realPath),
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          fingerprint: fingerprint(stat),
        });
      } catch {
        // An unreadable entry is represented by its existing material record instead.
      }
    }
  }
  return output.sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'zh-CN'));
}

function sha1Stable(filePath, options = {}) {
  const nowMs = Number(options.nowMs || Date.now());
  const settleMs = Math.max(0, Number(options.settleMs ?? DEFAULT_SETTLE_MS));
  let before;
  try { before = fs.statSync(filePath); } catch { return { ok: false, code: 'missing' }; }
  if (!before.isFile() || before.size <= 0) return { ok: false, code: 'not_regular_file' };
  if (nowMs - before.mtimeMs < settleMs) return { ok: false, code: 'unstable', retryAfterMs: Math.max(250, settleMs - (nowMs - before.mtimeMs)) };
  let sha1 = '';
  try { sha1 = crypto.createHash('sha1').update(fs.readFileSync(filePath)).digest('hex'); } catch { return { ok: false, code: 'unreadable' }; }
  let after;
  try { after = fs.statSync(filePath); } catch { return { ok: false, code: 'missing' }; }
  if (after.size !== before.size || Math.floor(after.mtimeMs) !== Math.floor(before.mtimeMs)) return { ok: false, code: 'changed_during_validation' };
  return { ok: true, sha1, size: after.size, mtimeMs: after.mtimeMs, fingerprint: fingerprint(after) };
}

function resolveStudentMaterialPaths(options = {}) {
  const rawRoot = path.resolve(String(options.rawRoot || ''));
  const materials = Array.isArray(options.materials) ? options.materials : [];
  const discoveryEntries = options.discoveryState && typeof options.discoveryState.entries === 'object'
    ? options.discoveryState.entries
    : {};
  const inventory = Array.isArray(options.inventory) ? options.inventory : inventoryRawFiles(rawRoot);
  const inventoryByRelative = new Map(inventory.map((entry) => [entry.relativePath.toLowerCase(), entry]));
  const inventoryByName = new Map();
  const inventoryBySize = new Map();
  for (const entry of inventory) {
    const nameKey = entry.fileName.toLowerCase();
    if (!inventoryByName.has(nameKey)) inventoryByName.set(nameKey, []);
    inventoryByName.get(nameKey).push(entry);
    const sizeKey = Number(entry.size || 0);
    if (!inventoryBySize.has(sizeKey)) inventoryBySize.set(sizeKey, []);
    inventoryBySize.get(sizeKey).push(entry);
  }
  const hashCache = new Map();
  const resolved = [];
  const repaired = [];
  const blocked = [];

  function verify(entry, material) {
    if (!entry || !entry.absolutePath || !isPathInside(rawRoot, entry.absolutePath)) return { ok: false, code: 'outside_root' };
    const expectedSize = Math.max(0, Number(material.size || 0));
    if (expectedSize && expectedSize !== Number(entry.size || 0)) return { ok: false, code: 'size_mismatch' };
    const expectedHash = String(material.sha1 || '').toLowerCase();
    const cachedDiscovery = discoveryEntries[entry.relativePath];
    let checked = null;
    if (cachedDiscovery?.sha1 && cachedDiscovery.fingerprint === entry.fingerprint) {
      checked = { ok: true, sha1: String(cachedDiscovery.sha1).toLowerCase(), size: entry.size, mtimeMs: entry.mtimeMs, fingerprint: entry.fingerprint };
    } else if (hashCache.has(entry.absolutePath)) {
      checked = hashCache.get(entry.absolutePath);
    } else {
      checked = sha1Stable(entry.absolutePath, options);
      hashCache.set(entry.absolutePath, checked);
    }
    if (!checked.ok) return checked;
    if (expectedHash && checked.sha1 !== expectedHash) return { ok: false, code: 'hash_mismatch' };
    return { ...checked, ok: true };
  }

  for (const material of materials) {
    const materialId = String(material.id || material.materialId || '');
    const expectedHash = String(material.sha1 || '').toLowerCase();
    const recordedPath = String(material.absolutePath || (path.isAbsolute(String(material.path || '')) ? material.path : '') || '');
    const recordedRelative = normalizeRelative(path.isAbsolute(String(material.path || ''))
      ? (isPathInside(rawRoot, material.path) ? path.relative(rawRoot, material.path) : '')
      : (material.path || material.relativePath || material.fileName || ''));
    const directCandidates = [];
    if (recordedPath && isPathInside(rawRoot, recordedPath)) {
      const relative = normalizeRelative(path.relative(rawRoot, recordedPath));
      const known = inventoryByRelative.get(relative.toLowerCase());
      if (known) directCandidates.push({ entry: known, method: 'recorded_path' });
    }
    if (recordedRelative) {
      const known = inventoryByRelative.get(recordedRelative.toLowerCase());
      if (known && !directCandidates.some((candidate) => comparable(candidate.entry.absolutePath) === comparable(known.absolutePath))) {
        directCandidates.push({ entry: known, method: 'current_root_relative' });
      }
    }

    let chosen = null;
    let unstable = null;
    for (const candidate of directCandidates) {
      const verification = verify(candidate.entry, material);
      if (verification.ok) { chosen = { ...candidate, verification }; break; }
      if (['unstable', 'changed_during_validation'].includes(verification.code)) unstable = verification;
    }
    if (!chosen && unstable) {
      blocked.push({ materialId, fileName: material.fileName || path.basename(recordedRelative), code: unstable.code, retryable: true, retryAfterMs: unstable.retryAfterMs || 1_000, recordedPath, expectedSha1: expectedHash });
      continue;
    }

    if (!chosen && expectedHash) {
      const fileName = String(material.fileName || path.basename(recordedRelative || recordedPath)).toLowerCase();
      const expectedSize = Math.max(0, Number(material.size || 0));
      const discoveryMatches = Object.entries(discoveryEntries)
        .filter(([, value]) => String(value?.sha1 || '').toLowerCase() === expectedHash)
        .map(([relative]) => inventoryByRelative.get(normalizeRelative(relative).toLowerCase()))
        .filter(Boolean);
      const nameMatches = (inventoryByName.get(fileName) || []).filter((entry) => !expectedSize || entry.size === expectedSize);
      const sizeMatches = expectedSize ? (inventoryBySize.get(expectedSize) || []) : [];
      // A discovery-cache hit is only a hint. Uniqueness is decided against
      // every plausible file in the current raw root, otherwise a second copy
      // added after the cache was written could be selected silently.
      const candidatePool = new Map([...discoveryMatches, ...nameMatches, ...sizeMatches]
        .map((entry) => [comparable(entry.absolutePath), entry]));
      if (candidatePool.size > 5_000) {
        blocked.push({ materialId, fileName: material.fileName || '', code: 'candidate_limit_exceeded', retryable: false, candidateCount: candidatePool.size, recordedPath, expectedSha1: expectedHash });
        chosen = { blocked: true };
        continue;
      }
      const verified = [];
      for (const entry of candidatePool.values()) {
        const verification = verify(entry, material);
        if (verification.ok) verified.push({ entry, verification });
      }
      const unique = new Map(verified.map((candidate) => [comparable(candidate.entry.absolutePath), candidate]));
      if (unique.size === 1) {
        const candidate = Array.from(unique.values())[0];
        const method = discoveryMatches.some((entry) => comparable(entry.absolutePath) === comparable(candidate.entry.absolutePath))
          ? 'discovery_hash'
          : nameMatches.some((entry) => comparable(entry.absolutePath) === comparable(candidate.entry.absolutePath))
            ? 'filename_hash'
            : 'size_hash';
        chosen = { ...candidate, method };
      } else if (unique.size > 1) {
        blocked.push({ materialId, fileName: material.fileName || '', code: 'ambiguous', retryable: false, candidates: Array.from(unique.values()).map((candidate) => candidate.entry.absolutePath), recordedPath, expectedSha1: expectedHash });
        chosen = { blocked: true };
      }
    }

    if (chosen?.blocked) continue;
    if (!chosen) {
      blocked.push({ materialId, fileName: material.fileName || path.basename(recordedRelative || recordedPath), code: expectedHash ? 'missing' : 'missing_hash', retryable: false, recordedPath, expectedSha1: expectedHash });
      continue;
    }
    const relativePath = chosen.entry.relativePath;
    const nextMaterial = {
      ...material,
      path: relativePath,
      absolutePath: chosen.entry.absolutePath,
      fileName: material.fileName || chosen.entry.fileName,
      size: chosen.verification.size,
      sha1: chosen.verification.sha1,
    };
    const changed = comparable(recordedPath || path.join(rawRoot, recordedRelative || '')) !== comparable(chosen.entry.absolutePath)
      || normalizeRelative(material.path || '') !== relativePath
      || !expectedHash;
    const result = { materialId, material: nextMaterial, absolutePath: chosen.entry.absolutePath, relativePath, sha1: chosen.verification.sha1, size: chosen.verification.size, method: chosen.method, repaired: changed, previousPath: recordedPath || String(material.path || '') };
    resolved.push(result);
    if (changed) repaired.push(result);
  }
  return { resolved, repaired, blocked, inventoryCount: inventory.length };
}

function selectDigestBatchFiles(resolved, options = {}) {
  const maxFiles = Math.max(1, Number(options.maxFiles || DEFAULT_BATCH_FILE_LIMIT));
  const maxBytes = Math.max(1, Number(options.maxBytes || DEFAULT_BATCH_BYTE_LIMIT));
  const selected = [];
  const deferred = [];
  const oversized = [];
  let selectedBytes = 0;
  for (const item of Array.isArray(resolved) ? resolved : []) {
    const size = Math.max(0, Number(item.size || item.material?.size || 0));
    if (size > maxBytes) oversized.push(item);
    else if (selected.length >= maxFiles || (selected.length > 0 && selectedBytes + size > maxBytes)) deferred.push(item);
    else { selected.push(item); selectedBytes += size; }
  }
  return { selected, deferred, oversized, selectedBytes, maxFiles, maxBytes };
}

function compactActiveMaterialRecords(records, options = {}) {
  const terminalLimit = Math.max(0, Number(options.terminalLimit ?? 1_000));
  const values = Array.isArray(records) ? records : [];
  const active = values.filter((record) => ACTIVE_MATERIAL_STATUSES.has(String(record?.status || 'pending_digest')));
  const terminal = values
    .filter((record) => !ACTIVE_MATERIAL_STATUSES.has(String(record?.status || 'pending_digest')))
    .sort((left, right) => String(right.statusUpdatedAt || right.uploadedAt || '').localeCompare(String(left.statusUpdatedAt || left.uploadedAt || '')))
    .slice(0, terminalLimit);
  return [...active, ...terminal];
}

module.exports = {
  ACTIVE_MATERIAL_STATUSES,
  DEFAULT_BATCH_BYTE_LIMIT,
  DEFAULT_BATCH_FILE_LIMIT,
  DEFAULT_SETTLE_MS,
  compactActiveMaterialRecords,
  inventoryRawFiles,
  isPathInside,
  normalizeRelative,
  resolveStudentMaterialPaths,
  selectDigestBatchFiles,
  sha1Stable,
};
