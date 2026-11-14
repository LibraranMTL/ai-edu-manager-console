'use strict';

const PROJECT_LIST_PROJECTION_SCHEMA = 'edu.project-list-projection.v1';

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringArray(value, limit = 100) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, limit).map((item) => String(item || '')).filter(Boolean);
}

function projectListProjection(project = {}, stagingSummary = {}) {
  const dashboard = project.dashboard && typeof project.dashboard === 'object' ? project.dashboard : {};
  const digestState = project.digestState && typeof project.digestState === 'object' ? project.digestState : {};
  const staging = stagingSummary && typeof stagingSummary === 'object' ? stagingSummary : {};
  const studentIds = stringArray(project.studentIds);
  const studentNames = stringArray(project.studentNames);

  return {
    projectionSchema: PROJECT_LIST_PROJECTION_SCHEMA,
    id: String(project.id || ''),
    name: String(project.name || ''),
    type: String(project.type || ''),
    status: String(project.status || ''),
    studentIds,
    studentNames,
    workspaceTemplateId: project.workspaceTemplateId ? String(project.workspaceTemplateId) : undefined,
    workspaceTemplateName: project.workspaceTemplateName ? String(project.workspaceTemplateName) : undefined,
    workspaceMode: project.workspaceMode ? String(project.workspaceMode) : undefined,
    materialStorageMode: project.materialStorageMode ? String(project.materialStorageMode) : undefined,
    createdAt: project.createdAt ? String(project.createdAt) : undefined,
    updatedAt: project.updatedAt ? String(project.updatedAt) : undefined,
    archivedAt: project.archivedAt ? String(project.archivedAt) : undefined,
    sealedAt: project.sealedAt ? String(project.sealedAt) : undefined,
    publishedAt: project.publishedAt ? String(project.publishedAt) : undefined,
    stagingItemsDeferred: finiteNumber(staging.total) > 0,
    digestState: {
      status: digestState.status ? String(digestState.status) : 'idle',
      pendingCount: finiteNumber(digestState.pendingCount),
      rawFileCount: finiteNumber(digestState.rawFileCount),
      lastDigestAt: digestState.lastDigestAt ? String(digestState.lastDigestAt) : undefined,
      updatedAt: digestState.updatedAt ? String(digestState.updatedAt) : undefined,
    },
    dashboard: {
      rawMaterialCount: finiteNumber(digestState.rawFileCount, finiteNumber(dashboard.rawMaterialCount)),
      knowledgeCount: finiteNumber(dashboard.knowledgeCount),
      indexedKnowledgeCount: finiteNumber(dashboard.indexedKnowledgeCount),
      pendingKnowledgeCount: finiteNumber(dashboard.pendingKnowledgeCount),
      pendingStagingCount: finiteNumber(staging.pending, finiteNumber(dashboard.pendingStagingCount)),
      acceptedStagingCount: finiteNumber(staging.accepted, finiteNumber(dashboard.acceptedStagingCount)),
      contributionReady: Boolean(dashboard.contributionReady),
      contributionStatus: dashboard.contributionStatus ? String(dashboard.contributionStatus) : undefined,
      knowledgeCoverage: finiteNumber(dashboard.knowledgeCoverage),
      riskCount: finiteNumber(dashboard.riskCount),
    },
  };
}

module.exports = { PROJECT_LIST_PROJECTION_SCHEMA, projectListProjection };
