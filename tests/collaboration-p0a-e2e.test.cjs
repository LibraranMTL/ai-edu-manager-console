const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  buildCollaborationPackage,
  createCollaborationStateSnapshot,
  discoverCollaborationPackages,
  importCollaborationPackage,
  rebuildCollaborationImportLedger,
  requestCollaborationObjectRemoval,
  restoreCollaborationObject,
  restoreCollaborationStateSnapshot,
  scanAndImportCollaborationPackages,
} = require('../electron/collaboration-runtime.cjs');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'edu-collaboration-'));
}

test('two nodes exchange a completed package through isolated staging', () => {
  const root = tempRoot();
  const source = path.join(root, 'source.md');
  const ledgerPath = path.join(root, 'local-state', 'imports.json');
  fs.writeFileSync(source, '# Shared knowledge\n', 'utf8');
  const built = buildCollaborationPackage(path.join(root, 'shared'), {
    sourceNodeId: 'node-a',
    targetNodeId: 'node-b',
    files: [{ sourcePath: source, relativePath: 'knowledge/source.md', objectId: 'knowledge-1', version: 1 }],
  });
  assert.equal(built.manifest.files.length, 1);
  assert.equal(discoverCollaborationPackages(path.join(root, 'shared'), 'node-b').length, 1);

  const first = scanAndImportCollaborationPackages(path.join(root, 'shared'), {
    targetNodeId: 'node-b',
    ledgerPath,
  });
  assert.equal(first.importedCount, 1);
  assert.equal(first.quarantinedCount, 0);
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  assert.equal(ledger.objects['knowledge-1'].version, 1);
  assert.equal(fs.readFileSync(ledger.objects['knowledge-1'].importedPath, 'utf8'), '# Shared knowledge\n');

  const second = scanAndImportCollaborationPackages(path.join(root, 'shared'), {
    targetNodeId: 'node-b',
    ledgerPath,
  });
  assert.equal(second.importedCount, 0);
  assert.equal(second.duplicateCount, 0);
  assert.equal(second.packageCount, 0);
});

test('same-version content conflict is quarantined instead of overwriting local import', () => {
  const root = tempRoot();
  const sharedRoot = path.join(root, 'shared');
  const ledgerPath = path.join(root, 'local-state', 'imports.json');
  const firstSource = path.join(root, 'first.md');
  const conflictingSource = path.join(root, 'conflicting.md');
  fs.writeFileSync(firstSource, 'first', 'utf8');
  fs.writeFileSync(conflictingSource, 'conflicting', 'utf8');
  buildCollaborationPackage(sharedRoot, {
    sourceNodeId: 'node-a',
    targetNodeId: 'node-b',
    manifestId: 'manifest-first',
    files: [{ sourcePath: firstSource, relativePath: 'knowledge/item.md', objectId: 'object-1', version: 1 }],
  });
  scanAndImportCollaborationPackages(sharedRoot, { targetNodeId: 'node-b', ledgerPath });
  buildCollaborationPackage(sharedRoot, {
    sourceNodeId: 'node-a',
    targetNodeId: 'node-b',
    manifestId: 'manifest-conflict',
    files: [{ sourcePath: conflictingSource, relativePath: 'knowledge/item.md', objectId: 'object-1', version: 1 }],
  });
  const result = scanAndImportCollaborationPackages(sharedRoot, { targetNodeId: 'node-b', ledgerPath });
  assert.equal(result.quarantinedCount, 1);
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  assert.equal(fs.readFileSync(ledger.objects['object-1'].importedPath, 'utf8'), 'first');
});

test('a duplicate object with a missing old import path is recovered from the new verified package', () => {
  const root = tempRoot();
  const sharedRoot = path.join(root, 'shared');
  const ledgerPath = path.join(root, 'local-state', 'imports.json');
  const source = path.join(root, 'source.md');
  fs.writeFileSync(source, 'recover me', 'utf8');
  buildCollaborationPackage(sharedRoot, {
    sourceNodeId: 'node-a',
    targetNodeId: 'node-b',
    manifestId: 'manifest-original',
    files: [{ sourcePath: source, relativePath: 'knowledge/original.md', objectId: 'object-recover', version: 1 }],
  });
  scanAndImportCollaborationPackages(sharedRoot, { targetNodeId: 'node-b', ledgerPath });
  const original = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')).objects['object-recover'];
  fs.rmSync(original.importedPath, { force: true });

  buildCollaborationPackage(sharedRoot, {
    sourceNodeId: 'node-a',
    targetNodeId: 'node-b',
    manifestId: 'manifest-recovery',
    files: [{ sourcePath: source, relativePath: 'knowledge/recovery.md', objectId: 'object-recover', version: 1 }],
  });
  const recovered = scanAndImportCollaborationPackages(sharedRoot, { targetNodeId: 'node-b', ledgerPath });
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  assert.equal(recovered.importedCount, 1);
  assert.equal(recovered.duplicateCount, 0);
  assert.notEqual(ledger.objects['object-recover'].importedPath, original.importedPath);
  assert.equal(fs.readFileSync(ledger.objects['object-recover'].importedPath, 'utf8'), 'recover me');
  assert.ok(ledger.objects['object-recover'].recoveredAt);
});

test('an already imported manifest repairs a missing object from its completed package', () => {
  const root = tempRoot();
  const sharedRoot = path.join(root, 'shared');
  const ledgerPath = path.join(root, 'local-state', 'imports.json');
  const source = path.join(root, 'source.md');
  fs.writeFileSync(source, 'repair completed package', 'utf8');
  const built = buildCollaborationPackage(sharedRoot, {
    sourceNodeId: 'node-a',
    targetNodeId: 'node-b',
    manifestId: 'manifest-completed-repair',
    files: [{ sourcePath: source, relativePath: 'knowledge/item.md', objectId: 'object-completed-repair', version: 1 }],
  });
  scanAndImportCollaborationPackages(sharedRoot, { targetNodeId: 'node-b', ledgerPath });
  const original = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')).objects['object-completed-repair'];
  fs.rmSync(original.importedPath, { force: true });

  const receipt = importCollaborationPackage(sharedRoot, {
    packageRoot: built.packageRoot,
    manifest: built.manifest,
  }, {
    targetNodeId: 'node-b',
    ledgerPath,
  });
  const repaired = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')).objects['object-completed-repair'];
  assert.equal(receipt.status, 'imported');
  assert.equal(receipt.importedCount, 1);
  assert.equal(fs.readFileSync(repaired.importedPath, 'utf8'), 'repair completed package');
});

test('deletion is reviewable, recoverable and never removes the imported file', () => {
  const root = tempRoot();
  const sharedRoot = path.join(root, 'shared');
  const ledgerPath = path.join(root, 'local-state', 'imports.json');
  const source = path.join(root, 'source.md');
  fs.writeFileSync(source, 'keep me', 'utf8');
  buildCollaborationPackage(sharedRoot, {
    sourceNodeId: 'node-a',
    targetNodeId: 'node-b',
    files: [{ sourcePath: source, relativePath: 'knowledge/item.md', objectId: 'object-delete', version: 1 }],
  });
  scanAndImportCollaborationPackages(sharedRoot, { targetNodeId: 'node-b', ledgerPath });
  const before = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')).objects['object-delete'];
  requestCollaborationObjectRemoval(sharedRoot, {
    targetNodeId: 'node-b',
    ledgerPath,
    objectId: 'object-delete',
    reason: 'user request',
  });
  assert.equal(fs.existsSync(before.importedPath), true);
  let ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  assert.equal(ledger.objects['object-delete'].deletionStatus, 'pending_review');
  restoreCollaborationObject(sharedRoot, { targetNodeId: 'node-b', ledgerPath, objectId: 'object-delete' });
  ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  assert.equal(ledger.objects['object-delete'].deletionStatus, '');
  assert.equal(fs.readFileSync(before.importedPath, 'utf8'), 'keep me');
});

test('import ledger can be rebuilt and restored from an independent state snapshot', () => {
  const root = tempRoot();
  const sharedRoot = path.join(root, 'shared');
  const ledgerPath = path.join(root, 'local-state', 'imports.json');
  const backupRoot = path.join(root, 'backups');
  const source = path.join(root, 'source.md');
  fs.writeFileSync(source, 'snapshot source', 'utf8');
  buildCollaborationPackage(sharedRoot, {
    sourceNodeId: 'node-a',
    targetNodeId: 'node-b',
    files: [{ sourcePath: source, relativePath: 'knowledge/item.md', objectId: 'object-snapshot', version: 1 }],
  });
  scanAndImportCollaborationPackages(sharedRoot, { targetNodeId: 'node-b', ledgerPath });
  const saved = createCollaborationStateSnapshot(ledgerPath, backupRoot);
  fs.writeFileSync(ledgerPath, JSON.stringify({ broken: true }), 'utf8');
  restoreCollaborationStateSnapshot(saved.snapshotPath, ledgerPath);
  let ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  assert.equal(ledger.objects['object-snapshot'].version, 1);
  fs.writeFileSync(ledgerPath, JSON.stringify({}), 'utf8');
  const rebuilt = rebuildCollaborationImportLedger(sharedRoot, { targetNodeId: 'node-b', ledgerPath });
  assert.equal(rebuilt.objectCount, 1);
  ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  assert.equal(ledger.objects['object-snapshot'].sha256.length, 64);
});
