'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SkillLibraryStore } = require('../electron/skill-library-store.cjs');

function makeSkill(base, folder, version = '1.0.0', publisher = '') {
  const root = path.join(base, folder); fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'SKILL.md'), `---\nname: shared-name\ndescription: synthetic archive fixture\nversion: ${version}\n${publisher ? `publisher: ${publisher}\n` : ''}---\nbody ${version}\n`);
  return root;
}

test('store creates immutable layout, deduplicates exact source versions and separates unknown publishers', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-skill-store-'));
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-skill-source-'));
  const store = new SkillLibraryStore({ userDataDir: root });
  for (const relative of ['settings.json', 'catalog.json', 'objects/sha256', 'staging', 'quarantine', 'receipts/imports', 'receipts/deletes', 'receipts/exports', 'backups']) assert.ok(fs.existsSync(path.join(store.root, relative)));
  const firstRoot = makeSkill(source, 'one');
  const first = await store.archiveDirectory(firstRoot, { sourceType: 'local_directory', sourceUri: firstRoot });
  assert.equal(first.status, 'archived');
  const duplicate = await store.archiveDirectory(firstRoot, { sourceType: 'local_directory', sourceUri: firstRoot });
  assert.equal(duplicate.status, 'duplicate');
  const secondRoot = makeSkill(source, 'two');
  const second = await store.archiveDirectory(secondRoot, { sourceType: 'local_directory', sourceUri: secondRoot });
  assert.equal(second.status, 'archived');
  assert.notEqual(first.artifact.artifactId, second.artifact.artifactId);
  assert.equal(store.catalog().versions.length, 2);
  assert.equal(store.listArtifacts({ query: 'synthetic' }).length, 2);
});

test('manual user tags are locked and preserved as separate metadata', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-skill-tags-'));
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-skill-tags-source-'));
  const store = new SkillLibraryStore({ userDataDir: root });
  const archived = await store.archiveDirectory(makeSkill(source, 'tagged', '1.0.0', 'fixture-publisher'), { sourceType: 'local_directory', sourceUri: 'fixture-a' });
  const tags = await store.saveUserTags(archived.artifact.artifactId, ['常用', '教学']);
  assert.equal(tags.manualLocked, true);
  assert.deepEqual(tags.user, ['常用', '教学']);
  assert.ok(store.readArtifact(archived.artifact.artifactId).versions[0].archiveObjectPath.startsWith('objects/sha256/'));
});

test('manual install export creates a verified independent copy and preserves the archive object', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-skill-export-store-'));
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-skill-export-source-'));
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-skill-export-target-'));
  const store = new SkillLibraryStore({ userDataDir: root });
  const archived = await store.archiveDirectory(makeSkill(source, 'manual-copy', '3.1.0', 'fixture-publisher'), { sourceType: 'local_directory', sourceUri: 'export-fixture' });
  const payload = store.resolveArtifactPayload(archived.artifact.artifactId, archived.version.versionId).payload;

  const result = await store.exportArtifactCopy(archived.artifact.artifactId, archived.version.versionId, target);

  assert.notEqual(result.exportPath, payload);
  assert.equal(fs.readFileSync(path.join(result.exportPath, 'SKILL.md'), 'utf8'), fs.readFileSync(path.join(payload, 'SKILL.md'), 'utf8'));
  assert.ok(fs.existsSync(payload));
  assert.equal(store.listReceipts().some(item => item.kind === 'exports' && item.exportPath === result.exportPath), true);
  await assert.rejects(store.exportArtifactCopy(archived.artifact.artifactId, archived.version.versionId, store.root), /不能导出到教育管家存档内部/);
});

test('deleting a stored Skill blocks active installations and removes only the archived object', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-skill-delete-store-'));
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-skill-delete-source-'));
  const store = new SkillLibraryStore({ userDataDir: root });
  const archived = await store.archiveDirectory(makeSkill(source, 'deletable', '1.0.0', 'fixture-publisher'), {
    sourceType: 'local_directory', sourceUri: 'delete-fixture',
  });
  const payload = path.join(store.root, ...archived.version.archiveObjectPath.split('/'));
  await store.saveInstallation({ installationId: 'install-delete-fixture', artifactId: archived.artifact.artifactId,
    versionId: archived.version.versionId, providerId: 'codex', state: 'restart_required', installedAt: new Date().toISOString() });
  await assert.rejects(store.deleteArtifact(archived.artifact.artifactId, archived.version.versionId), /请先.*卸载/);
  assert.ok(fs.existsSync(payload));

  await store.saveInstallation({ installationId: 'install-delete-fixture', artifactId: archived.artifact.artifactId,
    versionId: archived.version.versionId, providerId: 'codex', state: 'uninstalled', installedAt: new Date().toISOString(),
    retainedRecoveryPath: path.join(root, 'recovery-copy') });
  const result = await store.deleteArtifact(archived.artifact.artifactId, archived.version.versionId);
  assert.equal(result.deleted, true);
  assert.equal(result.receipt.recoveryCopiesRetained, 1);
  assert.equal(store.listArtifacts({}).length, 0);
  assert.equal(store.catalog().versions.length, 0);
  assert.equal(store.catalog().installations.length, 0);
  assert.equal(fs.existsSync(payload), false);
  assert.equal(store.listReceipts().some(item => item.kind === 'deletes' && item.artifactId === archived.artifact.artifactId), true);
});

test('archive root migration verifies immutable objects, switches the pointer and retains the old library', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-skill-migrate-store-'));
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-skill-migrate-source-'));
  const destinationParent = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-skill-migrate-target-'));
  const destination = path.join(destinationParent, 'library');
  const store = new SkillLibraryStore({ userDataDir: userData });
  const archived = await store.archiveDirectory(makeSkill(source, 'movable', '2.0.0', 'fixture-publisher'), {
    sourceType: 'local_directory', sourceUri: 'migration-fixture',
  });
  const originalRoot = store.root;

  const migrated = await store.migrateRoot(destination);

  assert.equal(migrated.activeRoot, destination);
  assert.equal(migrated.previousRoot, originalRoot);
  assert.equal(migrated.oldLibraryRetained, true);
  assert.ok(fs.existsSync(path.join(originalRoot, 'catalog.json')));
  assert.equal(store.root, destination);
  assert.equal(store.readArtifact(archived.artifact.artifactId).versions.length, 1);
  const pointer = JSON.parse(fs.readFileSync(path.join(userData, 'skill-library-location.json'), 'utf8'));
  assert.equal(pointer.activeRoot, destination);
  assert.ok(pointer.previousRoots.includes(originalRoot));

  const reopened = new SkillLibraryStore({ userDataDir: userData });
  assert.equal(reopened.root, destination);
  assert.equal(reopened.listArtifacts({}).length, 1);
});
