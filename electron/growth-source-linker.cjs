const crypto = require('node:crypto');
const path = require('node:path');
const { fixedEvidenceProjection, bindingMatchesEvidence } = require('./project-evidence-reference.cjs');

const SYSTEM_GROWTH_RULE_VERSION = 'p5-growth-link-v1';

function stableId(prefix, value) {
  return `${prefix}-${crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, 16)}`;
}

function summarizeArtifactText(content, fallback = '') {
  const summary = String(content || '')
    .replace(/^\uFEFF/u, '')
    .replace(/^---[\s\S]*?---\s*/u, '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !/^[-|: ]+$/u.test(line))
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return (summary || String(fallback || '')).slice(0, 500);
}

function governedStudentGrowthCandidates(options = {}) {
  const studentId = String(options.studentId || '');
  const run = options.run || {};
  if (!studentId || String(run.scope?.type || '') !== 'student' || String(run.scope?.id || '') !== studentId) return [];
  return (Array.isArray(run.artifacts) ? run.artifacts : [])
    .filter((artifact) => artifact?.riskLevel === 'low'
      && artifact?.decision === 'accepted_internal'
      && artifact?.exists !== false
      && Array.isArray(artifact?.sourceMaterialIds)
      && artifact.sourceMaterialIds.length > 0)
    .map((artifact) => {
      const sourcePath = String(artifact.path || '');
      const title = String(options.titleForArtifact?.(artifact) || path.basename(sourcePath, path.extname(sourcePath)) || '学习资料处理结果');
      const content = summarizeArtifactText(options.contentForArtifact?.(artifact), title);
      return {
        id: stableId('system-growth', `${studentId}|${artifact.id || sourcePath}`),
        studentId,
        title,
        content,
        ability: String(options.defaultAbility || '知识理解与整理'),
        sourcePath,
        status: 'watching',
        confidence: '系统验证·继续观察',
        epistemicType: 'observation',
        sourceKind: 'governed_knowledge_asset',
        systemVerification: {
          ruleVersion: SYSTEM_GROWTH_RULE_VERSION,
          decision: 'system_verified_observation',
          governanceRunId: String(run.runId || ''),
          batchId: String(run.batchId || ''),
          sourceMaterialIds: artifact.sourceMaterialIds.map(String),
          artifactId: String(artifact.id || ''),
          verifiedAt: String(run.completedAt || ''),
        },
        createdAt: String(run.completedAt || ''),
        updatedAt: String(run.completedAt || ''),
      };
    });
}

function projectStudentGrowthCandidates(options = {}) {
  const studentId = String(options.studentId || '');
  if (!studentId) return [];
  const candidates = [];
  for (const project of Array.isArray(options.projects) ? options.projects : []) {
    if (!(Array.isArray(project?.studentIds) ? project.studentIds : []).map(String).includes(studentId)) continue;
    for (const evidence of Array.isArray(project?.studentEvidence) ? project.studentEvidence : []) {
      if (String(evidence?.studentId || '') !== studentId) continue;
      const sourcePaths = (Array.isArray(evidence?.sourcePaths) ? evidence.sourcePaths : []).map(String).filter(Boolean);
      if (!sourcePaths.length || !String(evidence?.observation || '').trim()) continue;
      const fixed = project.materialStorageMode === 'workspace-v1' || Boolean(evidence.sourceBinding);
      const reference = fixedEvidenceProjection({ ...evidence, requiresProjectConfirmation: fixed });
      const bound = reference.sourceBinding?.projectId === String(project.id) && reference.sourceBinding?.studentId === studentId
        && bindingMatchesEvidence(reference.sourceBinding, evidence);
      candidates.push({
        id: `project-student-${String(project.id || '')}-${studentId}`,
        studentId,
        title: `${String(project.name || '学习项目')}·${String(evidence.ability || '成长观察')}`,
        content: String(evidence.observation || ''),
        ability: String(evidence.ability || '待标注'),
        projectId: String(project.id || ''),
        projectName: String(project.name || ''),
        sourcePath: fixed ? '' : sourcePaths.join('；'),
        ...(fixed ? reference : {}),
        status: fixed ? evidence.status === 'rejected' ? 'rejected' : bound && ['verified', 'published'].includes(evidence.status) ? 'confirmed' : 'pending' : 'watching',
        confidence: String(evidence.confidence || '项目证据·继续观察'),
        epistemicType: 'observation',
        sourceKind: 'project_student_evidence',
        systemVerification: {
          ruleVersion: SYSTEM_GROWTH_RULE_VERSION,
          decision: 'project_evidence_observation',
          sourceMaterialIds: [],
          sourcePaths: fixed ? [] : sourcePaths,
          verifiedAt: String(evidence.updatedAt || project.updatedAt || ''),
        },
        createdAt: String(evidence.createdAt || evidence.updatedAt || project.updatedAt || ''),
        updatedAt: String(evidence.updatedAt || project.updatedAt || ''),
      });
    }
  }
  return candidates;
}

function mergeGrowthCandidates(review = {}, candidates = []) {
  const next = {
    version: Number(review.version || 1),
    updatedAt: String(review.updatedAt || ''),
    candidates: (Array.isArray(review.candidates) ? review.candidates : []).map((item) => ({ ...item })),
  };
  const byId = new Map(next.candidates.map((item, index) => [String(item.id || ''), index]));
  let added = 0;
  let updated = 0;
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const id = String(candidate?.id || '');
    if (!id) continue;
    const index = byId.get(id);
    if (index === undefined) {
      byId.set(id, next.candidates.length);
      next.candidates.unshift({ ...candidate });
      for (const [knownId, knownIndex] of byId.entries()) {
        if (knownId !== id) byId.set(knownId, knownIndex + 1);
      }
      byId.set(id, 0);
      added += 1;
      continue;
    }
    const existing = next.candidates[index];
    const fixed = Boolean(candidate.requiresProjectConfirmation);
    const sameBinding = fixed && candidate.sourceBinding?.bindingId && candidate.sourceBinding.bindingId === existing.sourceBinding?.bindingId;
    const protectedStatus = ['confirmed', 'rejected'].includes(String(existing.status));
    const merged = {
      ...existing,
      ...candidate,
      status: !fixed && protectedStatus ? existing.status : candidate.status,
      ...(fixed ? { sourceMaterials: sameBinding ? fixedEvidenceProjection(existing).sourceMaterials : candidate.sourceMaterials || [] } : {}),
      createdAt: existing.createdAt || candidate.createdAt || '',
    };
    if (JSON.stringify(existing) !== JSON.stringify(merged)) {
      next.candidates[index] = merged;
      updated += 1;
    }
  }
  return { review: next, added, updated, changed: added > 0 || updated > 0 };
}

module.exports = {
  SYSTEM_GROWTH_RULE_VERSION,
  governedStudentGrowthCandidates,
  mergeGrowthCandidates,
  projectStudentGrowthCandidates,
  stableId,
  summarizeArtifactText,
};
