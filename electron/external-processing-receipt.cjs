'use strict';
const crypto = require('node:crypto');
function projectKnowledgeRefs(material, registry, projectId) {
  if (material?.adoption?.state !== 'accepted' || ['missing', 'unavailable'].includes(material?.availability)) return [];
  return (material?.links?.knowledge || []).filter(link => link.version === material.version).slice(0, 50).flatMap(link => {
    const item = (registry?.knowledge || []).find(k => k.knowledgeId === link.knowledgeId && k.status === 'committed'
      && k.sources?.some(s => s.materialId === material.materialId && s.version === material.version && s.sha256 === material.sha256));
    return item ? [{ knowledgeId: item.knowledgeId, projectId, relativePath: item.relativePath, sha256: item.sha256,
      uri: `edu://project/${encodeURIComponent(projectId)}/knowledge/${encodeURIComponent(item.relativePath)}` }] : [];
  });
}
function refsFingerprint(refs) { return crypto.createHash('sha256').update(JSON.stringify(refs)).digest('hex'); }
function verifiedIndex(refs, result) {
  if (!refs.length) return { status: 'unverified', reason: 'source_links_unavailable' };
  if (!result?.ok) return { status: 'unavailable', reason: result?.code || 'query_unavailable' };
  const resources = result.result?.resources || result.resources || [];
  const hits = ['cached', 'offline_snapshot'].includes(result.freshness) ? [] : refs.filter(ref => resources.some(r => String(r.projectId || (r.scopeType === 'project' ? r.scopeId : '')) === ref.projectId && r.relativePath === ref.relativePath && !['cached', 'offline_snapshot'].includes(r.freshness)));
  return { status: hits.length ? 'query_verified' : 'no_evidence', evidence: hits.map(r => r.uri), refsFingerprint: refsFingerprint(refs), checkedAt: new Date().toISOString() };
}
module.exports = { projectKnowledgeRefs, refsFingerprint, verifiedIndex };
