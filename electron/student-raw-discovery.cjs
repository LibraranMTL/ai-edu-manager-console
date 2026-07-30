const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_EXCLUDED_DIRS = new Set([
  '.edu-manager',
  '.ai-manager',
  '.git',
  'node_modules',
  '知识库',
  '知识空间',
  '学情分析汇总',
]);

function normalizedRelative(root, target) {
  return path.relative(root, target).replace(/\\/g, '/');
}

function isTransientFile(name) {
  const lower = String(name || '').toLowerCase();
  return lower.startsWith('~$')
    || lower.endsWith('.tmp')
    || lower.endsWith('.part')
    || lower.endsWith('.crdownload')
    || lower.endsWith('.download');
}

function shouldSkipDirectory(name, excludedDirs = DEFAULT_EXCLUDED_DIRS) {
  const value = String(name || '');
  return !value || value.startsWith('.') || excludedDirs.has(value);
}

function sha1File(filePath) {
  const hash = crypto.createHash('sha1');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function stableMaterialId(studentId, relativePath, sha1) {
  return `fs-${crypto.createHash('sha1')
    .update(`${String(studentId || '')}\n${relativePath}\n${sha1}`)
    .digest('hex')
    .slice(0, 24)}`;
}

function discoverStudentRawMaterials({
  studentId,
  rawRoot,
  existingMaterials = [],
  previousState = {},
  isAllowedFile = () => true,
  maxFilesPerRun = 250,
  minimumStableAgeMs = 2000,
  nowMs = Date.now(),
} = {}) {
  const root = path.resolve(String(rawRoot || ''));
  if (!rawRoot || !fs.existsSync(root)) {
    return { discovered: [], state: { version: 1, entries: {}, cursor: 0 }, scanned: 0, remaining: 0 };
  }

  const candidates = [];
  const pendingDirs = [root];
  while (pendingDirs.length) {
    const directory = pendingDirs.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!shouldSkipDirectory(entry.name)) pendingDirs.push(absolutePath);
        continue;
      }
      if (!entry.isFile() || isTransientFile(entry.name) || !isAllowedFile(entry.name)) continue;
      candidates.push(absolutePath);
    }
  }
  candidates.sort((left, right) => normalizedRelative(root, left).localeCompare(normalizedRelative(root, right), 'zh-CN'));

  const priorEntries = previousState && typeof previousState.entries === 'object' && previousState.entries
    ? previousState.entries
    : {};
  const nextEntries = { ...priorEntries };
  const existingSha1 = new Set(existingMaterials.map((item) => String(item.sha1 || '').toLowerCase()).filter(Boolean));
  const existingByPath = new Map();
  for (const item of existingMaterials) {
    const key = String(item.path || '').replace(/\\/g, '/').toLowerCase();
    if (key && !existingByPath.has(key)) existingByPath.set(key, item);
  }
  const start = candidates.length ? Math.max(0, Number(previousState.cursor || 0)) % candidates.length : 0;
  const limit = Math.min(candidates.length, Math.max(1, Number(maxFilesPerRun || 250)));
  const discovered = [];
  let scanned = 0;

  for (let offset = 0; offset < limit; offset += 1) {
    const absolutePath = candidates[(start + offset) % candidates.length];
    const relativePath = normalizedRelative(root, absolutePath);
    let stat;
    try {
      stat = fs.statSync(absolutePath);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size <= 0 || nowMs - stat.mtimeMs < minimumStableAgeMs) continue;
    scanned += 1;
    const fingerprint = `${stat.size}:${Math.floor(stat.mtimeMs)}`;
    const prior = priorEntries[relativePath];
    if (prior?.fingerprint === fingerprint && prior.sha1) continue;

    let sha1 = '';
    try {
      sha1 = sha1File(absolutePath);
    } catch {
      continue;
    }
    const previousMaterial = existingByPath.get(relativePath.toLowerCase());
    const materialId = stableMaterialId(studentId, relativePath, sha1);
    nextEntries[relativePath] = {
      fingerprint,
      sha1,
      materialId,
      observedAt: new Date(nowMs).toISOString(),
    };
    if (existingSha1.has(sha1) || existingMaterials.some((item) => String(item.id || '') === materialId)) continue;

    discovered.push({
      id: materialId,
      fileName: path.basename(absolutePath),
      path: relativePath,
      absolutePath,
      size: stat.size,
      sha1,
      uploadedAt: new Date(stat.mtimeMs).toISOString(),
      sourceDevice: '文件系统发现',
      sourceDeviceId: 'filesystem',
      sourcePath: absolutePath,
      sourceName: '学生原始资料库',
      sourceType: 'filesystem_discovery',
      status: 'pending_digest',
      statusUpdatedAt: new Date(nowMs).toISOString(),
      revisionOf: previousMaterial?.id || '',
    });
    existingSha1.add(sha1);
  }

  return {
    discovered,
    scanned,
    remaining: Math.max(0, candidates.length - limit),
    state: {
      version: 1,
      updatedAt: new Date(nowMs).toISOString(),
      cursor: candidates.length ? (start + limit) % candidates.length : 0,
      entries: nextEntries,
    },
  };
}

module.exports = {
  discoverStudentRawMaterials,
  isTransientFile,
  shouldSkipDirectory,
  stableMaterialId,
};
