// Transport only identity and immutable versions. Paths remain display-only.
const BINDING_SCHEMA = 'edu-manager.project-evidence-binding.v1';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { relativeMaterialPath, invariant } = require('./project-material-contract.cjs');
const { validateEvidenceBindingMetadata, evidenceHash } = require('./project-material-evidence.cjs');
const { archivedReportEvidence } = require('./report-evidence-archive.cjs');
function fixedEvidenceProjection(item = {}) {
  const binding = item.sourceBinding;
  const valid = binding && binding.schema === BINDING_SCHEMA
    && typeof binding.projectId === 'string' && binding.projectId
    && typeof binding.studentId === 'string' && binding.studentId
    && /^evidence-binding-[a-f0-9]{64}$/.test(binding.bindingId || '')
    && /^[a-f0-9]{64}$/.test(binding.evidenceHash || '');
  return {
    requiresProjectConfirmation: Boolean(item.requiresProjectConfirmation || binding),
    sourceBinding: valid ? { schema: BINDING_SCHEMA, projectId: binding.projectId, studentId: binding.studentId,
      bindingId: binding.bindingId, evidenceHash: binding.evidenceHash } : null,
    sourceMaterials: (Array.isArray(item.sourceMaterials) ? item.sourceMaterials : []).map((ref) => ({
      materialId: String(ref?.materialId || ''), version: ref?.version, sha256: String(ref?.sha256 || ''),
    })),
  };
}
function requiresFixedReportEvidence(evidence, projects = []) {
  return Boolean(evidence?.requiresProjectConfirmation || evidence?.sourceBinding
    || projects.some((project) => String(project.id) === String(evidence?.projectId) && project.materialStorageMode === 'workspace-v1'));
}
function bindingMatchesEvidence(binding, evidence) {
  return Boolean(binding && evidenceHash(binding.projectId, binding.studentId, evidence) === binding.evidenceHash);
}
function fixedSnapshotPath(root, relative) {
  const file = path.resolve(root, relativeMaterialPath(relative));
  for (let current = file; ; current = path.dirname(current)) {
    invariant(!fs.lstatSync(current).isSymbolicLink(), 'linked_path', '证据快照路径包含链接。');
    if (current === path.dirname(current)) break;
  }
  invariant(fs.statSync(file).isFile(), 'source_unavailable', '证据快照不是文件。');
  return file;
}
function verifyFixedEvidenceFile(source, budget = { remaining: 256 * 1024 * 1024 }) {
  const file = fixedSnapshotPath(source.root, source.relativePath);
  const handle = fs.openSync(file, 'r');
  try {
    const before = fs.fstatSync(handle);
    invariant(before.size <= 64 * 1024 * 1024 && before.size <= budget.remaining, 'source_limit', '固定证据读取超限。');
    budget.remaining -= before.size;
    const hash = crypto.createHash('sha256'); const buffer = Buffer.alloc(64 * 1024); let total = 0;
    for (;;) {
      const count = fs.readSync(handle, buffer, 0, buffer.length, null); if (!count) break;
      total += count; invariant(total <= before.size, 'source_changed', '固定证据读取期间变化。'); hash.update(buffer.subarray(0, count));
    }
    const after = fs.fstatSync(handle), named = fs.statSync(fixedSnapshotPath(source.root, source.relativePath));
    invariant(total === before.size && ['ino', 'dev', 'size', 'mtimeMs', 'ctimeMs'].every((key) => before[key] === after[key] && after[key] === named[key])
      && hash.digest('hex') === source.sha256, 'source_changed', '固定证据版本校验失败。');
    return true;
  } finally { fs.closeSync(handle); }
}
function resolveFixedEvidenceSources({ studentId, project, evidence, index, verifyBytes = false, budget }) {
  const reference = fixedEvidenceProjection(evidence).sourceBinding;
  invariant(reference && reference.studentId === String(studentId) && reference.projectId === String(project?.id)
    && project.materialStorageMode === 'workspace-v1' && project.studentIds?.map(String).includes(String(studentId)), 'forbidden', '固定证据不在当前学生项目范围。');
  const current = project.studentEvidence?.find((item) => String(item.studentId) === String(studentId));
  invariant(current && current.sourceBinding?.bindingId === reference.bindingId && current.sourceBinding?.evidenceHash === reference.evidenceHash
    && evidenceHash(project.id, String(studentId), current) === reference.evidenceHash
    && String(evidence.content || evidence.observation || '') === String(current.observation || '')
    && String(evidence.ability || '') === String(current.ability || '')
    && String(evidence.confidence || '') === String(current.confidence || ''), 'evidence_changed', '成长记录与已确认个人证据不一致。');
  const binding = index.evidenceBindings?.find((item) => item.bindingId === reference.bindingId);
  validateEvidenceBindingMetadata(project, binding, current, index);
  return bindingSources(project, binding, index, verifyBytes, budget);
}
function bindingSources(project, binding, index, verifyBytes, budget = { remaining: 256 * 1024 * 1024 }) {
  invariant(binding.materials.length > 0 && binding.materials.length <= 200 && binding.knowledge.length <= 200, 'source_limit', '证据来源数量无效。');
  const root = path.join(project.managerPath, 'project-materials');
  const sources = binding.materials.map((ref) => {
    const material = index.materials.find((item) => item.materialId === ref.materialId);
    const version = material.versions.find((item) => item.version === ref.version);
    return { ...ref, root, relativePath: version.snapshot,
      title: `${path.basename(material.location.relativePath)} · 引用 v${ref.version}`, currentVersion: material.version };
  }).concat(binding.knowledge.map((ref) => ({ root, relativePath: ref.snapshot, sha256: ref.sha256, title: `${ref.relativePath} · 确认时知识版本` })));
  for (const source of sources) {
    source.location = fixedSnapshotPath(root, source.relativePath); source.available = true; source.kind = 'project_evidence';
    source.bindingId = binding.bindingId; source.projectId = project.id; source.studentId = binding.studentId;
    if (verifyBytes) verifyFixedEvidenceFile(source, budget);
  }
  return sources;
}
function resolveHistoricalEvidenceSources({ archive, studentId, project, evidence, index, verifyBytes = false, budget }) {
  const historical = archivedReportEvidence(archive, studentId, evidence.id);
  const reference = fixedEvidenceProjection(historical).sourceBinding;
  invariant(reference && reference.studentId === String(studentId) && reference.projectId === String(project?.id)
    && project.materialStorageMode === 'workspace-v1' && project.studentIds?.map(String).includes(String(studentId)), 'forbidden', '历史证据不在当前学生项目范围。');
  invariant(historical.status === 'confirmed' && !(historical.conflicts || []).length
    && ['content', 'ability', 'confidence', 'projectId', 'status'].every((key) => historical[key] === evidence[key])
    && JSON.stringify(reference) === JSON.stringify(fixedEvidenceProjection(evidence).sourceBinding),
  'evidence_changed', '历史观察与档案版本不一致。');
  const current = project.studentEvidence?.find((item) => String(item.studentId) === String(studentId));
  invariant(current && current.status !== 'rejected', 'evidence_withdrawn', '个人证据已移除或被驳回。');
  const binding = index.evidenceBindings?.find((item) => item.bindingId === reference.bindingId);
  invariant(binding?.schema === BINDING_SCHEMA && binding.studentId === String(studentId)
    && binding.evidenceHash === reference.evidenceHash, 'evidence_binding_missing', '历史固定来源登记不可用。');
  // This record is reconstructed only from a verified local archive, not from a client flag.
  // Current project membership and current adoption are still checked by the shared validator.
  const confirmed = { studentId: String(studentId), status: 'verified', ability: historical.ability,
    observation: historical.content, confidence: historical.confidence, sourceBinding: reference, sourcePaths: binding.selectionPaths };
  validateEvidenceBindingMetadata(project, binding, confirmed, index);
  return bindingSources(project, binding, index, verifyBytes, budget).map((source) => ({ ...source,
    historical: true, archiveVersionId: archive.versionId, reportHash: archive.reportHash }));
}
module.exports = { fixedEvidenceProjection, bindingMatchesEvidence, requiresFixedReportEvidence, resolveFixedEvidenceSources, resolveHistoricalEvidenceSources, verifyFixedEvidenceFile };
