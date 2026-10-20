'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { inspectDirectory, sha256 } = require('./skill-package-inspector.cjs');

const CATALOG_SCHEMA = 'edu-manager.skill-library.v1';
const SETTINGS_SCHEMA = 'edu-manager.skill-library-settings.v1';
const LOCATION_SCHEMA = 'edu-manager.skill-library-location.v1';

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  try { fs.renameSync(temp, file); } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return typeof fallback === 'function' ? fallback() : fallback;
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch (error) {
    const damaged = `${file}.damaged-${Date.now()}`;
    fs.copyFileSync(file, damaged, fs.constants.COPYFILE_EXCL);
    const next = typeof fallback === 'function' ? fallback() : fallback;
    atomicWriteJson(file, next);
    return next;
  }
}

function safeSegment(value, label = '标识') {
  const text = String(value || '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(text)) throw Error(`${label}格式无效`);
  return text;
}

function isWithin(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep);
}

function copyPayload(source, target, files) {
  if (fs.existsSync(target)) return false;
  const temp = `${target}.staging-${crypto.randomUUID()}`;
  fs.mkdirSync(temp, { recursive: true });
  try {
    for (const file of files) {
      const sourceFile = path.join(source, ...file.relativePath.split('/'));
      const targetFile = path.join(temp, ...file.relativePath.split('/'));
      if (!isWithin(temp, targetFile)) throw Error('存档路径越界');
      fs.mkdirSync(path.dirname(targetFile), { recursive: true });
      fs.copyFileSync(sourceFile, targetFile, fs.constants.COPYFILE_EXCL);
      const copied = fs.readFileSync(targetFile);
      if (copied.length !== file.size || sha256(copied) !== file.sha256) throw Error(`存档复制校验失败：${file.relativePath}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(temp, target);
    return true;
  } finally {
    if (fs.existsSync(temp)) fs.rmSync(temp, { recursive: true, force: true });
  }
}

function copyTree(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name), to = path.join(target, entry.name);
    if (entry.isSymbolicLink()) throw Error('存档库包含符号链接，迁移已停止');
    if (entry.isDirectory()) copyTree(from, to);
    else if (entry.isFile()) {
      fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
      if (sha256(fs.readFileSync(from)) !== sha256(fs.readFileSync(to))) throw Error(`迁移文件校验失败：${entry.name}`);
    }
    else throw Error('存档库包含不支持的特殊文件');
  }
}

function defaultCatalog() {
  return { schema: CATALOG_SCHEMA, revision: 1, artifacts: [], versions: [], installations: [], updatedAt: new Date().toISOString() };
}

function defaultSettings(root) {
  return {
    schema: SETTINGS_SCHEMA,
    policyVersion: 1,
    archiveRoot: root,
    limits: { maxEntries: 2000, maxFiles: 500, maxFileBytes: 25 * 1024 * 1024, maxTotalBytes: 50 * 1024 * 1024, maxDepth: 8 },
    updatedAt: new Date().toISOString(),
  };
}

function normalizeIdentityPart(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 160);
}

class SkillLibraryStore {
  constructor({ userDataDir, rootPath } = {}) {
    if (!path.isAbsolute(String(userDataDir || ''))) throw Error('userDataDir 必须是绝对路径');
    this.userDataDir = path.resolve(userDataDir);
    this.pointerFile = path.join(this.userDataDir, 'skill-library-location.json');
    const pointer = readJson(this.pointerFile, null);
    const configured = rootPath || pointer?.activeRoot || path.join(this.userDataDir, 'skill-library');
    this.root = path.resolve(configured);
    this._queue = Promise.resolve();
    this.initialize();
  }

  initialize() {
    for (const relative of ['objects/sha256', 'sources', 'staging', 'quarantine', 'receipts/scans', 'receipts/imports', 'receipts/installs', 'receipts/rollbacks', 'receipts/deletes', 'receipts/exports', 'backups']) {
      fs.mkdirSync(path.join(this.root, relative), { recursive: true });
    }
    const settingsFile = path.join(this.root, 'settings.json');
    const catalogFile = path.join(this.root, 'catalog.json');
    if (!fs.existsSync(settingsFile)) atomicWriteJson(settingsFile, defaultSettings(this.root));
    if (!fs.existsSync(catalogFile)) atomicWriteJson(catalogFile, defaultCatalog());
    if (!fs.existsSync(this.pointerFile)) atomicWriteJson(this.pointerFile, { schema: LOCATION_SCHEMA, activeRoot: this.root, previousRoots: [], updatedAt: new Date().toISOString() });
  }

  enqueue(operation) {
    const next = this._queue.then(operation, operation);
    this._queue = next.catch(() => {});
    return next;
  }

  settings() { return readJson(path.join(this.root, 'settings.json'), () => defaultSettings(this.root)); }
  catalog() {
    const catalog = readJson(path.join(this.root, 'catalog.json'), defaultCatalog);
    if (catalog.schema !== CATALOG_SCHEMA || !Array.isArray(catalog.artifacts) || !Array.isArray(catalog.versions) || !Array.isArray(catalog.installations)) throw Error('Skill 存档账本格式不受支持');
    return catalog;
  }

  saveCatalog(catalog) {
    const next = { ...catalog, revision: Math.max(1, Number(catalog.revision || 0) + 1), updatedAt: new Date().toISOString() };
    atomicWriteJson(path.join(this.root, 'catalog.json'), next);
    return next;
  }

  objectPayload(treeSha256) {
    return path.join(this.root, 'objects', 'sha256', safeSegment(treeSha256, 'treeSha256'), 'payload');
  }

  writeReceipt(kind, receipt) {
    const id = safeSegment(receipt.receiptId || crypto.randomUUID(), 'receiptId');
    const file = path.join(this.root, 'receipts', safeSegment(kind, '回执类型'), `${id}.json`);
    atomicWriteJson(file, { ...receipt, receiptId: id });
    return { ...receipt, receiptId: id, relativePath: path.relative(this.root, file).split(path.sep).join('/') };
  }

  archiveDirectory(sourcePath, source = {}) {
    return this.enqueue(() => {
      const inspection = inspectDirectory(sourcePath, { limits: this.settings().limits });
      const sourceType = String(source.sourceType || 'local_directory').slice(0, 80);
      const sourceUri = String(source.sourceUri || path.resolve(sourcePath)).slice(0, 2048);
      if (inspection.inspectionStatus !== 'ready_to_archive') {
        const operationId = crypto.randomUUID();
        const receipt = this.writeReceipt('imports', {
          schema: 'edu-manager.skill-import-receipt.v1', receiptId: operationId, status: 'quarantined', sourceType,
          sourceUri, inspection: { treeSha256: inspection.treeSha256, findings: inspection.riskFindings }, createdAt: new Date().toISOString(),
        });
        return { status: 'quarantined', inspection: publicInspection(inspection), receipt };
      }
      const catalog = this.catalog();
      const unknownPublisher = `unknown-${sha256(Buffer.from(`${sourceType}\0${sourceUri}`, 'utf8')).slice(0, 16)}`;
      const publisher = normalizeIdentityPart(inspection.identity.publisher) || unknownPublisher;
      const name = normalizeIdentityPart(inspection.identity.name);
      const identityKey = `${inspection.kind}:${publisher}:${name}`;
      let artifact = catalog.artifacts.find(item => item.identityKey === identityKey);
      if (!artifact) {
        artifact = {
          schema: 'edu-manager.skill-artifact.v1', artifactId: crypto.randomUUID(), kind: inspection.kind, identityKey,
          identity: { name: inspection.identity.name, publisher, displayName: inspection.identity.displayName }, currentVersionId: '',
          tags: { system: [], semantic: [], user: [], manualLocked: false }, compatibility: [], installations: [],
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        };
        catalog.artifacts.push(artifact);
      }
      const duplicate = catalog.versions.find(version => version.artifactId === artifact.artifactId && version.treeSha256 === inspection.treeSha256);
      if (duplicate) {
        const receipt = this.writeReceipt('imports', {
          schema: 'edu-manager.skill-import-receipt.v1', status: 'duplicate', receiptId: crypto.randomUUID(), artifactId: artifact.artifactId,
          versionId: duplicate.versionId, sourceType, sourceUri, treeSha256: duplicate.treeSha256, createdAt: new Date().toISOString(),
        });
        return { status: 'duplicate', artifact, version: duplicate, inspection: publicInspection(inspection), receipt };
      }
      const payload = this.objectPayload(inspection.treeSha256);
      copyPayload(inspection.rootPath, payload, inspection.files);
      const version = {
        schema: 'edu-manager.skill-version.v1', versionId: crypto.randomUUID(), artifactId: artifact.artifactId,
        declaredVersion: inspection.identity.declaredVersion, sourceType, sourceUri, sourceRef: String(source.sourceRef || '').slice(0, 512),
        discoveredAt: new Date().toISOString(), packageSha256: String(source.packageSha256 || ''), treeSha256: inspection.treeSha256,
        manifestSha256: inspection.manifestSha256, fileCount: inspection.fileCount, totalBytes: inspection.totalBytes,
        entryPoint: inspection.entryPoint, description: inspection.identity.description, license: inspection.identity.license,
        observedCapabilities: inspection.observedCapabilities, riskFindings: inspection.riskFindings,
        inspectionStatus: 'archived', archiveObjectPath: path.relative(this.root, payload).split(path.sep).join('/'),
      };
      catalog.versions.push(version);
      artifact.currentVersionId = version.versionId;
      artifact.updatedAt = new Date().toISOString();
      artifact.tags.system = deterministicSystemTags(inspection, sourceType);
      artifact.compatibility = inspection.kind === 'skill' ? ['codex', 'workbuddy'] : [];
      this.saveCatalog(catalog);
      const receipt = this.writeReceipt('imports', {
        schema: 'edu-manager.skill-import-receipt.v1', status: 'archived', receiptId: crypto.randomUUID(), artifactId: artifact.artifactId,
        versionId: version.versionId, sourceType, sourceUri, treeSha256: version.treeSha256, createdAt: new Date().toISOString(),
      });
      return { status: 'archived', artifact, version, inspection: publicInspection(inspection), receipt };
    });
  }

  listArtifacts(query = {}) {
    const catalog = this.catalog();
    const text = String(query.query || '').trim().toLowerCase();
    const providerId = String(query.providerId || '');
    const kind = String(query.kind || '');
    // Request-local indexes preserve freshness and array order without the
    // repeated artifact × version / installation scans on the main thread.
    const versionById = new Map();
    for (const version of catalog.versions) {
      if (!versionById.has(version.versionId)) versionById.set(version.versionId, version);
    }
    const installationsByArtifact = new Map();
    for (const installation of catalog.installations) {
      if (installation.state === 'uninstalled') continue;
      const list = installationsByArtifact.get(installation.artifactId) || [];
      list.push(installation);
      installationsByArtifact.set(installation.artifactId, list);
    }
    const items = catalog.artifacts.map(artifact => {
      const version = versionById.get(artifact.currentVersionId);
      const installations = installationsByArtifact.get(artifact.artifactId) || [];
      return { ...artifact, version, installations };
    }).filter(item => (!kind || item.kind === kind)
      && (!providerId || item.compatibility.includes(providerId))
      && (!text || [item.identity.name, item.identity.displayName, item.identity.publisher, item.version?.description, ...(item.tags.system || []), ...(item.tags.semantic || []), ...(item.tags.user || [])].join(' ').toLowerCase().includes(text)));
    return items;
  }

  readArtifact(artifactId) {
    const id = String(artifactId || '');
    const catalog = this.catalog();
    const artifact = catalog.artifacts.find(item => item.artifactId === id);
    if (!artifact) throw Error('Skill 存档不存在');
    return { ...artifact, versions: catalog.versions.filter(item => item.artifactId === id), installations: catalog.installations.filter(item => item.artifactId === id) };
  }

  saveUserTags(artifactId, tags) {
    return this.enqueue(() => {
      const catalog = this.catalog();
      const artifact = catalog.artifacts.find(item => item.artifactId === String(artifactId || ''));
      if (!artifact) throw Error('Skill 存档不存在');
      const nextTags = [...new Set((Array.isArray(tags) ? tags : []).map(item => String(item).trim()).filter(Boolean))];
      if (nextTags.length > 20 || nextTags.some(item => item.length > 40)) throw Error('用户标签数量或长度超过限制');
      artifact.tags.user = nextTags;
      artifact.tags.manualLocked = true;
      artifact.updatedAt = new Date().toISOString();
      this.saveCatalog(catalog);
      return artifact.tags;
    });
  }

  saveInstallation(record) {
    return this.enqueue(() => {
      const catalog = this.catalog();
      const index = catalog.installations.findIndex(item => item.installationId === record.installationId);
      if (index >= 0) catalog.installations[index] = record; else catalog.installations.push(record);
      const artifact = catalog.artifacts.find(item => item.artifactId === record.artifactId);
      if (artifact && !artifact.installations.includes(record.installationId)) artifact.installations.push(record.installationId);
      this.saveCatalog(catalog);
      return record;
    });
  }

  findInstallation(artifactId, providerId) {
    return this.catalog().installations.filter(item => item.artifactId === artifactId && item.providerId === providerId && item.state !== 'uninstalled').at(-1) || null;
  }

  resolveArtifactPayload(artifactId, versionId, { verify = false } = {}) {
    const artifactKey = safeSegment(artifactId, 'artifactId');
    const versionKey = safeSegment(versionId, 'versionId');
    const catalog = this.catalog();
    const artifact = catalog.artifacts.find(item => item.artifactId === artifactKey);
    const version = catalog.versions.find(item => item.versionId === versionKey && item.artifactId === artifactKey);
    if (!artifact || !version) throw Error('Skill 存档或版本不存在');
    const payload = path.join(this.root, ...String(version.archiveObjectPath || '').split('/'));
    const objectRoot = path.join(this.root, 'objects', 'sha256');
    if (!isWithin(objectRoot, payload) || path.basename(payload) !== 'payload' || !fs.existsSync(payload)) throw Error('Skill 存档对象路径无效或文件缺失');
    const stat = fs.lstatSync(payload);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Skill 存档对象不是普通目录');
    if (verify) {
      const inspection = inspectDirectory(payload, { limits: this.settings().limits });
      if (inspection.treeSha256 !== version.treeSha256) throw Error('Skill 存档完整性校验失败，已停止操作');
      return { artifact, version, payload, inspection };
    }
    return { artifact, version, payload };
  }

  exportArtifactCopy(artifactId, versionId, targetParent) {
    return this.enqueue(() => {
      if (!path.isAbsolute(String(targetParent || ''))) throw Error('请选择绝对路径作为导出位置');
      const parent = path.resolve(targetParent);
      if (!fs.existsSync(parent)) throw Error('所选导出位置不存在，请重新选择');
      const parentStat = fs.lstatSync(parent);
      if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw Error('请选择普通文件夹，不能导出到目录链接');
      const resolved = this.resolveArtifactPayload(artifactId, versionId, { verify: true });
      if (resolved.artifact.kind !== 'skill') throw Error('插件不能按目录手动安装；当前仅支持导出 Skill 副本');
      const storeReal = fs.realpathSync(this.root);
      const parentReal = fs.realpathSync(parent);
      const baseName = [normalizeIdentityPart(resolved.artifact.identity.name) || 'skill', normalizeIdentityPart(resolved.version.declaredVersion) || 'unversioned', resolved.version.treeSha256.slice(0, 8)].join('-').slice(0, 150);
      const exportPath = path.join(parentReal, safeSegment(baseName, '导出目录名'));
      if (isWithin(storeReal, exportPath)) throw Error('手动安装副本不能导出到教育管家存档内部，请选择其他位置');
      if (fs.existsSync(exportPath)) throw Error(`目标已存在：${exportPath}。请选择其他位置，或先重命名已有副本`);
      if (!copyPayload(resolved.payload, exportPath, resolved.inspection.files)) throw Error('目标目录已存在，未覆盖任何文件');
      const exported = inspectDirectory(exportPath, { limits: this.settings().limits });
      if (exported.treeSha256 !== resolved.version.treeSha256) {
        try { fs.rmSync(exportPath, { recursive: true, force: true }); } catch { /* Retain evidence if cleanup is blocked. */ }
        throw Error('导出副本校验失败，未生成可用的手动安装副本');
      }
      const receipt = this.writeReceipt('exports', {
        schema: 'edu-manager.skill-export-receipt.v1', receiptId: crypto.randomUUID(), status: 'exported',
        artifactId: resolved.artifact.artifactId, versionId: resolved.version.versionId, treeSha256: resolved.version.treeSha256,
        exportPath, independentlyManaged: true, createdAt: new Date().toISOString(),
      });
      return { exportPath, treeSha256: resolved.version.treeSha256, receipt };
    });
  }

  deleteArtifact(artifactId, expectedVersionId = '') {
    return this.enqueue(() => {
      const id = safeSegment(artifactId, 'artifactId');
      const expected = expectedVersionId ? safeSegment(expectedVersionId, 'versionId') : '';
      const catalog = this.catalog();
      const artifact = catalog.artifacts.find(item => item.artifactId === id);
      if (!artifact) throw Error('Skill 存档不存在或已删除');
      if (expected && artifact.currentVersionId !== expected) throw Error('Skill 存档版本已变化，请刷新页面后重新确认删除');
      const activeInstallations = catalog.installations.filter(item => item.artifactId === id && item.state !== 'uninstalled');
      if (activeInstallations.length) throw Error(`该 Skill 仍有 ${activeInstallations.length} 个受管安装，请先在 Codex 或 WorkBuddy 中卸载，再删除存档`);

      const versions = catalog.versions.filter(item => item.artifactId === id);
      const retainedVersions = catalog.versions.filter(item => item.artifactId !== id);
      const retainedObjectPaths = new Set(retainedVersions.map(item => String(item.archiveObjectPath || '')));
      const removableObjectPaths = [...new Set(versions.map(item => String(item.archiveObjectPath || '')).filter(Boolean))]
        .filter(relative => !retainedObjectPaths.has(relative));
      const deletionId = crypto.randomUUID();
      const trashRoot = path.join(this.root, 'staging', `delete-${deletionId}`);
      const moved = [];
      try {
        for (const [index, relative] of removableObjectPaths.entries()) {
          const payload = path.join(this.root, ...relative.split('/'));
          const objectRoot = path.join(this.root, 'objects', 'sha256');
          if (!isWithin(objectRoot, payload) || path.basename(payload) !== 'payload') throw Error('Skill 存档对象路径无效，已停止删除');
          if (!fs.existsSync(payload)) continue;
          fs.mkdirSync(trashRoot, { recursive: true });
          const staged = path.join(trashRoot, `${index}-${path.basename(path.dirname(payload))}`);
          fs.renameSync(payload, staged);
          moved.push({ payload, staged });
        }
        this.saveCatalog({
          ...catalog,
          artifacts: catalog.artifacts.filter(item => item.artifactId !== id),
          versions: retainedVersions,
          installations: catalog.installations.filter(item => item.artifactId !== id),
        });
      } catch (error) {
        for (const item of moved.reverse()) {
          try { fs.mkdirSync(path.dirname(item.payload), { recursive: true }); fs.renameSync(item.staged, item.payload); } catch { /* Preserve remaining staged objects for manual recovery. */ }
        }
        throw error;
      }

      let cleanupPending = false;
      try {
        if (fs.existsSync(trashRoot)) fs.rmSync(trashRoot, { recursive: true, force: true });
        for (const item of moved) {
          const parent = path.dirname(item.payload);
          if (fs.existsSync(parent) && fs.readdirSync(parent).length === 0) fs.rmdirSync(parent);
        }
      } catch { cleanupPending = true; }
      const historicalInstallations = catalog.installations.filter(item => item.artifactId === id);
      const receipt = this.writeReceipt('deletes', {
        schema: 'edu-manager.skill-delete-receipt.v1', receiptId: deletionId, status: cleanupPending ? 'deleted_cleanup_pending' : 'deleted',
        artifactId: id, identity: artifact.identity, versionIds: versions.map(item => item.versionId), versionCount: versions.length,
        totalBytes: versions.reduce((total, item) => total + Math.max(0, Number(item.totalBytes || 0)), 0),
        recoveryCopiesRetained: historicalInstallations.filter(item => item.backupPath || item.retainedRecoveryPath).length,
        cleanupPending, createdAt: new Date().toISOString(),
      });
      return { deleted: true, artifactId: id, versionCount: versions.length, cleanupPending, receipt };
    });
  }

  listReceipts(limit = 100) {
    const results = [];
    for (const kind of ['scans', 'imports', 'installs', 'rollbacks', 'deletes', 'exports']) {
      const root = path.join(this.root, 'receipts', kind);
      for (const file of fs.readdirSync(root).filter(name => name.endsWith('.json'))) {
        const value = readJson(path.join(root, file), null);
        if (value) results.push({ kind, ...value });
      }
    }
    return results.sort((a, b) => String(b.createdAt || b.installedAt || '').localeCompare(String(a.createdAt || a.installedAt || ''))).slice(0, Math.max(1, Math.min(500, Number(limit || 100))));
  }

  migrateRoot(targetPath) {
    return this.enqueue(() => {
      if (!path.isAbsolute(String(targetPath || ''))) throw Error('请选择绝对路径作为新存档位置');
      const target = path.resolve(targetPath);
      if (!target || target === path.parse(target).root || target === this.root) throw Error('请选择不同的非根目录作为新存档位置');
      // Resolve existing ancestors too, so junction aliases cannot bypass overlap checks.
      const canonical = value => {
        let existing = value;
        while (!fs.existsSync(existing)) {
          const parent = path.dirname(existing);
          if (parent === existing) throw Error('目标磁盘或网络位置不可用，请重新选择可访问的文件夹');
          existing = parent;
        }
        return path.resolve(fs.realpathSync(existing), path.relative(existing, value));
      };
      const sourceReal = canonical(this.root), targetReal = canonical(target);
      if (isWithin(sourceReal, targetReal) || isWithin(targetReal, sourceReal)) throw Error('新存档位置不能是当前存档目录、其子目录或上级目录');
      const checkEmpty = () => {
        if (!fs.existsSync(target)) return;
        if (!fs.lstatSync(target).isDirectory() || fs.lstatSync(target).isSymbolicLink()) throw Error('请选择普通空文件夹，不能使用文件或目录链接');
        if (fs.readdirSync(target).length) throw Error('所选文件夹不是空目录。请在该位置新建一个空文件夹后选择；现有文件不会被覆盖。');
      };
      checkEmpty();
      const parent = path.dirname(target);
      // The native directory picker always returns an existing folder. Do not call
      // mkdir on its existing parent (for D:\\skillbackups that would be D:\\),
      // because Windows can reject an attempted mkdir of a drive root with EPERM.
      if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
      const temp = path.join(parent, `.edu-skill-migration-${crypto.randomUUID()}`);
      const previousRoot = this.root;
      try {
        copyTree(previousRoot, temp);
        const migratedCatalog = readJson(path.join(temp, 'catalog.json'), null);
        if (!migratedCatalog || migratedCatalog.schema !== CATALOG_SCHEMA) throw Error('迁移后的账本校验失败');
        for (const version of migratedCatalog.versions) {
          const payload = path.join(temp, ...String(version.archiveObjectPath).split('/'));
          if (!isWithin(temp, payload) || !fs.existsSync(payload) || inspectDirectory(payload, { limits: this.settings().limits }).treeSha256 !== version.treeSha256) throw Error(`迁移对象校验失败：${version.versionId}`);
        }
        // Current installation metadata must follow migrated backups; historical receipts stay immutable.
        for (const record of migratedCatalog.installations) {
          if (record.backupPath && isWithin(path.join(previousRoot, 'backups'), record.backupPath)) {
            record.backupPath = path.join(target, path.relative(previousRoot, record.backupPath));
          }
        }
        atomicWriteJson(path.join(temp, 'catalog.json'), migratedCatalog);
        const settings = this.settings(); settings.archiveRoot = target; settings.updatedAt = new Date().toISOString();
        atomicWriteJson(path.join(temp, 'settings.json'), settings);
        checkEmpty();
        if (canonical(target) !== targetReal) throw Error('目标目录在迁移过程中发生变化，请重新选择');
        if (!fs.existsSync(target)) fs.mkdirSync(target);
        // Keep the user-selected folder itself intact: Windows dialogs/Explorer may hold it open.
        for (const name of fs.readdirSync(temp)) {
          const destination = path.join(target, name);
          if (fs.existsSync(destination)) throw Error('目标目录出现新文件，已停止迁移以避免覆盖');
          fs.renameSync(path.join(temp, name), destination);
        }
        const pointer = readJson(this.pointerFile, { schema: LOCATION_SCHEMA, previousRoots: [] });
        atomicWriteJson(this.pointerFile, { schema: LOCATION_SCHEMA, activeRoot: target, previousRoots: [...new Set([...(pointer.previousRoots || []), previousRoot])], updatedAt: new Date().toISOString() });
        this.root = target;
        // The pointer is the final commit; cleanup failure must not turn success into a false failure.
        try { fs.rmdirSync(temp); } catch { /* Empty migration container can be removed later. */ }
        return { activeRoot: target, previousRoot, oldLibraryRetained: true };
      } catch (error) {
        // Retain any partial copy for recovery; never delete a selected directory or switch on failure.
        throw Error(`迁移未完成，当前仍使用原存档位置：${previousRoot}。${error.message}。如目标已产生副本，请保留并改选空文件夹重试。`);
      }
    });
  }
}

function deterministicSystemTags(inspection, sourceType) {
  const tags = [inspection.kind, `source:${sourceType}`];
  const nameAndDescription = `${inspection.identity.name} ${inspection.identity.description}`.toLowerCase();
  const semantic = [
    ['education', /教育|学生|教学|课程|学习|考试/], ['research', /研究|文献|论文|search/], ['documents', /文档|word|pdf|docx|markdown/],
    ['development', /开发|代码|git|debug|test/], ['media', /图片|视频|音频|image|video|audio/], ['automation', /自动化|automation|工作流/],
    ['knowledge', /知识库|知识管理|knowledge|obsidian/], ['office', /办公|excel|powerpoint|ppt|spreadsheet/],
  ];
  for (const [tag, pattern] of semantic) if (pattern.test(nameAndDescription)) tags.push(tag);
  for (const capability of inspection.observedCapabilities) tags.push(`risk:${capability}`);
  return [...new Set(tags)];
}

function publicInspection(inspection) {
  return {
    schema: inspection.schema, kind: inspection.kind, identity: inspection.identity, manifestSha256: inspection.manifestSha256,
    treeSha256: inspection.treeSha256, fileCount: inspection.fileCount, totalBytes: inspection.totalBytes,
    entryPoint: inspection.entryPoint, riskFindings: inspection.riskFindings, inspectionStatus: inspection.inspectionStatus,
    observedCapabilities: inspection.observedCapabilities, inspectedAt: inspection.inspectedAt,
  };
}

module.exports = {
  CATALOG_SCHEMA,
  SETTINGS_SCHEMA,
  LOCATION_SCHEMA,
  SkillLibraryStore,
  atomicWriteJson,
  deterministicSystemTags,
  publicInspection,
};
