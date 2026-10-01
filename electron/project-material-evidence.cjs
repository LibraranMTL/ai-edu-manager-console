const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { invariant, identifier } = require('./project-material-contract.cjs');
const { createProjectMaterialHost, readProjectMaterialIndexSync } = require('./project-material-host.cjs');
const { createProjectMaterialAccess, readBounded } = require('./project-material-access.cjs');
const { safePath, withCommitLock } = require('./project-materials.cjs');

const SCHEMA = 'edu-manager.project-evidence-binding.v1';
const commitBindings = new WeakMap();
const publications = new WeakSet();
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const pathKey = (value) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const pathsFor = (evidence) => [...new Set((Array.isArray(evidence?.sourcePaths) ? evidence.sourcePaths : []).map(String).filter(Boolean))];
const evidenceRevision = (evidence) => hash(JSON.stringify(evidence || null));
const evidenceHash = (projectId, studentId, evidence) => hash(JSON.stringify([projectId, studentId,
  String(evidence.ability || ''), String(evidence.observation || ''), String(evidence.confidence || '')]));
const sourceBindingRef = (binding) => ({ schema: SCHEMA, bindingId: binding.bindingId,
  projectId: binding.projectId, studentId: binding.studentId, evidenceHash: binding.evidenceHash });
const evidenceSourcesText = (binding) => [
  ...binding.materials.map((item) => `${binding.projectId} / ${item.materialId} / v${item.version} / SHA-256 ${item.sha256}`),
  ...binding.knowledge.map((item) => `知识 ${item.relativePath} / SHA-256 ${item.sha256}`),
].join('；');

function consumeEvidenceBinding(token, projectId, studentId, evidence) {
  const binding = token && commitBindings.get(token);
  invariant(binding && binding.projectId === projectId && binding.studentId === studentId
    && binding.evidenceHash === evidenceHash(projectId, studentId, evidence)
    && JSON.stringify(binding.selectionPaths) === JSON.stringify(pathsFor(evidence)),
  'evidence_confirmation_required', '请通过固定来源预览重新确认个人证据，不能使用旧同步入口直接确认。');
  commitBindings.delete(token);
  return binding;
}

function validateEvidenceBindingMetadata(project, binding, evidence, index = readProjectMaterialIndexSync(project)) {
  invariant(binding?.projectId === project.id && project.studentIds?.includes(binding.studentId)
    && evidence?.studentId === binding.studentId && ['verified', 'published'].includes(evidence.status)
    && evidence.sourceBinding?.bindingId === binding.bindingId
    && evidenceHash(project.id, binding.studentId, evidence) === binding.evidenceHash
    && JSON.stringify(pathsFor(evidence)) === JSON.stringify(binding.selectionPaths),
  'evidence_changed', '个人证据内容、审核状态或固定来源已变化，请重新确认。');
  invariant(index.evidenceBindings?.some((item) => item.bindingId === binding.bindingId
    && JSON.stringify(item) === JSON.stringify(binding)), 'evidence_binding_missing', '个人证据固定来源登记已变化。');
  for (const ref of binding.materials) {
    const record = index.materials.find((item) => item.materialId === ref.materialId);
    invariant(record?.adoption.state === 'accepted' && record.versions.some((version) => version.version === ref.version
      && version.sha256 === ref.sha256 && version.snapshot), 'source_withdrawn', '个人证据的固定原文已撤回或不可用。');
  }
}

async function prepareEvidencePublication(project, { authorize }) {
  const service = createProjectEvidenceService(project, { authorize });
  const records = [];
  for (const evidence of project.studentEvidence || []) {
    if (!['verified', 'published'].includes(evidence.status)) continue;
    const binding = await service.readBinding(evidence.studentId, evidence, evidence.sourceBinding?.bindingId);
    records.push({ studentId: evidence.studentId, revision: evidenceRevision(evidence), binding });
  }
  invariant(await authorize(), 'forbidden', '个人证据发布授权已失效。');
  const prepared = { projectId: project.id, records };
  publications.add(prepared);
  return prepared;
}

function requireEvidencePublication(project, prepared) {
  invariant(publications.has(prepared) && prepared.projectId === project.id, 'unprepared_evidence', '个人证据发布必须先校验固定来源。');
  const current = (project.studentEvidence || []).filter((item) => ['verified', 'published'].includes(item.status));
  invariant(current.length === prepared.records.length, 'evidence_changed', '发布准备期间个人证据范围已变化。');
  const index = readProjectMaterialIndexSync(project);
  for (const record of prepared.records) {
    const evidence = current.find((item) => item.studentId === record.studentId);
    invariant(evidenceRevision(evidence) === record.revision, 'evidence_changed', '发布准备期间个人证据已变化。');
    validateEvidenceBindingMetadata(project, record.binding, evidence, index);
  }
  return new Map(prepared.records.map((item) => [item.studentId, item.binding]));
}

function createProjectEvidenceService(project, { authorize } = {}) {
  invariant(typeof authorize === 'function', 'forbidden', '个人证据必须提供项目授权检查。');
  const host = createProjectMaterialHost(project);
  const access = createProjectMaterialAccess(project, { authorize });
  async function permit(studentId) {
    identifier(studentId, '学生ID');
    invariant(project.studentIds?.map(String).includes(studentId) && await authorize({ projectId: project.id, studentId }),
      'forbidden', '学生、项目或个人证据操作授权已失效。');
  }
  async function readBinding(studentId, evidence, bindingId) {
    await permit(studentId);
    const index = await host.store.read();
    const binding = (index.evidenceBindings || []).find((item) => item.bindingId === bindingId);
    invariant(binding?.schema === SCHEMA && binding.projectId === project.id && binding.studentId === studentId,
      'evidence_binding_missing', '个人证据缺少此项目、此学生的固定来源绑定，请重新确认。');
    invariant(binding.evidenceHash === evidenceHash(project.id, studentId, evidence),
      'evidence_changed', '个人观察、能力或置信度已变化，请重新确认。');
    invariant(JSON.stringify(binding.selectionPaths) === JSON.stringify(pathsFor(evidence)),
      'evidence_changed', '来源选择已变化，请重新确认。');
    invariant(Array.isArray(binding.materials) && binding.materials.length > 0 && binding.materials.length <= 200
      && Array.isArray(binding.knowledge) && binding.knowledge.length <= 50, 'invalid_binding', '个人证据来源结构无效。');
    for (const ref of binding.materials) {
      const record = index.materials.find((item) => item.materialId === ref.materialId);
      invariant(record?.adoption.state === 'accepted', 'source_withdrawn', '个人证据引用的资料已撤回或不在此项目。');
      const fixed = await host.store.resolve(ref.materialId, ref.version);
      invariant(fixed.sha256 === ref.sha256, 'source_changed', '个人证据原文版本校验失败。');
    }
    for (const ref of binding.knowledge) {
      invariant(ref.snapshot === `evidence-knowledge/${ref.sha256}.md`, 'invalid_binding', '个人证据知识快照路径无效。');
      const bytes = await readBounded(await safePath(host.store.directory, ref.snapshot), 4 * 1024 * 1024);
      invariant(hash(bytes) === ref.sha256, 'source_changed', '个人证据的知识版本快照已变化。');
    }
    await permit(studentId);
    return binding;
  }

  async function prepare(studentId, evidence, previousEvidence) {
    await permit(studentId);
    invariant(String(evidence.ability || '').trim() && String(evidence.observation || '').trim(), 'evidence_incomplete', '请填写能力维度和具体表现。');
    const selectionPaths = pathsFor(evidence);
    invariant(selectionPaths.length > 0 && selectionPaths.length <= 50, 'evidence_sources_required', '请选择1至50个具体来源文件，不能仅引用一个目录。');
    const index = await host.store.read();
    const materials = new Map();
    const knowledge = [];
    const previous = previousEvidence?.sourceBinding?.bindingId
      ? (index.evidenceBindings || []).find((item) => item.bindingId === previousEvidence.sourceBinding.bindingId) : null;
    if (previous && JSON.stringify(selectionPaths) === JSON.stringify(previous.selectionPaths)) {
      // A text correction must not silently retarget yesterday's evidence to
      // today's source version. Validate and retain the existing fixed inputs.
      const verified = await readBinding(studentId, previousEvidence, previous.bindingId);
      for (const ref of verified.materials) materials.set(`${ref.materialId}:${ref.version}`, ref);
      knowledge.push(...verified.knowledge);
    } else {
      for (const input of selectionPaths) {
        invariant(path.isAbsolute(input), 'invalid_path', '旧路径必须明确位于当前项目，不能按文件名或全局资产猜测。');
        const matches = index.materials.filter((record) => {
          const root = record.location.rootId === 'workspace' ? project.workspacePath : record.location.rootId === 'legacy' ? project.rawPath : null;
          return root && pathKey(path.join(root, record.location.relativePath)) === pathKey(input);
        });
        invariant(matches.length <= 1, 'ambiguous_source', '此路径对应多个项目资料身份，请先修复登记。');
        if (matches.length === 1) {
          const record = matches[0];
          invariant(record.adoption.state === 'accepted', 'source_not_adopted', '个人证据引用资料尚未采用。');
          const fixed = await host.store.snapshot(record.materialId, record.version);
          materials.set(`${record.materialId}:${record.version}`, { materialId: record.materialId, version: record.version, sha256: fixed.sha256 });
        } else {
          const document = await access.readKnowledge(input);
          invariant(document.provenance === 'linked' && document.sources.length > 0, 'knowledge_unlinked', '此来源不是已登记原文或具有固定来源的知识，请先补充依据。');
          for (const ref of document.sources) {
            invariant(ref.materialId && !['restricted', 'missing', 'withdrawn'].includes(ref.status), 'source_unavailable', '知识来源尚不可用于个人证据。');
            const fixed = await host.store.snapshot(ref.materialId, ref.version);
            invariant(fixed.sha256 === ref.sha256, 'source_changed', '知识来源版本不一致。');
            materials.set(`${ref.materialId}:${ref.version}`, { materialId: ref.materialId, version: ref.version, sha256: ref.sha256 });
          }
          const relative = `evidence-knowledge/${document.sha256}.md`;
          const folder = await safePath(host.store.directory, 'evidence-knowledge', { allowMissing: true });
          await fs.mkdir(folder, { recursive: true });
          const file = await safePath(host.store.directory, relative, { allowMissing: true });
          try { await fs.writeFile(file, document.content, { flag: 'wx' }); }
          catch (error) { if (error.code !== 'EEXIST') throw error; }
          invariant(hash(await readBounded(file, 4 * 1024 * 1024)) === document.sha256, 'source_changed', '知识快照写入校验失败。');
          await fs.chmod(file, 0o444);
          knowledge.push({ relativePath: document.relativePath, sha256: document.sha256, snapshot: relative });
        }
        await permit(studentId);
      }
    }
    invariant(materials.size > 0 && materials.size <= 200, 'evidence_sources_required', '个人证据最多绑定200个原文版本。');
    const binding = { schema: SCHEMA, projectId: project.id, studentId, previousEvidenceRevision: evidenceRevision(previousEvidence),
      evidenceHash: evidenceHash(project.id, studentId, evidence), selectionPaths,
      materials: [...materials.values()].sort((a, b) => `${a.materialId}:${a.version}`.localeCompare(`${b.materialId}:${b.version}`)),
      knowledge: knowledge.sort((a, b) => a.relativePath.localeCompare(b.relativePath)), createdAt: new Date().toISOString() };
    binding.bindingId = `evidence-binding-${hash(JSON.stringify([binding.projectId, studentId, binding.evidenceHash,
      binding.selectionPaths, binding.previousEvidenceRevision, binding.materials, binding.knowledge]))}`;
    await permit(studentId);
    await host.store.mutate((fresh) => {
      for (const ref of binding.materials) {
        const record = fresh.materials.find((item) => item.materialId === ref.materialId);
        const version = record?.versions.find((item) => item.version === ref.version && item.sha256 === ref.sha256);
        invariant(record?.adoption.state === 'accepted' && version?.snapshot, 'source_changed', '证据来源已撤回或未留存固定版本。');
        version.pins ||= [];
        if (!version.pins.includes(binding.bindingId)) version.pins.push(binding.bindingId);
      }
      fresh.evidenceBindings ||= [];
      if (!fresh.evidenceBindings.some((item) => item.bindingId === binding.bindingId)) fresh.evidenceBindings.push(binding);
    });
    return readBinding(studentId, evidence, binding.bindingId);
  }

  async function confirm(studentId, evidence, bindingId, commit) {
    const binding = await readBinding(studentId, evidence, bindingId);
    // Hash immutable inputs outside the registry commit queue. Under the short
    // commit lock recheck authority + metadata, then commit without more awaits.
    return withCommitLock(host.store.directory, async () => {
      const index = await host.store.read();
      await permit(studentId);
      validateEvidenceBindingMetadata(project, binding, { ...evidence, studentId, status: 'verified', sourceBinding: sourceBindingRef(binding) }, index);
      const token = {};
      commitBindings.set(token, binding);
      try {
        const result = commit(token, binding);
        invariant(!result?.then, 'async_commit', '证据提交回调必须同步完成。');
        return result;
      } finally { commitBindings.delete(token); }
    });
  }

  return { prepare, readBinding, confirm };
}

module.exports = { createProjectEvidenceService, evidenceHash, evidenceRevision, sourceBindingRef, evidenceSourcesText, consumeEvidenceBinding,
  validateEvidenceBindingMetadata, prepareEvidencePublication, requireEvidencePublication };
