const path = require('node:path');
const { validateRegistry } = require('./project-materials.cjs');

function projectStagingProjection(project, index, legacyItems = []) {
  validateRegistry(index, project.id);
  const records = index.materials.filter((item) => item.adoption.state !== 'accepted'
    || ['missing', 'unavailable'].includes(item.availability)
    || (item.sources || []).some((source) => source.type === 'staging_import'));
  const annotationsById = new Map(legacyItems.map((item) => [String(item.id), item]));
  const pathKey = (value) => process.platform === 'win32' ? value.toLowerCase() : value;
  const annotationsByPath = new Map(legacyItems.filter((item) => item.sourcePath || item.path)
    .map((item) => [pathKey(String(item.sourcePath || item.path)), item]));
  const projected = records.map((item) => {
    const root = item.location.kind === 'workspace' ? project.workspacePath
      : item.location.kind === 'legacy_raw' ? project.rawPath
        : item.location.rootId === 'legacy-staging' ? project.stagingPath : '';
    const filePath = root ? path.join(root, ...item.location.relativePath.split('/')) : '';
    const annotation = annotationsById.get(item.materialId)
      || (filePath ? annotationsByPath.get(pathKey(filePath)) : null) || {};
    const state = item.adoption.state;
    return {
      id: item.materialId, materialId: item.materialId, materialVersion: item.version,
      recordRevision: item.recordRevision, filename: path.posix.basename(item.location.relativePath),
      path: filePath, sourcePath: filePath, size: item.size, mtimeMs: item.mtimeMs || 0,
      sourceAvailability: item.availability || 'available',
      sha1: item.sha1 || '', status: state === 'accepted' ? 'promoted'
        : state === 'excluded' ? 'discarded' : 'collected',
      sourceStrategy: 'reference_only', reviewStatus: state === 'accepted' ? 'accepted'
        : state === 'excluded' ? 'rejected' : 'pending',
      reviewNote: item.adoption.reason || '', reviewedAt: item.adoption.decidedAt || '',
      promotedAssetId: (item.links?.assets || []).find((link) => link.version === item.version)?.assetId || '',
      addedAt: item.createdAt || '', updatedAt: item.updatedAt || '',
      locationKind: item.location.kind,
      aiAction: annotation.aiAction || '', aiReason: annotation.aiReason || '',
      aiScore: annotation.aiScore ?? '', aiReviewedAt: annotation.aiReviewedAt || '',
      governanceAction: annotation.governanceAction || '', governanceReason: annotation.governanceReason || '',
      duplicateCount: annotation.duplicateCount || 1,
    };
  });
  const ids = new Set(records.map((item) => item.materialId));
  const paths = new Set(projected.filter((item) => item.path).map((item) => pathKey(item.path)));
  return [...projected, ...legacyItems.filter((item) => {
    const key = String(item.sourcePath || item.path || '');
    return !ids.has(item.id) && !paths.has(pathKey(key));
  })];
}

module.exports = { projectStagingProjection };
