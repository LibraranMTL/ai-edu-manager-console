const path = require('node:path');
const crypto = require('node:crypto');
const { invariant, positiveVersion, sha256 } = require('./project-material-contract.cjs');
const { createProjectMaterialHost, readProjectMaterialIndexSync } = require('./project-material-host.cjs');
const { createProjectMaterialAccess } = require('./project-material-access.cjs');
const { createProjectEvidenceService, evidenceRevision, evidenceSourcesText, validateEvidenceBindingMetadata } = require('./project-material-evidence.cjs');

const preparedPlans = new WeakSet();

function projectMaterialPromotionItems(project) {
  const index = readProjectMaterialIndexSync(project);
  return index.materials.filter((item) => item.adoption.state === 'accepted').map((item) => ({
    id: item.materialId, kind: 'file', materialId: item.materialId, materialVersion: item.version, sha256: item.sha256,
    title: path.posix.basename(item.location.relativePath), size: item.size, sourcePath: '', displayPath: item.location.relativePath,
    defaultAction: 'reference', action: 'reference', allowedActions: ['reference', 'absorb', 'skip'],
    targetHint: '引用项目固定版本，或复制该版本到学生原始资料库',
    content: `项目资料 ${item.materialId} · v${item.version}；文件归档不代表个人贡献已经确认。`,
  }));
}

// Preserve only a user's chosen action. Names, paths, content and student scope
// come from the freshly generated server plan, never the submitted JSON.
function canonicalPromotionSelection(input, canonical) {
  invariant(Array.isArray(input?.items) && input.items.length > 0 && input.items.length <= 10000,
    'invalid_plan', '归档清单必须包含1至10000项。');
  invariant(input.items.filter((item) => String(item.action || item.defaultAction || 'skip') !== 'skip').length <= 500,
    'archive_batch_too_large', '本次非跳过条目最多500项，请将其余条目改为跳过后分批执行。');
  const candidates = new Map(canonical.items.map((item) => [item.id, item]));
  const seen = new Set();
  return input.items.map((submitted) => {
    const item = candidates.get(submitted.id);
    invariant(item && !seen.has(item.id), 'invalid_plan', '归档条目已失效、越界或重复，请重新生成清单。');
    seen.add(item.id);
    const action = String(submitted.action || submitted.defaultAction || 'skip');
    invariant(item.allowedActions.includes(action), 'invalid_action', '此归档条目不允许所选动作。');
    if (item.kind === 'file' && action !== 'skip') {
      invariant(submitted.materialId === item.materialId && positiveVersion(submitted.materialVersion) === item.materialVersion
        && sha256(submitted.sha256) === item.sha256, 'version_conflict', '归档资料版本已变化，请重新确认清单。');
    }
    if (item.kind === 'knowledge' && action === 'publish') {
      invariant(Array.isArray(item.knowledgeVersions) && item.knowledgeVersions.length > 0
        && JSON.stringify(submitted.knowledgeVersions) === JSON.stringify(item.knowledgeVersions),
      'knowledge_changed', '已审核知识的范围或版本已变化，请重新生成归档清单。');
    }
    if (item.kind === 'growth' && action === 'publish') {
      invariant(item.evidenceBindingId && submitted.evidenceBindingId === item.evidenceBindingId
        && submitted.evidenceRevision === item.evidenceRevision, 'evidence_changed', '个人证据来源或审核内容已变化，请重新生成归档清单。');
    }
    return { ...structuredClone(item), action };
  });
}

async function prepareProjectMaterialPromotion(project, input, canonical, { authorize } = {}) {
  invariant(typeof authorize === 'function' && await authorize(), 'forbidden', '归档准备未获当前任务授权。');
  const items = canonicalPromotionSelection(input, canonical);
  invariant(items.filter((item) => item.kind === 'file' && item.action !== 'skip').reduce((sum, item) => sum + item.size, 0) <= 256 * 1024 * 1024,
    'archive_batch_too_large', '本次归档来源超过256MiB，请分批选择。');
  const host = createProjectMaterialHost(project);
  const access = createProjectMaterialAccess(project, { authorize });
  const knowledgeRecords = [];
  const evidenceService = createProjectEvidenceService(project, { authorize });
  let totalBytes = 0;
  for (const item of items) {
    if (item.kind === 'growth' && item.action === 'publish') {
      const evidence = project.studentEvidence?.find((entry) => entry.studentId === item.studentId);
      invariant(evidence && ['verified', 'published'].includes(evidence.status)
        && evidenceRevision(evidence) === item.evidenceRevision, 'evidence_changed', '个人证据尚未确认或已变化。');
      const binding = await evidenceService.readBinding(item.studentId, evidence, item.evidenceBindingId);
      item.evidenceBinding = binding;
      item.sourceFingerprint = binding.bindingId;
      item.sourcePath = evidenceSourcesText(binding);
      item.sourceMaterials = binding.materials.map((ref) => ({ projectId: project.id, ...ref }));
      continue;
    }
    if (item.kind === 'knowledge' && item.action === 'publish') {
      for (const record of item.knowledgeVersions) {
        const document = await access.readKnowledge(record.path);
        invariant(document.provenance === 'linked'
          && crypto.createHash('sha1').update(document.content).digest('hex') === record.contentSha1,
        'knowledge_changed', '知识正文已修改或缺少可信的固定来源，请复核后发布。');
        const sources = [];
        for (const ref of document.sources) {
          invariant(ref.materialId && !['restricted', 'missing', 'withdrawn'].includes(ref.status), 'source_unavailable', '知识引用来源不可用或已撤回，暂不发布。');
          const resolved = await host.store.resolve(ref.materialId, ref.version);
          invariant(resolved.sha256 === ref.sha256, 'source_changed', '知识来源版本校验失败。');
          await host.store.snapshot(ref.materialId, ref.version);
          sources.push({ projectId: project.id, materialId: ref.materialId, version: ref.version, sha256: ref.sha256 });
        }
        invariant(sources.length > 0, 'source_unavailable', '知识没有可回溯的原文依据。');
        totalBytes += Buffer.byteLength(document.content);
        invariant(totalBytes <= 256 * 1024 * 1024, 'archive_batch_too_large', '本次归档内容过多，请分批选择。');
        knowledgeRecords.push({ ...record, kind: item.knowledgeKind, status: 'verified', content: document.content,
          sha256: document.sha256, sourceMaterials: sources });
      }
      item.sourceFingerprint = crypto.createHash('sha256').update(JSON.stringify(knowledgeRecords.filter((record) => record.kind === item.knowledgeKind)
        .map((record) => [record.id, record.sha256, record.sourceMaterials]))).digest('hex');
      continue;
    }
    if (item.kind !== 'file' || item.action === 'skip') continue;
    invariant(await authorize(), 'forbidden', '归档准备期间项目或任务授权已变化。');
    const source = await host.store.resolve(item.materialId, item.materialVersion);
    totalBytes += source.size;
    invariant(totalBytes <= 256 * 1024 * 1024, 'archive_batch_too_large', '本次归档来源超过256MiB，请分批选择。');
    invariant(source.sha256 === item.sha256, 'source_changed', '归档原文与确认版本不符。');
    const fixed = await host.store.snapshot(item.materialId, item.materialVersion);
    item.sourcePath = fixed.path;
    item.sourceMaterial = { projectId: project.id, materialId: item.materialId, version: item.materialVersion, sha256: fixed.sha256 };
  }
  const identity = crypto.createHash('sha256').update(JSON.stringify(items.map((item) => [item.id, item.action, item.sourceMaterial, item.sourceFingerprint]))).digest('hex');
  invariant(await authorize(), 'forbidden', '归档准备完成前授权已失效。');
  await host.store.mutate((index) => {
    for (const item of items) {
      if (!item.sourceMaterial) continue;
      const record = index.materials.find((entry) => entry.materialId === item.materialId);
      invariant(record?.adoption.state === 'accepted' && record.version === item.materialVersion && record.sha256 === item.sha256,
        'source_changed', '归档准备期间来源版本或采用状态发生变化。');
      const version = record.versions.find((entry) => entry.version === item.materialVersion);
      version.pins ||= [];
      if (!version.pins.includes(`promotion:${identity}`)) version.pins.push(`promotion:${identity}`);
    }
    for (const knowledge of knowledgeRecords) for (const ref of knowledge.sourceMaterials) {
      const record = index.materials.find((entry) => entry.materialId === ref.materialId);
      const version = record?.versions.find((entry) => entry.version === ref.version && entry.sha256 === ref.sha256);
      invariant(record?.adoption.state === 'accepted' && version, 'source_changed', '知识引用来源已撤回或不再可用。');
      version.pins ||= [];
      if (!version.pins.includes(`promotion:${identity}`)) version.pins.push(`promotion:${identity}`);
    }
  });
  invariant(await authorize(), 'forbidden', '归档提交前授权已失效。');
  const prepared = { projectId: project.id, identity, plan: { items }, knowledgeRecords };
  preparedPlans.add(prepared);
  return prepared;
}

function requirePreparedProjectPromotion(project, prepared) {
  invariant(preparedPlans.has(prepared) && prepared.projectId === project.id, 'unprepared_promotion', '必须由主机固定资料版本后才能执行归档。');
  const index = readProjectMaterialIndexSync(project);
  for (const item of prepared.plan.items) {
    if (item.evidenceBinding) {
      const evidence = project.studentEvidence?.find((entry) => entry.studentId === item.studentId);
      invariant(evidenceRevision(evidence) === item.evidenceRevision, 'evidence_changed', '归档前个人证据已变化。');
      validateEvidenceBindingMetadata(project, item.evidenceBinding, evidence, index);
    }
    if (!item.sourceMaterial) continue;
    const record = index.materials.find((entry) => entry.materialId === item.materialId);
    invariant(record?.adoption.state === 'accepted' && record.version === item.materialVersion && record.sha256 === item.sha256,
      'source_changed', '归档来源已更新或撤回，请重新确认。');
  }
  for (const knowledge of prepared.knowledgeRecords) for (const ref of knowledge.sourceMaterials) {
    const record = index.materials.find((entry) => entry.materialId === ref.materialId);
    invariant(record?.adoption.state === 'accepted' && record.versions.some((entry) => entry.version === ref.version && entry.sha256 === ref.sha256),
      'source_changed', '归档知识的引用来源已撤回或发生冲突。');
  }
  return prepared.plan;
}

module.exports = { projectMaterialPromotionItems, canonicalPromotionSelection, prepareProjectMaterialPromotion, requirePreparedProjectPromotion };
