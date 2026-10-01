const path = require('node:path');

const ALLOWED_VIEWER_TYPES = new Set(['admin', 'device', 'student_session']);

function canReadProjectMaterials(auth) {
  return Boolean(auth && ALLOWED_VIEWER_TYPES.has(auth.type)
    && !(auth.type === 'device' && auth.terminalMode === 'shared' && auth.deviceRole !== 'teacher'));
}

function hasFullProjectMaterialScope(auth) {
  return auth?.type === 'admin' || (auth?.type === 'device' && auth.deviceRole === 'teacher');
}

function projectMaterialAccessPolicy(project, auth) {
  const readable = canReadProjectMaterials(auth);
  const writable = readable && project?.materialMigrationState !== 'running'
    && !['sealed', 'archived'].includes(String(project?.status || 'active'));
  const managerDeviceIds = new Set((project?.materialAccess?.managerDeviceIds || []).map(String));
  const formalManager = auth?.type === 'admin'
    || (auth?.type === 'device' && auth.deviceRole === 'teacher'
      && managerDeviceIds.has(String(auth.deviceId || '')));
  const suggestionContributor = auth?.type === 'admin' || auth?.type === 'student_session'
    || (auth?.type === 'device' && auth.deviceRole === 'teacher');
  return { readable, writable, formalManager: writable && formalManager,
    suggestionContributor: writable && suggestionContributor };
}

function visibleMaterialSources(record, auth) {
  if (hasFullProjectMaterialScope(auth)) return Array.isArray(record.sources) ? record.sources : [];
  const allowed = new Set((auth.allowedStudentIds || []).map(String));
  return (Array.isArray(record.sources) ? record.sources : [])
    .filter((source) => !source.studentId || allowed.has(String(source.studentId)));
}

function materialVisibleToViewer(record, auth) {
  if (!canReadProjectMaterials(auth)) return false;
  if (hasFullProjectMaterialScope(auth)) return true;
  const sources = Array.isArray(record.sources) ? record.sources : [];
  // A source-less old registration cannot be scoped reliably to one student.
  return sources.length > 0 && visibleMaterialSources(record, auth).length > 0;
}

function publicMaterial(record, auth) {
  const sources = visibleMaterialSources(record, auth);
  return {
    materialId: String(record.materialId), version: record.version,
    recordRevision: record.recordRevision, title: path.posix.basename(record.location.relativePath),
    size: record.size, updatedAt: record.updatedAt || record.createdAt || '',
    availability: record.availability || 'available',
    adoption: record.adoption?.state || 'candidate',
    organizationState: record.organizationState || 'unclassified',
    classification: { categoryId: record.classification?.categoryId || '',
      tags: Array.isArray(record.classification?.tags) ? record.classification.tags : [] },
    processing: { state: record.processing?.state || 'pending',
      processedVersion: record.processing?.processedVersion || 0 },
    sourceTypes: [...new Set(sources.map((source) => String(source.type || '')).filter(Boolean))],
  };
}

function projectMaterialCapabilities(project, auth, maxUploadBytes) {
  const supported = project?.materialStorageMode === 'workspace-v1';
  const access = projectMaterialAccessPolicy(project, auth);
  const readable = access.readable;
  const writable = access.writable;
  return {
    protocolVersion: 1, storageMode: supported ? 'workspace-v1' : 'legacy',
    projectId: String(project.id), projectStatus: String(project.status || 'active'),
    supported, maxUploadBytes,
    operations: {
      upload: writable, receiptQuery: readable && project.status !== 'sealed', list: supported && readable,
      detail: supported && readable, originalDownload: supported && readable,
      classificationSuggest: supported && access.suggestionContributor,
      classificationWrite: supported && access.formalManager,
      adoptionWrite: supported && access.formalManager,
      knowledgeRead: supported && readable, evidenceRead: supported && readable,
      evidenceConfirm: supported && access.formalManager,
      organizationRead: supported && readable,
      organizationRun: supported && access.formalManager,
      organizationRetry: supported && access.formalManager,
      migrationRead: readable,
    },
  };
}

function publicRemoteProject(project, auth, maxUploadBytes) {
  const allowedStudentIds = new Set((auth?.allowedStudentIds || []).map(String));
  const visibleStudentIds = hasFullProjectMaterialScope(auth)
    ? (project.studentIds || []).map(String)
    : (project.studentIds || []).map(String)
      .filter((studentId) => allowedStudentIds.has(studentId));
  return {
    id: String(project.id), name: String(project.name || project.id),
    status: String(project.status || 'active'),
    studentIds: visibleStudentIds,
    materialStorageMode: project.materialStorageMode === 'workspace-v1' ? 'workspace-v1' : 'legacy',
    materialRegistryVersion: project.materialRegistryVersion || 1,
    materialMigrationState: String(project.materialMigrationState || 'not_started'),
    materialCapabilities: projectMaterialCapabilities(project, auth, maxUploadBytes),
  };
}

function publicUploadReceiptFile(file) {
  const clientRequestId = String(file.uploadId || '');
  return {
    filename: String(file.filename || ''), size: Number(file.size || 0),
    sha1: String(file.sha1 || ''), sha256: String(file.sha256 || ''),
    assetId: String(file.assetId || ''), materialId: String(file.materialId || ''),
    materialVersion: Number(file.materialVersion || 0), uploadId: clientRequestId,
    clientRequestId, receiptId: clientRequestId,
    duplicate: Boolean(file.duplicate), receiptStatus: 'received_verified',
    adoption: String(file.adoption || 'accepted'),
    organizationState: String(file.organizationState || 'unclassified'),
    processing: String(file.processing || 'pending'),
  };
}

function listProjectMaterialsForViewer(index, auth, query = {}) {
  const offset = Number(query.offset ?? 0);
  const limit = Number(query.limit ?? 50);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw Object.assign(new Error('资料分页参数无效。'), { code: 'invalid_pagination' });
  }
  const search = String(query.search || '').trim().toLocaleLowerCase();
  if (search.length > 120) throw Object.assign(new Error('资料搜索词过长。'), { code: 'invalid_search' });
  const adoption = String(query.adoption || '');
  if (adoption && !['candidate', 'accepted', 'excluded'].includes(adoption)) {
    throw Object.assign(new Error('资料采用筛选无效。'), { code: 'invalid_adoption' });
  }
  const categoryId = String(query.categoryId || '');
  if (categoryId.length > 128) throw Object.assign(new Error('资料分类筛选无效。'), { code: 'invalid_category' });
  const records = index.materials.filter((record) => materialVisibleToViewer(record, auth)
    && (!adoption || record.adoption?.state === adoption)
    && (!categoryId || record.classification?.categoryId === categoryId)
    && (!search || path.posix.basename(record.location.relativePath).toLocaleLowerCase().includes(search)));
  return { projectId: index.projectId, registryRevision: index.revision, total: records.length,
    offset, limit, items: records.slice(offset, offset + limit).map((record) => publicMaterial(record, auth)),
    categories: (index.categories || []).map((item) => ({ categoryId: item.categoryId, name: item.name })),
  };
}

module.exports = { canReadProjectMaterials, materialVisibleToViewer, publicMaterial,
  projectMaterialAccessPolicy,
  projectMaterialCapabilities, publicRemoteProject, publicUploadReceiptFile,
  listProjectMaterialsForViewer };
