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
    pathProvenance: input.pathProvenance && typeof input.pathProvenance === 'object' ? input.pathProvenance : {},
    operationSequence: Math.max(0, Number(input.operationSequence || 0)),
    importedPublicationIds: Array.isArray(input.importedPublicationIds) ? input.importedPublicationIds.map(String).slice(-2000) : [],
    updatedAt: String(input.updatedAt || new Date().toISOString()),
  };
}

function archivePathKey(kind, relativePath) {
  return `${String(kind || '')}\u001f${safeRelativePath(relativePath).toLowerCase()}`;
}

function recordPathProvenance(state, entry, sourceNodeId, localNodeId, tombstone) {
  state.operationSequence = Math.max(0, Number(state.operationSequence || 0)) + 1;
  state.pathProvenance[archivePathKey(entry.kind, entry.relativePath)] = {
    sourceNodeId: String(sourceNodeId || ''),
    origin: String(sourceNodeId || '') === String(localNodeId || '') ? 'local' : 'remote',
    tombstone: Boolean(tombstone),
    revisionId: String(entry.revisionId || ''),
    sequence: state.operationSequence,
  };
  const provenanceEntries = Object.entries(state.pathProvenance);
  if (provenanceEntries.length > 20_000) {
    for (const [key] of provenanceEntries.sort((left, right) => Number(left[1]?.sequence || 0) - Number(right[1]?.sequence || 0)).slice(0, 1_000)) {
      delete state.pathProvenance[key];
    }
  }
}

function revisionContentKey(kind, relativePath, sha256) {
  return `${String(kind || '')}\u001f${safeRelativePath(relativePath).toLowerCase()}\u001f${String(sha256 || '').toLowerCase()}`;
}

function filterLocallyAuthoredStudentArchiveFiles(options = {}) {
  const localNodeId = String(options.localNodeId || '').trim();
  const state = normalizeState(options.state);
  const remotelySourced = new Set();
  for (const lineage of Object.values(state.lineages || {})) {
    for (const object of Object.values(lineage?.objects || {})) {
      if (
        !object?.tombstone
        && object?.sourceNodeId
        && String(object.sourceNodeId) !== localNodeId
        && object?.sha256
      ) {
        remotelySourced.add(revisionContentKey(object.kind, object.relativePath, object.sha256));
      }
    }
  }
  return (Array.isArray(options.files) ? options.files : []).flatMap((file) => {
    const sha256 = String(file?.sha256 || sha256File(file.sourcePath)).toLowerCase();
    const key = revisionContentKey(file?.kind, file?.relativePath, sha256);
    return remotelySourced.has(key) ? [] : [{ ...file, sha256 }];
  });
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
  if (candidate && fs.existsSync(candidate) && pathInside(candidate, archiveRoot)) return candidate;
  const root = path.resolve(String(archiveRoot || ''));
  if (!root || !fs.existsSync(root)) return '';
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => path.join(root, entry.name))
    .filter((dir) => fs.existsSync(path.join(dir, 'education-archive.json')) && fs.existsSync(path.join(dir, 'manifest.json')))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)[0] || '';
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

function governedStatus(filePath) {
  const header = fs.readFileSync(filePath, 'utf8').slice(0, 8192);
  return /^status:\s*([^\r\n]+)$/im.exec(header)?.[1]?.trim().toLowerCase() || '';
}

const PUBLISHABLE_LEARNING_REPORT_STATUSES = new Set(['published', 'current', 'updated', 'active']);

function isPublishableLearningReportStatus(status) {
  return PUBLISHABLE_LEARNING_REPORT_STATUSES.has(String(status || '').trim().toLowerCase());
}

function collectGovernedStudentArchiveFiles(options = {}) {
  const rawRoot = path.resolve(String(options.rawRoot || ''));
  const reportRoot = path.resolve(String(options.reportRoot || ''));
  const excludedKnowledgeStatuses = new Set(['draft', 'pending', 'pending_review', 'rejected', 'template']);
  const knowledge = collectFiles(options.knowledgeRoot, {
    excludedRoots: [rawRoot, reportRoot].filter(Boolean),
    limit: options.limit,
  })
    .filter((item) => !excludedKnowledgeStatuses.has(governedStatus(item.sourcePath)))
    .map((item) => ({ ...item, kind: 'confirmed_knowledge' }));
  const growth = collectFiles(options.growthRoot, { limit: options.limit })
    .filter((item) => !/(^|\/)(?:成长证据草稿|.*(?:draft|草稿).*)\.(?:md|json|txt|csv)$/iu.test(item.relativePath))
    .map((item) => ({ ...item, kind: 'growth_model' }));
  const reports = collectFiles(reportRoot, { limit: 100 })
    .filter((item) => isPublishableLearningReportStatus(governedStatus(item.sourcePath)))
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
  const presentObjectIds = new Set((options.presentFiles || options.files || []).map((file) => {
    const kind = String(file.kind || '');
    const relativePath = safeRelativePath(file.relativePath);
    return `student-archive:${stableId(lineageId, kind, relativePath.toLowerCase()).slice(0, 40)}`;
  }));
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
    // A governed file can still exist locally but be intentionally suppressed
    // because it is an unchanged remote revision. That is not a deletion.
    if (presentObjectIds.has(objectId)) continue;
    const provenance = state.pathProvenance[archivePathKey(previous.kind, previous.relativePath)];
    if (provenance?.origin === 'remote' && provenance.tombstone) continue;
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
    if (!previous.localManaged || (previous.sourceNodeId && String(previous.sourceNodeId) !== String(options.sourceNodeId || ''))) continue;
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

function splitStudentArchivePublication(publication, maximumEntries = 999) {
  const limit = Math.max(1, Math.min(999, Number(maximumEntries || 999)));
  const entries = Array.isArray(publication?.entries) ? publication.entries : [];
  if (entries.length <= limit) return [publication];
  const chunks = [];
  for (let offset = 0; offset < entries.length; offset += limit) chunks.push(entries.slice(offset, offset + limit));
  return chunks.map((batchEntries, index) => {
    const fingerprint = stableId(
      publication.lineageId,
      batchEntries.map((entry) => `${entry.objectId}:${entry.revisionId}`).sort().join('|'),
    );
    return {
      ...publication,
      publicationId: `student-archive-${stableId(publication.lineageId, publication.sourceNodeId, fingerprint).slice(0, 32)}`,
      entries: batchEntries,
      fingerprint,
      collectionFingerprint: publication.fingerprint,
      batchIndex: index + 1,
      batchCount: chunks.length,
    };
  });
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
  const parsed = path.posix.parse(entry.relativePath);
  const timestamp = String(publication.createdAt || new Date().toISOString()).replace(/[^0-9]/g, '').slice(0, 14);
  const source = String(publication.sourceNodeId || 'remote').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(-20);
  const filename = `${parsed.name} (conflict-${source}-${timestamp || Date.now()})${parsed.ext}`;
  return path.join(conflictRoot, entry.kind, ...parsed.dir.split('/').filter(Boolean), filename);
}

function trashPath(trashRoot, publication, entry) {
  const parsed = path.posix.parse(entry.relativePath);
  const timestamp = String(publication.createdAt || new Date().toISOString()).replace(/[^0-9]/g, '').slice(0, 14);
  const filename = `${parsed.name} (deleted-${timestamp || Date.now()})${parsed.ext}`;
  return path.join(trashRoot, entry.kind, ...parsed.dir.split('/').filter(Boolean), filename);
}

function availableFilePath(candidatePath) {
  if (!fs.existsSync(candidatePath)) return candidatePath;
  const parsed = path.parse(candidatePath);
  for (let index = 2; index <= 999; index += 1) {
    const candidate = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return path.join(parsed.dir, `${parsed.name}-${crypto.randomUUID()}${parsed.ext}`);
}

function copyThenRemove(sourcePath, destinationPath) {
  const availableDestination = availableFilePath(destinationPath);
  fs.mkdirSync(path.dirname(availableDestination), { recursive: true });
  const temporary = `${availableDestination}.${process.pid}.${Date.now()}.tmp`;
  fs.copyFileSync(sourcePath, temporary);
  fs.renameSync(temporary, availableDestination);
  fs.unlinkSync(sourcePath);
  return availableDestination;
}

function validateStudentArchiveTargetRoots(options = {}) {
  const errors = [];
  const roots = [
    { name: 'knowledgeRoot', value: options.knowledgeRoot, create: false },
    { name: 'growthRoot', value: options.growthRoot, create: true },
    { name: 'reportRoot', value: options.reportRoot, create: true },
    { name: 'archiveRoot', value: options.archiveRoot, create: true },
  ];
  for (const root of roots) {
    const resolved = path.resolve(String(root.value || ''));
    if (!String(root.value || '').trim() || resolved === path.parse(resolved).root) {
      errors.push(`${root.name} 不是安全的目录路径。`);
      continue;
    }
    try {
      if (!fs.existsSync(resolved) && root.create) fs.mkdirSync(resolved, { recursive: true });
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        errors.push(`${root.name} 不存在或不是文件夹。`);
        continue;
      }
      fs.accessSync(resolved, fs.constants.R_OK | fs.constants.W_OK);
    } catch (error) {
      errors.push(`${root.name} 无法读写：${error.message}`);
    }
  }
  return { ok: errors.length === 0, errors };
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
      const { root, target } = targetForEntry(entry, options.roots, publication);
      const localHash = root && target && fs.existsSync(target) && fs.statSync(target).isFile() ? sha256File(target) : '';
      const baseRevisionKnown = Boolean(
        current.currentRevisionId
        && current.sha256
        && current.sha256 === localHash
        && entry.parentRevisionIds.includes(String(current.currentRevisionId)),
      );
      if (localHash && !baseRevisionKnown) {
        lineage.conflicts.push({
          objectId: entry.objectId,
          localRevisionId: current.currentRevisionId || `revision:${localHash}`,
          remoteRevisionId: entry.revisionId,
          reason: 'delete_conflict',
          publicationId: publication.publicationId,
          createdAt: new Date().toISOString(),
        });
        lineage.objects[entry.objectId] = {
          ...current,
          seenRevisionIds: [...new Set([...(current.seenRevisionIds || []), entry.revisionId])].slice(-50),
          pendingDeletion: true,
          tombstone: false,
        };
        conflicts += 1;
        continue;
      }
      let trashedPath = '';
      if (localHash && options.trashRoot) {
        trashedPath = copyThenRemove(target, trashPath(path.resolve(String(options.trashRoot)), publication, entry));
      }
      lineage.objects[entry.objectId] = {
        ...current,
        objectId: entry.objectId,
        kind: entry.kind,
        relativePath: entry.relativePath,
        sha256: entry.sha256,
        version: entry.version,
        tombstone: true,
        pendingDeletion: false,
        trashedPath,
        currentRevisionId: entry.revisionId,
        parentRevisionIds: entry.parentRevisionIds,
        seenRevisionIds: [...new Set([...(current.seenRevisionIds || []), entry.revisionId])],
        sourceNodeId: publication.sourceNodeId,
        localManaged: false,
        updatedAt: publication.createdAt,
      };
      recordPathProvenance(state, entry, publication.sourceNodeId, options.targetNodeId, true);
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
        const branch = availableFilePath(conflictPath(conflictRoot, publication, entry));
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
      localManaged: false,
      tombstone: false,
      updatedAt: publication.createdAt,
    };
    recordPathProvenance(state, entry, publication.sourceNodeId, options.targetNodeId, false);
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
      sourceNodeId: publication.sourceNodeId,
      localManaged: !entry.tombstone,
      tombstone: entry.tombstone,
      updatedAt: publication.createdAt,
    };
    recordPathProvenance(state, entry, publication.sourceNodeId, publication.sourceNodeId, entry.tombstone);
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
  collectStudentArchiveFiles: collectGovernedStudentArchiveFiles,
  createStudentArchivePublication,
  filterLocallyAuthoredStudentArchiveFiles,
  isPublishableLearningReportStatus,
  materializeStudentArchivePublication,
  normalizeState,
  recordPublishedStudentArchive,
  splitStudentArchivePublication,
  validateStudentArchivePublication,
  validateStudentArchiveTargetRoots,
  writeJsonAtomic,
};
