const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  createSyncManifest,
  createTombstone,
  ensureCollaborationLayout,
  importDisposition,
  pathInside,
  safeRelativePath,
  sha256File,
  validateSyncManifest,
  verifyManifestFiles,
} = require('./collaboration-sync.cjs');
const { manifestImportComplete } = require('./collaboration-package-retention.cjs');

const IMPORT_LEDGER_SCHEMA = 'edu-manager.collaboration-import-ledger.v1';
const RECEIPT_SCHEMA = 'edu-manager.collaboration-receipt.v1';

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temporaryPath, filePath);
}

function copyFileChecked(sourcePath, targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
  return {
    size: fs.statSync(targetPath).size,
    sha256: sha256File(targetPath),
  };
}

function buildCollaborationPackage(rootPath, input = {}) {
  const sourceNodeId = String(input.sourceNodeId || '').trim();
  const targetNodeId = String(input.targetNodeId || '').trim();
  if (!sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId) {
    throw new Error('发送节点和目标节点必须存在且不能相同。');
  }
  const layout = ensureCollaborationLayout(rootPath, sourceNodeId);
  const manifestId = String(input.manifestId || `manifest-${crypto.randomUUID()}`);
  const temporaryRoot = path.join(layout.outbox, `.${manifestId}.writing`);
  const packageRoot = path.join(layout.outbox, manifestId);
  if (fs.existsSync(temporaryRoot) || fs.existsSync(packageRoot)) {
    throw new Error('同名协作包已经存在。');
  }
  fs.mkdirSync(path.join(temporaryRoot, 'content'), { recursive: true });
  try {
    const files = (Array.isArray(input.files) ? input.files : []).map((item, index) => {
      const sourcePath = path.resolve(String(item.sourcePath || ''));
      if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
        throw new Error(`待发送文件不存在：${sourcePath}`);
      }
      const relativePath = safeRelativePath(item.relativePath || path.basename(sourcePath));
      if (!relativePath) throw new Error(`待发送文件路径无效：${item.relativePath || sourcePath}`);
      const targetPath = path.join(temporaryRoot, 'content', relativePath);
      if (!pathInside(targetPath, path.join(temporaryRoot, 'content'))) {
        throw new Error(`待发送文件超出协作包范围：${relativePath}`);
      }
      const copied = copyFileChecked(sourcePath, targetPath);
      return {
        objectId: String(item.objectId || `object-${crypto.randomUUID()}-${index}`),
        objectType: String(item.objectType || 'asset'),
        relativePath,
        sha256: copied.sha256,
        size: copied.size,
        version: Math.max(1, Number(item.version || 1)),
        studentId: String(item.studentId || ''),
        projectId: String(item.projectId || ''),
      };
    });
    const manifest = createSyncManifest({
      manifestId,
      sourceNodeId,
      targetNodeId,
      createdAt: input.createdAt || new Date().toISOString(),
      completedAt: new Date().toISOString(),
      files,
    });
    writeJsonAtomic(path.join(temporaryRoot, 'manifest.json'), manifest);
    fs.writeFileSync(path.join(temporaryRoot, 'READY'), manifest.manifestId, 'utf8');
    fs.renameSync(temporaryRoot, packageRoot);
    return { packageRoot, manifest };
  } catch (error) {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

function discoverCollaborationPackages(rootPath, targetNodeId, options = {}) {
  const root = path.resolve(String(rootPath || ''));
  if (!fs.existsSync(root)) return [];
  const ignoredManifestIds = options.ignoredManifestIds instanceof Set
    ? options.ignoredManifestIds
    : new Set(Array.isArray(options.ignoredManifestIds) ? options.ignoredManifestIds : []);
  const packages = [];
  for (const sourceEntry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!sourceEntry.isDirectory() || sourceEntry.name === targetNodeId) continue;
    const outbox = path.join(root, sourceEntry.name, 'outbox');
    if (!fs.existsSync(outbox)) continue;
    for (const packageEntry of fs.readdirSync(outbox, { withFileTypes: true })) {
      if (!packageEntry.isDirectory() || packageEntry.name.startsWith('.')) continue;
      // Package directories are named with their manifest id. Terminal
      // manifests can therefore be skipped without reopening and parsing a
      // potentially very large historical manifest on every inbox scan.
      if (ignoredManifestIds.has(packageEntry.name)) continue;
      const packageRoot = path.join(outbox, packageEntry.name);
      const manifestPath = path.join(packageRoot, 'manifest.json');
      const readyPath = path.join(packageRoot, 'READY');
      if (!fs.existsSync(manifestPath) || !fs.existsSync(readyPath)) continue;
      const manifest = readJson(manifestPath, null);
      if (manifest?.targetNodeId !== targetNodeId) continue;
      packages.push({ sourceNodeId: sourceEntry.name, packageRoot, manifestPath, manifest });
    }
  }
  return packages.sort((a, b) => String(a.manifest?.createdAt || '').localeCompare(String(b.manifest?.createdAt || '')));
}

function normalizeLedger(input = {}) {
  return {
    schema: IMPORT_LEDGER_SCHEMA,
    objects: input.objects && typeof input.objects === 'object' ? input.objects : {},
    manifests: input.manifests && typeof input.manifests === 'object' ? input.manifests : {},
    updatedAt: String(input.updatedAt || new Date().toISOString()),
  };
}

function receiptFor(manifest, status, details = {}) {
  return {
    schema: RECEIPT_SCHEMA,
    receiptId: `receipt-${crypto.randomUUID()}`,
    manifestId: manifest.manifestId,
    sourceNodeId: manifest.sourceNodeId,
    targetNodeId: manifest.targetNodeId,
    status,
    importedCount: Number(details.importedCount || 0),
    duplicateCount: Number(details.duplicateCount || 0),
    quarantinedCount: Number(details.quarantinedCount || 0),
    errors: Array.isArray(details.errors) ? details.errors : [],
    createdAt: new Date().toISOString(),
  };
}

function importCollaborationPackage(rootPath, packageInfo, options = {}) {
  const targetNodeId = String(options.targetNodeId || '').trim();
  const ledgerPath = path.resolve(String(options.ledgerPath || ''));
  if (!targetNodeId || !ledgerPath) throw new Error('导入协作包需要目标节点和本机导入账本。');
  const layout = ensureCollaborationLayout(rootPath, targetNodeId);
  const manifest = packageInfo?.manifest || readJson(path.join(packageInfo.packageRoot, 'manifest.json'), null);
  const validation = validateSyncManifest(manifest, { targetNodeId });
  if (!validation.ok) {
    const quarantinePath = path.join(layout.quarantine, String(manifest?.manifestId || `invalid-${Date.now()}`));
    fs.mkdirSync(quarantinePath, { recursive: true });
    writeJsonAtomic(path.join(quarantinePath, 'validation-errors.json'), validation);
    const receipt = receiptFor(manifest || {}, 'rejected', { quarantinedCount: 1, errors: validation.errors });
    writeJsonAtomic(path.join(layout.receipts, `${receipt.receiptId}.json`), receipt);
    if (manifest?.manifestId) {
      const ledger = normalizeLedger(readJson(ledgerPath, {}));
      ledger.manifests[manifest.manifestId] = {
        manifestId: manifest.manifestId,
        sourceNodeId: String(manifest.sourceNodeId || ''),
        status: 'rejected',
        rejectedAt: new Date().toISOString(),
        errors: validation.errors,
      };
      ledger.updatedAt = new Date().toISOString();
      writeJsonAtomic(ledgerPath, ledger);
    }
    return receipt;
  }
  const ledger = normalizeLedger(readJson(ledgerPath, {}));
  if (manifestImportComplete(manifest, ledger)) {
    const receipt = receiptFor(manifest, 'duplicate', { duplicateCount: manifest.files.length });
    writeJsonAtomic(path.join(layout.receipts, `${receipt.receiptId}.json`), receipt);
    return receipt;
  }
  const contentRoot = path.join(packageInfo.packageRoot, 'content');
  const verification = verifyManifestFiles(manifest, contentRoot);
  const invalidFiles = verification.filter((item) => !item.ok);
  if (invalidFiles.length) {
    const quarantinePath = path.join(layout.quarantine, manifest.manifestId);
    fs.mkdirSync(quarantinePath, { recursive: true });
    writeJsonAtomic(path.join(quarantinePath, 'verification-errors.json'), invalidFiles);
    const receipt = receiptFor(manifest, 'rejected', { quarantinedCount: invalidFiles.length, errors: invalidFiles });
    writeJsonAtomic(path.join(layout.receipts, `${receipt.receiptId}.json`), receipt);
    ledger.manifests[manifest.manifestId] = {
      manifestId: manifest.manifestId,
      sourceNodeId: manifest.sourceNodeId,
      status: 'rejected',
      rejectedAt: new Date().toISOString(),
      errors: invalidFiles,
    };
    ledger.updatedAt = new Date().toISOString();
    writeJsonAtomic(ledgerPath, ledger);
    return receipt;
  }

  let importedCount = 0;
  let duplicateCount = 0;
  let quarantinedCount = 0;
  const errors = [];
  const localImportRoot = path.join(layout.inbox, manifest.sourceNodeId, manifest.manifestId, 'content');
  for (const file of manifest.files) {
    const disposition = importDisposition(file, ledger.objects);
    const sourcePath = path.join(contentRoot, file.relativePath);
    const targetPath = path.join(localImportRoot, file.relativePath);
    if (disposition.action === 'receipt_only') {
      const current = ledger.objects[file.objectId];
      const currentPathValid = current?.importedPath
        && fs.existsSync(current.importedPath)
        && fs.statSync(current.importedPath).isFile();
      if (currentPathValid) {
        duplicateCount += 1;
        continue;
      }
      copyFileChecked(sourcePath, targetPath);
      ledger.objects[file.objectId] = {
        ...current,
        objectId: file.objectId,
        objectType: file.objectType,
        sha256: file.sha256,
        version: file.version,
        importedPath: targetPath,
        sourceNodeId: manifest.sourceNodeId,
        importedAt: new Date().toISOString(),
        recoveredAt: new Date().toISOString(),
      };
      importedCount += 1;
      continue;
    }
    if (disposition.action === 'quarantine') {
      quarantinedCount += 1;
      const quarantinePath = path.join(layout.quarantine, manifest.manifestId, file.relativePath);
      copyFileChecked(sourcePath, quarantinePath);
      errors.push({ objectId: file.objectId, relativePath: file.relativePath, reason: disposition.reason });
      continue;
    }
    copyFileChecked(sourcePath, targetPath);
    ledger.objects[file.objectId] = {
      objectId: file.objectId,
      objectType: file.objectType,
      sha256: file.sha256,
      version: file.version,
      importedPath: targetPath,
      sourceNodeId: manifest.sourceNodeId,
      importedAt: new Date().toISOString(),
    };
    importedCount += 1;
  }
  const status = quarantinedCount ? (importedCount ? 'partial' : 'rejected') : 'imported';
  ledger.manifests[manifest.manifestId] = {
    manifestId: manifest.manifestId,
    sourceNodeId: manifest.sourceNodeId,
    status,
    importedAt: new Date().toISOString(),
    verifiedAt: new Date().toISOString(),
    fileCount: manifest.files.length,
  };
  ledger.updatedAt = new Date().toISOString();
  writeJsonAtomic(ledgerPath, ledger);
  const receipt = receiptFor(manifest, status, { importedCount, duplicateCount, quarantinedCount, errors });
  writeJsonAtomic(path.join(layout.receipts, `${receipt.receiptId}.json`), receipt);
  return receipt;
}

function scanAndImportCollaborationPackages(rootPath, options = {}) {
  const ledger = normalizeLedger(readJson(options.ledgerPath, {}));
  const terminalStatuses = new Set(['imported', 'rejected', 'partial']);
  const terminalManifestIds = new Set(Object.values(ledger.manifests || {})
    .filter((item) => terminalStatuses.has(String(item?.status || '')))
    .map((item) => String(item?.manifestId || ''))
    .filter(Boolean));
  const packages = discoverCollaborationPackages(rootPath, options.targetNodeId, {
    ignoredManifestIds: terminalManifestIds,
  })
    .filter((packageInfo) => !terminalStatuses.has(ledger.manifests[packageInfo.manifest?.manifestId]?.status));
  const receipts = packages.map((packageInfo) => importCollaborationPackage(rootPath, packageInfo, options));
  return {
    packageCount: packages.length,
    receipts,
    importedCount: receipts.reduce((sum, item) => sum + item.importedCount, 0),
    duplicateCount: receipts.reduce((sum, item) => sum + item.duplicateCount, 0),
    quarantinedCount: receipts.reduce((sum, item) => sum + item.quarantinedCount, 0),
    skippedTerminalCount: terminalManifestIds.size,
  };
}

function requestCollaborationObjectRemoval(rootPath, options = {}) {
  const targetNodeId = String(options.targetNodeId || '').trim();
  const objectId = String(options.objectId || '').trim();
  const ledgerPath = path.resolve(String(options.ledgerPath || ''));
  if (!targetNodeId || !objectId || !ledgerPath) throw new Error('移除请求缺少节点、对象或导入账本。');
  const ledger = normalizeLedger(readJson(ledgerPath, {}));
  const current = ledger.objects[objectId];
  if (!current) throw new Error('未找到待移除的协作对象。');
  const layout = ensureCollaborationLayout(rootPath, targetNodeId);
  const tombstone = createTombstone({
    objectId,
    authorityNodeId: String(options.authorityNodeId || targetNodeId),
    requestedByNodeId: String(options.requestedByNodeId || targetNodeId),
    reason: options.reason,
  });
  writeJsonAtomic(path.join(layout.trash, `${tombstone.tombstoneId}.json`), tombstone);
  ledger.objects[objectId] = {
    ...current,
    deletionStatus: 'pending_review',
    tombstoneId: tombstone.tombstoneId,
  };
  ledger.updatedAt = new Date().toISOString();
  writeJsonAtomic(ledgerPath, ledger);
  return tombstone;
}

function restoreCollaborationObject(rootPath, options = {}) {
  const targetNodeId = String(options.targetNodeId || '').trim();
  const objectId = String(options.objectId || '').trim();
  const ledgerPath = path.resolve(String(options.ledgerPath || ''));
  const ledger = normalizeLedger(readJson(ledgerPath, {}));
  const current = ledger.objects[objectId];
  if (!targetNodeId || !current) throw new Error('未找到可恢复的协作对象。');
  const layout = ensureCollaborationLayout(rootPath, targetNodeId);
  const tombstonePath = current.tombstoneId ? path.join(layout.trash, `${current.tombstoneId}.json`) : '';
  if (tombstonePath && fs.existsSync(tombstonePath)) {
    const tombstone = readJson(tombstonePath, {});
    writeJsonAtomic(tombstonePath, { ...tombstone, status: 'cancelled', restoredAt: new Date().toISOString() });
  }
  ledger.objects[objectId] = {
    ...current,
    deletionStatus: '',
    restoredAt: new Date().toISOString(),
  };
  ledger.updatedAt = new Date().toISOString();
  writeJsonAtomic(ledgerPath, ledger);
  return ledger.objects[objectId];
}

function createCollaborationStateSnapshot(ledgerPath, backupRoot) {
  const ledger = normalizeLedger(readJson(ledgerPath, {}));
  const snapshot = {
    schema: 'edu-manager.collaboration-state-snapshot.v1',
    snapshotId: `snapshot-${crypto.randomUUID()}`,
    createdAt: new Date().toISOString(),
    ledger,
  };
  const snapshotPath = path.join(path.resolve(backupRoot), `${snapshot.snapshotId}.json`);
  writeJsonAtomic(snapshotPath, snapshot);
  return { snapshotPath, snapshot };
}

function restoreCollaborationStateSnapshot(snapshotPath, ledgerPath) {
  const snapshot = readJson(snapshotPath, null);
  if (snapshot?.schema !== 'edu-manager.collaboration-state-snapshot.v1' || !snapshot.ledger) {
    throw new Error('协作状态快照无效。');
  }
  const current = normalizeLedger(readJson(ledgerPath, {}));
  const rollbackPath = `${ledgerPath}.before-restore-${Date.now()}.json`;
  writeJsonAtomic(rollbackPath, current);
  writeJsonAtomic(ledgerPath, normalizeLedger(snapshot.ledger));
  return { rollbackPath, restoredSnapshotId: snapshot.snapshotId };
}

function rebuildCollaborationImportLedger(rootPath, options = {}) {
  const targetNodeId = String(options.targetNodeId || '').trim();
  const ledgerPath = path.resolve(String(options.ledgerPath || ''));
  if (!targetNodeId || !ledgerPath) throw new Error('重建导入索引需要目标节点和账本路径。');
  const layout = ensureCollaborationLayout(rootPath, targetNodeId);
  const previous = normalizeLedger(readJson(ledgerPath, {}));
  const rebuilt = normalizeLedger({});
  for (const packageInfo of discoverCollaborationPackages(rootPath, targetNodeId)) {
    const manifest = packageInfo.manifest;
    for (const file of Array.isArray(manifest?.files) ? manifest.files : []) {
      const importedPath = path.join(layout.inbox, manifest.sourceNodeId, manifest.manifestId, 'content', file.relativePath);
      if (!fs.existsSync(importedPath) || sha256File(importedPath) !== file.sha256) continue;
      const previousObject = previous.objects[file.objectId] || {};
      rebuilt.objects[file.objectId] = {
        ...previousObject,
        objectId: file.objectId,
        objectType: file.objectType,
        sha256: file.sha256,
        version: file.version,
        importedPath,
        sourceNodeId: manifest.sourceNodeId,
        importedAt: previousObject.importedAt || new Date().toISOString(),
      };
      rebuilt.manifests[manifest.manifestId] = {
        manifestId: manifest.manifestId,
        sourceNodeId: manifest.sourceNodeId,
        status: 'imported',
        importedAt: previous.manifests[manifest.manifestId]?.importedAt || new Date().toISOString(),
      };
    }
  }
  rebuilt.updatedAt = new Date().toISOString();
  writeJsonAtomic(ledgerPath, rebuilt);
  return {
    objectCount: Object.keys(rebuilt.objects).length,
    manifestCount: Object.keys(rebuilt.manifests).length,
  };
}

module.exports = {
  IMPORT_LEDGER_SCHEMA,
  RECEIPT_SCHEMA,
  buildCollaborationPackage,
  discoverCollaborationPackages,
  createCollaborationStateSnapshot,
  importCollaborationPackage,
  rebuildCollaborationImportLedger,
  requestCollaborationObjectRemoval,
  restoreCollaborationObject,
  restoreCollaborationStateSnapshot,
  scanAndImportCollaborationPackages,
};
