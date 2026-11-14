'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { projectMaterialRecordKind } = require('./project-material-automation.cjs');

const POLICY_VERSION = 'project-report-m1-v1';

function text(value) { return String(value ?? '').trim(); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}
function stableJson(value) { return JSON.stringify(canonical(value)); }
function sha256(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : stableJson(value)).digest('hex'); }
function reportArtifact(relativePath) {
  return /(^|\/)(项目报告|报告导出|report-revisions?|exports?|task-receipts?)(\/|$)/i.test(text(relativePath).replaceAll('\\', '/'));
}
function projectRevision(project) { return Number(project?.revision || 0); }
function registryRevision(registry) { return Number(registry?.revision || 0); }
function projectReadIdentity(project) { return sha256({ id: project?.id || project?.projectId, revision: projectRevision(project),
  name: project?.name, type: project?.type, status: project?.status, objective: project?.objective, description: project?.description,
  deliverables: project?.deliverables || [], successCriteria: project?.successCriteria || [],
  studentIds: project?.studentIds || [], studentEvidence: project?.studentEvidence || [] }); }
function registryReadIdentity(registry) { return sha256({ projectId: registry?.projectId, revision: registryRevision(registry),
  updatedAt: registry?.updatedAt, materials: registry?.materials || [], knowledge: registry?.knowledge || [],
  evidenceBindings: registry?.evidenceBindings || [] }); }
function activeAvailability(value) { return !['missing', 'unavailable', 'withdrawn', 'forbidden'].includes(text(value)); }
function materialEvidence(projectId, record) {
  const relativePath = text(record?.location?.relativePath).replaceAll('\\', '/');
  const availability = activeAvailability(record?.availability) && record?.adoption?.state === 'accepted' ? 'active'
    : ['missing', 'unavailable'].includes(text(record?.availability)) ? text(record.availability) : 'pending';
  const hash = /^[a-f0-9]{64}$/i.test(text(record?.sha256)) ? text(record.sha256).toLowerCase()
    : sha256({ projectId, materialId: record?.materialId, version: record?.version, relativePath });
  return {
    evidenceId: `evidence-material-${sha256(`${projectId}\n${text(record?.materialId)}\n${Number(record?.version || 1)}`).slice(0, 24)}`,
    citationId: `citation-material-${sha256(`${projectId}\n${text(record?.materialId)}\n${Number(record?.version || 1)}`).slice(0, 24)}`,
    sourceType: 'project_material', sourceId: text(record?.materialId), revision: String(Math.max(1, Number(record?.version || 1))),
    contentHash: hash, availability, audience: ['admin', 'student', 'teacher'],
    locator: { kind: 'file', logicalPath: relativePath || text(record?.materialId) },
    title: path.posix.basename(relativePath || text(record?.materialId)),
    adopted: record?.adoption?.state === 'accepted', processingState: text(record?.processing?.state || 'pending'),
    updatedAt: text(record?.updatedAt || record?.createdAt),
  };
}
function knowledgeEvidence(projectId, item) {
  const relativePath = text(item?.relativePath).replaceAll('\\', '/');
  const active = ['verified', 'accepted', 'committed', 'published'].includes(text(item?.status));
  return {
    evidenceId: `evidence-knowledge-${sha256(`${projectId}\n${text(item?.knowledgeId)}`).slice(0, 24)}`,
    citationId: `citation-knowledge-${sha256(`${projectId}\n${text(item?.knowledgeId)}`).slice(0, 24)}`,
    sourceType: 'project_knowledge', sourceId: text(item?.knowledgeId), revision: text(item?.version || item?.committedAt || '1'),
    contentHash: /^[a-f0-9]{64}$/i.test(text(item?.contentHash)) ? text(item.contentHash).toLowerCase()
      : sha256({ projectId, knowledgeId: item?.knowledgeId, status: item?.status, sources: item?.sources || [] }),
    availability: active ? 'active' : 'pending', audience: ['admin', 'student', 'teacher'],
    locator: { kind: 'knowledge', logicalPath: relativePath || text(item?.knowledgeId) },
    title: path.posix.basename(relativePath || text(item?.knowledgeId)), status: text(item?.status),
    sources: (Array.isArray(item?.sources) ? item.sources : []).map((source) => ({
      materialId: text(source?.materialId), version: Number(source?.version || 1), sha256: text(source?.sha256),
    })),
  };
}

async function buildProjectReportSnapshot({ projectId, asOf = new Date().toISOString(), timezone = 'Asia/Shanghai',
  authorizationVersion = 'local-admin-v1', policyVersion = POLICY_VERSION, pageSize = 100, loadProject, loadRegistry } = {}) {
  projectId = text(projectId);
  if (!projectId || typeof loadProject !== 'function' || typeof loadRegistry !== 'function') {
    throw Object.assign(new Error('项目快照范围或读取器缺失。'), { code: 'project_report_snapshot_invalid' });
  }
  if (!Number.isFinite(Date.parse(asOf))) throw Object.assign(new Error('项目快照截止时间无效。'), { code: 'project_report_snapshot_invalid' });
  pageSize = Math.max(1, Math.min(250, Number(pageSize) || 100));
  const beforeProject = await loadProject();
  const beforeRegistry = await loadRegistry();
  if (text(beforeProject?.id || beforeProject?.projectId) !== projectId || text(beforeRegistry?.projectId) !== projectId) {
    throw Object.assign(new Error('项目快照主体范围不一致。'), { code: 'subject_scope_forbidden' });
  }
  const materials = (Array.isArray(beforeRegistry.materials) ? beforeRegistry.materials : [])
    .filter((item) => projectMaterialRecordKind(item) === 'user_material' && !reportArtifact(item?.location?.relativePath));
  const knowledge = (Array.isArray(beforeRegistry.knowledge) ? beforeRegistry.knowledge : [])
    .filter((item) => !reportArtifact(item?.relativePath) && text(item?.status) !== 'recovery_conflict');
  const evidence = [];
  for (let offset = 0; offset < materials.length; offset += pageSize) {
    for (const item of materials.slice(offset, offset + pageSize)) evidence.push(materialEvidence(projectId, item));
    await Promise.resolve();
  }
  for (let offset = 0; offset < knowledge.length; offset += pageSize) {
    for (const item of knowledge.slice(offset, offset + pageSize)) evidence.push(knowledgeEvidence(projectId, item));
    await Promise.resolve();
  }
  const projectEvidence = {
    evidenceId: `evidence-project-${sha256(projectId).slice(0, 24)}`, citationId: `citation-project-${sha256(projectId).slice(0, 24)}`,
    sourceType: 'project_metadata', sourceId: projectId, revision: String(Math.max(1, projectRevision(beforeProject))),
    contentHash: sha256({ name: beforeProject.name, type: beforeProject.type, status: beforeProject.status,
      objective: beforeProject.objective, description: beforeProject.description, deliverables: beforeProject.deliverables || [] }),
    availability: 'active', audience: ['admin', 'student', 'teacher'], locator: { kind: 'record' }, title: text(beforeProject.name),
  };
  const registryEvidence = {
    evidenceId: `evidence-registry-${sha256(`${projectId}\n${registryRevision(beforeRegistry)}`).slice(0, 24)}`,
    citationId: `citation-registry-${sha256(`${projectId}\n${registryRevision(beforeRegistry)}`).slice(0, 24)}`,
    sourceType: 'project_material_registry', sourceId: projectId, revision: String(registryRevision(beforeRegistry)),
    contentHash: sha256(evidence.map((item) => ({ sourceType: item.sourceType, sourceId: item.sourceId,
      revision: item.revision, contentHash: item.contentHash, availability: item.availability }))),
    availability: 'active', audience: ['admin', 'student', 'teacher'], locator: { kind: 'record' }, title: '项目资料登记快照',
  };
  evidence.unshift(projectEvidence, registryEvidence);
  const evidenceByMaterial = new Map(evidence.filter((item) => item.sourceType === 'project_material')
    .map((item) => [`${item.sourceId}:${item.revision}`, item]));
  const bindings = new Map((Array.isArray(beforeRegistry.evidenceBindings) ? beforeRegistry.evidenceBindings : [])
    .map((item) => [text(item?.bindingId), item]));
  const confirmedContributions = (Array.isArray(beforeProject.studentEvidence) ? beforeProject.studentEvidence : []).flatMap((item) => {
    if (!['verified', 'published'].includes(text(item?.status))) return [];
    const binding = bindings.get(text(item?.sourceBinding?.bindingId));
    const evidenceIds = (Array.isArray(binding?.materials) ? binding.materials : []).flatMap((source) => {
      const found = evidenceByMaterial.get(`${text(source?.materialId)}:${String(Math.max(1, Number(source?.version || 1)))}`);
      return found?.availability === 'active' ? [found.evidenceId] : [];
    });
    if (!evidenceIds.length) return [];
    const confirmationHash = sha256({ studentId: item.studentId, status: item.status, ability: item.ability,
      observation: item.observation, sourceBinding: item.sourceBinding });
    const confirmation = {
      evidenceId: `evidence-contribution-${confirmationHash.slice(0, 24)}`, citationId: `citation-contribution-${confirmationHash.slice(0, 24)}`,
      sourceType: 'project_contribution_confirmation', sourceId: `${projectId}:${text(item.studentId)}`,
      revision: text(item.updatedAt || beforeProject.revision || '1'), contentHash: confirmationHash, availability: 'active',
      audience: ['admin', 'student', 'teacher'], locator: { kind: 'record' }, title: `${text(item.studentId)} 的已确认贡献`,
      studentId: text(item.studentId),
    };
    evidence.push(confirmation);
    return [{ studentId: text(item.studentId), ability: text(item.ability), observation: text(item.observation),
      status: text(item.status), evidenceIds: [confirmation.evidenceId, ...evidenceIds] }];
  });
  const activeMaterials = evidence.filter((item) => item.sourceType === 'project_material' && item.availability === 'active');
  const representativeEvidenceIds = activeMaterials.slice().sort((left, right) => {
    const score = (item) => /(^|\/)(最终成果|成果|deliverables?)(\/|$)/i.test(item.locator.logicalPath) ? 0 : 1;
    return score(left) - score(right) || right.revision.localeCompare(left.revision) || left.sourceId.localeCompare(right.sourceId);
  }).slice(0, 3).map((item) => item.evidenceId);
  const afterProject = await loadProject();
  const afterRegistry = await loadRegistry();
  if (projectReadIdentity(beforeProject) !== projectReadIdentity(afterProject)
    || registryReadIdentity(beforeRegistry) !== registryReadIdentity(afterRegistry)
    || text(afterProject?.id || afterProject?.projectId) !== projectId || text(afterRegistry?.projectId) !== projectId) {
    throw Object.assign(new Error('读取期间项目资料发生变化，已放弃混合快照。'), { code: 'project_report_snapshot_changed' });
  }
  const projectProjection = { name: text(beforeProject.name), type: text(beforeProject.type), status: text(beforeProject.status || 'active'),
    objective: text(beforeProject.objective), description: text(beforeProject.description),
    deliverables: Array.isArray(beforeProject.deliverables) ? beforeProject.deliverables.map(text).filter(Boolean) : [],
    successCriteria: Array.isArray(beforeProject.successCriteria) ? beforeProject.successCriteria : [] };
  const members = (Array.isArray(beforeProject.studentIds) ? beforeProject.studentIds : []).map((studentId) => ({ studentId: text(studentId) })).filter((item) => item.studentId);
  const coverage = {
    materials: { total: materials.length, analyzed: materials.length,
      unavailable: activeMaterials.length === materials.length ? 0 : evidence.filter((item) => item.sourceType === 'project_material' && ['missing','unavailable'].includes(item.availability)).length,
      pending: evidence.filter((item) => item.sourceType === 'project_material' && item.availability === 'pending').length },
    knowledge: { total: knowledge.length, analyzed: knowledge.length,
      pending: evidence.filter((item) => item.sourceType === 'project_knowledge' && item.availability !== 'active').length },
    contributions: { confirmed: confirmedContributions.length,
      unconfirmed: Math.max(0, (Array.isArray(beforeProject.studentEvidence) ? beforeProject.studentEvidence.length : 0) - confirmedContributions.length) },
  };
  const fingerprintInput = { projectId, projectRevision: projectRevision(beforeProject), registryRevision: registryRevision(beforeRegistry),
    authorizationVersion, project: projectProjection, members, evidence: evidence.map((item) => ({ sourceType: item.sourceType,
      sourceId: item.sourceId, revision: item.revision, contentHash: item.contentHash, availability: item.availability })), confirmedContributions };
  const inputFingerprint = sha256(fingerprintInput);
  return {
    snapshotId: `project-report-snapshot-${inputFingerprint.slice(0, 24)}`, projectId, asOf: new Date(asOf).toISOString(), timezone,
    policyVersion, authorizationVersion: text(authorizationVersion), projectRevision: projectRevision(beforeProject),
    registryRevision: registryRevision(beforeRegistry), inputFingerprint, project: projectProjection, members, coverage,
    evidence, representativeEvidenceIds, confirmedContributions,
  };
}

module.exports = { POLICY_VERSION, buildProjectReportSnapshot, stableJson, sha256 };

