const path = require('node:path');
const { invariant } = require('./project-material-contract.cjs');
const { categoryDefinitions, categoryForWorkspacePath } = require('./project-material-classification.cjs');

function pendingReasons(record, effectiveClassification = record.classification) {
  const reasons = [];
  if (record.adoption?.state === 'candidate') reasons.push('needs_adoption');
  if (!effectiveClassification?.categoryId) reasons.push('needs_classification');
  if (record.availability === 'missing') reasons.push('source_missing');
  if (record.availability === 'unavailable') reasons.push('source_unavailable');
  if (['failed', 'unsupported'].includes(record.processing?.state)) reasons.push('processing_failed');
  return reasons;
}

function projectMaterialWorkspaceView(project, index, query = {}) {
  const offset = Number(query.offset ?? 0);
  const limit = Number(query.limit ?? 50);
  invariant(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit)
    && limit > 0 && limit <= 100, 'invalid_pagination', '资料分页参数无效。');
  const view = String(query.view || 'materials');
  invariant(['materials', 'pending'].includes(view), 'invalid_view', '项目资料视图无效。');
  const search = String(query.search || '').trim().toLocaleLowerCase();
  invariant(search.length <= 120, 'invalid_search', '资料搜索词过长。');
  const categoryId = String(query.categoryId || '');
  // Project folders can be created or renamed directly in Explorer. Project the
  // category list from the current top-level workspace on every read so the UI
  // never remains stuck on the template that existed when the project began.
  const categories = categoryDefinitions(project, index);
  const categoryMap = new Map(categories.map((item) => [item.categoryId, item]));
  const evidenceBindings = new Map((index.evidenceBindings || []).map((item) => [item.bindingId, item]));
  const evidenceByMaterial = new Map();
  for (const evidence of project.studentEvidence || []) {
    const binding = evidenceBindings.get(evidence.sourceBinding?.bindingId);
    for (const source of binding?.materials || []) {
      const values = evidenceByMaterial.get(source.materialId) || [];
      values.push({ studentId: String(evidence.studentId), status: String(evidence.status || 'draft'),
        ability: String(evidence.ability || '') });
      evidenceByMaterial.set(source.materialId, values);
    }
  }
  const allMaterials = (index.materials || []).map((record) => {
    const inferredCategory = !record.classification?.categoryId
      && record.location?.kind === 'workspace' && record.location?.rootId === 'workspace'
      ? categoryForWorkspacePath(record.location.relativePath, categories, project.inboxRelativePath)
      : null;
    const effectiveClassification = inferredCategory ? { ...(record.classification || {}),
      categoryId: inferredCategory.categoryId, source: 'workspace_path', manualLocked: false,
      inferredFromPath: true } : record.classification;
    const category = categoryMap.get(effectiveClassification?.categoryId);
    const reasons = pendingReasons(record, effectiveClassification);
    return {
      materialId: record.materialId, version: record.version, recordRevision: record.recordRevision,
      title: path.posix.basename(record.location.relativePath), logicalPath: record.location.relativePath,
      locationKind: record.location.kind, size: record.size, updatedAt: record.updatedAt || record.createdAt || '',
      availability: record.availability || 'available', adoption: record.adoption?.state || 'candidate',
      organizationState: record.organizationState || 'unclassified',
      classification: { categoryId: effectiveClassification?.categoryId || '',
        categoryName: category?.name || '', source: effectiveClassification?.source || '',
        manualLocked: Boolean(effectiveClassification?.manualLocked),
        inferredFromPath: Boolean(effectiveClassification?.inferredFromPath),
        tags: Array.isArray(effectiveClassification?.tags) ? effectiveClassification.tags : [] },
      processing: { state: record.processing?.state || 'pending',
        processedVersion: record.processing?.processedVersion || 0 },
      pendingReasons: reasons,
      sourceTypes: [...new Set((record.sources || []).map((item) => String(item.type || '')).filter(Boolean))],
      knowledge: (record.links?.knowledge || []).map((item) => ({ knowledgeId: item.knowledgeId,
        version: item.version, commitId: item.commitId })),
      evidence: evidenceByMaterial.get(record.materialId) || [],
    };
  });
  const filtered = allMaterials.filter((item) => (view !== 'pending' || item.pendingReasons.length)
    && (!categoryId || item.classification.categoryId === categoryId)
    && (!search || `${item.title}\n${item.logicalPath}\n${item.classification.categoryName}`.toLocaleLowerCase().includes(search)));
  const knowledge = (index.knowledge || []).filter((item) => item.status !== 'recovery_conflict').map((item) => ({
    knowledgeId: item.knowledgeId, title: path.posix.basename(item.relativePath || item.knowledgeId),
    relativePath: item.relativePath, status: item.status, committedAt: item.committedAt,
    sources: (item.sources || []).map((source) => ({ materialId: source.materialId,
      version: source.version, sha256: source.sha256 })),
  }));
  const contributions = (project.studentEvidence || []).map((item) => {
    const binding = evidenceBindings.get(item.sourceBinding?.bindingId);
    return { studentId: String(item.studentId), ability: String(item.ability || ''),
      observation: String(item.observation || ''), status: String(item.status || 'draft'),
      confidence: String(item.confidence || ''), updatedAt: String(item.updatedAt || ''),
      sources: (binding?.materials || []).map((source) => ({ materialId: source.materialId,
        version: source.version, sha256: source.sha256 })),
      sourceStatus: binding ? 'fixed' : 'unverified' };
  });
  const counts = { materials: allMaterials.length,
    pending: allMaterials.filter((item) => item.pendingReasons.length).length,
    knowledge: knowledge.length, contributions: contributions.length,
    candidates: allMaterials.filter((item) => item.adoption === 'candidate').length,
    unclassified: allMaterials.filter((item) => !item.classification.categoryId).length,
    pathClassified: allMaterials.filter((item) => item.classification.source === 'workspace_path').length,
    unavailable: allMaterials.filter((item) => ['missing', 'unavailable'].includes(item.availability)).length };
  return { projectId: project.id, registryRevision: index.revision, view, counts,
    categories: categories.filter((item) => item.active !== false).map((item) => ({
      categoryId: item.categoryId, name: item.name, relativePath: item.relativePath || '',
      templateSource: item.templateSource || '', templateSlot: item.templateSlot,
    })), total: filtered.length, offset, limit, items: filtered.slice(offset, offset + limit),
    knowledge: knowledge.slice(0, 500), contributions: contributions.slice(0, 500),
    updatedAt: index.updatedAt || '' };
}

module.exports = { projectMaterialWorkspaceView, pendingReasons };
