const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  MATERIAL_SCHEMA, MaterialError, invariant, identifier, relativeMaterialPath, positiveVersion,
} = require('./project-material-contract.cjs');
const { createProjectMaterialStore, validateRegistry } = require('./project-materials.cjs');
const { readProjectExternalRoots } = require('./project-external-roots.cjs');

const registryCache = new Map();
const keyPath = (value) => process.platform === 'win32' ? value.toLowerCase() : value;
const isWorkspaceMaterialProject = (project) => project?.materialStorageMode === 'workspace-v1';

function normalizeMaterialConfiguration(project) {
  const mode = project.materialStorageMode || 'legacy';
  invariant(['legacy', 'workspace-v1'].includes(mode), 'unsupported_storage_mode', '此项目资料存储模式需要较新的客户端。');
  const version = project.materialRegistryVersion ?? 1;
  invariant(version === 1, 'unsupported_registry_version', '此项目资料登记版本暂不支持，不能按旧目录处理。');
  const inbox = relativeMaterialPath(project.inboxRelativePath || '收件箱');
  invariant(!inbox.split('/').some((part) => part.toLowerCase() === '.edu-manager'), 'invalid_path', '收件箱不能位于管理目录。');
  const policy = project.materialOrganizationPolicy || {};
  invariant(['suggest', 'automatic'].includes(policy.mode || 'suggest'), 'invalid_policy', '项目整理策略无效。');
  const roots = Array.isArray(policy.autoMoveRoots) ? policy.autoMoveRoots.map(relativeMaterialPath) : [inbox];
  invariant(roots.every((root) => root === inbox || root.startsWith(`${inbox}/`)),
    'invalid_policy', '自动移动范围必须位于项目收件箱内。');
  return { materialStorageMode: mode, materialRegistryVersion: version, inboxRelativePath: inbox,
    materialOrganizationPolicy: { mode: policy.mode || 'suggest', autoMoveRoots: roots, respectManualClassification: true },
    materialMigrationState: String(project.materialMigrationState || 'not_started') };
}

// Synchronous callers in the existing host may read ONLY this metadata index.
// No source-directory enumeration, existence check or content hashing occurs.
// Both readers validate the same registry contract; all writes stay in store.
function readProjectMaterialIndexSync(project) {
  identifier(project.id, '项目ID');
  invariant(path.isAbsolute(project.managerPath || ''), 'invalid_root', '项目管理目录无效。');
  let file;
  let stat;
  try {
    file = fs.realpathSync(project.managerPath);
    for (const part of ['project-materials', 'registry.json']) {
      file = path.join(file, part);
      invariant(!fs.lstatSync(file).isSymbolicLink(), 'linked_path', '项目登记路径包含未经允许的链接。');
    }
    stat = fs.statSync(file);
    invariant(stat.isFile(), 'registry_corrupt', '项目登记不是文件。');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { schema: MATERIAL_SCHEMA, projectId: project.id, revision: 0, materials: [],
      categories: [], receipts: [], commits: [], knowledge: [], updatedAt: '' };
  }
  const cacheKey = JSON.stringify([project.id, keyPath(file)]);
  const stamp = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}:${stat.ino}`;
  let data = registryCache.get(cacheKey)?.stamp === stamp ? registryCache.get(cacheKey).data : null;
  if (!data) {
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) { throw new MaterialError('registry_corrupt', '项目资料登记无法读取，不能回退扫描旧目录。', { cause: error.message }); }
    validateRegistry(data, project.id);
    registryCache.delete(cacheKey);
    registryCache.set(cacheKey, { stamp, data });
    while (registryCache.size > 32) registryCache.delete(registryCache.keys().next().value);
  }
  return structuredClone(data);
}

function projectMaterialDigestProjection(project, index) {
  validateRegistry(index, project.id);
  const adopted = index.materials.filter((item) => item.adoption.state === 'accepted');
  const available = adopted.filter((item) => !['missing', 'unavailable'].includes(item.availability));
  const missing = adopted.filter((item) => item.availability === 'missing');
  const unavailable = adopted.filter((item) => item.availability === 'unavailable');
  const pending = available.filter((item) => item.processing.state !== 'completed'
    || item.processing.processedVersion !== item.version);
  const running = pending.filter((item) => item.processing.state === 'running');
  const failed = pending.filter((item) => ['failed', 'unsupported'].includes(item.processing.state));
  const asFile = (item) => ({ materialId: item.materialId, version: item.version, sha256: item.sha256,
    sha1: item.sha1, size: item.size, filename: path.posix.basename(item.location.relativePath),
    relativePath: item.location.relativePath, locationKind: item.location.kind,
    changeType: item.version > 1 ? 'modified' : 'added' });
  return { version: 3, projectId: project.id, projectName: project.name || '',
    materialStorageMode: 'workspace-v1', registryRevision: index.revision,
    status: running.length ? 'digesting' : failed.length ? 'failed' : pending.length ? 'pending' : 'idle',
    message: pending.length ? `有 ${pending.length} 份已采用资料待处理；文件变化由后台扫描核对。`
      : missing.length || unavailable.length
        ? `有 ${missing.length} 份已采用原件缺失、${unavailable.length} 份来源暂不可访问，已暂停相应消化；请恢复来源后重新扫描。`
        : '暂无已登记的待处理资料。',
    rawPath: project.rawPath, digestFile: path.join(project.managerPath, 'project-materials', 'registry.json'),
    rawFileCount: adopted.length, materialCount: index.materials.length,
    missingCount: missing.length,
    unavailableCount: unavailable.length,
    candidateCount: index.materials.filter((item) => item.adoption.state === 'candidate').length,
    pendingCount: pending.length, submittedCount: running.length,
    pendingFiles: pending.map(asFile), submittedFiles: running.map(asFile),
    digestBatchId: '', digestSubmittedAt: '', lastDigestAt: index.commits.map((item) => item.committedAt || '').sort().at(-1) || '',
    digestedFiles: adopted.filter((item) => item.processing.state === 'completed').map((item) => item.materialId),
    digestManifest: {}, digestBatches: [], knowledgeGovernance: null, updatedAt: index.updatedAt || '' };
}

function createProjectMaterialHost(project, { externalRoots = {} } = {}) {
  invariant(isWorkspaceMaterialProject(project), 'legacy_project', '旧项目尚未切换统一资料模式。');
  normalizeMaterialConfiguration(project);
  const roots = { workspace: { kind: 'workspace', path: project.workspacePath },
    legacy: { kind: 'legacy_raw', path: project.rawPath } };
  if (path.isAbsolute(project.stagingPath || '')) {
    try {
      invariant(!fs.lstatSync(project.stagingPath).isSymbolicLink(), 'linked_path',
        '旧研究暂存目录不能是链接，需先核对来源。');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    roots['legacy-staging'] = { kind: 'external', path: project.stagingPath };
  }
  for (const grant of readProjectExternalRoots(project)) {
    if (grant.ownerStudentId && !(project.studentIds || []).map(String).includes(grant.ownerStudentId)) continue;
    invariant(!roots[grant.rootId], 'external_grants_corrupt', '外部来源授权不能覆盖项目内置资料根。');
    roots[grant.rootId] = { kind: 'external', path: grant.path };
  }
  // Only trusted host configuration supplies explicit external grants, never
  // a request body or an asset's global path.
  for (const [id, root] of Object.entries(externalRoots)) {
    invariant(relativeMaterialPath(id) === id && !id.includes('/'), 'invalid_root', '外部资料根标识必须是单个安全名称。');
    invariant(!roots[id] && root.kind === 'external', 'invalid_root', '外部资料根不能替代项目目录。');
    roots[id] = root;
  }
  const store = createProjectMaterialStore({ projectId: project.id, managerPath: project.managerPath, roots });

  async function registerTerminalUpload(filePath, { eventId, studentId = '', deviceId = '', intent = 'active',
    allowLegacy = false, sourceType = 'terminal_upload', captureSessionId = '', captureItemId = '',
    conversationDeliveryId = '', conversationAssetId = '', conversationInteractionId = '', agentIntentId = '',
    publicationId = '', publicationObjectId = '', publicationSourceNodeId = '',
    publicationMaterialId = '', publicationMaterialVersion = 0,
    collaborationTaskId = '', collaborationAttachmentObjectId = '' } = {}) {
    identifier(eventId, '上传事件ID');
    const relative = path.relative(project.workspacePath, path.resolve(filePath)).replace(/\\/g, '/');
    const inbox = normalizeMaterialConfiguration(project).inboxRelativePath;
    let location;
    if (relative.startsWith(`${inbox}/`)) {
      location = { kind: 'workspace', rootId: 'workspace', relativePath: relativeMaterialPath(relative) };
    } else {
      const legacyRelative = path.relative(project.rawPath, path.resolve(filePath)).replace(/\\/g, '/');
      invariant(allowLegacy && legacyRelative && !legacyRelative.startsWith('../') && legacyRelative !== '..',
        'invalid_upload_location', '终端上传必须落在项目工作空间收件箱。');
      location = { kind: 'legacy_raw', rootId: 'legacy', relativePath: relativeMaterialPath(legacyRelative) };
    }
    const { result: [material], revision } = await store.registerFiles([{ location, source: {
      eventId, type: sourceType, studentId: String(studentId), deviceId: String(deviceId),
      ...(sourceType === 'capture_import' ? { captureSessionId: String(captureSessionId),
        captureItemId: String(captureItemId) } : {}),
      ...(sourceType === 'conversation_delivery' ? { conversationDeliveryId: String(conversationDeliveryId),
        conversationAssetId: String(conversationAssetId) } : {}),
      ...(sourceType === 'conversation_submission' ? { conversationInteractionId: String(conversationInteractionId),
        conversationAssetId: String(conversationAssetId) } : {}),
      ...(sourceType === 'agent_approved_upload' ? { agentIntentId: String(agentIntentId) } : {}),
      ...(sourceType === 'collaboration_publication' ? { publicationId: String(publicationId),
        publicationObjectId: String(publicationObjectId), publicationSourceNodeId: String(publicationSourceNodeId),
        publicationMaterialId: String(publicationMaterialId), publicationMaterialVersion } : {}),
      ...(sourceType === 'collaboration_attachment' ? { collaborationTaskId: String(collaborationTaskId),
        collaborationAttachmentObjectId: String(collaborationAttachmentObjectId) } : {}),
    } }], { intent });
    return { material, revision };
  }

  async function bindUploadedAsset(materialId, asset) {
    identifier(materialId, '资料ID');
    identifier(asset?.assetId, '资产ID');
    const current = await store.resolve(materialId);
    invariant(asset.sha1 === current.sha1 && asset.size === current.size,
      'asset_content_mismatch', '上传资产与登记的资料字节不一致。');
    invariant((asset.references || []).some((ref) => ref.spaceType === 'project'
      && String(ref.spaceId) === project.id && path.isAbsolute(ref.path || '')
      && keyPath(path.resolve(ref.path)) === keyPath(current.path)),
    'asset_scope_mismatch', '上传资产没有指向此项目的原文。');
    await store.mutate((index) => {
      const record = index.materials.find((item) => item.materialId === materialId);
      invariant(record?.version === current.version && record.sha256 === current.sha256,
        'version_conflict', '上传资产关联期间资料版本已变化。');
      record.links.assets ||= [];
      if (!record.links.assets.some((link) => link.assetId === asset.assetId && link.version === current.version)) {
        record.links.assets.push({ assetId: asset.assetId, version: current.version, sha256: current.sha256 });
        record.recordRevision++;
      }
    });
    return { assetId: asset.assetId, materialId, version: current.version };
  }

  async function bindLegacyAssets(assets) {
    invariant(Array.isArray(assets), 'invalid_assets', '资产清单无效。');
    const baseline = await store.read();
    const proposals = [];
    const results = [];
    for (const asset of assets) {
      const references = (asset.references || []).filter((ref) => ref.spaceType === 'project' && String(ref.spaceId) === project.id);
      if (!references.length) { results.push({ assetId: asset.assetId, ok: false, code: 'forbidden' }); continue; }
      if (!/^[a-f0-9]{40}$/.test(asset.sha1 || '')) { results.push({ assetId: asset.assetId, ok: false, code: 'asset_hash_missing' }); continue; }
      const candidates = [];
      for (const item of baseline.materials) {
        if (item.sha1 !== asset.sha1) continue;
        const root = roots[item.location.rootId];
        if (!root) continue;
        const location = path.resolve(root.path, item.location.relativePath);
        // Hash alone cannot distinguish two identical documents in a project.
        if (!references.some((ref) => path.isAbsolute(ref.path || '') && keyPath(path.resolve(ref.path)) === keyPath(location))) continue;
        candidates.push(item);
      }
      if (candidates.length !== 1) {
        results.push({ assetId: asset.assetId, ok: false, code: candidates.length ? 'ambiguous_asset' : 'asset_unmapped' }); continue;
      }
      const item = candidates[0];
      await store.resolve(item.materialId); // Real original, not another project's matching hash.
      proposals.push({ assetId: identifier(asset.assetId, '资产ID'), materialId: item.materialId,
        version: item.version, sha256: item.sha256, recordRevision: item.recordRevision });
    }
    if (proposals.length) await store.mutate((index) => {
      const revisions = new Map(index.materials.map((item) => [item.materialId, item.recordRevision]));
      for (const proposal of proposals) {
        const item = index.materials.find((record) => record.materialId === proposal.materialId);
        if (!item || revisions.get(item.materialId) !== proposal.recordRevision) {
          results.push({ assetId: proposal.assetId, ok: false, code: 'version_conflict' }); continue;
        }
        item.links.assets ||= [];
        if (!item.links.assets.some((link) => link.assetId === proposal.assetId && link.version === proposal.version)) {
          item.links.assets.push({ assetId: proposal.assetId, version: proposal.version, sha256: proposal.sha256 });
          item.recordRevision++;
        }
        results.push({ assetId: proposal.assetId, materialId: item.materialId, version: item.version, ok: true });
      }
    });
    return results;
  }

  async function resolveAsset(assetId, { materialId, version } = {}) {
    identifier(assetId, '资产ID');
    const index = await store.read();
    const candidates = index.materials.flatMap((item) => (item.links.assets || [])
      .filter((link) => link.assetId === assetId && (!materialId || materialId === item.materialId)
        && (version === undefined || version === link.version))
      .map((link) => ({ materialId: item.materialId, version: link.version })));
    invariant(candidates.length === 1, candidates.length ? 'ambiguous_asset' : 'asset_unmapped',
      '资产尚未唯一关联此项目的资料版本，需要定位后再操作。');
    return store.resolve(candidates[0].materialId, candidates[0].version);
  }

  async function publicationSources(options = {}) {
    const index = await store.read();
    const all = index.materials.filter((item) => item.adoption.state === 'accepted');
    let selected = all;
    if (options.scope === 'selected') {
      const requested = Array.isArray(options.materials) ? options.materials : [];
      const paths = Array.isArray(options.selectedPaths) ? options.selectedPaths.map(relativeMaterialPath) : [];
      invariant(requested.length || paths.length, 'empty_selection', '请选择本次发布的来源，空选择不能扩大为全部资料。');
      if (requested.length) {
        invariant(new Set(requested.map((item) => item.materialId)).size === requested.length, 'duplicate_material', '发布来源重复。');
        selected = requested.map((input) => {
          const item = all.find((record) => record.materialId === identifier(input.materialId));
          invariant(item, 'source_not_adopted', '发布只能包含当前项目已采用的资料。');
          invariant(item.version === positiveVersion(input.version), 'version_conflict', '所选来源版本已更新，请重新确认发布范围。');
          return item;
        });
      } else {
        selected = paths.flatMap((relative) => {
          const matches = all.filter((item) => keyPath(`${item.location.rootId}/${item.location.relativePath}`) === keyPath(relative)
            || keyPath(item.location.relativePath) === keyPath(relative));
          invariant(matches.length <= 1, 'ambiguous_selection', '同名来源位于不同资料根，请使用资料ID选择。');
          invariant(matches.length || (options.allowedOtherPaths || []).includes(relative), 'source_not_adopted', '所选来源未采用或已不在项目中。');
          return matches;
        });
        selected = [...new Map(selected.map((item) => [item.materialId, item])).values()];
      }
    }
    const output = [];
    for (const item of selected) {
      // Verify the live original before fixing the export version. Editing the
      // original after this cannot change bytes sent by the package builder.
      const current = await store.resolve(item.materialId);
      invariant(current.version === item.version, 'version_conflict', '发布准备期间来源已更新。');
      const fixed = await store.snapshot(item.materialId, item.version);
      output.push({ sourcePath: fixed.path, kind: 'raw_material', materialId: item.materialId,
        materialVersion: item.version, sha256: fixed.sha256, sha1: fixed.sha1, size: fixed.size,
        // Root ID namespaces avoid a legacy/workspace same-name collision.
        relativePath: `${item.location.rootId}/${item.location.relativePath}`, displayPath: item.location.relativePath,
        knowledgeKind: '', sourceAssetIds: (item.links.assets || []).filter((link) => link.version === item.version).map((link) => link.assetId),
        sourceRelativePaths: [], processed: item.processing.state === 'completed' && item.processing.processedVersion === item.version });
    }
    // Recheck adoption after slow copies, then pin only this verified manifest.
    if (output.length) await store.mutate((fresh) => {
      for (const source of output) {
        const item = fresh.materials.find((record) => record.materialId === source.materialId);
        invariant(item?.adoption.state === 'accepted' && item.version === source.materialVersion && item.sha256 === source.sha256,
          'source_changed', '发布准备期间采用状态或来源版本发生变化。');
        const version = item.versions.find((value) => value.version === source.materialVersion);
        version.pins ||= [];
        const pin = `publication:${crypto.createHash('sha256').update(JSON.stringify(output.map((value) => [value.materialId, value.materialVersion]))).digest('hex')}`;
        if (!version.pins.includes(pin)) version.pins.push(pin);
      }
    });
    return output;
  }

  return { store, registerTerminalUpload, bindUploadedAsset, bindLegacyAssets, resolveAsset, publicationSources };
}

module.exports = { isWorkspaceMaterialProject, normalizeMaterialConfiguration, readProjectMaterialIndexSync,
  projectMaterialDigestProjection, createProjectMaterialHost };
