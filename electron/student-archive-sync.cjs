const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathInside, safeRelativePath, sha256File } = require('./collaboration-sync.cjs');

const STUDENT_ARCHIVE_SYNC_SCHEMA = 'edu-manager.student-archive-sync.v1';
const STUDENT_ARCHIVE_SYNC_STATE_SCHEMA = 'edu-manager.student-archive-sync-state.v1';
const SYNC_KINDS = new Set(['confirmed_knowledge', 'growth_model', 'learning_report', 'education_archive']);
const TEXT_EXTENSIONS = new Set(['.md', '.json', '.txt', '.csv']);

function stableId(...parts) {
  return crypto.createHash('sha256').update(parts.map((part) => String(part || '')).join('\u001f')).digest('hex');
}

function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
}

function normalizeState(input = {}) {
  return {
    schema: STUDENT_ARCHIVE_SYNC_STATE_SCHEMA,
    lineages: input.lineages && typeof input.lineages === 'object' ? input.lineages : {},
    importedPublicationIds: Array.isArray(input.importedPublicationIds) ? input.importedPublicationIds.map(String).slice(-2000) : [],
    updatedAt: String(input.updatedAt || new Date().toISOString()),
  };
}

function collectFiles(root, options = {}) {
  const base = path.resolve(String(root || ''));
  if (!base || !fs.existsSync(base)) return [];
  const excludedRoots = (options.excludedRoots || []).map((item) => path.resolve(String(item || ''))).filter(Boolean);
  const files = [];
  const pending = [base];
  while (pending.length && files.length < Math.max(1, Number(options.limit || 5000))) {
    const current = pending.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (excludedRoots.some((excluded) => pathInside(target, excluded))) continue;
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.edu-manager' || entry.name === '.ai-manager') continue;
      if (entry.isDirectory()) {
        pending.push(target);
        continue;
      }
      if (!entry.isFile() || !TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      const relativePath = safeRelativePath(path.relative(base, target));
      if (!relativePath) continue;
      const stat = fs.statSync(target);
      files.push({ sourcePath: target, relativePath, size: stat.size, modifiedAt: stat.mtime.toISOString() });
    }
  }
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function latestArchiveVersionDir(archiveRoot) {
  const latest = readJson(path.join(String(archiveRoot || ''), 'latest.json'), {});
  const candidate = path.resolve(String(latest.versionDir || ''));
  return candidate && fs.existsSync(candidate) && pathInside(candidate, archiveRoot) ? candidate : '';
}

function collectStudentArchiveFiles(options = {}) {
  const rawRoot = path.resolve(String(options.rawRoot || ''));
  const reportRoot = path.resolve(String(options.reportRoot || ''));
  const knowledge = collectFiles(options.knowledgeRoot, {
    excludedRoots: [rawRoot, reportRoot].filter(Boolean),
    limit: options.limit,
  }).map((item) => ({ ...item, kind: 'confirmed_knowledge' }));
  const growth = collectFiles(options.growthRoot, { limit: options.limit })
    .filter((item) => !/(^|\/)(?:成长证据草稿|.*(?:draft|草稿).*)\.(?:md|json|txt|csv)$/iu.test(item.relativePath))
    .map((item) => ({ ...item, kind: 'growth_model' }));
  const reports = collectFiles(reportRoot, { limit: 100 })
    .filter((item) => {
      const header = fs.readFileSync(item.sourcePath, 'utf8').slice(0, 8192);
      const status = /^status:\s*([^\r\n]+)$/im.exec(header)?.[1]?.trim().toLowerCase() || '';
      return !status || status === 'published';
    })
    .map((item) => ({ ...item, kind: 'learning_report' }));
  const archiveVersionDir = latestArchiveVersionDir(options.archiveRoot);
  const archive = collectFiles(archiveVersionDir, { limit: 50 })
    .map((item) => ({ ...item, kind: 'education_archive' }));
  const rawPrefix = rawRoot ? `${rawRoot.toLowerCase()}${path.sep}` : '';
  return [...knowledge, ...growth, ...reports, ...archive].filter((item) => {
    const source = path.resolve(item.sourcePath).toLowerCase();
    return !rawRoot || (source !== rawRoot.toLowerCase() && !source.startsWith(rawPrefix));
  });
}

function normalizeEntry(input = {}, lineageId = '') {
  const kind = String(input.kind || '');
  const relativePath = safeRelativePath(input.relativePath);
  if (!SYNC_KINDS.has(kind) || !relativePath) throw new Error('学生档案同步条目类型或路径无效。');
  const sha256 = String(input.sha256 || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error(`学生档案同步条目缺少 SHA-256：${relativePath}`);
  const objectId = String(input.objectId || `student-archive:${stableId(lineageId, kind, relativePath.toLowerCase()).slice(0, 40)}`);
  const revisionId = String(input.revisionId || `revision:${sha256}`);
  return {
    objectId,
    kind,
    relativePath,
    sha256,
    size: Math.max(0, Number(input.size || 0)),
    revisionId,
    version: Math.max(1, Number(input.version || 1)),
    parentRevisionIds: [...new Set((Array.isArray(input.parentRevisionIds) ? input.parentRevisionIds : []).map(String).filter(Boolean))].slice(0, 20),
    sourceModifiedAt: String(input.sourceModifiedAt || ''),
    tombstone: Boolean(input.tombstone),
  };
}

function createStudentArchivePublication(options = {}) {
  const lineageId = String(options.lineageId || '').trim();
  if (!lineageId) throw new Error('学生档案同步缺少 lineageId。');
  const state = normalizeState(options.state);
  const lineage = state.lineages[lineageId] || { objects: {} };
  const entries = (options.files || []).map((file) => {
    const sha256 = file.sha256 || sha256File(file.sourcePath);
    const kind = String(file.kind || '');
    const relativePath = safeRelativePath(file.relativePath);
    const objectId = `student-archive:${stableId(lineageId, kind, relativePath.toLowerCase()).slice(0, 40)}`;
    const previous = lineage.objects?.[objectId];
    if (previous?.tombstone && previous.sha256 === sha256) {
      return normalizeEntry({
        objectId,
        kind,
        relativePath,
        sha256,
        size: 0,
        revisionId: previous.currentRevisionId,
        version: previous.version,
        parentRevisionIds: previous.parentRevisionIds || [],
        tombstone: true,
      }, lineageId);
    }
    const unchanged = previous?.sha256 === sha256 && !previous?.tombstone;
    return normalizeEntry({
      objectId,
      kind,
      relativePath,
      sha256,
      size: file.size ?? fs.statSync(file.sourcePath).size,
      revisionId: `revision:${sha256}`,
      version: unchanged ? previous.version : Math.max(1, Number(previous?.version || 0) + 1),
      parentRevisionIds: previous?.currentRevisionId ? [previous.currentRevisionId] : [],
      sourceModifiedAt: file.modifiedAt,
    }, lineageId);
  });
  const currentObjectIds = new Set(entries.map((entry) => entry.objectId));
  for (const [objectId, previous] of Object.entries(lineage.objects || {})) {
    if (currentObjectIds.has(objectId)) continue;
    if (previous.tombstone) {
      entries.push(normalizeEntry({
        objectId,
        kind: previous.kind,
        relativePath: previous.relativePath,
        sha256: previous.sha256,
        size: 0,
        revisionId: previous.currentRevisionId,
        version: previous.version,
        parentRevisionIds: previous.parentRevisionIds || [],
        tombstone: true,
      }, lineageId));
      continue;
    }
    if (!previous.localManaged) continue;
    entries.push(normalizeEntry({
      objectId,
      kind: previous.kind,
      relativePath: previous.relativePath,
      sha256: previous.sha256,
      size: 0,
      revisionId: `tombstone:${stableId(objectId, previous.currentRevisionId, Date.now()).slice(0, 40)}`,
      version: Math.max(1, Number(previous.version || 0) + 1),
      parentRevisionIds: previous.currentRevisionId ? [previous.currentRevisionId] : [],
      tombstone: true,
    }, lineageId));
  }
  const createdAt = String(options.createdAt || new Date().toISOString());
  const publicationId = String(options.publicationId || `student-archive-${stableId(lineageId, options.sourceNodeId, createdAt, entries.map((entry) => entry.revisionId).join('|')).slice(0, 32)}`);
  return {
    schema: STUDENT_ARCHIVE_SYNC_SCHEMA,
    protocolVersion: 1,
    publicationId,
    lineageId,
    sourceNodeId: String(options.sourceNodeId || ''),
    targetNodeId: String(options.targetNodeId || ''),
    sourceStudentId: String(options.sourceStudentId || ''),
    targetStudentId: String(options.targetStudentId || ''),
    createdAt,
    entries,
    fingerprint: stableId(lineageId, entries.map((entry) => `${entry.objectId}:${entry.revisionId}`).sort().join('|')),
  };
}

function validateStudentArchivePublication(publication, options = {}) {
  const errors = [];
  if (publication?.schema !== STUDENT_ARCHIVE_SYNC_SCHEMA) errors.push('学生档案同步协议不受支持。');
  for (const field of ['publicationId', 'lineageId', 'sourceNodeId', 'targetNodeId', 'sourceStudentId', 'targetStudentId']) {
    if (!publication?.[field]) errors.push(`学生档案同步缺少 ${field}。`);
  }
  if (options.targetNodeId && publication?.targetNodeId !== options.targetNodeId) errors.push('学生档案同步目标节点不匹配。');
  const seen = new Set();
  for (const input of publication?.entries || []) {
    try {
      const entry = normalizeEntry(input, publication.lineageId);
      if (seen.has(entry.objectId)) errors.push(`学生档案同步对象重复：${entry.objectId}`);
      seen.add(entry.objectId);
    } catch (error) {
      errors.push(error.message);
    }
  }
  return { ok: errors.length === 0, errors };
}

function targetForEntry(entry, roots = {}, publication = {}) {
  const root = {
    confirmed_knowledge: roots.knowledgeRoot,
    growth_model: roots.growthRoot,
    learning_report: roots.reportRoot,
    education_archive: path.join(String(roots.archiveRoot || ''), `remote-${publication.sourceNodeId}-${publication.publicationId}`),
  }[entry.kind];
  const target = path.resolve(String(root || ''), ...entry.relativePath.split('/'));
  if (!root || !pathInside(target, root)) return { root: '', target: '' };
  return { root: path.resolve(root), target };
}

function conflictPath(conflictRoot, publication, entry) {
  const suffix = `${publication.sourceNodeId}-${entry.revisionId.replace(/[^a-zA-Z0-9]+/g, '-').slice(-24)}`;
  return path.join(conflictRoot, entry.kind, `${entry.relativePath}.${suffix}`);
}

function materializeStudentArchivePublication(options = {}) {
  const publication = options.publication;
  const validation = validateStudentArchivePublication(publication, { targetNodeId: options.targetNodeId });
  if (!validation.ok) return { ok: false, errors: validation.errors, imported: 0, duplicates: 0, conflicts: 0, tombstones: 0 };
  const state = normalizeState(options.state);
  const lineage = state.lineages[publication.lineageId] || { lineageId: publication.lineageId, objects: {}, conflicts: [] };
  let imported = 0;
  let duplicates = 0;
  let conflicts = 0;
  let tombstones = 0;
  const conflictRoot = path.resolve(String(options.conflictRoot || ''));
  for (const input of publication.entries) {
    const entry = normalizeEntry(input, publication.lineageId);
    const current = lineage.objects[entry.objectId] || {};
    if (current.seenRevisionIds?.includes(entry.revisionId)) {
      duplicates += 1;
      continue;
    }
    if (entry.tombstone) {
      lineage.objects[entry.objectId] = {
        ...current,
        objectId: entry.objectId,
        kind: entry.kind,
        relativePath: entry.relativePath,
        sha256: entry.sha256,
        version: entry.version,
        tombstone: true,
        pendingDeletion: true,
        currentRevisionId: entry.revisionId,
        parentRevisionIds: entry.parentRevisionIds,
        seenRevisionIds: [...new Set([...(current.seenRevisionIds || []), entry.revisionId])],
        localManaged: false,
        updatedAt: publication.createdAt,
      };
      tombstones += 1;
      continue;
    }
    const sourcePath = path.resolve(String(options.packageContentRoot || ''), ...String(options.packageRelativePath(entry) || '').split('/'));
    if (!pathInside(sourcePath, options.packageContentRoot) || !fs.existsSync(sourcePath) || sha256File(sourcePath) !== entry.sha256) {
      conflicts += 1;
      lineage.conflicts.push({ objectId: entry.objectId, revisionId: entry.revisionId, reason: 'missing_or_invalid_package_content', publicationId: publication.publicationId });
      continue;
    }
    const { root, target } = targetForEntry(entry, options.roots, publication);
    if (!root || !target) {
      conflicts += 1;
      continue;
    }
    const localHash = fs.existsSync(target) && fs.statSync(target).isFile() ? sha256File(target) : '';
    if (localHash === entry.sha256) {
      duplicates += 1;
    } else {
      const fastForward = !localHash || (
        Boolean(current.currentRevisionId)
        && current.sha256 === localHash
        && entry.parentRevisionIds.includes(String(current.currentRevisionId))
      );
      if (!fastForward) {
        const branch = conflictPath(conflictRoot, publication, entry);
        fs.mkdirSync(path.dirname(branch), { recursive: true });
        fs.copyFileSync(sourcePath, branch);
        lineage.conflicts.push({
          objectId: entry.objectId,
          localRevisionId: current.currentRevisionId || (localHash ? `revision:${localHash}` : ''),
          remoteRevisionId: entry.revisionId,
          branchPath: branch,
          publicationId: publication.publicationId,
          createdAt: new Date().toISOString(),
        });
        conflicts += 1;
        continue;
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
      fs.copyFileSync(sourcePath, temporary);
      fs.renameSync(temporary, target);
      imported += 1;
    }
    lineage.objects[entry.objectId] = {
      objectId: entry.objectId,
      kind: entry.kind,
      relativePath: entry.relativePath,
      sha256: entry.sha256,
      currentRevisionId: entry.revisionId,
      version: entry.version,
      parentRevisionIds: entry.parentRevisionIds,
      seenRevisionIds: [...new Set([...(current.seenRevisionIds || []), entry.revisionId])].slice(-50),
      sourceNodeId: publication.sourceNodeId,
      localManaged: true,
      tombstone: false,
      updatedAt: publication.createdAt,
    };
  }
  lineage.updatedAt = new Date().toISOString();
  lineage.lastSyncedFingerprint = publication.fingerprint;
  state.lineages[publication.lineageId] = lineage;
  state.updatedAt = lineage.updatedAt;
  return { ok: true, state, imported, duplicates, conflicts, tombstones };
}

function recordPublishedStudentArchive(stateInput, publication) {
  const state = normalizeState(stateInput);
  const lineage = state.lineages[publication.lineageId] || { lineageId: publication.lineageId, objects: {}, conflicts: [] };
  for (const entry of publication.entries || []) {
    const current = lineage.objects[entry.objectId] || {};
    lineage.objects[entry.objectId] = {
      ...current,
      objectId: entry.objectId,
      kind: entry.kind,
      relativePath: entry.relativePath,
      sha256: entry.sha256,
      currentRevisionId: entry.revisionId,
      version: entry.version,
      seenRevisionIds: [...new Set([...(current.seenRevisionIds || []), entry.revisionId])].slice(-50),
      localManaged: !entry.tombstone,
      tombstone: entry.tombstone,
      updatedAt: publication.createdAt,
    };
  }
  lineage.lastPublishedAt = publication.createdAt;
  lineage.lastPublicationId = publication.publicationId;
  lineage.lastPublishedFingerprint = publication.fingerprint;
  lineage.lastSyncedFingerprint = publication.fingerprint;
  state.lineages[publication.lineageId] = lineage;
  state.updatedAt = new Date().toISOString();
  return state;
}

module.exports = {
  STUDENT_ARCHIVE_SYNC_SCHEMA,
  STUDENT_ARCHIVE_SYNC_STATE_SCHEMA,
  collectStudentArchiveFiles,
  createStudentArchivePublication,
  materializeStudentArchivePublication,
  normalizeState,
  recordPublishedStudentArchive,
  validateStudentArchivePublication,
  writeJsonAtomic,
};
