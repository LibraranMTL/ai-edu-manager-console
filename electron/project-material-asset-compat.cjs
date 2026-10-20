const path = require('node:path');
const { identifier, invariant } = require('./project-material-contract.cjs');

const pathKey = (value) => process.platform === 'win32' ? value.toLowerCase() : value;

function validProjectReference(asset, project, source) {
  return asset?.sha1 === source.sha1 && asset?.size === source.size
    && (asset.references || []).some((reference) => reference.spaceType === 'project'
      && String(reference.spaceId) === String(project.id)
      && path.isAbsolute(reference.path || '')
      && pathKey(path.resolve(reference.path)) === pathKey(path.resolve(source.path)));
}

function createProjectMaterialAssetCompatibility(project, host, { findAsset, upsertAsset, addProjectAsset, hasProjectAsset }) {
  invariant(project?.id && host?.store && typeof findAsset === 'function'
    && typeof upsertAsset === 'function' && typeof addProjectAsset === 'function',
  'invalid_adapter', '项目资产兼容适配器配置无效。');

  async function syncAccepted(materialId, preparedIndex = null) {
    identifier(materialId, '资料ID');
    const index = preparedIndex || await host.store.read();
    const record = index.materials.find((item) => item.materialId === materialId);
    invariant(record?.adoption.state === 'accepted', 'source_not_adopted', '只有已采用资料可建立旧资产引用。');
    const source = await host.store.resolve(materialId);
    invariant(source.version === record.version && source.sha256 === record.sha256,
      'version_conflict', '建立旧资产引用期间原件版本已变化。');
    const linked = (record.links.assets || []).find((link) => link.version === record.version
      && link.sha256 === record.sha256 && validProjectReference(findAsset(link.assetId), project, source));
    if (linked) {
      await addProjectAsset(linked.assetId);
      return { materialId, version: record.version, assetId: linked.assetId, unchanged: true };
    }
    const asset = await upsertAsset(source.path, {
      spaceType: 'project', projectId: project.id, projectName: project.name,
      sourcePath: source.path, sourceName: '项目资料登记', sourceType: 'project_material',
      role: 'project_raw_accepted', contentSha256: source.sha256, contentSha1: source.sha1,
      referenceId: `project-material:${materialId}:${record.version}`,
    });
    invariant(validProjectReference(asset, project, source), 'asset_scope_mismatch',
      '旧资产引用未指向当前项目原件。');
    await host.bindUploadedAsset(materialId, asset);
    await addProjectAsset(asset.assetId);
    return { materialId, version: record.version, assetId: asset.assetId, unchanged: false };
  }

  async function repair({ limit = 20 } = {}) {
    invariant(Number.isSafeInteger(limit) && limit >= 1 && limit <= 100,
      'invalid_limit', '兼容关联每次最多处理100份资料。');
    const index = await host.store.read();
    const accepted = index.materials.filter((item) => item.adoption.state === 'accepted'
      && !['missing', 'unavailable'].includes(item.availability));
    const missing = [];
    for (const item of accepted) {
      let sourcePath = '';
      try { sourcePath = await host.store.locationPath(item.location); }
      catch { missing.push(item); continue; }
      if (!(item.links.assets || []).some((link) => link.version === item.version
        && link.sha256 === item.sha256
        && validProjectReference(findAsset(link.assetId), project, {
          path: sourcePath, sha1: item.sha1, size: item.size,
        }) && (!hasProjectAsset || hasProjectAsset(link.assetId)))) missing.push(item);
    }
    const results = [];
    const failed = [];
    for (const record of missing.slice(0, limit)) {
      try { results.push(await syncAccepted(record.materialId)); }
      catch (error) { failed.push({ materialId: record.materialId,
        code: error.code || 'asset_compat_failed', message: error.message }); }
    }
    return { linked: results.length, failed, remaining: Math.max(0, missing.length - results.length) };
  }

  async function repairAll({ batchSize = 100, onProgress = () => {}, shouldCancel = () => false } = {}) {
    invariant(Number.isSafeInteger(batchSize) && batchSize >= 1 && batchSize <= 100,
      'invalid_limit', '兼容关联批次每次最多处理100份资料。');
    const index = await host.store.read();
    const accepted = index.materials.filter((item) => item.adoption.state === 'accepted'
      && !['missing', 'unavailable'].includes(item.availability));
    const missing = [];
    for (const item of accepted) {
      let sourcePath = '';
      try { sourcePath = await host.store.locationPath(item.location); }
      catch { missing.push(item); continue; }
      if (!(item.links.assets || []).some((link) => link.version === item.version
        && link.sha256 === item.sha256
        && validProjectReference(findAsset(link.assetId), project, {
          path: sourcePath, sha1: item.sha1, size: item.size,
        }) && (!hasProjectAsset || hasProjectAsset(link.assetId)))) missing.push(item);
    }
    const results = [];
    const failed = [];
    for (let offset = 0; offset < missing.length; offset += batchSize) {
      const batch = missing.slice(offset, offset + batchSize);
      for (const record of batch) {
        if (shouldCancel()) throw Object.assign(new Error('资产索引补建已取消。'), { code: 'asset_scan_cancelled' });
        try { results.push(await syncAccepted(record.materialId, index)); }
        catch (error) { failed.push({ materialId: record.materialId,
          code: error.code || 'asset_compat_failed', message: error.message }); }
      }
      await onProgress({ total: missing.length, processed: Math.min(offset + batch.length, missing.length),
        linked: results.length, failed: failed.length });
    }
    if (!missing.length) await onProgress({ total: 0, processed: 0, linked: 0, failed: 0 });
    return { linked: results.length, failed, remaining: 0, total: missing.length, processed: missing.length };
  }

  return { syncAccepted, repair, repairAll };
}

module.exports = { createProjectMaterialAssetCompatibility, validProjectReference };
