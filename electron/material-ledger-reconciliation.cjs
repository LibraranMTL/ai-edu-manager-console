const path = require('node:path');

const ACTIVE_STATUSES = new Set(['pending_digest', 'submitted', 'digesting', 'failed']);
const COMPLETED_REVISION_STATUSES = new Set(['processed', 'ignored', 'invalid']);

function text(value) {
  return String(value || '').trim();
}

function mergeMaterialFromUpload(previous, incoming) {
  if (!previous) return { ...incoming };
  const merged = {
    ...previous,
    ...incoming,
    // A verified/manual repair owns the current physical location. Capture
    // updates still own the content fingerprint and capture metadata.
    path: previous.path || incoming.path || '',
    absolutePath: previous.absolutePath || incoming.absolutePath || '',
    pathRepair: previous.pathRepair || incoming.pathRepair,
    size: Number.isFinite(Number(incoming.size)) ? Number(incoming.size) : Number(previous.size || 0),
    sha1: text(incoming.sha1) || text(previous.sha1),
    status: text(incoming.status) || text(previous.status) || 'pending_digest',
    statusUpdatedAt: text(incoming.statusUpdatedAt) || text(previous.statusUpdatedAt),
    digestedAt: text(incoming.digestedAt) || text(previous.digestedAt),
    digestBatchId: text(incoming.digestBatchId) || text(previous.digestBatchId),
  };
  if (!merged.pathRepair) delete merged.pathRepair;
  return merged;
}

function comparablePath(value) {
  if (!value) return '';
  const normalized = path.normalize(String(value)).replace(/\\/g, '/');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function materialPath(record) {
  return comparablePath(record?.absolutePath || record?.path || record?.fileName || record?.filename || '');
}

function reconcileCompletedMaterialRevisions(materials, uploadRecords, options = {}) {
  const nextMaterials = (Array.isArray(materials) ? materials : []).map((item) => ({ ...item }));
  const nextUploadRecords = (Array.isArray(uploadRecords) ? uploadRecords : []).map((item) => ({ ...item }));
  const materialsById = new Map(nextMaterials.map((item) => [text(item.id), item]));
  const uploadsById = new Map(nextUploadRecords.map((item) => [text(item.id), item]));
  const reconciled = [];
  const reconciledAt = text(options.reconciledAt) || new Date().toISOString();

  for (const revision of nextMaterials) {
    const previousId = text(revision.revisionOf);
    const previous = materialsById.get(previousId);
    const revisionStatus = text(revision.status);
    if (!previousId || !previous || !COMPLETED_REVISION_STATUSES.has(revisionStatus)) continue;
    if (!ACTIVE_STATUSES.has(text(previous.status))) continue;
    const revisionSha1 = text(revision.sha1).toLowerCase();
    const previousSha1 = text(previous.sha1).toLowerCase();
    if (!revisionSha1 || revisionSha1 !== previousSha1) continue;
    const previousPath = materialPath(previous);
    const revisionPath = materialPath(revision);
    if (previousPath && revisionPath && previousPath !== revisionPath) continue;

    const statusUpdatedAt = text(revision.statusUpdatedAt) || text(revision.digestedAt) || reconciledAt;
    const settledStatus = 'ignored';
    Object.assign(previous, {
      status: settledStatus,
      statusUpdatedAt,
      digestedAt: text(revision.digestedAt) || statusUpdatedAt,
      digestBatchId: text(revision.digestBatchId) || text(previous.digestBatchId),
      digestDisposition: 'superseded',
      supersededBy: text(revision.id),
      supersededAt: statusUpdatedAt,
    });
    const upload = uploadsById.get(previousId);
    if (upload && ACTIVE_STATUSES.has(text(upload.status))) {
      Object.assign(upload, {
        status: settledStatus,
        statusUpdatedAt,
        digestedAt: previous.digestedAt,
        digestBatchId: previous.digestBatchId,
        digestDisposition: 'superseded',
        supersededBy: text(revision.id),
        supersededAt: statusUpdatedAt,
      });
    }
    reconciled.push({
      materialId: previousId,
      revisionId: text(revision.id),
      status: settledStatus,
      sha1: revisionSha1,
    });
  }

  return { materials: nextMaterials, uploadRecords: nextUploadRecords, reconciled };
}

module.exports = {
  mergeMaterialFromUpload,
  reconcileCompletedMaterialRevisions,
};
