const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { invariant, identifier, relativeMaterialPath, sourceVersionKey } = require('./project-material-contract.cjs');
const { safePath, hashStableFile, writeJsonAtomic } = require('./project-materials.cjs');

const BATCH_SCHEMA = 'edu-manager.project-material-digest.v1';
const RESULT_SCHEMA = 'edu-manager.project-material-result.v1';

function safeBatchId(value) {
  invariant(typeof value === 'string' && /^batch-[a-f0-9-]{36}$/.test(value), 'invalid_batch', '项目批次ID无效。');
  return value;
}

// This service prepares immutable inputs and validates staged outputs. The
// task adapter must grant write access ONLY to outputRoot, never manifestRoot,
// original documents, snapshots or the official knowledge root.
function createProjectDigestWorkspace({ store, knowledgeRoot, allowedDirectories, hooks = {} }) {
  invariant(store?.projectId && path.isAbsolute(knowledgeRoot), 'invalid_scope', '项目消化范围无效。');
  invariant(Array.isArray(allowedDirectories) && allowedDirectories.length > 0,
    'invalid_categories', '项目知识类别未配置。');
  const allowed = new Set(allowedDirectories.map(relativeMaterialPath));

  function targetPath(relative) {
    const normalized = relativeMaterialPath(relative);
    invariant([...allowed].some((dir) => normalized.startsWith(`${dir}/`)) && /\.md$/i.test(normalized),
      'invalid_artifact', '知识输出必须位于允许的Markdown知识目录中。');
    return normalized;
  }

  async function batchPaths(batchId, { create = false } = {}) {
    safeBatchId(batchId);
    const root = await safePath(store.directory, `batches/${batchId}`, { allowMissing: create });
    if (create) await fs.mkdir(root, { recursive: true });
    const manifest = await safePath(root, 'manifest.json', { allowMissing: create });
    const output = await safePath(root, 'output', { allowMissing: create });
    if (create) await fs.mkdir(output, { recursive: true });
    return { root, manifest, output };
  }

  async function prepare({ materialIds, ruleVersion, targets }) {
    identifier(ruleVersion, '规则版本');
    invariant(Array.isArray(materialIds) && materialIds.length > 0 && materialIds.length <= 200
      && new Set(materialIds).size === materialIds.length, 'invalid_sources', '消化来源数量或身份重复。');
    invariant(Array.isArray(targets) && targets.length > 0 && targets.length <= 200,
      'invalid_artifacts', '知识目标清单无效。');
    const targetDefinitions = targets.map((target) => {
      const relativePath = targetPath(typeof target === 'string' ? target : target?.relativePath);
      const ids = typeof target === 'string' ? materialIds : target.materialIds;
      invariant(Array.isArray(ids) && ids.length > 0 && new Set(ids).size === ids.length
        && ids.every((id) => materialIds.includes(id)), 'invalid_sources', '知识目标的来源范围无效。');
      return { relativePath, materialIds: [...ids] };
    });
    const relativeTargets = targetDefinitions.map((target) => target.relativePath);
    invariant(new Set(relativeTargets.map((item) => item.toLowerCase())).size === relativeTargets.length,
      'duplicate_artifact', '知识目标重复。');
    const data = await store.read();
    const sources = [];
    for (const materialId of materialIds) {
      const record = data.materials.find((item) => item.materialId === materialId);
      invariant(record?.adoption.state === 'accepted', 'source_not_adopted', '消化只能采用当前项目已采用的资料。');
      const source = await store.snapshot(materialId, record.version);
      const current = await store.resolve(materialId);
      invariant(current.version === source.version && current.sha256 === source.sha256,
        'source_changed', '准备期间资料版本已改变。');
      sources.push({ materialId, version: source.version, sha256: source.sha256, sha1: source.sha1,
        size: source.size, snapshot: source.snapshot, displayPath: record.location.relativePath });
    }
    const baselines = [];
    for (const relativePath of relativeTargets) {
      const file = await safePath(knowledgeRoot, relativePath, { allowMissing: true });
      let observed;
      try { observed = await hashStableFile(file); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      baselines.push({ relativePath, sha256: observed?.sha256 || null,
        materialIds: targetDefinitions.find((target) => target.relativePath === relativePath).materialIds });
    }
    const batchId = `batch-${crypto.randomUUID()}`;
    const paths = await batchPaths(batchId, { create: true });
    const manifest = { schema: BATCH_SCHEMA, projectId: store.projectId, batchId,
      state: 'preparing', ruleVersion, createdAt: new Date().toISOString(), sources, baselines };
    await writeJsonAtomic(paths.manifest, manifest);
    await store.mutate((index) => {
      for (const source of sources) {
        const record = index.materials.find((item) => item.materialId === source.materialId);
        invariant(record?.version === source.version && record.sha256 === source.sha256
          && record.adoption.state === 'accepted', 'source_changed', '登记已变化，不能提交旧来源批次。');
        const version = record.versions.find((item) => item.version === source.version);
        version.pins ||= [];
        if (!version.pins.includes(batchId)) version.pins.push(batchId);
      }
    });
    manifest.state = 'prepared';
    await writeJsonAtomic(paths.manifest, manifest);
    return { ...manifest, manifestPath: paths.manifest, outputRoot: paths.output,
      inputFiles: await Promise.all(sources.map((source) => store.resolve(source.materialId, source.version))) };
  }

  async function readBatch(batchId) {
    const paths = await batchPaths(batchId);
    const manifest = JSON.parse(await fs.readFile(paths.manifest, 'utf8'));
    invariant(manifest.schema === BATCH_SCHEMA && manifest.batchId === batchId
      && manifest.projectId === store.projectId && manifest.state === 'prepared',
    'invalid_batch', '批次尚未就绪或不属于当前项目。');
    return { paths, manifest };
  }

  async function validate(batchId, receipt) {
    const { paths, manifest } = await readBatch(batchId);
    invariant(receipt?.schema === RESULT_SCHEMA && receipt.batchId === batchId
      && receipt.projectId === store.projectId, 'receipt_scope_mismatch', '输出回执必须明确匹配当前项目及批次。');
    invariant(Array.isArray(receipt.artifacts) && receipt.artifacts.length > 0 && receipt.artifacts.length <= 200,
      'invalid_artifacts', '输出必须逐项声明真实知识文件和来源。');
    const artifacts = [];
    const seen = new Set();
    const data = await store.read();
    const checkedSources = new Map();
    let totalBytes = 0;
    for (const artifact of receipt.artifacts) {
      const relative = targetPath(artifact.relativePath);
      invariant(!seen.has(relative.toLowerCase()), 'duplicate_artifact', '回执重复声明知识文件。');
      seen.add(relative.toLowerCase());
      const baseline = manifest.baselines.find((item) => item.relativePath === relative);
      invariant(baseline, 'undeclared_artifact', '回执输出不在本批次目标清单中。');
      invariant(Array.isArray(artifact.sources) && artifact.sources.length > 0 && artifact.sources.length <= manifest.sources.length,
        'sources_missing', '每项知识必须声明其真实输入版本。');
      const refs = new Set();
      let stale = false;
      for (const ref of artifact.sources) {
        const source = manifest.sources.find((item) => item.materialId === ref.materialId
          && item.version === ref.version && item.sha256 === ref.sha256);
        invariant(source, 'source_mismatch', '知识引用与固定输入不符。');
        invariant((baseline.materialIds || materialIdsFromManifest(manifest)).includes(source.materialId),
          'source_mismatch', '知识引用不在该目标的授权来源范围内。');
        const key = sourceVersionKey(store.projectId, ref.materialId, ref.version);
        invariant(!refs.has(key), 'duplicate_source', '同一知识重复声明同一来源。');
        refs.add(key);
        if (!checkedSources.has(key)) {
          // Always verify the fixed input, even when the working file changed.
          await store.resolve(source.materialId, source.version);
          const current = data.materials.find((item) => item.materialId === source.materialId);
          let currentMatches = current?.version === source.version && current.sha256 === source.sha256
            && current.adoption.state === 'accepted';
          if (currentMatches) {
            try { await store.resolve(source.materialId); }
            catch (error) {
              if (!['source_changed', 'ENOENT'].includes(error.code)) throw error;
              currentMatches = false;
            }
          }
          checkedSources.set(key, currentMatches);
        }
        if (!checkedSources.get(key)) stale = true;
      }
      const outputPath = await safePath(paths.output, relative);
      const output = await hashStableFile(outputPath);
      totalBytes += output.size;
      invariant(output.size > 0 && output.size <= 2 * 1024 * 1024 && totalBytes <= 16 * 1024 * 1024,
        'output_limit', '知识输出为空或超过批次容量限制。');
      let currentHash = null;
      const destination = await safePath(knowledgeRoot, relative, { allowMissing: true });
      try { currentHash = (await hashStableFile(destination)).sha256; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      const targetChanged = currentHash !== baseline.sha256;
      artifacts.push({ relativePath: relative, outputPath, sha256: output.sha256, size: output.size,
        sources: structuredClone(artifact.sources), baselineHash: baseline.sha256,
        status: stale ? 'stale_sources' : targetChanged ? 'knowledge_conflict' : 'validated' });
    }
    await hooks.afterValidation?.(artifacts);
    // Validation is not a commit receipt and never advances processing state.
    return { projectId: store.projectId, batchId, state: 'validated_candidates', artifacts,
      requiresCommit: true, processedMaterialIds: [] };
  }

  return { prepare, readBatch, validate };
}

module.exports = { BATCH_SCHEMA, RESULT_SCHEMA, createProjectDigestWorkspace };

function materialIdsFromManifest(manifest) { return manifest.sources.map((source) => source.materialId); }
