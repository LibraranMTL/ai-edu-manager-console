'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Worker } = require('node:worker_threads');
const { SkillLibraryStore } = require('./skill-library-store.cjs');
const { extractSkillArchive } = require('./skill-archive-extractor.cjs');
const { inspectDirectory } = require('./skill-package-inspector.cjs');
const discovery = require('./skill-discovery-adapters.cjs');
const installAdapters = require('./skill-install-adapters.cjs');

const ACTIONS = new Set([
  'snapshot', 'scanSources', 'cancelScan', 'archiveDiscovered', 'chooseArchiveRoot', 'migrateArchiveRoot',
  'chooseImportDirectory', 'chooseImportArchive', 'importDirectory', 'importArchive', 'listArtifacts', 'readArtifact',
  'saveUserTags', 'deleteArtifact', 'previewInstall', 'install', 'verifyInstallation', 'previewRollback', 'rollback', 'uninstall',
  'manualInstallInfo', 'copyManualInstallPath', 'openManualInstallPath', 'chooseManualExportRoot', 'exportManualInstallCopy',
  'openArchivePath', 'listReceipts',
]);

function object(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('请求参数格式无效');
  return input;
}

function id(value, label = 'ID') {
  const text = String(value || '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(text)) throw Error(`${label}格式无效`);
  return text;
}

function provider(value) {
  const text = String(value || '').toLowerCase();
  if (!['codex', 'workbuddy', 'qclaw'].includes(text)) throw Error('Agent 类型不受支持');
  return text;
}

function redactCandidate(candidate) {
  return {
    discoveryId: candidate.discoveryId, providerId: candidate.providerId, sourceKind: candidate.sourceKind,
    sourceRoot: candidate.sourceRoot, relativePath: candidate.relativePath, kind: candidate.kind || 'unknown',
    identity: candidate.identity || null, treeSha256: candidate.treeSha256 || '', manifestSha256: candidate.manifestSha256 || '',
    fileCount: candidate.fileCount || 0, totalBytes: candidate.totalBytes || 0, riskFindings: candidate.riskFindings || [],
    inspectionStatus: candidate.inspectionStatus || candidate.status || 'unsupported', message: candidate.message || '',
  };
}

class SkillLibraryService {
  constructor(options = {}) {
    this.options = options;
    this.userDataDir = path.resolve(options.userDataDir);
    this.homeDir = path.resolve(options.homeDir || os.homedir());
    this.store = options.store || new SkillLibraryStore({ userDataDir: this.userDataDir });
    this.scans = new Map();
    this.discoveryIndex = new Map();
    this.selections = new Map();
    this.installPlans = new Map();
    this.rollbackPlans = new Map();
    this.cancelledOperations = new Set();
    this.activeScans = new Map();
  }

  hostOptions() { return { homeDir: this.homeDir, codexHome: this.options.codexHome || process.env.CODEX_HOME || '' }; }

  snapshot() {
    const settings = this.store.settings();
    const catalog = this.store.catalog();
    const stat = fs.statSync(this.store.root);
    const receipts = this.store.listReceipts(500);
    return {
      schema: 'edu-manager.skill-library-snapshot.v1',
      library: { rootPath: this.store.root, writable: Boolean(stat && fs.accessSync ? (() => { try { fs.accessSync(this.store.root, fs.constants.W_OK); return true; } catch { return false; } })() : true), settings },
      counts: { artifacts: catalog.artifacts.length, versions: catalog.versions.length, installations: catalog.installations.filter(item => item.state !== 'uninstalled').length, quarantined: receipts.filter(item => item.status === 'quarantined').length },
      providers: ['codex', 'workbuddy', 'qclaw'].map(item => discovery.capabilities(item, this.hostOptions())),
      scans: [...this.scans.values()].map(scan => ({ ...scan, candidates: scan.candidates.map(redactCandidate) })),
      recentReceipts: receipts.slice(0, 20),
      scope: 'host', mcpEnabled: false, pluginInstallEnabled: false,
    };
  }

  scanSources(input) {
    const request = object(input);
    const providerIds = request.providerIds === undefined ? ['codex', 'workbuddy', 'qclaw']
      : [...new Set((Array.isArray(request.providerIds) ? request.providerIds : []).map(provider))];
    if (!providerIds.length) throw Error('请选择至少一个扫描来源');
    const operationId = crypto.randomUUID();
    const workerPath = path.join(__dirname, 'skill-scan-worker.cjs');
    return new Promise((resolve, reject) => {
      const worker = new Worker(workerPath, { workerData: { providerIds, options: { ...this.hostOptions(), limits: this.store.settings().limits } } });
      this.activeScans.set(operationId, worker);
      let settled = false;
      const finish = (error, results = []) => {
        if (settled) return;
        settled = true;
        this.activeScans.delete(operationId);
        if (error) return reject(error);
        const scans = [];
        for (const result of results) {
          this.scans.set(result.providerId, result);
          for (const candidate of result.candidates) this.discoveryIndex.set(candidate.discoveryId, candidate);
          scans.push({ ...result, candidates: result.candidates.map(redactCandidate) });
          this.store.writeReceipt('scans', {
            schema: 'edu-manager.skill-scan-receipt.v1', receiptId: crypto.randomUUID(), operationId, providerId: result.providerId,
            rootCount: result.roots.length, candidateCount: result.candidates.length, readOnly: true, createdAt: new Date().toISOString(),
          });
        }
        resolve({ operationId, status: this.cancelledOperations.has(operationId) ? 'cancelled' : 'completed', scans });
      };
      worker.on('message', message => {
        if (message?.type === 'complete') finish(null, message.results);
        else if (message?.type === 'error') finish(Error(message.message || 'Skill 扫描失败'));
      });
      worker.once('error', error => finish(error));
      worker.once('exit', code => {
        if (settled) return;
        if (this.cancelledOperations.has(operationId)) finish(null, []);
        else finish(code === 0 ? Error('Skill 扫描未返回结果') : Error(`Skill 扫描进程异常退出（${code}）`));
      });
    });
  }

  cancelScan(input) {
    const operationId = id(object(input).operationId, 'operationId');
    this.cancelledOperations.add(operationId);
    const worker = this.activeScans.get(operationId);
    if (worker) void worker.terminate();
    return { operationId, status: 'cancellation_requested' };
  }

  async archiveDiscovered(input) {
    const request = object(input);
    const ids = [...new Set((Array.isArray(request.discoveryIds) ? request.discoveryIds : []).map(value => id(value, 'discoveryId')))];
    if (!ids.length || ids.length > 100) throw Error('请选择 1—100 个发现项');
    const results = [];
    for (const discoveryId of ids) {
      const candidate = this.discoveryIndex.get(discoveryId);
      if (!candidate) throw Error('发现项已过期，请重新扫描');
      const before = inspectDirectory(candidate.sourcePath, { limits: this.store.settings().limits });
      if (before.treeSha256 !== candidate.treeSha256) throw Error(`${candidate.relativePath} 在扫描后发生变化，请重新扫描`);
      const archived = await this.store.archiveDirectory(candidate.sourcePath, {
        sourceType: `${candidate.providerId}_scan`, sourceUri: `${candidate.providerId}:${candidate.relativePath}`,
      });
      if (candidate.providerId === 'qclaw') {
        const after = inspectDirectory(candidate.sourcePath, { limits: this.store.settings().limits });
        if (after.treeSha256 !== before.treeSha256) throw Error('QClaw 来源在导出过程中发生变化，已停止并保留审计回执');
        archived.sourceUnchanged = true;
      }
      results.push({ discoveryId, providerId: candidate.providerId, ...archived });
    }
    return { status: 'completed', results };
  }

  async choosePath(kind) {
    const dialog = this.options.dialog;
    const parent = typeof this.options.getParentWindow === 'function' ? this.options.getParentWindow() : undefined;
    if (!dialog) throw Error('当前运行环境不支持文件选择');
    const options = kind === 'archive_root'
      ? { title: '选择新的 Skill 存档位置（请新建或选择空文件夹）', defaultPath: this.store.root, properties: ['openDirectory', 'createDirectory'] }
      : kind === 'import_directory'
        ? { title: '选择单个 Skill 目录，或包含多个 Skill 子目录的文件夹', properties: ['openDirectory'] }
        : kind === 'manual_export'
          ? { title: '选择手动安装副本的导出位置', properties: ['openDirectory', 'createDirectory'] }
          : { title: '选择 Skill ZIP 包', properties: ['openFile'], filters: [{ name: 'Skill ZIP', extensions: ['zip'] }] };
    const args = parent ? [parent, options] : [options];
    const result = dialog.showOpenDialog ? (await dialog.showOpenDialog(...args)).filePaths : dialog.showOpenDialogSync(...args);
    if (!Array.isArray(result) || result.length !== 1) return { cancelled: true };
    const selectedPath = path.resolve(result[0]);
    const selectionId = crypto.randomUUID();
    this.selections.set(selectionId, { kind, selectedPath, createdAt: Date.now() });
    return { cancelled: false, selectionId, displayPath: selectedPath };
  }

  selection(selectionId, kind) {
    const key = id(selectionId, 'selectionId');
    const selected = this.selections.get(key);
    if (!selected || selected.kind !== kind || Date.now() - selected.createdAt > 15 * 60 * 1000) throw Error('文件选择已过期，请重新选择');
    return selected.selectedPath;
  }

  async importDirectory(input) {
    const request = object(input);
    const selected = this.selection(request.selectionId, 'import_directory');
    const selectedStat = await fs.promises.lstat(selected);
    if (!selectedStat.isDirectory() || selectedStat.isSymbolicLink()) throw Error('请选择普通文件夹，不能导入符号链接或特殊目录');
    let candidates = [];
    if (fs.existsSync(path.join(selected, 'SKILL.md'))) {
      candidates = [{ name: path.basename(selected), sourcePath: selected }];
    } else {
      const entries = await fs.promises.readdir(selected, { withFileTypes: true });
      if (entries.length > 2000) throw Error('所选目录项目过多，请选择更接近 Skills 的一级目录');
      candidates = entries
        .filter(entry => entry.isDirectory() && !entry.isSymbolicLink())
        .map(entry => ({ name: entry.name, sourcePath: path.join(selected, entry.name) }))
        .filter(entry => fs.existsSync(path.join(entry.sourcePath, 'SKILL.md')));
    }
    if (!candidates.length) throw Error('所选目录不是 Skill，且其一级子目录中没有找到 SKILL.md');
    if (candidates.length > 100) throw Error('一次最多导入 100 个 Skill，请拆分目录后重试');
    const results = [];
    for (const candidate of candidates) {
      // Yield between packages so a batch import does not monopolize the host event loop.
      await new Promise(resolve => setImmediate(resolve));
      try {
        const result = await this.store.archiveDirectory(candidate.sourcePath, {
          sourceType: 'local_directory', sourceUri: candidate.sourcePath,
        });
        results.push({ name: candidate.name, status: result.status, artifactId: result.artifact?.artifactId || '', receiptId: result.receipt?.receiptId || '' });
      } catch (error) {
        results.push({ name: candidate.name, status: 'failed', message: error instanceof Error ? error.message : String(error) });
      }
    }
    const counts = Object.fromEntries(['archived', 'duplicate', 'quarantined', 'failed'].map(status => [status, results.filter(item => item.status === status).length]));
    return { status: counts.failed === results.length ? 'failed' : counts.failed ? 'partial' : 'completed', mode: candidates.length === 1 ? 'single' : 'batch', total: results.length, counts, results };
  }

  async importArchive(input) {
    const request = object(input);
    const selected = this.selection(request.selectionId, 'import_archive');
    const extracted = await extractSkillArchive(selected, path.join(this.store.root, 'staging'), { limits: this.store.settings().limits });
    try {
      return await this.store.archiveDirectory(extracted.contentRoot, { sourceType: 'local_zip', sourceUri: selected, packageSha256: extracted.packageSha256 });
    } finally {
      if (fs.existsSync(extracted.stagingPath)) fs.rmSync(extracted.stagingPath, { recursive: true, force: true });
    }
  }

  previewInstall(input) {
    const request = object(input);
    const artifactId = id(request.artifactId, 'artifactId'), versionId = id(request.versionId, 'versionId');
    const providerId = provider(request.providerId);
    if (providerId === 'qclaw') throw Error('QClaw 本轮仅支持扫描和导出存档，不能安装');
    const catalog = this.store.catalog();
    const artifact = catalog.artifacts.find(item => item.artifactId === artifactId);
    const version = catalog.versions.find(item => item.versionId === versionId && item.artifactId === artifactId);
    const existingInstallation = this.store.findInstallation(artifactId, providerId);
    const plan = installAdapters.previewInstall({ artifact, version, existingInstallation, libraryRoot: this.store.root, providerId, scope: request.scope || 'user', options: this.hostOptions() });
    this.installPlans.set(plan.planId, plan);
    return publicPlan(plan);
  }

  async install(input) {
    const request = object(input);
    const planId = id(request.planId, 'planId');
    const plan = this.installPlans.get(planId);
    if (!plan || plan.planHash !== String(request.planHash || '')) throw Error('安装预览不存在或已变化，请重新预览');
    this.installPlans.delete(planId);
    try {
      const record = installAdapters.executeInstall(plan, { libraryRoot: this.store.root, backupRoot: path.join(this.store.root, 'backups'), currentPlanHash: String(request.planHash), options: this.hostOptions() });
      await this.store.saveInstallation(record);
      const receipt = this.store.writeReceipt('installs', { ...record, receiptId: record.installationId, status: record.state, createdAt: record.installedAt });
      return { record, receipt };
    } catch (error) {
      this.store.writeReceipt('installs', { schema: 'edu-manager.skill-install-receipt.v1', receiptId: crypto.randomUUID(), status: error.recoveryRequired ? 'failed_needs_attention' : 'failed_recoverable',
        artifactId: plan.artifactId, versionId: plan.versionId, providerId: plan.providerId, message: error.message, createdAt: new Date().toISOString() });
      throw error;
    }
  }

  async verifyInstallation(input) {
    const installationId = id(object(input).installationId, 'installationId');
    const record = this.store.catalog().installations.find(item => item.installationId === installationId);
    if (!record) throw Error('安装记录不存在');
    const result = installAdapters.verifyInstallation(record, this.hostOptions());
    const next = { ...record, ...result };
    await this.store.saveInstallation(next);
    return next;
  }

  previewRollback(input) {
    const installationId = id(object(input).installationId, 'installationId');
    const record = this.store.catalog().installations.find(item => item.installationId === installationId);
    if (!record?.backupPath) throw Error('该安装没有可回滚备份');
    if (installAdapters.fingerprintIfPresent(record.targetPath) !== record.installedFingerprint) throw Error('目标 Skill 已被修改，拒绝生成回滚计划');
    const plan = { schema: 'edu-manager.skill-rollback-plan.v1', planId: crypto.randomUUID(), installationId, providerId: record.providerId,
      currentFingerprint: record.installedFingerprint, backupPath: record.backupPath, expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() };
    plan.planHash = require('./skill-package-inspector.cjs').sha256(Buffer.from(JSON.stringify(plan), 'utf8'));
    this.rollbackPlans.set(plan.planId, plan);
    return { ...plan, backupPath: undefined };
  }

  async rollback(input) {
    const request = object(input), planId = id(request.planId, 'planId');
    const plan = this.rollbackPlans.get(planId);
    if (!plan || plan.planHash !== String(request.planHash || '') || Date.parse(plan.expiresAt) <= Date.now()) throw Error('回滚计划不存在、已变化或已过期');
    const record = this.store.catalog().installations.find(item => item.installationId === plan.installationId);
    const next = installAdapters.rollbackInstallation(record, { backupRoot: path.join(this.store.root, 'backups'), options: this.hostOptions() });
    this.rollbackPlans.delete(planId);
    await this.store.saveInstallation(next);
    const receipt = this.store.writeReceipt('rollbacks', { ...next, receiptId: crypto.randomUUID(), status: 'rolled_back', createdAt: next.rolledBackAt });
    return { record: next, receipt };
  }

  async uninstall(input) {
    const installationId = id(object(input).installationId, 'installationId');
    const record = this.store.catalog().installations.find(item => item.installationId === installationId);
    if (!record) throw Error('安装记录不存在');
    const next = installAdapters.uninstallInstallation(record, this.hostOptions());
    await this.store.saveInstallation(next);
    return next;
  }

  manualInstallPayload(input) {
    const request = object(input);
    const resolved = this.store.resolveArtifactPayload(id(request.artifactId, 'artifactId'), id(request.versionId, 'versionId'));
    if (resolved.artifact.kind !== 'skill') throw Error('插件不能按目录手动安装；当前仅支持查看和导出 Skill');
    return resolved;
  }

  async action(action, input = {}) {
    const name = String(action || '');
    if (!ACTIONS.has(name)) throw Error('不支持的 Skill 存档操作');
    if (name === 'snapshot') return this.snapshot();
    if (name === 'scanSources') return this.scanSources(input);
    if (name === 'cancelScan') return this.cancelScan(input);
    if (name === 'archiveDiscovered') return this.archiveDiscovered(input);
    if (name === 'chooseArchiveRoot') return this.choosePath('archive_root');
    if (name === 'migrateArchiveRoot') {
      if (this.activeScans.size) throw Error('扫描尚未结束，请等待扫描完成后再迁移存档');
      const result = await this.store.migrateRoot(this.selection(object(input).selectionId, 'archive_root'));
      this.installPlans.clear(); this.rollbackPlans.clear();
      return result;
    }
    if (name === 'chooseImportDirectory') return this.choosePath('import_directory');
    if (name === 'chooseImportArchive') return this.choosePath('import_archive');
    if (name === 'importDirectory') return this.importDirectory(input);
    if (name === 'importArchive') return this.importArchive(input);
    if (name === 'listArtifacts') return this.store.listArtifacts(object(input));
    if (name === 'readArtifact') return this.store.readArtifact(id(object(input).artifactId, 'artifactId'));
    if (name === 'saveUserTags') return this.store.saveUserTags(id(object(input).artifactId, 'artifactId'), object(input).tags);
    if (name === 'deleteArtifact') {
      const request = object(input);
      const artifactId = id(request.artifactId, 'artifactId');
      const result = await this.store.deleteArtifact(artifactId, id(request.currentVersionId, 'versionId'));
      for (const [planId, plan] of this.installPlans) if (plan.artifactId === artifactId) this.installPlans.delete(planId);
      for (const [planId, plan] of this.rollbackPlans) {
        const record = this.store.catalog().installations.find(item => item.installationId === plan.installationId);
        if (!record || record.artifactId === artifactId) this.rollbackPlans.delete(planId);
      }
      return result;
    }
    if (name === 'previewInstall') return this.previewInstall(input);
    if (name === 'install') return this.install(input);
    if (name === 'verifyInstallation') return this.verifyInstallation(input);
    if (name === 'previewRollback') return this.previewRollback(input);
    if (name === 'rollback') return this.rollback(input);
    if (name === 'uninstall') return this.uninstall(input);
    if (name === 'manualInstallInfo') {
      const resolved = this.manualInstallPayload(input);
      return { archivePath: resolved.payload, readOnlyArchive: true, kind: resolved.artifact.kind, treeSha256: resolved.version.treeSha256 };
    }
    if (name === 'copyManualInstallPath') {
      const resolved = this.manualInstallPayload(input);
      if (!this.options.clipboard?.writeText) throw Error('当前运行环境不支持复制路径');
      this.options.clipboard.writeText(resolved.payload);
      return { copied: true, archivePath: resolved.payload };
    }
    if (name === 'openManualInstallPath') {
      const resolved = this.manualInstallPayload(input);
      if (!this.options.shell) throw Error('当前运行环境不支持打开目录');
      const error = await this.options.shell.openPath(resolved.payload);
      if (error) throw Error(error);
      return { opened: true };
    }
    if (name === 'chooseManualExportRoot') return this.choosePath('manual_export');
    if (name === 'exportManualInstallCopy') {
      const request = object(input);
      const artifactId = id(request.artifactId, 'artifactId'), versionId = id(request.versionId, 'versionId');
      this.manualInstallPayload({ artifactId, versionId });
      const selectionId = id(request.selectionId, 'selectionId');
      const targetParent = this.selection(selectionId, 'manual_export');
      this.selections.delete(selectionId);
      return this.store.exportArtifactCopy(artifactId, versionId, targetParent);
    }
    if (name === 'openArchivePath') {
      if (!this.options.shell) throw Error('当前运行环境不支持打开目录');
      const error = await this.options.shell.openPath(this.store.root);
      if (error) throw Error(error);
      return { opened: true };
    }
    if (name === 'listReceipts') return this.store.listReceipts(object(input).limit);
    throw Error('不支持的 Skill 存档操作');
  }
}

function publicPlan(plan) {
  return {
    schema: plan.schema, planId: plan.planId, planHash: plan.planHash, artifactId: plan.artifactId, versionId: plan.versionId,
    providerId: plan.providerId, scope: plan.scope, targetPath: plan.targetPath, beforeFingerprint: plan.beforeFingerprint,
    objectTreeSha256: plan.objectTreeSha256, changes: plan.changes, riskFindings: plan.riskFindings,
    requiresRestart: plan.requiresRestart, rollbackAvailable: plan.rollbackAvailable, createdAt: plan.createdAt, expiresAt: plan.expiresAt,
  };
}

function createSkillLibraryService(options) { return new SkillLibraryService(options); }

module.exports = { ACTIONS, SkillLibraryService, createSkillLibraryService };
