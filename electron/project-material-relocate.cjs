const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { identifier, invariant, positiveVersion, relativeMaterialPath } = require('./project-material-contract.cjs');
const { hashStableFile } = require('./project-materials.cjs');

const locationKey = (location) => JSON.stringify([location.kind, location.rootId,
  pathKey(location.relativePath)]);
const hasLinks = (links) => Object.values(links || {}).some((value) => Array.isArray(value)
  ? value.length > 0 : Boolean(value));

function requireMergeableScanDuplicate(index, record) {
  invariant(record?.location.kind === 'workspace' && record.location.rootId === 'workspace'
    && record.version === 1 && record.availability === 'available'
    && record.adoption.state === 'candidate'
    && record.processing.state === 'pending'
    && !record.processing.batchId && !record.processing.processedVersion
    && !record.classification?.categoryId && !record.classification?.manualLocked
    && (!record.classification?.tags || record.classification.tags.length === 0)
    && record.organizationState === 'unclassified'
    && !hasLinks(record.links)
    && record.versions.length === 1 && !record.versions[0].snapshot
    && !(record.versions[0].pins || []).length
    && !(record.legacyAliases || []).length
    && Array.isArray(record.sources) && record.sources.length > 0
    && record.sources.every((item) => item.type === 'workspace_scan' && item.deviceId === 'local-host'
      && !item.studentId), 'duplicate_has_dependencies',
  '目标资料已有采用、分类、处理或引用，不能自动纠正身份；请保留两份登记并人工核对。');
  const elsewhere = { ...index, materials: index.materials.filter((item) => item.materialId !== record.materialId) };
  invariant(!JSON.stringify(elsewhere).includes(record.materialId), 'duplicate_has_dependencies',
    '目标资料ID已被其他项目记录引用，不能合并。');
}

const pathKey = (value) => process.platform === 'win32' ? value.toLowerCase() : value;
const within = (root, target) => {
  const relative = path.relative(root, target);
  return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
};

async function targetLocation(project, targetPath) {
  invariant(path.isAbsolute(targetPath || ''), 'invalid_path', '请选择本机上的原件文件。');
  const real = await fs.realpath(targetPath);
  const stat = await fs.stat(real);
  invariant(stat.isFile(), 'not_file', '所选来源不是普通文件。');
  for (const forbidden of [project.managerPath, project.knowledgeRootPath].filter(Boolean)) {
    const root = await fs.realpath(forbidden).catch((error) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    invariant(!root || !within(root, real), 'generated_source', '不能用管理或知识产物目录充当原件。');
  }
  for (const candidate of [
    { kind: 'workspace', rootId: 'workspace', path: project.workspacePath },
    { kind: 'legacy_raw', rootId: 'legacy', path: project.rawPath },
    { kind: 'external', rootId: 'legacy-staging', path: project.stagingPath },
  ]) {
    if (!candidate.path) continue;
    const root = await fs.realpath(candidate.path).catch((error) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    if (!root || !within(root, real)) continue;
    return { path: real, location: { kind: candidate.kind, rootId: candidate.rootId,
      relativePath: relativeMaterialPath(path.relative(root, real).replace(/\\/g, '/')) } };
  }
  invariant(false, 'ungranted_source', '原件必须位于当前项目工作空间或已接管的旧资料目录。');
}

async function relocateProjectMaterial(project, host, {
  materialId, expectedVersion, expectedRecordRevision, targetPath,
  confirmedDuplicateId = '', confirmedDuplicateRevision,
}) {
  identifier(materialId, '资料ID');
  positiveVersion(expectedVersion);
  invariant(Number.isSafeInteger(expectedRecordRevision) && expectedRecordRevision >= 0,
    'invalid_revision', '资料审核修订号无效。');
  const selected = await targetLocation(project, targetPath);
  const baseline = await host.store.read();
  const record = baseline.materials.find((item) => item.materialId === materialId);
  invariant(record && record.projectId === project.id, 'material_missing', '此项目没有该资料。');
  invariant(record.version === expectedVersion, 'version_conflict', '资料版本已变化，请刷新后重新定位。');
  const sameLocation = record.location.kind === selected.location.kind
    && record.location.rootId === selected.location.rootId
    && pathKey(record.location.relativePath) === pathKey(selected.location.relativePath);
  if (sameLocation && record.availability === 'available') {
    await host.store.resolve(materialId);
    return { materialId, version: record.version, location: record.location, unchanged: true };
  }
  invariant(record.recordRevision === expectedRecordRevision, 'version_conflict',
    '资料状态已变化，请刷新后重新定位。');
  invariant(['missing', 'unavailable'].includes(record.availability), 'source_still_available',
    '当前登记原件仍可用；如需主动移动，请使用受控整理操作。');
  try {
    await host.store.resolve(materialId);
    invariant(false, 'source_still_available', '原登记位置已有可验证的原件，请先重新扫描。');
  } catch (error) {
    if (error.code === 'source_still_available') throw error;
    invariant(['ENOENT', 'EACCES', 'EPERM', 'linked_path', 'source_changed', 'unknown_root'].includes(error.code),
      'source_unavailable', '原来源状态不明确，不能直接改绑。');
  }
  const observed = await hashStableFile(selected.path);
  invariant(observed.sha256 === record.sha256, 'content_mismatch',
    '所选文件与登记版本字节不同；不能仅凭文件名或大小合并为同一资料。');
  const occupant = baseline.materials.find((item) => locationKey(item.location) === locationKey(selected.location));
  if (occupant && occupant.materialId !== materialId) {
    requireMergeableScanDuplicate(baseline, occupant);
    invariant(occupant.sha256 === record.sha256 && occupant.fileKey === observed.fileKey,
      'source_changed', '目标登记与当前原件不一致，请重新扫描后核对。');
    invariant(confirmedDuplicateId === occupant.materialId
      && confirmedDuplicateRevision === occupant.recordRevision,
    'duplicate_confirmation_required', '目标已被扫描成另一份待采用资料；须明确确认身份纠正。',
    { duplicateMaterialId: occupant.materialId, duplicateRecordRevision: occupant.recordRevision,
      duplicateRelativePath: occupant.location.relativePath });
    const changedAt = new Date().toISOString();
    const { result: moved } = await host.store.mutate((index) => {
      const source = index.materials.find((item) => item.materialId === materialId);
      const duplicate = index.materials.find((item) => item.materialId === occupant.materialId);
      invariant(source?.recordRevision === expectedRecordRevision && source.version === expectedVersion
        && duplicate?.recordRevision === confirmedDuplicateRevision
        && locationKey(duplicate.location) === locationKey(selected.location),
      'version_conflict', '身份纠正期间资料状态已变化，请刷新后重新确认。');
      requireMergeableScanDuplicate(index, duplicate);
      invariant(source.sha256 === observed.sha256 && duplicate.sha256 === observed.sha256
        && duplicate.fileKey === observed.fileKey, 'source_changed', '资料字节或文件身份已变化。');
      index.materialMergeHistory ||= [];
      index.materialMergeHistory.push({ mergeId: `material-merge-${crypto.randomUUID()}`,
        mergedAt: changedAt, sourceBefore: structuredClone(source),
        duplicateBefore: structuredClone(duplicate) });
      const oldLocation = structuredClone(source.location);
      source.legacyAliases.push({ location: oldLocation, version: source.version, movedAt: changedAt });
      source.legacyAliases.push({ materialId: duplicate.materialId,
        location: structuredClone(duplicate.location), version: duplicate.version, movedAt: changedAt });
      const eventIds = new Set(source.sources.map((item) => item.eventId));
      for (const event of duplicate.sources) {
        if (!eventIds.has(event.eventId)) { source.sources.push(structuredClone(event)); eventIds.add(event.eventId); }
      }
      source.sources.push({ eventId: `manual-relocation-${crypto.randomUUID()}`,
        type: 'manual_relocation', deviceId: 'local-host', studentId: '' });
      Object.assign(source, observed, { location: structuredClone(selected.location),
        availability: 'available', contentVerifiedAt: changedAt, updatedAt: changedAt,
        recordRevision: source.recordRevision + 1 });
      index.materialIdAliases ||= [];
      index.materialIdAliases.push({ materialId: duplicate.materialId,
        canonicalMaterialId: source.materialId, fromVersion: duplicate.version,
        toVersion: source.version, sha256: source.sha256, mergedAt: changedAt });
      index.materials.splice(index.materials.indexOf(duplicate), 1);
      return { materialId: source.materialId, version: source.version, location: source.location,
        unchanged: false, mergedDuplicateId: duplicate.materialId };
    }, baseline.revision);
    await host.store.resolve(materialId);
    return moved;
  }
  const { result: [moved] } = await host.store.registerFiles([{ location: selected.location,
    materialId, expectedVersion, expectedSha256: record.sha256,
    source: { eventId: `manual-relocation-${crypto.randomUUID()}`, type: 'manual_relocation',
      deviceId: 'local-host', studentId: '' },
  }], { expectedRevision: baseline.revision });
  invariant(moved.materialId === materialId && moved.version === expectedVersion,
    'version_conflict', '重新定位期间资料版本发生变化。');
  await host.store.resolve(materialId);
  return { materialId, version: moved.version, location: moved.location, unchanged: false };
}

module.exports = { relocateProjectMaterial, targetLocation };
