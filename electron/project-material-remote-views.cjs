const path = require('node:path');
const crypto = require('node:crypto');
const { materialVisibleToViewer, publicMaterial } = require('./project-material-http.cjs');
const { pendingReasons } = require('./project-material-views.cjs');

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const fullScope = (auth) => auth?.type === 'admin'
  || (auth?.type === 'device' && auth.deviceRole === 'teacher');
const evidenceRevision = (evidence) => crypto.createHash('sha256')
  .update(JSON.stringify(evidence || null)).digest('hex');

function pagination(query) {
  const offset = Number(query.offset ?? 0);
  const limit = Number(query.limit ?? 50);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    fail('invalid_pagination', '资料分页参数无效。');
  }
  const search = String(query.search || '').trim().toLocaleLowerCase();
  if (search.length > 120) fail('invalid_search', '资料搜索词过长。');
  const categoryId = String(query.categoryId || '');
  if (categoryId.length > 128) fail('invalid_category', '资料分类筛选无效。');
  return { offset, limit, search, categoryId };
}

function projectMaterialRemoteView(project, index, auth, query = {}) {
  const view = String(query.view || 'materials');
  if (!['materials', 'pending', 'knowledge', 'contributions'].includes(view)) {
    fail('invalid_view', '项目资料视图无效。');
  }
  const { offset, limit, search, categoryId } = pagination(query);
  const categories = (index.categories || []).filter((item) => item.active !== false);
  const categoryMap = new Map(categories.map((item) => [item.categoryId, item.name]));
  const visibleRecords = (index.materials || []).filter((record) => materialVisibleToViewer(record, auth));
  const visibleIds = new Set(visibleRecords.map((record) => record.materialId));
  const visibleById = new Map(visibleRecords.map((record) => [record.materialId, record]));
  const materials = visibleRecords.map((record) => ({
    ...publicMaterial(record, auth), logicalPath: record.location.relativePath,
    categoryName: categoryMap.get(record.classification?.categoryId) || '',
    pendingReasons: pendingReasons(record),
    knowledge: (record.links?.knowledge || []).map((item) => ({ knowledgeId: item.knowledgeId,
      version: item.version, commitId: item.commitId })),
  }));
  const allowedStudents = new Set((auth?.allowedStudentIds || []).map(String));
  const evidenceBindings = new Map((index.evidenceBindings || []).map((item) => [item.bindingId, item]));
  const knowledge = (index.knowledge || []).filter((item) => item.status !== 'recovery_conflict')
    .map((item) => {
      const sources = (item.sources || []).filter((source) => visibleIds.has(source.materialId));
      if (!fullScope(auth) && !sources.length) return null;
      return { knowledgeId: item.knowledgeId, documentId: item.relativePath,
        title: path.posix.basename(item.relativePath || item.knowledgeId), status: item.status,
        committedAt: item.committedAt || '', sources: sources.map((source) => ({ materialId: source.materialId,
          version: source.version, sha256: source.sha256,
          title: path.posix.basename(visibleById.get(source.materialId)?.location?.relativePath || '已登记资料') })) };
    }).filter(Boolean);
  const contributions = (project.studentEvidence || []).filter((item) => fullScope(auth)
    || allowedStudents.has(String(item.studentId))).map((item) => {
      const binding = evidenceBindings.get(item.sourceBinding?.bindingId);
      const sources = (binding?.materials || []).filter((source) => visibleIds.has(source.materialId));
      return { studentId: String(item.studentId), ability: String(item.ability || ''),
        observation: String(item.observation || ''), status: String(item.status || 'draft'),
        confidence: String(item.confidence || ''), updatedAt: String(item.updatedAt || ''),
        evidenceRevision: evidenceRevision(item),
        sourceStatus: binding && sources.length === (binding.materials || []).length ? 'fixed' : 'restricted',
        sources: sources.map((source) => ({ materialId: source.materialId,
          version: source.version, sha256: source.sha256,
          title: path.posix.basename(visibleById.get(source.materialId)?.location?.relativePath || '已登记资料') })) };
    });
  const filteredMaterials = materials.filter((item) => (view !== 'pending' || item.pendingReasons.length)
    && (!categoryId || item.classification.categoryId === categoryId)
    && (!search || `${item.title}\n${item.logicalPath}\n${item.categoryName}`.toLocaleLowerCase().includes(search)));
  const knowledgeItems = knowledge.filter((item) => !search || item.title.toLocaleLowerCase().includes(search));
  const contributionItems = contributions.filter((item) => !search
    || `${item.ability}\n${item.observation}`.toLocaleLowerCase().includes(search));
  const all = view === 'knowledge' ? knowledgeItems : view === 'contributions' ? contributionItems : filteredMaterials;
  return { projectId: project.id, registryRevision: index.revision, view,
    counts: { materials: materials.length, pending: materials.filter((item) => item.pendingReasons.length).length,
      knowledge: knowledge.length, contributions: contributions.length },
    categories: categories.map((item) => ({ categoryId: item.categoryId, name: item.name })),
    total: all.length, offset, limit, items: all.slice(offset, offset + limit),
    updatedAt: index.updatedAt || '' };
}

module.exports = { projectMaterialRemoteView };
