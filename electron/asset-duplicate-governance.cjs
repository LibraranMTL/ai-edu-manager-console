'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { hashStableFile } = require('./file-fingerprint.cjs');

const PROTECTED_ROLES = new Set(['project_raw_accepted', 'project_material', 'student_raw', 'legacy_asset_path']);

function codeError(code, message, extra = {}) { return Object.assign(new Error(message), { code, ...extra }); }
function pathKey(value) { return process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value); }
function inside(root, target) {
  if (!root || !target) return false;
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
function scopeKey(reference) {
  if (reference.spaceType === 'student' && reference.spaceId) return `student:${reference.spaceId}`;
  if (reference.spaceType === 'project' && reference.spaceId) return `project:${reference.spaceId}`;
  return '';
}
async function stableFingerprint(file) {
  try { return await hashStableFile(file, { rejectSymbolicLink: true }); }
  catch (error) {
    if (['linked_path', 'not_file'].includes(error.code)) throw codeError('asset_scope_protected', '路径不是可治理的普通文件。');
    if (error.code === 'source_changed') throw codeError('asset_file_changed', '文件在指纹校验期间发生变化。');
    throw error;
  }
}

async function copyVerified(source, destination, expected) {
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await new Promise((resolve, reject) => {
      const input = fs.createReadStream(source), output = fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 });
      input.on('error', reject); output.on('error', reject); output.on('finish', resolve); input.pipe(output);
    });
    const descriptor = await fsp.open(temporary, 'r+');
    try { await descriptor.sync(); } finally { await descriptor.close(); }
    const actual = await stableFingerprint(temporary);
    if (actual.size !== expected.size || actual.sha256 !== expected.sha256 || (expected.sha1 && actual.sha1 !== expected.sha1)) {
      throw codeError('asset_file_changed', '隔离副本校验失败。');
    }
    await fsp.rename(temporary, destination);
  } finally { await fsp.rm(temporary, { force: true }).catch(() => {}); }
}

function chooseKeep(records) {
  return [...records].sort((left, right) => {
    const protectedDiff = Number(right.protected) - Number(left.protected);
    if (protectedDiff) return protectedDiff;
    const referenceDiff = right.references.length - left.references.length;
    if (referenceDiff) return referenceDiff;
    const leftAt = left.references.map(item => item.linkedAt || '').filter(Boolean).sort()[0] || '9999';
    const rightAt = right.references.map(item => item.linkedAt || '').filter(Boolean).sort()[0] || '9999';
    return leftAt.localeCompare(rightAt) || pathKey(left.path).localeCompare(pathKey(right.path));
  })[0];
}

function createAssetDuplicateGovernance({ store, quarantineRoot, authorizedRoots = () => [], notify = () => {}, now = Date.now }) {
  let activeOperationId = '';

  function isAuthorized(record, candidatePath) {
    return authorizedRoots().some(root => root.spaceType === record.spaceType && String(root.spaceId) === String(record.spaceId)
      && inside(root.path, candidatePath));
  }

  async function prepare(request = {}) {
    if (activeOperationId) throw codeError('asset_operation_busy', '已有重复文件治理任务正在运行。');
    const assetIds = [...new Set((request.assetIds || []).map(String).filter(Boolean))].slice(0, 100);
    if (!assetIds.length) throw codeError('asset_not_found', '请先选择要处理的重复文件组。');
    const operationId = `asset-duplicates-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const operationRoot = path.join(quarantineRoot, operationId);
    const entries = [];
    const blocked = [];
    for (const assetId of assetIds) {
      const asset = store.getAssetDetail(assetId);
      if (!asset) continue;
      if (!asset.sha256) {
        blocked.push({ assetId, reason: '资产尚未补齐 SHA-256。' });
        continue;
      }
      if (asset.governanceStatus === 'fingerprint_conflict') {
        blocked.push({ assetId, reason: '资产存在指纹冲突。' });
        continue;
      }
      const assetScopes = new Set(asset.references.filter(item => item.state === 'active').map(scopeKey).filter(Boolean));
      if (assetScopes.size > 1) {
        blocked.push({ assetId, reason: '资产跨学生或项目空间使用，受保护且不自动隔离。' });
        continue;
      }
      const pathMap = new Map();
      for (const reference of asset.references.filter(item => item.state === 'active' && item.path)) {
        const key = pathKey(reference.path);
        const current = pathMap.get(key) || { path: reference.path, references: [], scopes: new Set(), protected: false };
        current.references.push(reference);
        const scope = scopeKey(reference); if (scope) current.scopes.add(scope);
        current.protected ||= PROTECTED_ROLES.has(reference.role);
        pathMap.set(key, current);
      }
      const records = [];
      for (const record of pathMap.values()) {
        if (record.scopes.size !== 1) { blocked.push({ assetId, path: record.path, reason: '路径跨空间共享或缺少明确空间。' }); continue; }
        const [scope] = record.scopes; const [spaceType, spaceId] = scope.split(':');
        if (!isAuthorized({ spaceType, spaceId }, record.path)) { blocked.push({ assetId, path: record.path, reason: '路径不在已授权空间内。' }); continue; }
        try {
          const fingerprint = await stableFingerprint(record.path);
          if (fingerprint.sha1 !== asset.sha1 || fingerprint.sha256 !== asset.sha256 || fingerprint.size !== Number(asset.size)) {
            blocked.push({ assetId, path: record.path, reason: '当前文件指纹与资产记录不一致。' }); continue;
          }
          records.push({ ...record, scope, spaceType, spaceId, ...fingerprint });
        } catch (error) { blocked.push({ assetId, path: record.path, reason: error.message }); }
      }
      const byScope = new Map();
      for (const record of records) byScope.set(record.scope, [...(byScope.get(record.scope) || []), record]);
      for (const scoped of byScope.values()) {
        if (scoped.length < 2) continue;
        const keep = chooseKeep(scoped);
        for (const candidate of scoped) {
          if (candidate === keep) continue;
          if (candidate.protected) { blocked.push({ assetId, path: candidate.path, reason: '权威原件角色受保护。' }); continue; }
          if (candidate.fileKey === keep.fileKey) { blocked.push({ assetId, path: candidate.path, reason: '与保留路径是同一硬链接文件。' }); continue; }
          const entryId = `duplicate-${crypto.createHash('sha256').update(`${operationId}|${assetId}|${candidate.path}`).digest('hex').slice(0, 24)}`;
          entries.push({ entryId, assetId, keepPath: keep.path, sourcePath: candidate.path,
            quarantinePath: path.join(operationRoot, 'files', entryId, path.basename(candidate.path)),
            spaceType: candidate.spaceType, spaceId: candidate.spaceId, sha1: asset.sha1, sha256: asset.sha256,
            size: candidate.size, mtimeMs: candidate.mtimeMs, fileKey: candidate.fileKey, status: 'eligible',
            references: candidate.references });
        }
      }
    }
    const summary = { groupCount: assetIds.length, eligibleCount: entries.length, blockedCount: blocked.length,
      reclaimableBytes: entries.reduce((sum, item) => sum + item.size, 0), blocked };
    await fsp.mkdir(operationRoot, { recursive: true });
    await fsp.writeFile(path.join(operationRoot, 'manifest.json'), `${JSON.stringify({ operationId, createdAt: new Date(now()).toISOString(), summary, entries }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    return store.createDuplicateOperation({ operationId, status: 'prepared', createdAt: new Date(now()).toISOString(), filter: request, summary }, entries);
  }

  async function isolateEntry(operation, entry) {
    const temporarySource = `${entry.sourcePath}.edu-quarantine-${entry.entryId}.tmp`;
    const source = await stableFingerprint(entry.sourcePath);
    const keep = await stableFingerprint(entry.keepPath);
    if (source.sha1 !== entry.sha1 || keep.sha1 !== entry.sha1 || source.sha256 !== entry.sha256 || keep.sha256 !== entry.sha256 || source.size !== entry.size) {
      throw codeError('asset_file_changed', '源文件或保留文件已发生变化。');
    }
    if (source.fileKey !== entry.fileKey) throw codeError('asset_file_changed', '源文件标识已发生变化。');
    if (source.fileKey === keep.fileKey) throw codeError('asset_scope_protected', '源路径与保留路径是同一硬链接文件。');
    store.updateDuplicateEntry(entry.entryId, { status: 'renaming', error: '' });
    await fsp.rename(entry.sourcePath, temporarySource);
    store.updateDuplicateEntry(entry.entryId, { status: 'renamed' });
    try {
      await copyVerified(temporarySource, entry.quarantinePath, entry);
      store.updateDuplicateEntry(entry.entryId, { status: 'copied', quarantinePath: entry.quarantinePath });
      await fsp.rm(temporarySource);
      store.transaction(() => {
        store.setReferenceQuarantine(entry.assetId, entry.sourcePath, operation.operationId, true);
        const asset = store.getAssetDetail(entry.assetId);
        if (asset && pathKey(asset.path) === pathKey(entry.sourcePath)) store.patchAsset(entry.assetId, { path: entry.keepPath });
        store.updateDuplicateEntry(entry.entryId, { status: 'quarantined' });
      });
    } catch (error) {
      if (fs.existsSync(temporarySource) && !fs.existsSync(entry.sourcePath)) await fsp.rename(temporarySource, entry.sourcePath).catch(() => {});
      throw error;
    }
  }

  async function apply(operationId, entryIds = []) {
    if (activeOperationId) throw codeError('asset_operation_busy', '已有重复文件治理任务正在运行。');
    const operation = store.duplicateOperation(operationId);
    if (!operation || operation.status !== 'prepared') throw codeError('asset_not_found', '重复文件治理预览不存在或已经执行。');
    const selected = new Set(entryIds.map(String));
    const entries = operation.entries.filter(entry => entry.status === 'eligible' && (!selected.size || selected.has(entry.entryId)));
    if (!entries.length) throw codeError('asset_not_found', '没有可隔离的重复文件。');
    activeOperationId = operationId;
    store.updateDuplicateOperation(operationId, { status: 'applying', confirmedAt: new Date(now()).toISOString() });
    notify({ operationId, status: 'applying', total: entries.length, processed: 0 });
    let completed = 0, failed = 0;
    try {
      for (const entry of entries) {
        try { await isolateEntry(operation, entry); completed += 1; }
        catch (error) { failed += 1; store.updateDuplicateEntry(entry.entryId, { status: 'failed', error: error.message }); }
        notify({ operationId, status: 'applying', total: entries.length, processed: completed + failed, completed, failed, currentPath: entry.sourcePath });
      }
      const status = failed ? completed ? 'partial' : 'failed' : 'completed';
      const summary = { ...operation.summary, selectedCount: entries.length, completedCount: completed, failedCount: failed };
      const result = store.updateDuplicateOperation(operationId, { status, finishedAt: new Date(now()).toISOString(), summary,
        error: failed ? `${failed} 个文件未能隔离。` : '' });
      notify({ operationId, status, total: entries.length, processed: entries.length, completed, failed });
      return result;
    } finally { activeOperationId = ''; }
  }

  async function restore(operationId, entryIds = []) {
    if (activeOperationId) throw codeError('asset_operation_busy', '已有重复文件治理任务正在运行。');
    const operation = store.duplicateOperation(operationId);
    if (!operation) throw codeError('asset_not_found', '未找到隔离操作。');
    const selected = new Set(entryIds.map(String));
    const entries = operation.entries.filter(entry => entry.status === 'quarantined' && (!selected.size || selected.has(entry.entryId)));
    activeOperationId = operationId;
    let restored = 0, failed = 0;
    try {
      for (const entry of entries) {
        try {
          if (fs.existsSync(entry.sourcePath)) throw codeError('asset_quarantine_conflict', '原路径已经存在文件，未执行覆盖。');
          const quarantine = await stableFingerprint(entry.quarantinePath);
          if (quarantine.sha256 !== entry.sha256 || quarantine.size !== entry.size) throw codeError('asset_file_changed', '隔离文件校验失败。');
          const temporary = `${entry.sourcePath}.edu-restore-${entry.entryId}.tmp`;
          await copyVerified(entry.quarantinePath, temporary, entry);
          await fsp.rename(temporary, entry.sourcePath);
          store.transaction(() => {
            store.setReferenceQuarantine(entry.assetId, entry.sourcePath, operationId, false);
            store.updateDuplicateEntry(entry.entryId, { status: 'restored', error: '' });
          });
          await fsp.rm(entry.quarantinePath, { force: true });
          restored += 1;
        } catch (error) { failed += 1; store.updateDuplicateEntry(entry.entryId, { status: 'restore_failed', error: error.message }); }
        notify({ operationId, status: 'restoring', total: entries.length, processed: restored + failed, restored, failed, currentPath: entry.sourcePath });
      }
      const result = store.updateDuplicateOperation(operationId, { status: failed ? 'restore_partial' : 'restored',
        finishedAt: new Date(now()).toISOString(), error: failed ? `${failed} 个文件未能恢复。` : '' });
      return result;
    } finally { activeOperationId = ''; }
  }

  async function retry(operationId, entryIds = []) {
    if (activeOperationId) throw codeError('asset_operation_busy', '已有重复文件治理任务正在运行。');
    const previous = store.duplicateOperation(operationId);
    if (!previous) throw codeError('asset_not_found', '未找到要重试的重复文件治理任务。');
    const selected = new Set((entryIds || []).map(String).filter(Boolean));
    const retryable = previous.entries.filter(entry => ['failed', 'restore_failed', 'recovered'].includes(entry.status)
      && (!selected.size || selected.has(entry.entryId)));
    if (!retryable.length) throw codeError('asset_not_found', '当前操作没有可重新校验的失败项。');
    return prepare({
      assetIds: [...new Set(retryable.map(entry => entry.assetId))],
      retryOfOperationId: previous.operationId,
      retryEntryIds: retryable.map(entry => entry.entryId),
    });
  }

  async function recover() {
    const rows = store.db.prepare("SELECT operation_id FROM asset_duplicate_operations WHERE status='applying'").all();
    for (const row of rows) {
      const operation = store.duplicateOperation(row.operation_id);
      for (const entry of operation.entries.filter(item => ['renaming', 'renamed', 'copied'].includes(item.status))) {
        const temporary = `${entry.sourcePath}.edu-quarantine-${entry.entryId}.tmp`;
        if (fs.existsSync(temporary) && !fs.existsSync(entry.sourcePath)) {
          await fsp.rename(temporary, entry.sourcePath).catch(() => {});
          store.updateDuplicateEntry(entry.entryId, { status: 'recovered', error: '应用异常退出，已恢复原路径。' });
        } else if (!fs.existsSync(entry.sourcePath) && fs.existsSync(entry.quarantinePath)) {
          store.transaction(() => {
            store.setReferenceQuarantine(entry.assetId, entry.sourcePath, operation.operationId, true);
            const asset = store.getAssetDetail(entry.assetId);
            if (asset && pathKey(asset.path) === pathKey(entry.sourcePath)) store.patchAsset(entry.assetId, { path: entry.keepPath });
            store.updateDuplicateEntry(entry.entryId, { status: 'quarantined', error: '' });
          });
        } else store.updateDuplicateEntry(entry.entryId, { status: 'failed', error: '无法自动确认文件状态，请人工核对。' });
      }
      store.updateDuplicateOperation(operation.operationId, { status: 'interrupted', finishedAt: new Date(now()).toISOString(),
        error: '上次隔离任务异常中止，已执行恢复检查。' });
    }
  }

  return {
    listGroups: request => store.listDuplicateGroups(request),
    history: request => store.listDuplicateOperations(request),
    prepare,
    apply,
    status: id => store.duplicateOperation(id),
    restore,
    retry,
    recover,
  };
}

module.exports = { createAssetDuplicateGovernance, stableFingerprint, inside, scopeKey, chooseKeep };
