const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SYNC_MANIFEST_SCHEMA = 'edu-manager.collaboration-manifest.v1';
const TOMBSTONE_SCHEMA = 'edu-manager.collaboration-tombstone.v1';
const SYNC_NAMESPACES = Object.freeze(['outbox', 'inbox', 'receipts', 'quarantine', 'trash', 'snapshots']);
const FORBIDDEN_NAMES = new Set([
  'tasks.json',
  'events.jsonl',
  'settings.json',
  'devices.json',
  'asset-index.json',
  'projects.json',
]);

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const handle = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let read = 0;
    do {
      read = fs.readSync(handle, buffer, 0, buffer.length, null);
      if (read > 0) hash.update(buffer.subarray(0, read));
    } while (read > 0);
  } finally {
    fs.closeSync(handle);
  }
  return hash.digest('hex');
}

function safeRelativePath(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('\0')) return '';
  const segments = normalized.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return '';
  return segments.join('/');
}

function pathInside(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function collaborationLayout(rootPath, nodeId) {
  const root = path.resolve(String(rootPath || ''));
  const namespaceRoot = path.join(root, String(nodeId || 'unknown-node'));
  return Object.fromEntries([
    ['root', root],
    ['nodeRoot', namespaceRoot],
    ...SYNC_NAMESPACES.map((name) => [name, path.join(namespaceRoot, name)]),
  ]);
}

function ensureCollaborationLayout(rootPath, nodeId) {
  const layout = collaborationLayout(rootPath, nodeId);
  for (const name of ['root', 'nodeRoot', ...SYNC_NAMESPACES]) {
    fs.mkdirSync(layout[name], { recursive: true });
  }
  return layout;
}

function forbiddenSyncPath(relativePath) {
  const normalized = safeRelativePath(relativePath);
  if (!normalized) return true;
  const lower = normalized.toLowerCase();
  const basename = path.posix.basename(lower);
  return FORBIDDEN_NAMES.has(basename)
    || lower.includes('/cache/')
    || lower.includes('/locks/')
    || lower.includes('/executions/')
    || lower.includes('/qclaw-inbox/')
    || lower.includes('/qclaw-results/')
    || /(^|\/)(agent-inbox|agent-results|workbuddy-outbox|manual-outbox)\//.test(lower)
    || lower.endsWith('.lock')
    || lower.endsWith('.tmp');
}

function normalizeManifestFile(input = {}) {
  const relativePath = safeRelativePath(input.relativePath);
  return {
    objectId: String(input.objectId || '').trim(),
    objectType: String(input.objectType || 'asset').trim(),
    relativePath,
    sha256: String(input.sha256 || '').trim().toLowerCase(),
    size: Math.max(0, Number(input.size || 0)),
    version: Math.max(1, Number(input.version || 1)),
    studentId: String(input.studentId || '').trim(),
    projectId: String(input.projectId || '').trim(),
  };
}

function createSyncManifest(input = {}) {
  const files = (Array.isArray(input.files) ? input.files : []).map(normalizeManifestFile);
  return {
    schema: SYNC_MANIFEST_SCHEMA,
    protocolVersion: '1.0',
    manifestId: String(input.manifestId || `manifest-${crypto.randomUUID()}`),
    sourceNodeId: String(input.sourceNodeId || '').trim(),
    targetNodeId: String(input.targetNodeId || '').trim(),
    createdAt: String(input.createdAt || new Date().toISOString()),
    completedAt: input.completedAt ? String(input.completedAt) : '',
    files,
  };
}

function validateSyncManifest(manifest, options = {}) {
  const errors = [];
  if (!manifest || manifest.schema !== SYNC_MANIFEST_SCHEMA) errors.push('同步清单 Schema 不正确。');
  if (!manifest?.manifestId) errors.push('同步清单缺少 manifestId。');
  if (!manifest?.sourceNodeId) errors.push('同步清单缺少 sourceNodeId。');
  if (!manifest?.targetNodeId) errors.push('同步清单缺少 targetNodeId。');
  if (options.targetNodeId && String(manifest?.targetNodeId || '') !== String(options.targetNodeId)) {
    errors.push('同步清单目标节点不匹配。');
  }
  if (!manifest?.completedAt || Number.isNaN(Date.parse(manifest.completedAt))) {
    errors.push('同步清单尚未完成。');
  }
  const seen = new Set();
  for (const file of Array.isArray(manifest?.files) ? manifest.files : []) {
    if (!file.objectId || !file.relativePath || !/^[a-f0-9]{64}$/.test(file.sha256 || '')) {
      errors.push(`同步对象无效：${file.objectId || file.relativePath || '未知对象'}`);
      continue;
    }
    if (forbiddenSyncPath(file.relativePath)) errors.push(`同步对象属于禁止目录：${file.relativePath}`);
    const key = `${file.objectId}|${file.version}`;
    if (seen.has(key)) errors.push(`同步对象重复：${key}`);
    seen.add(key);
  }
  return { ok: errors.length === 0, errors };
}

function verifyManifestFiles(manifest, contentRoot) {
  const results = [];
  for (const file of Array.isArray(manifest?.files) ? manifest.files : []) {
    const relativePath = safeRelativePath(file.relativePath);
    const absolutePath = path.resolve(contentRoot, relativePath);
    if (!relativePath || !pathInside(absolutePath, contentRoot)) {
      results.push({ ...file, ok: false, code: 'UNSAFE_PATH' });
      continue;
    }
    if (!fs.existsSync(absolutePath)) {
      results.push({ ...file, ok: false, code: 'FILE_MISSING' });
      continue;
    }
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile() || stat.size !== Number(file.size)) {
      results.push({ ...file, ok: false, code: 'FILE_SIZE_MISMATCH' });
      continue;
    }
    const digest = sha256File(absolutePath);
    results.push({ ...file, ok: digest === file.sha256, code: digest === file.sha256 ? 'VERIFIED' : 'HASH_MISMATCH' });
  }
  return results;
}

function fileLooksStable(previousStat, currentStat, options = {}) {
  if (!previousStat || !currentStat) return false;
  const minAgeMs = Math.max(0, Number(options.minAgeMs || 1500));
  const nowMs = Number(options.nowMs || Date.now());
  return Number(previousStat.size) === Number(currentStat.size)
    && Number(previousStat.mtimeMs) === Number(currentStat.mtimeMs)
    && nowMs - Number(currentStat.mtimeMs) >= minAgeMs;
}

function isSyncthingConflict(relativePath) {
  return /\.sync-conflict-\d{8}-\d{6}-[A-Z0-9]+/i.test(String(relativePath || ''));
}

function importDisposition(file, existing = {}) {
  if (isSyncthingConflict(file?.relativePath)) return { action: 'quarantine', reason: 'sync_conflict' };
  if (forbiddenSyncPath(file?.relativePath)) return { action: 'quarantine', reason: 'forbidden_path' };
  const current = existing[String(file?.objectId || '')];
  if (!current) return { action: 'import', reason: 'new_object' };
  if (String(current.sha256 || '') === String(file?.sha256 || '')) return { action: 'receipt_only', reason: 'duplicate_content' };
  if (Number(file?.version || 1) <= Number(current.version || 1)) return { action: 'quarantine', reason: 'stale_or_conflicting_version' };
  return { action: 'import', reason: 'new_version' };
}

function createTombstone(input = {}) {
  return {
    schema: TOMBSTONE_SCHEMA,
    tombstoneId: String(input.tombstoneId || `tombstone-${crypto.randomUUID()}`),
    objectId: String(input.objectId || '').trim(),
    authorityNodeId: String(input.authorityNodeId || '').trim(),
    requestedByNodeId: String(input.requestedByNodeId || '').trim(),
    reason: String(input.reason || '').trim().slice(0, 500),
    status: 'pending_review',
    createdAt: String(input.createdAt || new Date().toISOString()),
  };
}

module.exports = {
  FORBIDDEN_NAMES,
  SYNC_MANIFEST_SCHEMA,
  SYNC_NAMESPACES,
  TOMBSTONE_SCHEMA,
  collaborationLayout,
  createSyncManifest,
  createTombstone,
  ensureCollaborationLayout,
  fileLooksStable,
  forbiddenSyncPath,
  importDisposition,
  isSyncthingConflict,
  pathInside,
  safeRelativePath,
  sha256File,
  validateSyncManifest,
  verifyManifestFiles,
};
