const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  invariant, identifier, relativeMaterialPath,
} = require('./project-material-contract.cjs');
const {
  hashStableFile, safePath, within, writeJsonAtomic,
} = require('./project-materials.cjs');
const { isSystemGeneratedMaterialPath } = require('./project-material-automation.cjs');

const queues = new Map();
const MAX_PREVIEW_FILES = 5000;
const MAX_EXECUTE_ITEMS = 100;
const PRESERVED_EXTENSIONS = new Set([
  '.html', '.htm', '.mhtml', '.css', '.js', '.mjs', '.cjs', '.json', '.xml',
  '.dwg', '.dxf', '.step', '.stp', '.blend', '.psd', '.indd', '.prproj',
]);
const clone = (value) => structuredClone(value);
const timestamp = () => new Date().toISOString();
const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const keyPath = (value) => process.platform === 'win32'
  ? path.resolve(value).toLocaleLowerCase('zh-CN') : path.resolve(value);
const locationKey = (value) => JSON.stringify([value?.rootId,
  process.platform === 'win32' ? String(value?.relativePath || '').toLocaleLowerCase('zh-CN')
    : String(value?.relativePath || '')]);
const contains = (root, target) => keyPath(root) === keyPath(target) || within(path.resolve(root), path.resolve(target));

function ensureMigrationState(index) {
  index.migrationOperations ||= [];
  index.migrationReceipts ||= [];
  invariant(index.migrationOperations.length <= 1000 && index.migrationReceipts.length <= 3000,
    'migration_capacity', '项目迁移回执已达到安全上限，请先在主机归档。');
}

function publicItem(item) {
  return {
    itemId: item.itemId, materialId: item.materialId || '', title: item.title,
    sourceKind: item.sourceKind, sourceRelativePath: item.source.relativePath,
    targetRelativePath: item.target?.relativePath || '', action: item.action,
    status: item.status, code: item.code || '', message: item.message || '',
    retryable: Boolean(item.retryable), recovered: Boolean(item.recovered),
    rollbackStatus: item.rollbackStatus || '', rollbackCode: item.rollbackCode || '',
    size: item.snapshot?.size || 0, version: item.version || 0,
  };
}

function publicOperation(operation) {
  const items = (operation.items || []).map(publicItem);
  return {
    operationId: operation.operationId, previewId: operation.previewId,
    status: operation.status, createdAt: operation.createdAt,
    completedAt: operation.completedAt || '', items,
    hasPhysicalCopies: items.some((item) => ['migrate', 'associate_existing'].includes(item.action)
      && item.status === 'succeeded'),
    counts: {
      total: items.length,
      succeeded: items.filter((item) => item.status === 'succeeded').length,
      failed: items.filter((item) => item.status === 'failed').length,
      attention: items.filter((item) => item.status === 'recovery_required'
        || item.status === 'source_retained').length,
      retryable: items.filter((item) => item.retryable).length,
      rolledBack: items.filter((item) => item.rollbackStatus === 'succeeded').length,
    },
  };
}

function publicPreview(preview) {
  return {
    previewId: preview.previewId, projectId: preview.projectId, status: preview.status || 'current',
    createdAt: preview.createdAt, registryRevision: preview.registryRevision,
    truncated: Boolean(preview.truncated),
    items: preview.items.map((item) => ({
      itemId: item.itemId, materialId: item.materialId || '', title: item.title,
      sourceKind: item.sourceKind, sourceLabel: item.sourceLabel,
      sourceRelativePath: item.source.relativePath,
      targetRelativePath: item.target?.relativePath || '', action: item.action,
      code: item.code || '', reason: item.reason || '', size: item.snapshot?.size || 0,
      registered: Boolean(item.materialId),
    })),
    counts: {
      total: preview.items.length,
      workspace: preview.items.filter((item) => item.action === 'associate').length,
      migratable: preview.items.filter((item) => ['migrate', 'associate_existing'].includes(item.action)).length,
      preserved: preview.items.filter((item) => item.action === 'preserve').length,
      conflicts: preview.items.filter((item) => Boolean(item.code)).length,
    },
  };
}

function migrationError(error) {
  const code = String(error?.code || 'migration_io_error');
  return {
    code, message: String(error?.message || '历史资料迁移失败。').slice(0, 500),
    retryable: !['source_changed', 'target_occupied', 'dependency_group', 'linked_path',
      'location_conflict', 'version_conflict', 'invalid_path'].includes(code),
  };
}

async function serialized(projectId, work) {
  const previous = queues.get(projectId) || Promise.resolve();
  const current = previous.catch(() => {}).then(work);
  queues.set(projectId, current);
  try { return await current; } finally {
    if (queues.get(projectId) === current) queues.delete(projectId);
  }
}

async function exists(file) {
  try { return await fsp.lstat(file); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function publishCopy(source, temporary, target, expectedSha256, { uniqueTarget = false } = {}) {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  let temporaryStat = await exists(temporary);
  if (!temporaryStat) {
    const copied = await hashStableFile(source, { copyTo: temporary });
    invariant(copied.sha256 === expectedSha256, 'source_changed', '迁移源在复制期间发生变化。');
    temporaryStat = await fsp.lstat(temporary);
  } else {
    invariant(temporaryStat.isFile() && !temporaryStat.isSymbolicLink(),
      'recovery_conflict', '迁移临时文件类型异常。');
    const copied = await hashStableFile(temporary);
    invariant(copied.sha256 === expectedSha256, 'recovery_conflict', '迁移临时文件校验失败。');
  }
  const targetStat = await exists(target);
  if (!targetStat) {
    try { await fsp.link(temporary, target); }
    catch (error) {
      invariant(error.code !== 'EEXIST', 'target_occupied', '迁移目标已有文件，未覆盖。');
      invariant(false, 'safe_publish_unavailable', '当前文件系统不支持安全的无覆盖迁移发布。');
    }
  } else if (uniqueTarget) {
    const current = await hashStableFile(target);
    invariant(current.sha256 === expectedSha256, 'recovery_conflict', '迁移备份与原计划不一致。');
  } else {
    const latestTemporary = await fsp.lstat(temporary);
    invariant(targetStat.isFile() && !targetStat.isSymbolicLink()
      && targetStat.dev === latestTemporary.dev && targetStat.ino === latestTemporary.ino,
    'target_occupied', '迁移目标已有其他文件，未覆盖。');
  }
  const published = await hashStableFile(target);
  invariant(published.sha256 === expectedSha256, 'migration_verification_failed', '迁移副本校验失败。');
  return published;
}

function rootDefinitions(project) {
  return [
    { rootId: 'workspace', kind: 'workspace', label: '项目工作空间', path: project.workspacePath },
    { rootId: 'legacy', kind: 'legacy_raw', label: '旧原始资料库', path: project.rawPath },
    { rootId: 'legacy-staging', kind: 'external', label: '旧研究暂存', path: project.stagingPath },
  ].filter((item) => path.isAbsolute(String(item.path || '')));
}

function migrationTarget(project, rootId, relativePath) {
  const inbox = relativeMaterialPath(project.inboxRelativePath || '收件箱');
  const label = rootId === 'legacy' ? '旧原始资料库' : '旧研究暂存';
  return relativeMaterialPath(`${inbox}/历史迁移/${label}/${relativePath}`);
}

function dependencyProtected(relativePath) {
  const extension = path.posix.extname(relativePath).toLowerCase();
  const stem = path.posix.basename(relativePath, extension).toLowerCase();
  return PRESERVED_EXTENSIONS.has(extension) || relativePath.split('/').some((part) =>
    part.toLowerCase() === `${stem}_files` || part.toLowerCase().endsWith('.assets'));
}

function createProjectMaterialMigration(project, store, hooks = {}) {
  identifier(project?.id, '项目ID');
  invariant(path.isAbsolute(project.workspacePath || '') && path.isAbsolute(project.managerPath || ''),
    'invalid_root', '项目迁移目录无效。');
  invariant(store && typeof store.read === 'function' && typeof store.registerFiles === 'function',
    'migration_store_missing', '项目迁移服务缺少资料登记。');
  const now = hooks.now || timestamp;
  const migrationDirectory = path.join(store.directory, 'migrations');
  const backupDirectory = path.join(store.directory, 'migration-backups');

  async function planPath(previewId) {
    identifier(previewId, '迁移预览ID');
    invariant(/^migration-preview-[a-f0-9-]+$/i.test(previewId), 'invalid_identity', '迁移预览ID无效。');
    await fsp.mkdir(migrationDirectory, { recursive: true });
    return safePath(migrationDirectory, `${previewId}.json`, { allowMissing: true });
  }

  async function loadPreview(previewId) {
    const file = await planPath(previewId);
    let value;
    try { value = JSON.parse(await fsp.readFile(file, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') invariant(false, 'preview_missing', '迁移预览不存在，请重新检查。');
      invariant(false, 'preview_corrupt', '迁移预览无法核对，请重新检查。');
    }
    invariant(value.projectId === project.id && Array.isArray(value.items),
      'preview_corrupt', '迁移预览项目范围不符。');
    invariant(value.status !== 'superseded', 'preview_superseded', '已有更新的迁移预览，请使用最新预览。');
    return value;
  }

  async function enumerateRoot(root, seen, registeredByLocation, workspaceByRelative, output) {
    let resolvedRoot;
    try {
      resolvedRoot = await fsp.realpath(root.path);
      const stat = await fsp.lstat(resolvedRoot);
      invariant(stat.isDirectory() && !stat.isSymbolicLink(), 'linked_path', `${root.label}不是安全目录。`);
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    const excluded = [project.managerPath, project.knowledgeRootPath].filter((item) => path.isAbsolute(String(item || '')))
      .map((item) => keyPath(item));
    const stack = [{ absolute: resolvedRoot, relative: '' }];
    while (stack.length && output.length < MAX_PREVIEW_FILES) {
      const current = stack.pop();
      let entries = await fsp.readdir(current.absolute, { withFileTypes: true });
      entries = entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
      for (const entry of entries) {
        if (output.length >= MAX_PREVIEW_FILES) break;
        const absolute = path.join(current.absolute, entry.name);
        const absoluteKey = keyPath(absolute);
        if (excluded.some((item) => absoluteKey === item || absoluteKey.startsWith(`${item}${path.sep}`))) continue;
        const relativeRaw = current.relative ? `${current.relative}/${entry.name}` : entry.name;
        if (isSystemGeneratedMaterialPath(relativeRaw)) continue;
        if (entry.isDirectory()) {
          if (!entry.isSymbolicLink()) stack.push({ absolute, relative: relativeRaw });
          continue;
        }
        let relativePath;
        try { relativePath = relativeMaterialPath(relativeRaw); }
        catch { continue; }
        const source = { kind: root.kind, rootId: root.rootId, relativePath };
        const registered = registeredByLocation.get(locationKey(source));
        if (entry.isSymbolicLink()) {
          output.push({ itemId: `migration-item-${digest([root.rootId, relativePath]).slice(0, 32)}`,
            title: entry.name, sourceKind: root.kind, sourceLabel: root.label, source,
            materialId: registered?.materialId || '', version: registered?.version || 0,
            recordRevision: registered?.recordRevision ?? -1, action: 'preserve', code: 'linked_path',
            reason: '来源是链接或目录联接，保留原位并由管理员核对。', snapshot: null });
          continue;
        }
        let real;
        try { real = await fsp.realpath(absolute); } catch { continue; }
        if (!contains(resolvedRoot, real) || seen.has(keyPath(real))) continue;
        seen.add(keyPath(real));
        let snapshot;
        try { snapshot = await hashStableFile(real); }
        catch (error) {
          output.push({ itemId: `migration-item-${digest([root.rootId, relativePath]).slice(0, 32)}`,
            title: entry.name, sourceKind: root.kind, sourceLabel: root.label, source,
            materialId: registered?.materialId || '', version: registered?.version || 0,
            recordRevision: registered?.recordRevision ?? -1, action: 'preserve',
            code: error.code || 'source_unavailable', reason: '预览时来源正在变化或无法稳定读取，保留原位。', snapshot: null });
          continue;
        }
        const base = { itemId: `migration-item-${digest([root.rootId, relativePath, snapshot.sha256]).slice(0, 32)}`,
          title: entry.name, sourceKind: root.kind, sourceLabel: root.label, source,
          materialId: registered?.materialId || '', version: registered?.version || 0,
          recordRevision: registered?.recordRevision ?? -1, snapshot };
        if (root.rootId === 'workspace') {
          output.push({ ...base, action: 'associate', code: '', reason: '文件已位于项目工作空间，只建立统一登记，不复制原文。', target: source });
          workspaceByRelative.set(relativePath.toLocaleLowerCase('zh-CN'), { ...base, target: source, absolute: real });
          continue;
        }
        if (dependencyProtected(relativePath)) {
          output.push({ ...base, action: 'preserve', code: 'dependency_group',
            reason: '网页、代码、CAD或关联附件可能依赖相对路径，本轮保留原位。' });
          continue;
        }
        const exactWorkspace = workspaceByRelative.get(relativePath.toLocaleLowerCase('zh-CN'));
        if (exactWorkspace && exactWorkspace.snapshot.sha256 === snapshot.sha256) {
          output.push({ ...base, action: 'associate_existing', code: '',
            reason: '工作空间相同相对位置已有同字节文件，可关联现有原件而不再复制。', target: exactWorkspace.target });
          continue;
        }
        const target = { kind: 'workspace', rootId: 'workspace',
          relativePath: migrationTarget(project, root.rootId, relativePath) };
        const targetFile = await safePath(project.workspacePath, target.relativePath, { allowMissing: true });
        const occupied = await exists(targetFile);
        if (occupied) {
          output.push({ ...base, action: 'preserve', code: 'target_occupied',
            reason: '迁移目标已有同名文件，未覆盖；可调整原文件名后重新预览。', target });
        } else {
          output.push({ ...base, action: 'migrate', code: '',
            reason: '可复制到工作空间、逐字节核验并把旧副本保留到迁移备份区。', target });
        }
      }
    }
  }

  async function preview(access = {}) {
    invariant(access.canRead === true, 'forbidden', '当前身份不能检查项目迁移。');
    return serialized(project.id, async () => {
      const index = await store.read({ fresh: true });
      ensureMigrationState(index);
      const registeredByLocation = new Map(index.materials.map((item) => [locationKey(item.location), item]));
      const items = [];
      const seen = new Set();
      const workspaceByRelative = new Map();
      const roots = rootDefinitions(project);
      const workspace = roots.find((item) => item.rootId === 'workspace');
      if (workspace) await enumerateRoot(workspace, seen, registeredByLocation, workspaceByRelative, items);
      for (const root of roots.filter((item) => item.rootId !== 'workspace')) {
        await enumerateRoot(root, seen, registeredByLocation, workspaceByRelative, items);
      }
      for (const record of index.materials) {
        if (isSystemGeneratedMaterialPath(record.location?.relativePath)) continue;
        if (items.some((item) => item.materialId === record.materialId)) continue;
        if (record.location.rootId === 'workspace') continue;
        items.push({ itemId: `migration-item-${digest(['registered', record.materialId]).slice(0, 32)}`,
          materialId: record.materialId, version: record.version, recordRevision: record.recordRevision,
          title: path.posix.basename(record.location.relativePath), sourceKind: record.location.kind,
          sourceLabel: record.location.rootId === 'legacy' ? '旧原始资料库' : '外部来源',
          source: clone(record.location), action: 'preserve', code: 'source_unavailable',
          reason: '登记来源当前未能稳定读取，保留原位并等待修复。', snapshot: null });
      }
      const previewValue = { schema: 'edu-manager.project-material-migration-preview.v1',
        previewId: `migration-preview-${crypto.randomUUID()}`, projectId: project.id,
        status: 'current', createdAt: now(), registryRevision: index.revision,
        truncated: items.length >= MAX_PREVIEW_FILES, items };
      await fsp.mkdir(migrationDirectory, { recursive: true });
      for (const name of await fsp.readdir(migrationDirectory)) {
        if (!/^migration-preview-[a-f0-9-]+\.json$/i.test(name)) continue;
        const file = path.join(migrationDirectory, name);
        try {
          const previous = JSON.parse(await fsp.readFile(file, 'utf8'));
          if (previous.projectId !== project.id || previous.status === 'superseded') continue;
          await writeJsonAtomic(file, { ...previous, status: 'superseded', supersededAt: now(),
            supersededBy: previewValue.previewId });
        } catch { /* corrupt old previews remain untouched for diagnostics */ }
      }
      await writeJsonAtomic(await planPath(previewValue.previewId), previewValue);
      return publicPreview(previewValue);
    });
  }

  async function mark(operationId, itemId, update) {
    return store.mutate((index) => {
      ensureMigrationState(index);
      const operation = index.migrationOperations.find((item) => item.operationId === operationId);
      const item = operation?.items.find((entry) => entry.itemId === itemId);
      invariant(item, 'migration_item_missing', '未找到迁移条目。');
      Object.assign(item, update, { updatedAt: now() });
      return true;
    });
  }

  async function finalize(operationId) {
    return store.mutate((index) => {
      ensureMigrationState(index);
      const operation = index.migrationOperations.find((item) => item.operationId === operationId);
      invariant(operation, 'migration_operation_missing', '未找到迁移操作。');
      const success = operation.items.filter((item) => item.status === 'succeeded').length;
      const attention = operation.items.filter((item) => ['recovery_required', 'source_retained'].includes(item.status)).length;
      operation.status = attention ? 'attention' : success === operation.items.length ? 'succeeded'
        : success ? 'partial' : 'failed';
      operation.completedAt = now();
      return publicOperation(operation);
    });
  }

  async function registerTarget(item, targetPath) {
    const before = await store.read({ fresh: true });
    ensureMigrationState(before);
    let currentRecord = item.materialId
      ? before.materials.find((record) => record.materialId === item.materialId) : null;
    if (currentRecord && locationKey(currentRecord.location) === locationKey(item.target)
      && currentRecord.sha256 === item.snapshot.sha256) return currentRecord;
    if (currentRecord) {
      invariant(currentRecord.version === item.version && currentRecord.recordRevision === item.recordRevision
        && locationKey(currentRecord.location) === locationKey(item.source)
        && currentRecord.sha256 === item.snapshot.sha256,
      'version_conflict', '迁移前资料登记已变化，请重新预览。');
    }
    const occupant = before.materials.find((record) => locationKey(record.location) === locationKey(item.target));
    if (occupant && !currentRecord && item.action === 'associate_existing'
      && occupant.sha256 === item.snapshot.sha256) return occupant;
    invariant(!occupant || occupant.materialId === item.materialId,
      'location_conflict', '工作空间目标已登记为另一资料，保留两份并等待人工核对。');
    const entry = { location: item.target, expectedSha256: item.snapshot.sha256,
      source: { eventId: `history-migration-${digest([item.itemId, item.snapshot.sha256])}`,
        type: 'history_migration', deviceId: 'local-host', studentId: '' },
      ...(currentRecord ? { materialId: currentRecord.materialId, expectedVersion: currentRecord.version } : {}) };
    const result = await store.registerFiles([entry], {
      intent: item.source.rootId === 'legacy' ? 'active' : 'later',
    });
    const registered = result.result[0];
    invariant(registered.sha256 === item.snapshot.sha256 && path.resolve(await store.locationPath(registered.location)) === path.resolve(targetPath),
      'migration_verification_failed', '迁移登记与工作空间原文不一致。');
    return registered;
  }

  async function processItem(operationId, itemId) {
    let index = await store.read({ fresh: true });
    ensureMigrationState(index);
    const operation = index.migrationOperations.find((entry) => entry.operationId === operationId);
    let item = operation?.items.find((entry) => entry.itemId === itemId);
    invariant(item, 'migration_item_missing', '未找到迁移条目。');
    if (item.status === 'succeeded') return publicItem(item);
    try {
      const source = await store.locationPath(item.source);
      const sourceObserved = await hashStableFile(source);
      invariant(sourceObserved.sha256 === item.snapshot.sha256
        && sourceObserved.size === item.snapshot.size,
      'source_changed', '来源在预览后已变化，保留原位并等待重新预览。');
      if (item.action === 'associate') {
        const registered = await registerTarget(item, source);
        await mark(operationId, itemId, { status: 'succeeded', materialId: registered.materialId,
          version: registered.version, migratedRecordRevision: registered.recordRevision,
          retryable: false, code: '', message: '原文已在工作空间，仅建立统一登记；没有复制或删除文件。' });
        return publicItem({ ...item, status: 'succeeded', materialId: registered.materialId,
          version: registered.version });
      }
      invariant(['migrate', 'associate_existing'].includes(item.action),
        'migration_action_invalid', '该预览项不能执行物理迁移。');
      const target = await safePath(project.workspacePath, item.target.relativePath, { allowMissing: true });
      const temporary = await safePath(project.workspacePath,
        `${path.posix.dirname(item.target.relativePath)}/._edu-migration-${operationId}-${item.itemId}.partial`,
        { allowMissing: true });
      await mark(operationId, itemId, { status: 'copying', retryable: false, code: '', message: '' });
      if (item.action === 'migrate') {
        await publishCopy(source, temporary, target, item.snapshot.sha256);
      } else {
        const existing = await hashStableFile(target);
        invariant(existing.sha256 === item.snapshot.sha256, 'target_occupied', '工作空间关联文件已变化，保留旧来源。');
      }
      await mark(operationId, itemId, { status: 'target_copied' });
      await hooks.checkpoint?.('after_target', { operationId, itemId, source, target });
      const backupRelativePath = relativeMaterialPath(`${operationId}/${item.source.rootId}/${item.source.relativePath}`);
      await fsp.mkdir(backupDirectory, { recursive: true });
      const backup = await safePath(backupDirectory, backupRelativePath, { allowMissing: true });
      const backupTemporary = `${backup}.partial`;
      await fsp.mkdir(path.dirname(backup), { recursive: true });
      await publishCopy(source, backupTemporary, backup, item.snapshot.sha256, { uniqueTarget: true });
      await fsp.rm(backupTemporary, { force: true });
      await mark(operationId, itemId, { status: 'backup_ready', backupRelativePath });
      await hooks.checkpoint?.('after_backup', { operationId, itemId, source, target, backup });
      const beforeCommit = await hashStableFile(source);
      invariant(beforeCommit.sha256 === item.snapshot.sha256, 'source_changed', '来源在迁移切换前发生变化，保留原位。');
      const registered = await registerTarget(item, target);
      await mark(operationId, itemId, { status: 'registered', materialId: registered.materialId,
        version: registered.version, migratedRecordRevision: registered.recordRevision });
      await hooks.checkpoint?.('after_register', { operationId, itemId, source, target, backup });
      const beforeRemove = await hashStableFile(source);
      if (beforeRemove.sha256 !== item.snapshot.sha256) {
        await mark(operationId, itemId, { status: 'source_retained', retryable: false,
          code: 'source_changed_after_switch',
          message: '原版本已迁入工作空间，但旧位置随后出现新内容；新内容保留原位，需重新扫描为新版本。' });
        return publicItem({ ...item, status: 'source_retained' });
      }
      await fsp.unlink(source);
      await fsp.rm(temporary, { force: true });
      await mark(operationId, itemId, { status: 'succeeded', retryable: false, code: '',
        message: '已逐字节核验工作空间原文并保留迁移备份；旧位置原件已移出。' });
      return publicItem({ ...item, status: 'succeeded', materialId: registered.materialId,
        version: registered.version });
    } catch (error) {
      const failure = migrationError(error);
      index = await store.read({ fresh: true });
      const latest = index.migrationOperations?.find((entry) => entry.operationId === operationId)
        ?.items.find((entry) => entry.itemId === itemId);
      const alreadyRegistered = latest?.status === 'registered' || latest?.status === 'source_retained';
      await mark(operationId, itemId, alreadyRegistered
        ? { status: 'source_retained', code: failure.code, message: `工作空间登记已完成，但旧来源未移除：${failure.message}`,
          retryable: failure.retryable }
        : { status: failure.code === 'recovery_conflict' ? 'recovery_required' : 'failed', ...failure });
      return { itemId, ok: false, ...failure };
    }
  }

  async function execute(request, access = {}) {
    invariant(request && typeof request === 'object' && !Array.isArray(request)
      && Object.keys(request).every((key) => ['previewId', 'itemIds', 'idempotencyKey'].includes(key)),
    'invalid_migration_request', '迁移请求结构无效。');
    invariant(access.canWrite === true, 'forbidden', '当前身份不能执行项目迁移。');
    const actorId = identifier(String(access.actorId || ''), '操作人ID');
    const idempotencyKey = identifier(String(request.idempotencyKey || ''), '请求ID');
    const previewValue = await loadPreview(String(request.previewId || ''));
    const selected = new Set((Array.isArray(request.itemIds) ? request.itemIds : previewValue.items
      .filter((item) => ['associate', 'migrate', 'associate_existing'].includes(item.action) && !item.code)
      .map((item) => item.itemId)).map(String));
    invariant(selected.size > 0 && selected.size <= MAX_EXECUTE_ITEMS,
      'invalid_batch', `每批迁移须选择1至${MAX_EXECUTE_ITEMS}项。`);
    const planned = previewValue.items.filter((item) => selected.has(item.itemId));
    invariant(planned.length === selected.size && planned.every((item) =>
      ['associate', 'migrate', 'associate_existing'].includes(item.action) && !item.code && item.snapshot),
    'invalid_batch', '迁移选择包含不可执行条目，请重新预览。');
    const payloadHash = digest({ projectId: project.id, previewId: previewValue.previewId,
      itemIds: [...selected].sort() });
    return serialized(project.id, async () => {
      const baseline = await store.read({ fresh: true });
      ensureMigrationState(baseline);
      const replay = baseline.migrationReceipts.find((item) => item.kind === 'execute'
        && item.actorId === actorId && item.idempotencyKey === idempotencyKey);
      if (replay) {
        invariant(replay.payloadHash === payloadHash, 'idempotency_conflict',
          '同一请求编号已用于不同迁移范围。');
        const previous = baseline.migrationOperations.find((item) => item.operationId === replay.operationId);
        return { ok: true, idempotentReplay: true,
          operation: previous ? publicOperation(previous) : replay.response };
      }
      const operationId = `migration-operation-${crypto.randomUUID()}`;
      await store.mutate((index) => {
        ensureMigrationState(index);
        invariant(!index.migrationReceipts.some((item) => item.actorId === actorId
          && item.idempotencyKey === idempotencyKey), 'idempotency_conflict',
        '迁移请求已由另一任务接收，请刷新。');
        const operation = { operationId, previewId: previewValue.previewId,
          projectId: project.id, actorId, status: 'running', createdAt: now(), completedAt: '',
          items: planned.map((item) => ({ ...clone(item), status: 'pending', code: '', message: '',
            retryable: false, rollbackStatus: '', createdAt: now(), updatedAt: now() })) };
        index.migrationOperations.push(operation);
        index.migrationReceipts.push({ kind: 'execute', actorId, idempotencyKey,
          payloadHash, operationId, createdAt: now(), response: publicOperation(operation) });
        return true;
      });
      const results = [];
      for (const item of planned) results.push(await processItem(operationId, item.itemId));
      const completed = await finalize(operationId);
      const remaining = previewValue.items.filter((item) => !selected.has(item.itemId)).length;
      return { ok: true, operation: completed.result, results,
        remaining, previewTruncated: Boolean(previewValue.truncated),
        message: `历史归一完成：${completed.result.counts.succeeded}/${completed.result.counts.total}项已统一；冲突和外部变化均保留原位。` };
    });
  }

  async function retry(operationId, request, access = {}) {
    identifier(operationId, '迁移操作ID');
    invariant(access.canWrite === true, 'forbidden', '当前身份不能重试项目迁移。');
    const actorId = identifier(String(access.actorId || ''), '操作人ID');
    const idempotencyKey = identifier(String(request?.idempotencyKey || ''), '请求ID');
    return serialized(project.id, async () => {
      const baseline = await store.read({ fresh: true });
      ensureMigrationState(baseline);
      const operation = baseline.migrationOperations.find((item) => item.operationId === operationId);
      invariant(operation, 'migration_operation_missing', '未找到迁移操作。');
      const allowed = operation.items.filter((item) => item.status === 'failed' && item.retryable);
      const selected = new Set((Array.isArray(request?.itemIds) ? request.itemIds : allowed.map((item) => item.itemId)).map(String));
      invariant(selected.size > 0 && [...selected].every((itemId) => allowed.some((item) => item.itemId === itemId)),
        'retry_not_allowed', '所选迁移项当前不可重试。');
      const payloadHash = digest({ projectId: project.id, operationId, itemIds: [...selected].sort() });
      const replay = baseline.migrationReceipts.find((item) => item.kind === 'retry'
        && item.actorId === actorId && item.idempotencyKey === idempotencyKey);
      if (replay) {
        invariant(replay.payloadHash === payloadHash, 'idempotency_conflict', '同一请求编号已用于不同迁移重试。');
        return { ok: true, idempotentReplay: true, operation: publicOperation(operation) };
      }
      await store.mutate((index) => {
        ensureMigrationState(index);
        const current = index.migrationOperations.find((item) => item.operationId === operationId);
        for (const item of current.items.filter((entry) => selected.has(entry.itemId))) {
          Object.assign(item, { status: 'pending', code: '', message: '', retryable: false, updatedAt: now() });
        }
        current.status = 'running';
        current.completedAt = '';
        index.migrationReceipts.push({ kind: 'retry', actorId, idempotencyKey,
          payloadHash, operationId, createdAt: now() });
        return true;
      });
      const results = [];
      for (const itemId of selected) results.push(await processItem(operationId, itemId));
      const completed = await finalize(operationId);
      return { ok: true, operation: completed.result, results };
    });
  }

  async function rollback(operationId, request, access = {}) {
    identifier(operationId, '迁移操作ID');
    invariant(access.canWrite === true, 'forbidden', '当前身份不能回滚项目迁移。');
    const actorId = identifier(String(access.actorId || ''), '操作人ID');
    const idempotencyKey = identifier(String(request?.idempotencyKey || ''), '请求ID');
    return serialized(project.id, async () => {
      const baseline = await store.read({ fresh: true });
      ensureMigrationState(baseline);
      const payloadHash = digest({ projectId: project.id, operationId });
      const replay = baseline.migrationReceipts.find((item) => item.kind === 'rollback'
        && item.actorId === actorId && item.idempotencyKey === idempotencyKey);
      if (replay) {
        invariant(replay.payloadHash === payloadHash, 'idempotency_conflict', '同一请求编号已用于不同迁移回滚。');
        return { ok: true, idempotentReplay: true, operation: replay.response };
      }
      const operation = baseline.migrationOperations.find((item) => item.operationId === operationId);
      invariant(operation, 'migration_operation_missing', '未找到迁移操作。');
      const results = [];
      for (const item of operation.items.filter((entry) => entry.status === 'succeeded'
        && ['migrate', 'associate_existing'].includes(entry.action) && entry.rollbackStatus !== 'succeeded')) {
        try {
          const current = await store.read({ fresh: true });
          const currentItem = current.migrationOperations.find((entry) => entry.operationId === operationId)
            ?.items.find((entry) => entry.itemId === item.itemId);
          const record = current.materials.find((entry) => entry.materialId === currentItem.materialId);
          invariant(record && record.version === currentItem.version
            && record.recordRevision === currentItem.migratedRecordRevision
            && locationKey(record.location) === locationKey(currentItem.target)
            && record.sha256 === currentItem.snapshot.sha256,
          'rollback_conflict', '迁移后资料登记已变化，不能自动回滚。');
          const target = await store.locationPath(currentItem.target);
          const source = await store.locationPath(currentItem.source).catch(async (error) => {
            if (error.code !== 'ENOENT') throw error;
            const root = rootDefinitions(project).find((entry) => entry.rootId === currentItem.source.rootId);
            invariant(root, 'unknown_root', '旧来源根不可用。');
            return safePath(root.path, currentItem.source.relativePath, { allowMissing: true });
          });
          invariant(!(await exists(source)), 'rollback_target_occupied', '旧位置已有文件，不能覆盖回滚。');
          const targetObserved = await hashStableFile(target);
          invariant(targetObserved.sha256 === currentItem.snapshot.sha256,
            'rollback_conflict', '迁移后的工作空间文件已被编辑，保留现状。');
          const backup = await safePath(backupDirectory, currentItem.backupRelativePath);
          const temporary = `${source}.migration-rollback-${crypto.randomUUID()}.partial`;
          await fsp.mkdir(path.dirname(source), { recursive: true });
          await publishCopy(backup, temporary, source, currentItem.snapshot.sha256);
          const moved = await store.registerFiles([{ location: currentItem.source,
            materialId: record.materialId, expectedVersion: record.version,
            expectedSha256: record.sha256,
            source: { eventId: `history-migration-rollback-${digest([operationId, item.itemId])}`,
              type: 'history_migration_rollback', deviceId: 'local-host', studentId: '' } }]);
          await fsp.unlink(target);
          await fsp.rm(temporary, { force: true });
          await mark(operationId, item.itemId, { rollbackStatus: 'succeeded', rollbackCode: '',
            rollbackAt: now(), rollbackRecordRevision: moved.result[0].recordRevision });
          results.push({ itemId: item.itemId, ok: true });
        } catch (error) {
          const failure = migrationError(error);
          await mark(operationId, item.itemId, { rollbackStatus: 'failed', rollbackCode: failure.code,
            rollbackMessage: failure.message });
          results.push({ itemId: item.itemId, ok: false, ...failure });
        }
      }
      const latest = await store.read({ fresh: true });
      const response = publicOperation(latest.migrationOperations.find((item) => item.operationId === operationId));
      await store.mutate((index) => {
        ensureMigrationState(index);
        index.migrationReceipts.push({ kind: 'rollback', actorId, idempotencyKey,
          payloadHash, operationId, createdAt: now(), response: clone(response) });
        return true;
      });
      return { ok: true, operation: response, results };
    });
  }

  async function recoverInterrupted() {
    return serialized(project.id, async () => {
      const index = await store.read({ fresh: true });
      ensureMigrationState(index);
      const pending = index.migrationOperations.flatMap((operation) => operation.items
        .filter((item) => ['pending', 'copying', 'target_copied', 'backup_ready', 'registered'].includes(item.status))
        .map((item) => ({ operationId: operation.operationId, itemId: item.itemId })));
      const results = [];
      for (const item of pending) results.push(await processItem(item.operationId, item.itemId));
      for (const operationId of [...new Set(pending.map((item) => item.operationId))]) await finalize(operationId);
      return { recovered: results.filter((item) => item.status === 'succeeded').length, results };
    });
  }

  async function inspectBackupCleanup(access = {}) {
    invariant(access.canRead === true, 'forbidden', '当前身份不能检查迁移备份。');
    const index = await store.read({ fresh: true });
    ensureMigrationState(index);
    const candidates = [];
    for (const operation of index.migrationOperations) {
      for (const item of operation.items.filter((entry) => entry.backupRelativePath && !entry.backupCleanedAt)) {
        const backup = await safePath(backupDirectory, item.backupRelativePath, { allowMissing: true });
        const backupStat = await exists(backup);
        if (!backupStat?.isFile() || backupStat.isSymbolicLink()) continue;
        let observed;
        try { observed = await hashStableFile(backup); } catch { continue; }
        if (observed.sha256 !== item.snapshot?.sha256 || observed.size !== item.snapshot?.size) continue;
        const record = index.materials.find((entry) => entry.materialId === item.materialId);
        const immutableSnapshot = record?.versions?.find((entry) => entry.version === item.version
          && entry.sha256 === item.snapshot.sha256 && entry.snapshot);
        let restoredSource = false;
        if (item.rollbackStatus === 'succeeded' && record
          && locationKey(record.location) === locationKey(item.source)
          && record.sha256 === item.snapshot.sha256) {
          try {
            const source = await store.locationPath(item.source);
            restoredSource = (await hashStableFile(source)).sha256 === item.snapshot.sha256;
          } catch { restoredSource = false; }
        }
        if (!immutableSnapshot && !restoredSource) continue;
        candidates.push({
          candidateId: `migration-backup-${digest([operation.operationId, item.itemId,
            item.backupRelativePath, observed.sha256, observed.size]).slice(0, 32)}`,
          operationId: operation.operationId, itemId: item.itemId, title: item.title,
          size: observed.size, sha256: observed.sha256,
          reason: immutableSnapshot ? '相同版本已有只读固定快照，可清理重复迁移备份。'
            : '该项已安全回滚且旧位置原件校验一致，可清理重复迁移备份。',
        });
      }
    }
    return { projectId: project.id, candidates,
      bytes: candidates.reduce((sum, item) => sum + item.size, 0),
      message: candidates.length
        ? `找到 ${candidates.length} 份可人工确认清理的重复迁移备份。`
        : '没有可安全清理的迁移备份；仍承担回滚或版本留存作用的备份将继续保留。' };
  }

  async function cleanupBackups(request, access = {}) {
    invariant(request && typeof request === 'object' && !Array.isArray(request)
      && Object.keys(request).every((key) => ['candidateIds', 'idempotencyKey'].includes(key)),
    'invalid_migration_cleanup_request', '迁移备份清理请求结构无效。');
    invariant(access.canWrite === true, 'forbidden', '当前身份不能清理迁移备份。');
    const actorId = identifier(String(access.actorId || ''), '操作人ID');
    const idempotencyKey = identifier(String(request.idempotencyKey || ''), '请求ID');
    const selected = new Set((Array.isArray(request.candidateIds) ? request.candidateIds : []).map(String));
    invariant(selected.size > 0 && selected.size <= MAX_EXECUTE_ITEMS,
      'invalid_batch', `每批最多清理${MAX_EXECUTE_ITEMS}份迁移备份。`);
    return serialized(project.id, async () => {
      const baseline = await store.read({ fresh: true });
      ensureMigrationState(baseline);
      const payloadHash = digest({ projectId: project.id, candidateIds: [...selected].sort() });
      const replay = baseline.migrationReceipts.find((item) => item.kind === 'backup_cleanup'
        && item.actorId === actorId && item.idempotencyKey === idempotencyKey);
      if (replay) {
        invariant(replay.payloadHash === payloadHash, 'idempotency_conflict',
          '同一请求编号已用于不同迁移备份范围。');
        return { ok: true, idempotentReplay: true, ...clone(replay.response) };
      }
      const inspection = await inspectBackupCleanup({ canRead: true });
      invariant([...selected].every((candidateId) => inspection.candidates
        .some((item) => item.candidateId === candidateId)),
      'cleanup_candidate_changed', '迁移备份清理条件已变化，请重新检查。');
      const results = [];
      for (const candidate of inspection.candidates.filter((item) => selected.has(item.candidateId))) {
        const current = await store.read({ fresh: true });
        const item = current.migrationOperations.find((entry) => entry.operationId === candidate.operationId)
          ?.items.find((entry) => entry.itemId === candidate.itemId);
        try {
          invariant(item?.backupRelativePath && !item.backupCleanedAt,
            'cleanup_candidate_changed', '迁移备份状态已变化。');
          const backup = await safePath(backupDirectory, item.backupRelativePath);
          const observed = await hashStableFile(backup);
          invariant(observed.sha256 === candidate.sha256 && observed.size === candidate.size,
            'cleanup_candidate_changed', '迁移备份内容已变化，未删除。');
          await fsp.unlink(backup);
          await mark(candidate.operationId, candidate.itemId, { backupCleanedAt: now(),
            backupCleanupReason: candidate.reason });
          results.push({ candidateId: candidate.candidateId, ok: true, size: candidate.size });
        } catch (error) {
          const failure = migrationError(error);
          results.push({ candidateId: candidate.candidateId, ok: false, ...failure });
        }
      }
      const response = { results, cleaned: results.filter((item) => item.ok).length,
        bytes: results.filter((item) => item.ok).reduce((sum, item) => sum + item.size, 0) };
      await store.mutate((index) => {
        ensureMigrationState(index);
        index.migrationReceipts.push({ kind: 'backup_cleanup', actorId, idempotencyKey,
          payloadHash, createdAt: now(), response: clone(response) });
        return true;
      });
      return { ok: true, ...response,
        message: `已清理 ${response.cleaned}/${results.length} 份经重新校验的重复迁移备份。` };
    });
  }

  async function status({ limit = 10 } = {}) {
    await recoverInterrupted();
    const index = await store.read({ fresh: true });
    ensureMigrationState(index);
    const operations = index.migrationOperations.slice(-Math.max(1, Math.min(20, limit)))
      .reverse().map(publicOperation);
    const backupItems = index.migrationOperations.flatMap((operation) => operation.items)
      .filter((item) => item.backupRelativePath && !item.backupCleanedAt);
    return { projectId: project.id, migrationState: String(project.materialMigrationState || 'not_started'),
      operations, backups: { count: backupItems.length,
        bytes: backupItems.reduce((sum, item) => sum + Number(item.snapshot?.size || 0), 0),
        cleanupRequiresExplicitReview: true }, registryRevision: index.revision };
  }

  return { preview, execute, retry, rollback, status, recoverInterrupted,
    inspectBackupCleanup, cleanupBackups,
    publicPreview, publicOperation };
}

module.exports = {
  MAX_PREVIEW_FILES, MAX_EXECUTE_ITEMS, PRESERVED_EXTENSIONS,
  createProjectMaterialMigration, publicPreview, publicOperation,
};
