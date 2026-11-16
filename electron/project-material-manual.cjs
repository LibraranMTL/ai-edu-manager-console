'use strict';
const crypto = require('node:crypto');
const { createProjectMaterialHost } = require('./project-material-host.cjs');
const { createProjectDigestWorkspace } = require('./project-material-digest.cjs');
const { createProjectKnowledgeCommitter } = require('./project-knowledge-commit.cjs');
const { createProjectMaterialExtractor } = require('./project-material-extract.cjs');
const { outputSchema, stageMaterialResponse } = require('./project-material-agent.cjs');
const { KNOWLEDGE_DIRS } = require('./project-material-task.cjs');

// A manual batch exposes only frozen source text and declared destinations.
// The caller persists batchId and revalidates the task and scope on every call.
function createManualMaterialBatch({ project, authorize, scopeFingerprint = '' }) {
  const { store } = createProjectMaterialHost(project);
  const workspace = createProjectDigestWorkspace({ store, knowledgeRoot: project.knowledgeRootPath, allowedDirectories: KNOWLEDGE_DIRS });
  const extractor = createProjectMaterialExtractor({ store });
  async function check() { if (await authorize() !== true) throw Object.assign(Error('任务或资料范围已变化。'), { code: 'project_scope_changed' }); }
  async function prepare(materialIds, { allowPrefix = false } = {}) {
    await check();
    if (!Array.isArray(materialIds) || !materialIds.length || materialIds.length > 20 || new Set(materialIds).size !== materialIds.length) throw Error('每次请选择 1 至 20 份不同资料。');
    const index = await store.read(), texts = [], selected = [];
    let size = 0;
    for (const id of materialIds) {
      await check();
      const record = index.materials.find(item => item.materialId === id);
      if (!record || record.adoption?.state !== 'accepted') throw Error('资料未采用或已不存在。');
      if (record.processing?.state === 'completed' && record.processing?.processedVersion === record.version) throw Error('资料版本已经完成消化。');
      await store.snapshot(id, record.version);
      const input = await store.resolve(id, record.version);
      const text = await extractor.extractText(input);
      const bytes = Buffer.byteLength(text || '');
      if (!text?.trim()) throw Error('资料正文为空，请先检查该资料。');
      if (size + bytes > 256 * 1024) {
        if (allowPrefix && selected.length) break;
        throw Error('单份资料正文超过手工交接容量，请先精简该资料。');
      }
      size += bytes;
      selected.push(record);
      texts.push({ materialId: id, version: input.version, sha256: input.sha256, text });
    }
    await check();
    const ruleVersion = crypto.createHash('sha256').update('manual-material-v1').digest('hex');
    const targets = selected.flatMap(item => KNOWLEDGE_DIRS.map(dir => ({ relativePath: `${dir}/${crypto.createHash('sha256').update(item.materialId).digest('hex').slice(0, 24)}.md`, materialIds: [item.materialId] })));
    const batch = await workspace.prepare({ materialIds: selected.map(item => item.materialId), ruleVersion, scopeFingerprint, targets });
    await check();
    if (batch.sources.some(source => !texts.some(item => item.materialId === source.materialId && item.version === source.version && item.sha256 === source.sha256))) throw Error('准备期间资料版本已变化。');
    return { batchId: batch.batchId, sources: texts, schema: outputSchema(batch), baselines: batch.baselines };
  }
  async function accept(batchId, response) {
    await check();
    const loaded = await workspace.readBatch(batchId);
    if (String(loaded.manifest.scopeFingerprint || '') !== String(scopeFingerprint || '')) throw Error('冻结资料范围已变化。');
    const batch = { ...loaded.manifest, outputRoot: loaded.paths.output };
    // Require a complete batch before staging or committing any knowledge.
    if (response?.status === 'completed') {
      const paths = Array.isArray(response.artifacts) ? response.artifacts.map(item => item?.relativePath) : [];
      const expected = batch.baselines.map(item => item.relativePath);
      if (paths.length !== expected.length || new Set(paths).size !== expected.length || expected.some(item => !paths.includes(item))) {
        throw Object.assign(Error('回执未覆盖本批次全部知识目标，未写入知识；请补全后重试。'), { code: 'incomplete_artifacts' });
      }
    }
    const receipt = await stageMaterialResponse(batch, response);
    await check();
    const committer = createProjectKnowledgeCommitter({ store, workspace, knowledgeRoot: project.knowledgeRootPath,
      hooks: { afterLocked: check, afterFilesWritten: check } });
    return committer.commit(batchId, receipt);
  }
  return { prepare, accept, store };
}
module.exports = { createManualMaterialBatch };
