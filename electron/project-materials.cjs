const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { hashStableFile } = require('./file-fingerprint.cjs');
const {
  MATERIAL_SCHEMA, MaterialError, invariant, identifier, relativeMaterialPath,
  positiveVersion, newMaterialId, validateMaterial, adoptionForImport,
} = require('./project-material-contract.cjs');

// All project service instances in this host share a short commit queue. No
// file hashing, snapshot copying, parsing or AI network call holds this queue.
const commitQueues = new Map();
const NO_CHANGE = Symbol('project-material-no-change');
const clone = (value) => structuredClone(value);
const now = () => new Date().toISOString();
const unchanged = (result) => ({ [NO_CHANGE]: true, result });
const pathKey = (location) => JSON.stringify([location.rootId,
  process.platform === 'win32' ? location.relativePath.toLowerCase() : location.relativePath]);
const SNAPSHOT_FREE_RESERVE_BYTES = 512n * 1024n * 1024n;

function validateRegistry(data, projectId) {
  invariant(data?.schema === MATERIAL_SCHEMA && data.projectId === projectId
    && Number.isSafeInteger(data.revision) && data.revision >= 0
    && Array.isArray(data.materials) && Array.isArray(data.categories)
    && Array.isArray(data.receipts) && Array.isArray(data.commits),
  'registry_corrupt', '项目资料登记的结构或项目范围不符。');
  invariant(data.classificationSuggestions === undefined || Array.isArray(data.classificationSuggestions),
    'registry_corrupt', '项目分类建议记录结构无效。');
  invariant(data.classificationOperations === undefined || Array.isArray(data.classificationOperations),
    'registry_corrupt', '项目分类操作记录结构无效。');
  invariant(data.classificationReceipts === undefined || Array.isArray(data.classificationReceipts),
    'registry_corrupt', '项目分类幂等回执结构无效。');
  invariant(data.adoptionReceipts === undefined || Array.isArray(data.adoptionReceipts),
    'registry_corrupt', '项目采用审核幂等回执结构无效。');
  invariant(data.organizationOperations === undefined || Array.isArray(data.organizationOperations),
    'registry_corrupt', '项目自动整理操作记录结构无效。');
  invariant(data.organizationReceipts === undefined || Array.isArray(data.organizationReceipts),
    'registry_corrupt', '项目自动整理幂等回执结构无效。');
  invariant(data.capacityCleanupOperations === undefined || Array.isArray(data.capacityCleanupOperations),
    'registry_corrupt', '项目容量清理审计记录结构无效。');
  invariant(data.migrationOperations === undefined || Array.isArray(data.migrationOperations),
    'registry_corrupt', '项目历史迁移操作记录结构无效。');
  invariant(data.migrationReceipts === undefined || Array.isArray(data.migrationReceipts),
    'registry_corrupt', '项目历史迁移幂等回执结构无效。');
  const ids = new Set();
  for (const record of data.materials) {
    validateMaterial(record, projectId);
    invariant(!ids.has(record.materialId), 'registry_corrupt', '项目资料身份重复。');
    ids.add(record.materialId);
  }
  const aliases = new Set();
  invariant(data.materialIdAliases === undefined || Array.isArray(data.materialIdAliases),
    'registry_corrupt', '资料身份别名结构无效。');
  for (const alias of data.materialIdAliases || []) {
    identifier(alias.materialId, '旧资料ID');
    identifier(alias.canonicalMaterialId, '正式资料ID');
    positiveVersion(alias.fromVersion);
    positiveVersion(alias.toVersion);
    const canonical = data.materials.find((item) => item.materialId === alias.canonicalMaterialId);
    invariant(!ids.has(alias.materialId) && !aliases.has(alias.materialId)
      && canonical && canonical.versions.some((item) => item.version === alias.toVersion
        && item.sha256 === alias.sha256), 'registry_corrupt', '资料身份别名与正式版本不匹配。');
    aliases.add(alias.materialId);
  }
  invariant(data.materialMergeHistory === undefined || Array.isArray(data.materialMergeHistory),
    'registry_corrupt', '资料身份纠正记录结构无效。');
  for (const entry of data.materialMergeHistory || []) {
    identifier(entry.mergeId, '纠正记录ID');
    invariant(entry.sourceBefore?.projectId === projectId && entry.duplicateBefore?.projectId === projectId,
      'registry_corrupt', '资料身份纠正记录项目范围不符。');
    validateMaterial(entry.sourceBefore, projectId);
    validateMaterial(entry.duplicateBefore, projectId);
  }
  return data;
}

async function withCommitLock(key, operation) {
  const previous = commitQueues.get(key) || Promise.resolve();
  const work = previous.catch(() => {}).then(operation);
  commitQueues.set(key, work);
  try { return await work; } finally {
    if (commitQueues.get(key) === work) commitQueues.delete(key);
  }
}

function within(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

async function safePath(root, relative, { allowMissing = false } = {}) {
  const parts = relativeMaterialPath(relative).split('/');
  const canonicalRoot = await fsp.realpath(root);
  let target = canonicalRoot;
  for (const part of parts) {
    target = path.join(target, part);
    try {
      const stat = await fsp.lstat(target);
      invariant(!stat.isSymbolicLink(), 'linked_path', '资料路径包含链接，需单独授权。');
    } catch (error) {
      if (!(allowMissing && error.code === 'ENOENT')) throw error;
    }
  }
  invariant(within(canonicalRoot, target), 'invalid_path', '资料路径越界。');
  return target;
}

async function writeJsonAtomic(file, value) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fsp.open(temporary, 'wx');
    await handle.writeFile(JSON.stringify(value), 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await fsp.rename(temporary, file);
  } finally {
    await handle?.close();
    await fsp.rm(temporary, { force: true });
  }
}

function createProjectMaterialStore({ projectId, managerPath, roots, hooks = {} }) {
  identifier(projectId, '项目ID');
  invariant(typeof managerPath === 'string' && path.isAbsolute(managerPath), 'invalid_root', '项目管理目录无效。');
  invariant(roots && typeof roots === 'object', 'invalid_root', '项目资料根未配置。');
  const configuredRoots = new Map(Object.entries(roots).map(([id, root]) => {
    identifier(id, '根目录ID');
    invariant(root && path.isAbsolute(root.path) && ['workspace', 'legacy_raw', 'external'].includes(root.kind),
      'invalid_root', '项目资料根配置无效。');
    return [id, { path: path.resolve(root.path), kind: root.kind }];
  }));
  const directory = path.join(managerPath, 'project-materials');
  const indexPath = path.join(directory, 'registry.json');
  const lockKey = process.platform === 'win32' ? indexPath.toLowerCase() : indexPath;
  let cached = null;
  let cachedStamp = '';

  async function ensureDirectory() {
    await fsp.mkdir(managerPath, { recursive: true });
    await safePath(managerPath, 'project-materials', { allowMissing: true });
    await fsp.mkdir(directory, { recursive: true });
    await safePath(directory, 'registry.json', { allowMissing: true });
  }

  function empty() {
    return { schema: MATERIAL_SCHEMA, projectId, revision: 0, updatedAt: '',
      categories: [], materials: [], receipts: [], commits: [] };
  }

  async function load({ fresh = false } = {}) {
    let stat;
    try {
      // Index queries inspect only the small registry; never an original file.
      await safePath(managerPath, 'project-materials/registry.json');
      stat = await fsp.stat(indexPath);
    } catch (error) {
      if (error.code === 'ENOENT') { cached = null; cachedStamp = ''; return empty(); }
      throw error;
    }
    const stamp = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}:${stat.ino}`;
    if (!fresh && cached && stamp === cachedStamp) return cached;
    let data;
    try { data = JSON.parse(await fsp.readFile(indexPath, 'utf8')); }
    catch (error) { throw new MaterialError('registry_corrupt', '项目资料登记无法读取，需恢复后再写入。', { cause: error.message }); }
    validateRegistry(data, projectId);
    cached = data;
    cachedStamp = stamp;
    return data;
  }

  async function read(options = {}) {
    return clone(await load(options));
  }

  // Internal read-only inspection path for bounded host/worker pipelines.  The
  // public `read()` contract deliberately returns an isolated clone, but
  // cloning a 30k-record registry once per verified material caused very large
  // transient heaps.  Callers of inspect() must never mutate the returned
  // object; all writes still go through mutate().
  async function inspect(options = {}) {
    return load(options);
  }

  async function mutate(operation, expectedRevision) {
    return withCommitLock(lockKey, async () => {
      await ensureDirectory();
      // Mutations work on an isolated draft so a failed atomic write cannot
      // leak uncommitted records through the read cache.
      const data = clone(await load({ fresh: true }));
      invariant(expectedRevision === undefined || data.revision === expectedRevision,
        'revision_conflict', '项目资料已变化，请刷新后重试。', { revision: data.revision });
      const operationResult = operation(data);
      invariant(!operationResult || typeof operationResult.then !== 'function', 'async_commit', '不能在资料提交锁内执行异步任务。');
      if (operationResult?.[NO_CHANGE]) {
        return { result: clone(operationResult.result), revision: data.revision, unchanged: true };
      }
      for (const record of data.materials) validateMaterial(record, projectId);
      data.revision++;
      data.updatedAt = now();
      await hooks.beforeIndexWrite?.(clone(data));
      await writeJsonAtomic(indexPath, data);
      cached = null;
      cachedStamp = '';
      return { result: clone(operationResult), revision: data.revision };
    });
  }

  async function locationPath(location) {
    const root = configuredRoots.get(location?.rootId);
    invariant(root && root.kind === location.kind, 'unknown_root', '资料根未经此项目授权。');
    const rel = relativeMaterialPath(location.relativePath);
    invariant(!rel.split('/').some((part) => part.toLowerCase() === '.edu-manager'),
      'generated_source', '管理目录不能作为原始资料。');
    const file = await safePath(root.path, rel);
    invariant(!within(path.resolve(managerPath), file), 'generated_source', '管理文件不能作为原始资料。');
    return file;
  }

  async function registerFiles(entries, options = {}) {
    invariant(Array.isArray(entries) && entries.length > 0 && entries.length <= 1000,
      'invalid_batch', '每次登记须包含1至1000项。');
    const baseline = await read();
    // Bounded sequential hashing stays outside the metadata commit queue.
    const observed = [];
    for (const input of entries) {
      const location = { kind: input.location?.kind, rootId: input.location?.rootId,
        relativePath: relativeMaterialPath(input.location?.relativePath) };
      const file = await locationPath(location);
      const content = await hashStableFile(file, { afterRead: hooks.afterSourceRead });
      if (input.expectedSha256) invariant(content.sha256 === input.expectedSha256,
        'source_changed', '所选原件内容与待修复资料版本不一致。');
      if (input.expectedFileKey) invariant(content.fileKey === input.expectedFileKey,
        'source_changed', '原件文件标识在扫描与登记之间已变化，请重新扫描。');
      observed.push({ input, location, content });
    }
    invariant(new Set(observed.map((item) => pathKey(item.location))).size === observed.length,
      'duplicate_location', '同批登记不能包含重复位置。');
    await hooks.afterObservation?.();
    return mutate((data) => {
      const byId = new Map(data.materials.map((item) => [item.materialId, item]));
      const byPath = new Map(data.materials.map((item) => [pathKey(item.location), item]));
      const baselineById = new Map(baseline.materials.map((item) => [item.materialId, item]));
      const baselineByPath = new Map(baseline.materials.map((item) => [pathKey(item.location), item]));
      let changed = false;
      const results = observed.map(({ input, location, content }) => {
        const targetKey = pathKey(location);
        const occupant = byPath.get(targetKey);
        const existing = input.materialId ? byId.get(input.materialId) : occupant;
        invariant(!input.materialId || existing, 'material_missing', '待更新资料不存在。');
        invariant(!occupant || !existing || occupant.materialId === existing.materialId,
          'location_conflict', '新位置已有另一份资料。');
        invariant(!existing || input.expectedVersion === undefined || input.expectedVersion === existing.version,
          'version_conflict', '资料版本已变化。');
        const previous = input.materialId ? baselineById.get(input.materialId) : baselineByPath.get(targetKey);
        invariant(!existing || (previous && previous.version === existing.version
          && pathKey(previous.location) === pathKey(existing.location))
          || (!previous && existing.sha256 === content.sha256),
        'version_conflict', '读取期间另一任务已登记新版本，请重新扫描。');
        const sameContent = existing?.sha256 === content.sha256;
        const source = input.source;
        const sourceAlreadyLinked = !source || existing?.sources?.some((item) => item.eventId === source.eventId);
        const sameLocation = existing && pathKey(existing.location) === targetKey;
        if (existing && sameContent && sameLocation && sourceAlreadyLinked
          && existing.availability === 'available' && existing.fileKey === content.fileKey
          && existing.size === content.size && existing.mtimeMs === content.mtimeMs) return existing;
        changed = true;
        const record = existing || { projectId, materialId: newMaterialId(), version: 1,
          createdAt: now(), sources: [], versions: [], legacyAliases: [], links: {},
          adoption: { state: adoptionForImport(options), decidedAt: now() },
          classification: { categoryId: '', tags: [], source: '', manualLocked: false },
          organizationState: 'unclassified', processing: { state: 'pending' }, recordRevision: 0 };
        if (existing && !sameContent) {
          record.version++;
          record.processing = { ...record.processing, state: 'pending', previousProcessedVersion: record.processing.processedVersion };
        }
        if (existing && pathKey(record.location) !== targetKey) {
          byPath.delete(pathKey(record.location));
          record.legacyAliases.push({ location: clone(record.location), version: record.version, movedAt: now() });
        }
        Object.assign(record, content, { location, availability: 'available', contentVerifiedAt: now(),
          updatedAt: now(), recordRevision: record.recordRevision + 1 });
        if (source) {
          identifier(source.eventId, '来源事件ID');
          if (!record.sources.some((item) => item.eventId === source.eventId)) record.sources.push(clone(source));
        }
        if (!record.versions.some((version) => version.version === record.version)) {
          record.versions.push({ version: record.version, sha256: record.sha256, sha1: record.sha1,
            size: record.size, registeredAt: now(), snapshot: null });
        }
        if (!existing) {
          if (source?.intakeAssociation?.itemId && source.intakeAssociation.studentId === source.studentId) record.intakeOrigin = clone(source.intakeAssociation);
          data.materials.push(record); byId.set(record.materialId, record);
        }
        byPath.set(targetKey, record);
        return record;
      });
      return changed ? results : unchanged(results);
    }, options.expectedRevision);
  }

  async function list({ offset = 0, limit = 50, categoryId, adoption, search = '' } = {}) {
    invariant(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit) && limit > 0 && limit <= 200,
      'invalid_pagination', '资料分页参数无效。');
    const data = await load();
    const query = String(search).toLocaleLowerCase();
    const items = data.materials.filter((item) => (!categoryId || item.classification.categoryId === categoryId)
      && (!adoption || item.adoption.state === adoption)
      && (!query || item.location.relativePath.toLocaleLowerCase().includes(query)));
    return { projectId, revision: data.revision, total: items.length,
      items: items.slice(offset, offset + limit), categories: data.categories };
  }

  async function resolve(materialId, version, { verify = true } = {}) {
    identifier(materialId, '资料ID');
    const data = await inspect();
    const alias = data.materialIdAliases?.find((item) => item.materialId === materialId);
    const record = data.materials.find((item) => item.materialId === (alias?.canonicalMaterialId || materialId));
    invariant(record, 'material_missing', '此项目中没有该资料。');
    const requestedVersion = version === undefined ? undefined : positiveVersion(version);
    if (alias) invariant(requestedVersion === undefined || requestedVersion === alias.fromVersion,
      'version_missing', '旧资料身份没有该版本。');
    const selectedVersion = alias ? alias.toVersion : requestedVersion ?? record.version;
    const selected = record.versions.find((item) => item.version === selectedVersion);
    invariant(selected, 'version_missing', '该资料版本不存在。');
    invariant(!alias || selected.sha256 === alias.sha256, 'registry_corrupt', '旧资料身份指向的版本校验值不符。');
    let file;
    if (version !== undefined && selected.snapshot) file = await safePath(directory, selected.snapshot);
    else {
      invariant(selectedVersion === record.version, 'version_unavailable', '历史原文版本未留存，不能用最新文件替代。');
      file = await locationPath(record.location);
    }
    if (verify) {
      const observed = await hashStableFile(file);
      invariant(observed.sha256 === selected.sha256, 'source_changed', '资料内容与登记版本不符，需要刷新登记。');
    }
    return { projectId, materialId: record.materialId, version: selectedVersion, path: file, sha256: selected.sha256,
      sha1: selected.sha1, size: selected.size, location: clone(record.location) };
  }

  async function snapshot(materialId, version) {
    const source = await resolve(materialId, version);
    await ensureDirectory();
    const snapshotRoot = await safePath(directory, 'snapshots', { allowMissing: true });
    await fsp.mkdir(snapshotRoot, { recursive: true });
    const relative = `snapshots/${source.sha256}`;
    const finalPath = await safePath(directory, relative, { allowMissing: true });
    return withCommitLock(`snapshot:${finalPath}`, async () => {
      let exists = false;
      try { exists = (await fsp.lstat(finalPath)).isFile(); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      const temporary = path.join(snapshotRoot, `${crypto.randomUUID()}.partial`);
      try {
        if (!exists) {
          let available;
          try {
            const stat = await (hooks.statfs || fsp.statfs)(snapshotRoot);
            available = BigInt(stat.bavail) * BigInt(stat.bsize);
            invariant(BigInt(stat.bavail) > 0n && BigInt(stat.bsize) > 0n,
              'capacity_unknown', '无法确认固定版本所在磁盘的剩余空间，已暂停新快照。');
          } catch (error) {
            if (error.code === 'capacity_unknown') throw error;
            throw new MaterialError('capacity_unknown', '无法确认固定版本所在磁盘的剩余空间，已暂停新快照。');
          }
          const required = BigInt(source.size) + SNAPSHOT_FREE_RESERVE_BYTES;
          invariant(available >= required, 'insufficient_space',
            `固定版本需要约 ${required} 字节可用空间（含安全余量），当前仅 ${available} 字节；原文和现有快照未清理。`);
          const observed = await hashStableFile(source.path, { copyTo: temporary, afterRead: hooks.afterSnapshotRead });
          invariant(observed.sha256 === source.sha256, 'source_changed', '资料在建立固定版本前已改变。');
          try { await (hooks.link || fsp.link)(temporary, finalPath); }
          catch (error) {
            if (error.code !== 'EEXIST') throw new MaterialError('atomic_publish_unavailable',
              '固定版本所在文件系统不支持安全的无覆盖发布，原文未移动；请更换受支持的管理目录。');
          }
        }
        const stored = await hashStableFile(finalPath);
        invariant(stored.sha256 === source.sha256, 'snapshot_corrupt', '固定版本内容校验失败。');
        // Read-only is defense in depth; execution adapters must separately deny
        // writes to this directory. chmod alone is not a process sandbox.
        await fsp.chmod(finalPath, 0o444);
        await mutate((data) => {
          const record = data.materials.find((item) => item.materialId === materialId);
          const selected = record?.versions.find((item) => item.version === source.version);
          invariant(selected?.sha256 === source.sha256, 'version_conflict', '待固定的资料版本已不匹配。');
          selected.snapshot = relative;
          selected.pins ||= [];
        });
        return { ...source, path: finalPath, snapshot: relative };
      } finally { await fsp.rm(temporary, { force: true }); }
    });
  }

  async function setCategories(categories, expectedRevision) {
    invariant(Array.isArray(categories) && categories.length <= 500, 'invalid_categories', '项目分类列表无效。');
    const definitions = categories.map((item) => ({
      categoryId: identifier(item.categoryId, '分类ID'), name: identifier(item.name, '分类名'),
      relativePath: item.relativePath ? relativeMaterialPath(item.relativePath) : '',
      active: item.active !== false,
      templateSource: item.templateSource ? identifier(item.templateSource, '分类模板来源') : '',
      templateSlot: Number.isSafeInteger(item.templateSlot) && item.templateSlot >= 0 ? item.templateSlot : null,
      aliases: Array.isArray(item.aliases)
        ? [...new Set(item.aliases.map((alias) => identifier(String(alias), '分类别名')))].slice(0, 20) : [],
    }));
    invariant(new Set(definitions.map((item) => item.categoryId)).size === definitions.length,
      'duplicate_category', '分类ID重复。');
    return mutate((data) => {
      for (const previous of data.categories) {
        if (!definitions.some((item) => item.categoryId === previous.categoryId)) definitions.push({ ...previous, active: false });
      }
      data.categories = definitions;
      return definitions;
    }, expectedRevision);
  }

  async function updateClassification(changes, { actorId, expectedRevision, source = 'manual' } = {}) {
    identifier(actorId, '操作人ID');
    invariant(source === 'manual' || source === 'ai', 'invalid_classification_source', '分类来源无效。');
    invariant(Array.isArray(changes) && changes.length > 0 && changes.length <= 1000,
      'invalid_batch', '批量分类数量无效。');
    return mutate((data) => changes.map((change) => {
      const record = data.materials.find((item) => item.materialId === change.materialId);
      if (!record) return { materialId: change.materialId, ok: false, code: 'material_missing' };
      if (record.version !== change.expectedVersion || record.recordRevision !== change.expectedRecordRevision) {
        return { materialId: change.materialId, ok: false, code: 'version_conflict' };
      }
      if (!data.categories.some((item) => item.categoryId === change.categoryId && item.active)) {
        return { materialId: change.materialId, ok: false, code: 'category_missing' };
      }
      if (source === 'ai' && record.classification.manualLocked) {
        return { materialId: change.materialId, ok: false, code: 'manual_locked' };
      }
      record.classification = { ...record.classification, categoryId: change.categoryId,
        source, manualLocked: source === 'manual', actorId, changedAt: now() };
      record.organizationState = 'classified';
      record.recordRevision++;
      return { materialId: record.materialId, ok: true, recordRevision: record.recordRevision };
    }), expectedRevision);
  }

  async function decideAdoption(changes, {
    actorId, reason = '', expectedRevision, idempotencyKey = '',
  } = {}) {
    identifier(actorId, '操作人ID');
    if (idempotencyKey) identifier(idempotencyKey, '请求ID');
    invariant(Array.isArray(changes) && changes.length > 0 && changes.length <= 1000,
      'invalid_batch', '批量采用数量无效。');
    invariant(new Set(changes.map((item) => item.materialId)).size === changes.length,
      'duplicate_material', '同批不能重复决策同一份资料。');
    for (const change of changes) {
      invariant(change && typeof change === 'object' && !Array.isArray(change)
        && Object.keys(change).every((key) => ['materialId', 'expectedVersion',
          'expectedRecordRevision', 'state'].includes(key)),
      'invalid_adoption', '资料采用请求包含不支持的字段。');
      identifier(change.materialId, '资料ID');
      invariant(['accepted', 'excluded', 'candidate'].includes(change.state),
        'invalid_adoption', '资料采用决定无效。');
      positiveVersion(change.expectedVersion);
      invariant(Number.isSafeInteger(change.expectedRecordRevision) && change.expectedRecordRevision >= 0,
        'invalid_revision', '资料记录修订号无效。');
    }
    const verified = new Map();
    for (const change of changes.filter((item) => item.state === 'accepted')) {
      try { verified.set(change.materialId, await resolve(change.materialId, change.expectedVersion)); }
      catch (error) { verified.set(change.materialId, { error: error.code || 'source_unavailable' }); }
    }
    const payloadHash = idempotencyKey ? crypto.createHash('sha256').update(JSON.stringify({
      projectId, actorId, reason: String(reason).slice(0, 500), changes,
    })).digest('hex') : '';
    return mutate((data) => {
      data.adoptionReceipts ||= [];
      if (idempotencyKey) {
        const replay = data.adoptionReceipts.find((item) => item.actorId === actorId
          && item.idempotencyKey === idempotencyKey);
        if (replay) {
          invariant(replay.payloadHash === payloadHash, 'idempotency_conflict',
            '同一请求编号已用于不同的采用审核。');
          return unchanged(replay.response);
        }
        invariant(data.adoptionReceipts.length < 10000,
          'adoption_capacity', '项目采用审核回执已达到安全上限，请先在主机归档。');
      }
      const results = changes.map((change) => {
        const record = data.materials.find((item) => item.materialId === change.materialId);
        if (!record) return { materialId: change.materialId, ok: false, code: 'material_missing' };
        if (record.version !== change.expectedVersion || record.recordRevision !== change.expectedRecordRevision) {
          return { materialId: change.materialId, ok: false, code: 'version_conflict' };
        }
        if (record.adoption.state === change.state) {
          return { materialId: change.materialId, ok: true, unchanged: true,
            state: record.adoption.state, recordRevision: record.recordRevision };
        }
        if (record.adoption.state === 'accepted') {
          return { materialId: change.materialId, ok: false, code: 'already_accepted' };
        }
        if (record.adoption.state === 'excluded' && change.state === 'accepted') {
          return { materialId: change.materialId, ok: false, code: 'reopen_required' };
        }
        const source = verified.get(change.materialId);
        if (change.state === 'accepted' && source?.error) {
          return { materialId: change.materialId, ok: false, code: source.error };
        }
        if (change.state === 'accepted' && (record.sha256 !== source?.sha256
          || record.version !== source.version)) {
          return { materialId: change.materialId, ok: false, code: 'source_changed' };
        }
        record.adoption = { state: change.state, decidedAt: now(), actorId,
          reason: String(reason).slice(0, 500) };
        if (change.state === 'accepted') record.processing = { ...record.processing, state: 'pending' };
        record.recordRevision++;
        record.updatedAt = now();
        return { materialId: record.materialId, ok: true, state: change.state,
          recordRevision: record.recordRevision };
      });
      if (idempotencyKey) data.adoptionReceipts.push({ actorId, idempotencyKey, payloadHash,
        createdAt: now(), response: clone(results) });
      return results;
    }, expectedRevision);
  }

  return { projectId, directory, indexPath, read, inspect, list, registerFiles, resolve, snapshot,
    setCategories, updateClassification, decideAdoption, mutate, locationPath };
}

module.exports = { createProjectMaterialStore, validateRegistry, hashStableFile, safePath, writeJsonAtomic,
  withCommitLock, within, unchanged };
