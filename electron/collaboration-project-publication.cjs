const crypto = require('node:crypto');
const path = require('node:path');
const { safeRelativePath } = require('./collaboration-sync.cjs');

const PROJECT_SYNC_PROFILE_SCHEMA = 'edu-manager.project-sync-profile.v1';
const PROJECT_PUBLICATION_SCHEMA = 'edu-manager.project-publication.v1';
const PROJECT_PUBLICATION_STORE_SCHEMA = 'edu-manager.project-publication-store.v1';
const PROJECT_PUBLICATION_MODES = new Set(['snapshot', 'follow', 'contribution']);
const PROJECT_PUBLICATION_SCOPES = new Set(['whole', 'selected']);
const PROJECT_ENTRY_KINDS = new Set(['raw_material', 'knowledge_snapshot', 'source_relation']);
const TRANSFER_RESPONSIBILITIES = new Set(['direct', 'syncthing_compat']);

function compactText(value, limit = 240) {
  return String(value || '').trim().slice(0, limit);
}

function stableId(prefix, ...parts) {
  const hash = crypto.createHash('sha256').update(parts.map((part) => String(part || '').trim()).join('\n')).digest('hex');
  return `${prefix}-${hash.slice(0, 24)}`;
}

function stableProjectLineageId(sourceNodeId, sourceProjectId) {
  if (!compactText(sourceNodeId) || !compactText(sourceProjectId)) {
    throw new Error('项目谱系需要来源节点和来源项目标识。');
  }
  return stableId('lineage', sourceNodeId, sourceProjectId);
}

function stablePublicationObjectId(lineageId, kind, relativePath) {
  const safePath = safeRelativePath(relativePath);
  if (!compactText(lineageId) || !PROJECT_ENTRY_KINDS.has(kind) || !safePath) {
    throw new Error('项目分发对象缺少有效谱系、类型或相对路径。');
  }
  return stableId('project-object', lineageId, kind, safePath.toLowerCase());
}

function normalizeProjectSyncProfile(input = {}) {
  const mode = PROJECT_PUBLICATION_MODES.has(input.mode) ? input.mode : 'snapshot';
  const scope = PROJECT_PUBLICATION_SCOPES.has(input.scope) ? input.scope : 'whole';
  const transferResponsibility = TRANSFER_RESPONSIBILITIES.has(input.transferResponsibility)
    ? input.transferResponsibility
    : 'direct';
  return {
    schema: PROJECT_SYNC_PROFILE_SCHEMA,
    mode,
    scope,
    transferResponsibility,
    includeRawMaterials: input.includeRawMaterials !== false,
    includeVerifiedKnowledge: input.includeVerifiedKnowledge !== false,
    includeSourceRelations: input.includeSourceRelations !== false,
  };
}

function normalizePublicationEntry(input = {}, lineageId = '') {
  const kind = PROJECT_ENTRY_KINDS.has(input.kind) ? input.kind : '';
  const relativePath = safeRelativePath(input.relativePath);
  const sha256 = compactText(input.sha256, 64).toLowerCase();
  const entry = {
    objectId: compactText(input.objectId) || (lineageId && kind && relativePath
      ? stablePublicationObjectId(lineageId, kind, relativePath)
      : ''),
    kind,
    relativePath,
    sha256,
    size: Math.max(0, Number(input.size || 0)),
    knowledgeKind: compactText(input.knowledgeKind, 48),
    sourceAssetIds: [...new Set((Array.isArray(input.sourceAssetIds) ? input.sourceAssetIds : []).map((value) => compactText(value)).filter(Boolean))],
    sourceRelativePaths: [...new Set((Array.isArray(input.sourceRelativePaths) ? input.sourceRelativePaths : []).map(safeRelativePath).filter(Boolean))],
  };
  return entry;
}

function sanitizedProjectSnapshot(input = {}) {
  const workspaceBaseline = (Array.isArray(input.workspaceBaseline) ? input.workspaceBaseline : [])
    .map((item) => ({
      sourceStagingId: compactText(item?.sourceStagingId || item?.id, 160),
      relativePath: safeRelativePath(item?.relativePath),
      filename: compactText(item?.filename, 260),
      sha1: compactText(item?.sha1, 40).toLowerCase(),
      status: compactText(item?.status, 40),
      reviewStatus: compactText(item?.reviewStatus, 40),
      sourceStrategy: compactText(item?.sourceStrategy, 40),
      aiAction: compactText(item?.aiAction, 240),
      aiReason: compactText(item?.aiReason, 1000),
    }))
    .filter((item) => item.relativePath && /^[a-f0-9]{40}$/.test(item.sha1))
    .slice(0, 5000);
  const digestBaseline = (Array.isArray(input.digestBaseline) ? input.digestBaseline : [])
    .map((item) => ({
      relativePath: safeRelativePath(item?.relativePath),
      sha1: compactText(item?.sha1, 40).toLowerCase(),
      digestedAt: compactText(item?.digestedAt, 64),
    }))
    .filter((item) => item.relativePath && /^[a-f0-9]{40}$/.test(item.sha1))
    .slice(0, 5000);
  return {
    name: compactText(input.name, 160),
    type: compactText(input.type, 80),
    description: compactText(input.description, 1200),
    objective: compactText(input.objective, 1200),
    status: compactText(input.status, 40),
    workspaceTemplateId: compactText(input.workspaceTemplateId, 120),
    workspaceTemplateName: compactText(input.workspaceTemplateName, 160),
    knowledgeStrategy: compactText(input.knowledgeStrategy, 800),
    growthStrategy: compactText(input.growthStrategy, 800),
    deliverables: (Array.isArray(input.deliverables) ? input.deliverables : [])
      .map((value) => compactText(value, 240))
      .filter(Boolean)
      .slice(0, 100),
    workspaceBaseline,
    digestBaseline,
  };
}

function createProjectPublication(input = {}) {
  const sourceNodeId = compactText(input.sourceNodeId);
  const sourceProjectId = compactText(input.sourceProjectId);
  const targetNodeId = compactText(input.targetNodeId);
  const lineageId = compactText(input.lineageId) || stableProjectLineageId(sourceNodeId, sourceProjectId);
  const version = Math.max(1, Number(input.version || 1));
  const entries = (Array.isArray(input.entries) ? input.entries : []).map((entry) => normalizePublicationEntry(entry, lineageId));
  return {
    schema: PROJECT_PUBLICATION_SCHEMA,
    publicationId: compactText(input.publicationId) || `publication-${crypto.randomUUID()}`,
    lineageId,
    version,
    sourceNodeId,
    sourceProjectId,
    targetNodeId,
    sourceStudentIds: [...new Set((Array.isArray(input.sourceStudentIds) ? input.sourceStudentIds : []).map((value) => compactText(value)).filter(Boolean))],
    targetStudentIds: [...new Set((Array.isArray(input.targetStudentIds) ? input.targetStudentIds : []).map((value) => compactText(value)).filter(Boolean))],
    profile: normalizeProjectSyncProfile(input.profile),
    project: sanitizedProjectSnapshot(input.project),
    entries,
    createdAt: String(input.createdAt || new Date().toISOString()),
  };
}

function validateProjectPublication(publication, options = {}) {
  const errors = [];
  if (!publication || publication.schema !== PROJECT_PUBLICATION_SCHEMA) errors.push('项目分发协议版本不正确。');
  if (!publication?.publicationId) errors.push('项目分发缺少 publicationId。');
  if (!publication?.lineageId) errors.push('项目分发缺少 lineageId。');
  if (!publication?.sourceNodeId || !publication?.sourceProjectId) errors.push('项目分发缺少来源节点或项目。');
  if (!publication?.targetNodeId || publication?.targetNodeId === publication?.sourceNodeId) errors.push('项目分发目标节点无效。');
  if (options.targetNodeId && publication?.targetNodeId !== options.targetNodeId) errors.push('项目分发目标节点与本机不匹配。');
  if (!publication?.project?.name) errors.push('项目分发缺少项目名称。');
  if (!PROJECT_PUBLICATION_MODES.has(publication?.profile?.mode)) errors.push('项目分发模式无效。');
  if (!PROJECT_PUBLICATION_SCOPES.has(publication?.profile?.scope)) errors.push('项目分发范围无效。');
  if (!TRANSFER_RESPONSIBILITIES.has(publication?.profile?.transferResponsibility)) errors.push('项目传输责任无效。');
  const objectIds = new Set();
  const paths = new Set();
  for (const entry of Array.isArray(publication?.entries) ? publication.entries : []) {
    if (entry.objectId && objectIds.has(entry.objectId)) errors.push(`项目分发对象重复：${entry.objectId}`);
    if (entry.objectId) objectIds.add(entry.objectId);
    if (!entry.objectId || !PROJECT_ENTRY_KINDS.has(entry.kind) || !safeRelativePath(entry.relativePath)) {
      errors.push(`项目分发对象无效：${entry.objectId || entry.relativePath || '未知对象'}`);
      continue;
    }
    if (!/^[a-f0-9]{64}$/.test(entry.sha256 || '')) errors.push(`项目分发对象摘要无效：${entry.relativePath}`);
    const pathKey = `${entry.kind}|${entry.relativePath.toLowerCase()}`;
    if (paths.has(pathKey)) errors.push(`项目分发路径重复：${entry.relativePath}`);
    paths.add(pathKey);
  }
  return { ok: errors.length === 0, errors };
}

function versionedConflictPath(relativePath, publicationId) {
  const safePath = safeRelativePath(relativePath);
  if (!safePath) return '';
  const extension = path.posix.extname(safePath);
  const base = extension ? safePath.slice(0, -extension.length) : safePath;
  const suffix = compactText(publicationId, 36).replace(/[^a-zA-Z0-9_-]+/g, '-') || 'remote';
  return `${base}.来自协作-${suffix}${extension}`;
}

function isVersionedConflictPath(relativePath) {
  const safePath = safeRelativePath(relativePath);
  if (!safePath) return false;
  return path.posix.basename(safePath).includes('.来自协作-');
}

function publicationImportDisposition(entry, existing = {}, publicationId = '') {
  const current = existing[String(entry?.relativePath || '').toLowerCase()];
  if (!current) return { action: 'import', relativePath: entry.relativePath, reason: 'new_path' };
  if (String(current.sha256 || '').toLowerCase() === String(entry?.sha256 || '').toLowerCase()) {
    return { action: 'skip', relativePath: entry.relativePath, reason: 'duplicate_content' };
  }
  return {
    action: 'isolate',
    relativePath: versionedConflictPath(entry.relativePath, publicationId),
    reason: 'path_conflict',
  };
}

function publicationEntryPackagePath(publicationPath, entry) {
  const envelopePath = path.resolve(String(publicationPath || ''));
  const safePath = safeRelativePath(entry?.relativePath);
  if (!envelopePath || !PROJECT_ENTRY_KINDS.has(entry?.kind) || !safePath) return '';
  const packageRoot = path.dirname(envelopePath);
  const candidate = path.resolve(packageRoot, entry.kind, ...safePath.split('/'));
  const relative = path.relative(packageRoot, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return '';
  return candidate;
}

function normalizePublicationStore(input = {}) {
  return {
    schema: PROJECT_PUBLICATION_STORE_SCHEMA,
    publications: input.publications && typeof input.publications === 'object' ? input.publications : {},
    lineages: input.lineages && typeof input.lineages === 'object' ? input.lineages : {},
    updatedAt: String(input.updatedAt || new Date().toISOString()),
  };
}

function recordPublication(storeInput, publication, status, details = {}) {
  const store = normalizePublicationStore(storeInput);
  const now = new Date().toISOString();
  store.publications[publication.publicationId] = {
    publicationId: publication.publicationId,
    lineageId: publication.lineageId,
    version: publication.version,
    sourceNodeId: publication.sourceNodeId,
    targetNodeId: publication.targetNodeId,
    sourceProjectId: publication.sourceProjectId,
    localProjectId: compactText(details.localProjectId),
    status: compactText(status, 40),
    importedCount: Math.max(0, Number(details.importedCount || 0)),
    duplicateCount: Math.max(0, Number(details.duplicateCount || 0)),
    conflictCount: Math.max(0, Number(details.conflictCount || 0)),
    expectedCount: Math.max(0, Number(details.expectedCount || publication.entries?.length || 0)),
    resolvedCount: Math.max(0, Number(details.resolvedCount || 0)),
    contentComplete: Boolean(details.contentComplete),
    materializationVersion: Math.max(0, Number(details.materializationVersion || 0)),
    updatedAt: now,
  };
  store.lineages[publication.lineageId] = {
    ...(store.lineages[publication.lineageId] || {}),
    lineageId: publication.lineageId,
    latestVersion: Math.max(Number(store.lineages[publication.lineageId]?.latestVersion || 0), publication.version),
    localProjectId: compactText(details.localProjectId) || compactText(store.lineages[publication.lineageId]?.localProjectId),
    updatedAt: now,
  };
  store.updatedAt = now;
  return store;
}

function dismissProjectLineage(storeInput, lineageId, details = {}) {
  const store = normalizePublicationStore(storeInput);
  const normalizedLineageId = compactText(lineageId);
  if (!normalizedLineageId) return store;
  const now = String(details.dismissedAt || new Date().toISOString());
  store.lineages[normalizedLineageId] = {
    ...(store.lineages[normalizedLineageId] || {}),
    lineageId: normalizedLineageId,
    localProjectId: '',
    localDisposition: 'dismissed',
    dismissedAt: now,
    dismissedProjectName: compactText(details.projectName, 160),
    updatedAt: now,
  };
  store.updatedAt = now;
  return store;
}

function restoreProjectLineage(storeInput, lineageId, details = {}) {
  const store = normalizePublicationStore(storeInput);
  const normalizedLineageId = compactText(lineageId);
  if (!normalizedLineageId || !store.lineages[normalizedLineageId]) return store;
  const now = String(details.restoredAt || new Date().toISOString());
  store.lineages[normalizedLineageId] = {
    ...store.lineages[normalizedLineageId],
    localProjectId: compactText(details.localProjectId) || compactText(store.lineages[normalizedLineageId].localProjectId),
    localDisposition: 'active',
    dismissedAt: '',
    restoredAt: now,
    updatedAt: now,
  };
  store.updatedAt = now;
  return store;
}

function isProjectLineageDismissed(storeInput, lineageId) {
  const store = normalizePublicationStore(storeInput);
  return store.lineages[compactText(lineageId)]?.localDisposition === 'dismissed';
}

module.exports = {
  PROJECT_ENTRY_KINDS,
  PROJECT_PUBLICATION_MODES,
  PROJECT_PUBLICATION_SCHEMA,
  PROJECT_PUBLICATION_SCOPES,
  PROJECT_PUBLICATION_STORE_SCHEMA,
  PROJECT_SYNC_PROFILE_SCHEMA,
  TRANSFER_RESPONSIBILITIES,
  createProjectPublication,
  dismissProjectLineage,
  isVersionedConflictPath,
  isProjectLineageDismissed,
  normalizeProjectSyncProfile,
  normalizePublicationEntry,
  normalizePublicationStore,
  publicationEntryPackagePath,
  publicationImportDisposition,
  recordPublication,
  restoreProjectLineage,
  stableProjectLineageId,
  stablePublicationObjectId,
  validateProjectPublication,
  versionedConflictPath,
};
