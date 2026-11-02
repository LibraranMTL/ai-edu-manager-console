const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  invariant, identifier, positiveVersion, relativeMaterialPath,
} = require('./project-material-contract.cjs');
const {
  hashStableFile, safePath, within, unchanged,
} = require('./project-materials.cjs');
const {
  RULE_VERSION, suggestProjectMaterialClassifications,
} = require('./project-material-classifier.cjs');

const operationQueues = new Map();
const SAFE_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv',
  '.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.mp3', '.m4a', '.wav',
  '.mp4', '.mov',
]);
const ORGANIZATION_RESERVE_BYTES = 64n * 1024n * 1024n;
const CLEANUP_MIN_AGE_MS = 24 * 60 * 60 * 1000;

const clone = (value) => structuredClone(value);
const timestamp = () => new Date().toISOString();
const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const pathKey = (location) => JSON.stringify([location?.rootId,
  process.platform === 'win32' ? String(location?.relativePath || '').toLowerCase() : location?.relativePath]);

function strictObject(value, keys, code = 'invalid_organization_request') {
  invariant(value && typeof value === 'object' && !Array.isArray(value), code, '自动整理请求结构无效。');
  invariant(Object.keys(value).every((key) => keys.has(key)), code, '自动整理请求包含不支持的字段。');
}

function ensureState(index) {
  index.organizationOperations ||= [];
  index.organizationReceipts ||= [];
  index.capacityCleanupOperations ||= [];
  invariant(index.organizationOperations.length <= 2000
    && index.organizationReceipts.length <= 5000
    && index.capacityCleanupOperations.length <= 1000,
  'organization_capacity', '自动整理操作记录已达到安全上限，请先在主机归档记录。');
}

function configuration(project) {
  // materialAutomation is the production source of truth.  The legacy
  // materialOrganization block is read only when a project has not yet been
  // migrated; an explicit `enabled: false` in the new block must win over an
  // older authorization.
  const current = project.materialAutomation && typeof project.materialAutomation === 'object'
    ? project.materialAutomation : null;
  const value = current || project.materialOrganization || {};
  return {
    enabled: value.enabled === true,
    processingPaused: value.processingPaused === true,
    authorizationId: String(value.authorizationId || ''),
    authorizedAt: String(value.authorizedAt || ''),
    authorizedBy: String(value.authorizedBy || ''),
    maxBatch: Math.max(1, Math.min(50, Number(value.maxBatch || 20))),
    onWorkspaceChange: value.onWorkspaceChange !== false,
    intervalMinutes: Math.max(15, Math.min(10080, Number(value.intervalMinutes || 1440))),
    nextRunAt: String(value.nextRunAt || ''),
    lastRunAt: String(value.lastRunAt || ''),
    lastReason: String(value.lastReason || ''),
    lastStatus: String(value.lastStatus || ''),
    lastMessage: String(value.lastMessage || ''),
  };
}

function publicItem(item) {
  return {
    materialId: item.materialId, version: item.version, categoryId: item.categoryId,
    title: path.posix.basename(item.before?.location?.relativePath || item.title || '已登记资料'),
    status: item.status, code: item.code || '', message: item.message || '',
    retryable: Boolean(item.retryable), recovered: Boolean(item.recovered),
    undoStatus: item.undoStatus || '', undoCode: item.undoCode || '',
    beforeRevision: item.beforeRecordRevision, afterRevision: item.afterRecordRevision,
  };
}

function publicOperation(operation, visibleIds) {
  const items = (operation.items || []).filter((item) => !visibleIds || visibleIds.has(item.materialId));
  return {
    operationId: operation.operationId, trigger: operation.trigger, status: operation.status,
    createdAt: operation.createdAt, completedAt: operation.completedAt || '',
    undoStatus: operation.undoStatus || '', items: items.map(publicItem),
    counts: {
      total: items.length, succeeded: items.filter((item) => item.status === 'succeeded').length,
      failed: items.filter((item) => item.status === 'failed').length,
      attention: items.filter((item) => item.status === 'recovery_required').length,
      retryable: items.filter((item) => item.retryable).length,
      undone: items.filter((item) => item.undoStatus === 'succeeded').length,
    },
  };
}

function isDirectInboxRecord(record, project) {
  const inbox = relativeMaterialPath(project.inboxRelativePath || '收件箱');
  const relative = String(record.location?.relativePath || '');
  const dirname = path.posix.dirname(relative);
  return record.location?.kind === 'workspace' && record.location?.rootId === 'workspace'
    && dirname.toLocaleLowerCase('zh-CN') === inbox.toLocaleLowerCase('zh-CN');
}

function safeCandidate(record, index, project, suggestions) {
  const relative = String(record.location?.relativePath || '');
  if (!isDirectInboxRecord(record, project)) return null;
  if (record.availability !== 'available') return { code: 'source_unavailable', retryable: true };
  if (record.adoption?.state !== 'accepted') return { code: 'adoption_pending', retryable: false };
  if (!SAFE_EXTENSIONS.has(path.posix.extname(relative).toLowerCase())) {
    return { code: 'structure_protected', retryable: false };
  }
  const proposal = suggestions.get(record.materialId);
  const categoryId = record.classification?.categoryId || proposal?.categoryId || '';
  if (!categoryId) return { code: 'classification_pending', retryable: false };
  const category = (index.categories || []).find((item) => item.active !== false
    && item.categoryId === categoryId && item.relativePath);
  if (!category) return { code: 'category_missing', retryable: true };
  const target = relativeMaterialPath(`${category.relativePath}/${path.posix.basename(relative)}`);
  if (target.toLocaleLowerCase('zh-CN') === relative.toLocaleLowerCase('zh-CN')) return null;
  return { categoryId, target, proposal, category };
}

async function serialized(projectId, operation) {
  const key = String(projectId);
  const previous = operationQueues.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  operationQueues.set(key, current);
  try { return await current; } finally {
    if (operationQueues.get(key) === current) operationQueues.delete(key);
  }
}

async function exists(file) {
  try { return await fsp.lstat(file); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function createVerifiedLink(source, target, expectedSha256) {
  invariant(!(await exists(target)), 'target_occupied', '目标分类中已有同名文件，未覆盖。');
  try { await fsp.link(source, target); }
  catch (error) {
    if (error.code === 'EEXIST') invariant(false, 'target_occupied', '目标分类中已有同名文件，未覆盖。');
    invariant(false, 'safe_move_unavailable', '当前文件系统不支持安全的无覆盖整理，原件未移动。');
  }
  try {
    const copied = await hashStableFile(target);
    invariant(copied.sha256 === expectedSha256, 'move_verification_failed', '整理副本校验失败，原件保持不变。');
  } catch (error) {
    await fsp.unlink(target).catch(() => {});
    throw error;
  }
}

async function rollbackLink(source, target, expectedSha256) {
  const sourceStat = await exists(source);
  const targetStat = await exists(target);
  if (sourceStat && targetStat && sourceStat.dev === targetStat.dev && sourceStat.ino === targetStat.ino) {
    await fsp.unlink(target);
    return true;
  }
  if (!sourceStat && targetStat) {
    await fsp.link(target, source);
    const restored = await hashStableFile(source);
    invariant(restored.sha256 === expectedSha256, 'recovery_conflict', '原位置恢复校验失败。');
    await fsp.unlink(target);
    return true;
  }
  return Boolean(sourceStat && !targetStat);
}

function errorResult(error) {
  const code = String(error?.code || 'io_error');
  return { code, message: String(error?.message || '自动整理失败。').slice(0, 500),
    retryable: !['structure_protected', 'classification_pending', 'adoption_pending',
      'manual_locked', 'invalid_path'].includes(code) };
}

function createProjectMaterialOrganization(project, store, hooks = {}) {
  identifier(project?.id, '项目ID');
  invariant(path.isAbsolute(project.workspacePath || ''), 'invalid_root', '项目工作空间无效。');
  invariant(store && typeof store.read === 'function' && typeof store.mutate === 'function',
    'organization_store_missing', '项目自动整理服务缺少资料登记。');
  const workspace = path.resolve(project.workspacePath);
  const now = hooks.now || timestamp;
  const io = hooks.fs || fsp;

  async function capacity() {
    try {
      const stat = await (hooks.statfs || io.statfs)(workspace);
      const availableBytes = BigInt(stat.bavail) * BigInt(stat.bsize);
      return { ok: availableBytes >= ORGANIZATION_RESERVE_BYTES,
        availableBytes: Number(availableBytes > BigInt(Number.MAX_SAFE_INTEGER)
          ? BigInt(Number.MAX_SAFE_INTEGER) : availableBytes),
        reserveBytes: Number(ORGANIZATION_RESERVE_BYTES),
        code: availableBytes >= ORGANIZATION_RESERVE_BYTES ? '' : 'insufficient_space' };
    } catch {
      return { ok: false, availableBytes: null, reserveBytes: Number(ORGANIZATION_RESERVE_BYTES),
        code: 'capacity_unknown' };
    }
  }

  async function markItem(operationId, materialId, update) {
    await store.mutate((index) => {
      ensureState(index);
      const operation = index.organizationOperations.find((item) => item.operationId === operationId);
      invariant(operation, 'operation_missing', '未找到自动整理操作。');
      const item = operation.items.find((entry) => entry.materialId === materialId);
      invariant(item, 'operation_item_missing', '未找到自动整理条目。');
      Object.assign(item, update, { updatedAt: now() });
      return true;
    });
  }

  async function finalize(operationId) {
    return store.mutate((index) => {
      ensureState(index);
      const operation = index.organizationOperations.find((item) => item.operationId === operationId);
      invariant(operation, 'operation_missing', '未找到自动整理操作。');
      const succeeded = operation.items.filter((item) => item.status === 'succeeded').length;
      const attention = operation.items.filter((item) => item.status === 'recovery_required').length;
      operation.status = attention ? 'attention' : succeeded === operation.items.length ? 'succeeded'
        : succeeded ? 'partial' : 'failed';
      operation.completedAt = now();
      return publicOperation(operation);
    });
  }

  async function recoverInterruptedInternal() {
    const baseline = await store.read({ fresh: true });
    ensureState(baseline);
    const moving = baseline.organizationOperations.flatMap((operation) =>
      operation.items.filter((item) => item.status === 'moving')
        .map((item) => ({ operationId: operation.operationId, item })));
    const results = [];
    for (const pending of moving) {
      const { operationId, item } = pending;
      try {
        const current = await store.read({ fresh: true });
        const record = current.materials.find((entry) => entry.materialId === item.materialId);
        const source = await safePath(workspace, item.before.location.relativePath, { allowMissing: true });
        const target = await safePath(workspace, item.target.relativePath, { allowMissing: true });
        const sourceStat = await exists(source);
        const targetStat = await exists(target);
        const recordStillBefore = record && record.version === item.version
          && record.recordRevision === item.beforeRecordRevision
          && record.sha256 === item.sha256
          && pathKey(record.location) === pathKey(item.before.location);
        if (recordStillBefore && sourceStat && targetStat
          && sourceStat.dev === targetStat.dev && sourceStat.ino === targetStat.ino) {
          await io.unlink(target);
          await markItem(operationId, item.materialId, { status: 'failed',
            code: 'interrupted_before_move', retryable: true, recovered: true,
            message: '检测到中断留下的同一文件链接，已移除临时目标；原件仍在收件箱，可安全重试。' });
          results.push({ materialId: item.materialId, recovered: true, action: 'restored_source' });
          continue;
        }
        if (recordStillBefore && sourceStat && !targetStat) {
          await markItem(operationId, item.materialId, { status: 'failed',
            code: 'interrupted_before_move', retryable: true, recovered: true,
            message: '自动整理在移动前中断；原件未改变，可安全重试。' });
          results.push({ materialId: item.materialId, recovered: true, action: 'kept_source' });
          continue;
        }
        if (recordStillBefore && !sourceStat && targetStat) {
          const observed = await hashStableFile(target);
          invariant(observed.sha256 === item.sha256, 'recovery_conflict',
            '中断后的目标文件内容与原登记不符。');
          await store.mutate((latest) => {
            ensureState(latest);
            const latestOperation = latest.organizationOperations.find((entry) => entry.operationId === operationId);
            const latestItem = latestOperation?.items.find((entry) => entry.materialId === item.materialId);
            const latestRecord = latest.materials.find((entry) => entry.materialId === item.materialId);
            invariant(latestItem?.status === 'moving' && latestRecord
              && latestRecord.version === item.version
              && latestRecord.recordRevision === item.beforeRecordRevision
              && latestRecord.sha256 === item.sha256
              && pathKey(latestRecord.location) === pathKey(item.before.location),
            'recovery_conflict', '恢复提交前资料登记已变化。');
            invariant(!latest.materials.some((entry) => entry.materialId !== item.materialId
              && pathKey(entry.location) === pathKey(item.target)),
            'location_conflict', '中断后的目标位置已登记为另一资料。');
            latestRecord.legacyAliases ||= [];
            latestRecord.legacyAliases.push({ location: clone(latestRecord.location),
              version: latestRecord.version, movedAt: now(), reason: 'authorized-inbox-organization-recovery' });
            latestRecord.location = clone(item.target);
            if (!latestRecord.classification?.categoryId) {
              latestRecord.classification = { ...(latestRecord.classification || {}),
                categoryId: item.categoryId, tags: [], source: 'rule', manualLocked: false,
                actorId: 'host-rule-engine', changedAt: now(), ruleVersion: item.ruleVersion };
            }
            latestRecord.organizationState = 'organized';
            latestRecord.recordRevision++;
            latestRecord.updatedAt = now();
            Object.assign(latestItem, { status: 'succeeded', code: '', retryable: false,
              recovered: true, message: '检测到文件移动已经完成，已校验内容并恢复资料登记。',
              afterRecordRevision: latestRecord.recordRevision,
              after: { location: clone(latestRecord.location),
                classification: clone(latestRecord.classification),
                organizationState: latestRecord.organizationState }, updatedAt: now() });
            return true;
          });
          results.push({ materialId: item.materialId, recovered: true, action: 'committed_target' });
          continue;
        }
        invariant(false, 'recovery_conflict', '自动整理中断现场无法唯一恢复。');
      } catch (error) {
        await markItem(operationId, item.materialId, { status: 'recovery_required',
          code: 'recovery_required', retryable: false, recovered: false,
          message: `自动整理中断现场需主机管理员核对：${String(error.message || error).slice(0, 300)}` });
        results.push({ materialId: item.materialId, recovered: false, action: 'attention_required' });
      }
    }
    const affected = [...new Set(moving.map((entry) => entry.operationId))];
    for (const operationId of affected) await finalize(operationId);
    return { recovered: results.filter((item) => item.recovered).length,
      attention: results.filter((item) => !item.recovered).length, results };
  }

  async function prepare({ materialIds, actorId, idempotencyKey, trigger }) {
    const baseline = await store.read({ fresh: true });
    ensureState(baseline);
    const payloadHash = digest({ projectId: project.id, materialIds: materialIds || [], trigger });
    const replay = baseline.organizationReceipts.find((item) => item.actorId === actorId
      && item.idempotencyKey === idempotencyKey);
    if (replay) {
      invariant(replay.payloadHash === payloadHash, 'idempotency_conflict',
        '同一请求编号已用于不同的自动整理操作。');
      const previous = baseline.organizationOperations.find((item) => item.operationId === replay.operationId);
      return { replay: true, operation: previous ? publicOperation(previous) : replay.response };
    }
    const proposals = suggestProjectMaterialClassifications(baseline, { limit: 500 }).items;
    const proposalById = new Map(proposals.map((item) => [item.materialId, item]));
    const requested = materialIds ? new Set(materialIds.map((value) => identifier(String(value), '资料ID'))) : null;
    const records = baseline.materials.filter((item) => requested
      ? requested.has(item.materialId) : isDirectInboxRecord(item, project));
    const items = [];
    for (const record of records) {
      if (items.length >= configuration(project).maxBatch) break;
      const candidate = safeCandidate(record, baseline, project, proposalById);
      if (!candidate || candidate.code) continue;
      items.push({ materialId: record.materialId, version: record.version,
        beforeRecordRevision: record.recordRevision, categoryId: candidate.categoryId,
        ruleVersion: candidate.proposal ? RULE_VERSION : '', reason: candidate.proposal?.reason || '',
        before: { location: clone(record.location), classification: clone(record.classification || {}),
          organizationState: record.organizationState || 'unclassified' },
        target: { kind: 'workspace', rootId: 'workspace', relativePath: candidate.target },
        sha256: record.sha256, status: 'pending', code: '', message: '', retryable: false,
        undoStatus: '', createdAt: now(), updatedAt: now() });
    }
    if (!items.length) return { replay: false, operation: null, unresolved: records.length };
    const operationId = `organization-operation-${crypto.randomUUID()}`;
    const committed = await store.mutate((index) => {
      ensureState(index);
      invariant(!index.organizationReceipts.some((item) => item.actorId === actorId
        && item.idempotencyKey === idempotencyKey), 'idempotency_conflict',
      '自动整理请求已由另一任务接收，请刷新。');
      for (const item of items) {
        const record = index.materials.find((entry) => entry.materialId === item.materialId);
        invariant(record && record.version === item.version
          && record.recordRevision === item.beforeRecordRevision
          && pathKey(record.location) === pathKey(item.before.location),
        'version_conflict', '准备自动整理时资料已变化，请刷新。');
      }
      const operation = { operationId, projectId: project.id, actorId, idempotencyKey,
        trigger, status: 'running', createdAt: now(), completedAt: '', items };
      index.organizationOperations.push(operation);
      index.organizationReceipts.push({ actorId, idempotencyKey, payloadHash, operationId,
        createdAt: now(), response: { operationId } });
      return publicOperation(operation);
    });
    return { replay: false, operation: committed.result, operationId, unresolved: records.length - items.length };
  }

  async function moveItem(operationId, materialId) {
    const index = await store.read({ fresh: true });
    const operation = (index.organizationOperations || []).find((item) => item.operationId === operationId);
    const item = operation?.items.find((entry) => entry.materialId === materialId);
    invariant(item && ['pending', 'failed'].includes(item.status), 'operation_state', '该资料当前不能执行整理。');
    const record = index.materials.find((entry) => entry.materialId === materialId);
    invariant(record && record.version === item.version
      && record.recordRevision === item.beforeRecordRevision
      && record.sha256 === item.sha256
      && pathKey(record.location) === pathKey(item.before.location),
    'version_conflict', '资料已变化，自动整理未执行。');
    if (record.classification?.manualLocked) {
      invariant(record.classification.categoryId === item.categoryId
        && JSON.stringify(record.classification) === JSON.stringify(item.before.classification),
      'manual_locked', '人工分类已变化，后台不会覆盖。');
    }
    await markItem(operationId, materialId, { status: 'moving', code: '', message: '', retryable: false });
    const source = await store.locationPath(item.before.location);
    const resolved = await store.resolve(materialId, item.version);
    invariant(resolved.sha256 === item.sha256 && resolved.path === source,
      'source_changed', '原件已变化，自动整理未执行。');
    const target = await safePath(workspace, item.target.relativePath, { allowMissing: true });
    invariant(within(workspace, target), 'invalid_path', '自动整理目标越界。');
    await io.mkdir(path.dirname(target), { recursive: true });
    await safePath(workspace, path.posix.dirname(item.target.relativePath), { allowMissing: false });
    let linked = false;
    try {
      await createVerifiedLink(source, target, item.sha256);
      linked = true;
      await io.unlink(source);
      await store.mutate((current) => {
        ensureState(current);
        const currentOperation = current.organizationOperations.find((entry) => entry.operationId === operationId);
        const currentItem = currentOperation?.items.find((entry) => entry.materialId === materialId);
        const currentRecord = current.materials.find((entry) => entry.materialId === materialId);
        invariant(currentItem?.status === 'moving' && currentRecord
          && currentRecord.version === item.version
          && currentRecord.recordRevision === item.beforeRecordRevision
          && currentRecord.sha256 === item.sha256
          && pathKey(currentRecord.location) === pathKey(item.before.location),
        'version_conflict', '整理提交前资料已变化。');
        invariant(!current.materials.some((entry) => entry.materialId !== materialId
          && pathKey(entry.location) === pathKey(item.target)),
        'location_conflict', '目标位置已登记为另一资料。');
        currentRecord.legacyAliases ||= [];
        currentRecord.legacyAliases.push({ location: clone(currentRecord.location),
          version: currentRecord.version, movedAt: now(), reason: 'authorized-inbox-organization' });
        currentRecord.location = clone(item.target);
        if (!currentRecord.classification?.categoryId) {
          currentRecord.classification = { ...(currentRecord.classification || {}),
            categoryId: item.categoryId, tags: [], source: 'rule', manualLocked: false,
            actorId: 'host-rule-engine', changedAt: now(), ruleVersion: item.ruleVersion };
        }
        currentRecord.organizationState = 'organized';
        currentRecord.recordRevision++;
        currentRecord.updatedAt = now();
        Object.assign(currentItem, { status: 'succeeded', code: '', message: item.reason
          ? `${item.reason.replace('；请人工确认，原件不会移动。', '')}；已按项目的一次授权整理到对应文件夹。`
          : '已按人工分类和项目的一次授权整理到对应文件夹。', retryable: false,
        afterRecordRevision: currentRecord.recordRevision,
        after: { location: clone(currentRecord.location), classification: clone(currentRecord.classification),
          organizationState: currentRecord.organizationState }, updatedAt: now() });
        return true;
      });
      return { materialId, ok: true };
    } catch (error) {
      let recovered = false;
      if (linked) {
        try { recovered = await rollbackLink(source, target, item.sha256); } catch { recovered = false; }
      }
      const failure = errorResult(error);
      await markItem(operationId, materialId, recovered || !linked
        ? { status: 'failed', ...failure }
        : { status: 'recovery_required', code: 'recovery_required', retryable: false,
          message: '自动整理被中断且无法安全恢复，请在主机核对原位置和目标位置。' });
      return { materialId, ok: false, ...failure, recovered };
    }
  }

  async function run(request, access = {}) {
    strictObject(request, new Set(['materialIds', 'idempotencyKey', 'trigger']));
    invariant(access.canWrite === true, 'forbidden', '当前身份不能运行项目自动整理。');
    const actorId = identifier(String(access.actorId || ''), '操作人ID');
    const idempotencyKey = identifier(String(request.idempotencyKey || ''), '请求ID');
    const trigger = ['manual', 'scheduled', 'workspace_change', 'retry'].includes(String(request.trigger || 'manual'))
      ? String(request.trigger || 'manual') : 'manual';
    invariant(request.materialIds === undefined || (Array.isArray(request.materialIds)
      && request.materialIds.length > 0 && request.materialIds.length <= 50),
    'invalid_batch', '自动整理资料范围无效。');
    invariant(configuration(project).enabled, 'organization_not_authorized',
      '此项目尚未一次授权“自动整理收件箱”。');
    return serialized(project.id, async () => {
      await recoverInterruptedInternal();
      const capacityState = await capacity();
      if (!capacityState.ok) return { ok: false, code: capacityState.code, capacity: capacityState,
        retryable: true, message: capacityState.code === 'insufficient_space'
          ? '磁盘可用空间低于安全余量，已暂停自动整理；原件未移动。'
          : '无法确认磁盘可用空间，已暂停自动整理；原件未移动。' };
      const prepared = await prepare({ materialIds: request.materialIds, actorId,
        idempotencyKey, trigger });
      if (prepared.replay) return { ok: true, idempotentReplay: true,
        operation: prepared.operation, capacity: capacityState };
      if (!prepared.operationId) return { ok: true, operation: null,
        unresolved: prepared.unresolved, capacity: capacityState,
        message: '当前没有符合安全规则的收件箱文件；待分类、未采用或结构型资料保持原位。' };
      const results = [];
      for (const item of prepared.operation.items) results.push(await moveItem(prepared.operationId, item.materialId));
      const completed = await finalize(prepared.operationId);
      return { ok: true, operation: completed.result, results, unresolved: prepared.unresolved,
        capacity: capacityState, message: `自动整理完成：${completed.result.counts.succeeded}/${completed.result.counts.total}份成功；异常仅保留回执，不覆盖任何文件。` };
    });
  }

  async function retry(operationId, request, access = {}) {
    identifier(operationId, '自动整理操作ID');
    strictObject(request, new Set(['materialIds', 'idempotencyKey']));
    await serialized(project.id, recoverInterruptedInternal);
    const index = await store.read({ fresh: true });
    const operation = (index.organizationOperations || []).find((item) => item.operationId === operationId);
    invariant(operation, 'operation_missing', '未找到自动整理操作。');
    const allowed = new Set(operation.items.filter((item) => item.status === 'failed' && item.retryable)
      .map((item) => item.materialId));
    const materialIds = Array.isArray(request.materialIds) ? request.materialIds.map(String) : [...allowed];
    invariant(materialIds.length > 0 && materialIds.every((id) => allowed.has(id)),
      'retry_not_allowed', '所选条目当前不可重试，请先按提示处理冲突。');
    return run({ materialIds, idempotencyKey: request.idempotencyKey, trigger: 'retry' }, access);
  }

  async function undo(operationId, request, access = {}) {
    identifier(operationId, '自动整理操作ID');
    strictObject(request, new Set(['idempotencyKey']));
    invariant(access.canWrite === true, 'forbidden', '当前身份不能撤销自动整理。');
    const actorId = identifier(String(access.actorId || ''), '操作人ID');
    const idempotencyKey = identifier(String(request.idempotencyKey || ''), '请求ID');
    return serialized(project.id, async () => {
      await recoverInterruptedInternal();
      const baseline = await store.read({ fresh: true });
      ensureState(baseline);
      const payloadHash = digest({ projectId: project.id, operationId });
      const prior = baseline.organizationReceipts.find((item) => item.kind === 'undo'
        && item.actorId === actorId && item.idempotencyKey === idempotencyKey);
      if (prior) {
        invariant(prior.payloadHash === payloadHash, 'idempotency_conflict',
          '同一请求编号已用于不同的撤销操作。');
        return { ok: true, idempotentReplay: true, operation: prior.response };
      }
      const operation = baseline.organizationOperations.find((item) => item.operationId === operationId);
      invariant(operation, 'operation_missing', '未找到自动整理操作。');
      const results = [];
      for (const item of operation.items.filter((entry) => entry.status === 'succeeded'
        && entry.undoStatus !== 'succeeded')) {
        let source;
        let target;
        let linked = false;
        try {
          const current = await store.read({ fresh: true });
          const record = current.materials.find((entry) => entry.materialId === item.materialId);
          invariant(record && record.version === item.version
            && record.recordRevision === item.afterRecordRevision
            && record.sha256 === item.sha256
            && pathKey(record.location) === pathKey(item.after.location)
            && JSON.stringify(record.classification) === JSON.stringify(item.after.classification),
          'undo_conflict', '资料或人工分类已继续变化，不能自动撤销。');
          source = await safePath(workspace, item.before.location.relativePath, { allowMissing: true });
          target = await store.locationPath(item.after.location);
          invariant(!(await exists(source)), 'undo_target_occupied', '原位置已有文件，不能覆盖撤销。');
          invariant(!current.materials.some((entry) => entry.materialId !== item.materialId
            && pathKey(entry.location) === pathKey(item.before.location)),
          'undo_target_occupied', '原位置已登记为另一资料，不能撤销。');
          await io.mkdir(path.dirname(source), { recursive: true });
          await createVerifiedLink(target, source, item.sha256);
          linked = true;
          await io.unlink(target);
          await store.mutate((latest) => {
            ensureState(latest);
            const latestOperation = latest.organizationOperations.find((entry) => entry.operationId === operationId);
            const latestItem = latestOperation?.items.find((entry) => entry.materialId === item.materialId);
            const latestRecord = latest.materials.find((entry) => entry.materialId === item.materialId);
            invariant(latestItem && latestRecord && latestRecord.version === item.version
              && latestRecord.recordRevision === item.afterRecordRevision
              && pathKey(latestRecord.location) === pathKey(item.after.location),
            'undo_conflict', '撤销提交前资料已变化。');
            latestRecord.legacyAliases ||= [];
            latestRecord.legacyAliases.push({ location: clone(latestRecord.location),
              version: latestRecord.version, movedAt: now(), reason: 'organization-undo' });
            latestRecord.location = clone(item.before.location);
            latestRecord.classification = clone(item.before.classification);
            latestRecord.organizationState = item.before.organizationState;
            latestRecord.recordRevision++;
            latestRecord.updatedAt = now();
            latestItem.undoStatus = 'succeeded';
            latestItem.undoAt = now();
            latestItem.undoRecordRevision = latestRecord.recordRevision;
            return true;
          });
          results.push({ materialId: item.materialId, ok: true });
        } catch (error) {
          let recovered = false;
          if (linked && source && target) {
            try { recovered = await rollbackLink(target, source, item.sha256); } catch { recovered = false; }
          }
          const failure = errorResult(error);
          await markItem(operationId, item.materialId, { undoStatus: recovered || !linked ? 'failed' : 'recovery_required',
            undoCode: recovered || !linked ? failure.code : 'recovery_required',
            undoMessage: recovered || !linked ? failure.message : '撤销中断且无法安全恢复，请在主机核对。' });
          results.push({ materialId: item.materialId, ok: false, ...failure });
        }
      }
      const committed = await store.mutate((latest) => {
        ensureState(latest);
        const latestOperation = latest.organizationOperations.find((item) => item.operationId === operationId);
        latestOperation.undoStatus = results.every((item) => item.ok) ? 'succeeded'
          : results.some((item) => item.ok) ? 'partial' : 'failed';
        latestOperation.undoCompletedAt = now();
        const response = publicOperation(latestOperation);
        latest.organizationReceipts.push({ kind: 'undo', actorId, idempotencyKey,
          payloadHash, operationId, createdAt: now(), response: clone(response) });
        return response;
      });
      return { ok: true, operation: committed.result, results };
    });
  }

  async function status({ visibleMaterialIds, limit = 20 } = {}) {
    await serialized(project.id, recoverInterruptedInternal);
    const index = await store.read();
    ensureState(index);
    const visibleIds = visibleMaterialIds instanceof Set ? visibleMaterialIds : null;
    const operations = index.organizationOperations.slice(-Math.max(1, Math.min(50, limit)))
      .reverse().map((operation) => publicOperation(operation, visibleIds))
      .filter((operation) => operation.items.length > 0);
    return { projectId: project.id, configuration: configuration(project),
      capacity: await capacity(), operations, registryRevision: index.revision };
  }

  async function inspectCleanup() {
    const candidates = [];
    const cutoff = Date.now() - CLEANUP_MIN_AGE_MS;
    const areas = [
      { id: 'snapshot-partial', root: path.join(store.directory, 'snapshots'), pattern: /^[a-f0-9-]+\.partial$/i },
      { id: 'inbox-import-partial', root: path.join(workspace, project.inboxRelativePath || '收件箱'),
        pattern: /^\._edu-import-[a-f0-9-]{36}\.partial$/i },
    ];
    for (const area of areas) {
      let entries = [];
      try { entries = await io.readdir(area.root, { withFileTypes: true }); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      for (const entry of entries.slice(0, 2000)) {
        if (!entry.isFile() || !area.pattern.test(entry.name)) continue;
        const file = await safePath(area.root, entry.name);
        const stat = await io.lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.mtimeMs > cutoff) continue;
        const candidateId = digest([area.id, entry.name, stat.size, stat.mtimeMs, stat.dev, stat.ino]);
        candidates.push({ candidateId, area: area.id, name: entry.name, size: stat.size,
          modifiedAt: new Date(stat.mtimeMs).toISOString(), fileKey: `${stat.dev}:${stat.ino}`,
          internal: { file, mtimeMs: stat.mtimeMs } });
      }
    }
    return { projectId: project.id, candidates };
  }

  async function cleanup(request, access = {}) {
    strictObject(request, new Set(['candidateIds', 'idempotencyKey']));
    invariant(access.canWrite === true, 'forbidden', '当前身份不能清理项目临时残件。');
    const actorId = identifier(String(access.actorId || ''), '操作人ID');
    const idempotencyKey = identifier(String(request.idempotencyKey || ''), '请求ID');
    invariant(Array.isArray(request.candidateIds) && request.candidateIds.length > 0
      && request.candidateIds.length <= 200, 'invalid_batch', '临时残件清理范围无效。');
    const selected = new Set(request.candidateIds.map(String));
    const payloadHash = digest({ projectId: project.id, candidateIds: [...selected].sort() });
    return serialized(project.id, async () => {
      const baseline = await store.read({ fresh: true });
      ensureState(baseline);
      const replay = baseline.capacityCleanupOperations.find((item) => item.actorId === actorId
        && item.idempotencyKey === idempotencyKey);
      if (replay) {
        invariant(replay.payloadHash === payloadHash, 'idempotency_conflict',
          '同一请求编号已用于不同的临时残件清理。');
        return { ...clone(replay.response), idempotentReplay: true };
      }
      const inspected = await inspectCleanup();
      const items = inspected.candidates.filter((item) => selected.has(item.candidateId));
      invariant(items.length === selected.size, 'cleanup_candidate_changed',
        '临时残件已变化，请重新检查后选择。');
      const results = [];
      for (const item of items) {
        try {
          const stat = await io.lstat(item.internal.file);
          invariant(stat.isFile() && !stat.isSymbolicLink()
            && stat.mtimeMs === item.internal.mtimeMs
            && `${stat.dev}:${stat.ino}` === item.fileKey,
          'cleanup_candidate_changed', '临时残件已变化，未清理。');
          await io.unlink(item.internal.file);
          results.push({ candidateId: item.candidateId, area: item.area, name: item.name,
            size: item.size, ok: true });
        } catch (error) {
          results.push({ candidateId: item.candidateId, area: item.area, name: item.name,
            size: item.size, ok: false, code: error.code || 'cleanup_failed' });
        }
      }
      const response = { ok: true, results,
        message: `已核对并清理 ${results.filter((item) => item.ok).length}/${results.length} 个过期临时残件；原文、固定版本和迁移备份未纳入。` };
      await store.mutate((index) => {
        ensureState(index);
        invariant(!index.capacityCleanupOperations.some((item) => item.actorId === actorId
          && item.idempotencyKey === idempotencyKey), 'idempotency_conflict',
        '临时残件清理请求已由另一任务接收，请刷新。');
        index.capacityCleanupOperations.push({ cleanupId: `capacity-cleanup-${crypto.randomUUID()}`,
          actorId, idempotencyKey, payloadHash, createdAt: now(), results,
          response: clone(response) });
        return true;
      });
      return response;
    });
  }

  async function recoverInterrupted() {
    return serialized(project.id, recoverInterruptedInternal);
  }

  return { run, retry, undo, status, capacity, inspectCleanup, cleanup, recoverInterrupted,
    publicOperation, configuration: () => configuration(project) };
}

module.exports = {
  SAFE_EXTENSIONS, ORGANIZATION_RESERVE_BYTES, CLEANUP_MIN_AGE_MS,
  configuration, publicOperation, createProjectMaterialOrganization,
};
