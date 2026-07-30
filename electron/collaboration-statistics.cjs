const crypto = require('node:crypto');

const MATERIAL_STATS_SCHEMA = 'edu-manager.student-material-stats.v1';

function validDate(value) {
  const date = new Date(value || 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function countSince(items, sinceMs) {
  return items.filter((item) => {
    const date = validDate(item.uploadedAt || item.createdAt || item.capturedAt);
    return date && date.getTime() >= sinceMs;
  }).length;
}

function itemStatus(item) {
  return String(item?.status || item?.governanceStatus || '').trim().toLowerCase();
}

function sourceType(item) {
  return String(item?.sourceType || item?.source || 'local_upload').trim() || 'local_upload';
}

function countBy(items, keyFn) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function buildStudentMaterialStats(input = {}, nowValue = Date.now()) {
  const materials = Array.isArray(input.materials) ? input.materials : [];
  const assets = Array.isArray(input.assets) ? input.assets : [];
  const projects = Array.isArray(input.projects) ? input.projects : [];
  const nowMs = Number(nowValue || Date.now());
  const statuses = materials.map(itemStatus);
  const allowedProjectIds = new Set((Array.isArray(input.allowedProjectIds) ? input.allowedProjectIds : [])
    .map(String)
    .filter(Boolean));
  const projectBreakdown = projects
    .filter((project) => !allowedProjectIds.size || allowedProjectIds.has(String(project.id || '')))
    .map((project) => {
      const projectMaterials = materials.filter((item) => String(item.projectId || '') === String(project.id || ''));
      return {
        projectId: String(project.id || ''),
        projectName: String(project.name || '').slice(0, 120),
        totalCount: projectMaterials.length,
        pendingDigestCount: projectMaterials.filter((item) => ['pending_digest', 'submitted', 'digesting'].includes(itemStatus(item))).length,
        digestedCount: projectMaterials.filter((item) => itemStatus(item) === 'processed').length,
        failedCount: projectMaterials.filter((item) => ['failed', 'invalid', 'missing'].includes(itemStatus(item))).length,
      };
    })
    .filter((item) => item.projectId);

  const snapshot = {
    schema: MATERIAL_STATS_SCHEMA,
    snapshotId: String(input.snapshotId || `stats-${crypto.randomUUID()}`),
    authorityNodeId: String(input.authorityNodeId || ''),
    viewerNodeId: String(input.viewerNodeId || ''),
    studentId: String(input.studentId || ''),
    generatedAt: new Date(nowMs).toISOString(),
    schemaVersion: 1,
    totalCollectedCount: materials.length,
    addedLast24Hours: countSince(materials, nowMs - 24 * 60 * 60 * 1000),
    addedLast7Days: countSince(materials, nowMs - 7 * 24 * 60 * 60 * 1000),
    addedLast30Days: countSince(materials, nowMs - 30 * 24 * 60 * 60 * 1000),
    stagingCount: statuses.filter((status) => ['collected', 'screened', 'staging', 'candidate'].includes(status)).length,
    managedAssetCount: assets.length,
    pendingGovernanceCount: statuses.filter((status) => ['collected', 'screened', 'candidate', 'pending_review'].includes(status)).length,
    pendingDigestCount: statuses.filter((status) => ['pending_digest', 'submitted', 'digesting'].includes(status)).length,
    digestedCount: statuses.filter((status) => status === 'processed').length,
    digestFailedCount: statuses.filter((status) => ['failed', 'invalid', 'missing'].includes(status)).length,
    projectCount: projectBreakdown.length,
    projectBreakdown,
    sourceTypeBreakdown: countBy(materials, sourceType).map(({ key, count }) => ({ sourceType: key, count })),
    dataFreshness: 'live',
  };
  return snapshot;
}

function markStatsFreshness(snapshot, options = {}) {
  const nowMs = Number(options.nowMs || Date.now());
  const staleAfterMs = Math.max(60_000, Number(options.staleAfterMs || 5 * 60 * 1000));
  const generatedAt = Date.parse(String(snapshot?.generatedAt || ''));
  const dataFreshness = !Number.isFinite(generatedAt)
    ? 'unknown'
    : nowMs - generatedAt > staleAfterMs ? 'stale' : 'live';
  return { ...snapshot, dataFreshness };
}

function validateStatsPrivacy(snapshot) {
  const serialized = JSON.stringify(snapshot || {});
  const forbiddenKeys = ['filename', 'filepath', 'absolutepath', 'relativepath', 'content', 'summary', 'rawtext'];
  const leakedKey = forbiddenKeys.find((key) => new RegExp(`"${key}"\\s*:`, 'i').test(serialized));
  return leakedKey
    ? { ok: false, code: 'PRIVATE_FIELD_LEAK', message: `统计快照包含禁止字段：${leakedKey}` }
    : { ok: true };
}

module.exports = {
  MATERIAL_STATS_SCHEMA,
  buildStudentMaterialStats,
  markStatsFreshness,
  validateStatsPrivacy,
};
