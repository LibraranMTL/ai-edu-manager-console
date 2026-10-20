'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SkillLibraryStore } = require('../electron/skill-library-store.cjs');
const installer = require('../electron/skill-install-adapters.cjs');

function makeSkill(base, version, body) {
  const root = path.join(base, `source-${version}`); fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'SKILL.md'), `---\nname: install-fixture\ndescription: isolated install fixture\npublisher: edu-test\nversion: ${version}\n---\n${body}\n`);
  return root;
}

test('Codex install uses preview fingerprint, persistent target, update backup and rollback', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-skill-install-store-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-skill-install-home-'));
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-skill-install-source-'));
  const store = new SkillLibraryStore({ userDataDir: userData });
  const v1 = await store.archiveDirectory(makeSkill(source, '1.0.0', 'version one'), { sourceType: 'local_directory', sourceUri: 'fixture' });
  const plan1 = installer.previewInstall({ artifact: v1.artifact, version: v1.version, existingInstallation: null, libraryRoot: store.root, providerId: 'codex', options: { homeDir: home } });
  const record1 = installer.executeInstall(plan1, { libraryRoot: store.root, backupRoot: path.join(store.root, 'backups'), currentPlanHash: plan1.planHash, options: { homeDir: home } });
  assert.equal(record1.state, 'restart_required');
  assert.equal(installer.verifyInstallation(record1, { homeDir: home }).state, 'inventory_detected');
  await store.saveInstallation(record1);

  fs.writeFileSync(path.join(source, 'source-1.0.0', 'SKILL.md'), fs.readFileSync(path.join(source, 'source-1.0.0', 'SKILL.md'), 'utf8').replace('version one', 'version two').replace('1.0.0', '2.0.0'));
  const v2 = await store.archiveDirectory(path.join(source, 'source-1.0.0'), { sourceType: 'local_directory', sourceUri: 'fixture' });
  const latestArtifact = store.readArtifact(v1.artifact.artifactId);
  const artifact = store.catalog().artifacts.find(item => item.artifactId === v1.artifact.artifactId);
  const plan2 = installer.previewInstall({ artifact, version: v2.version, existingInstallation: record1, libraryRoot: store.root, providerId: 'codex', options: { homeDir: home } });
  const record2 = installer.executeInstall(plan2, { libraryRoot: store.root, backupRoot: path.join(store.root, 'backups'), currentPlanHash: plan2.planHash, options: { homeDir: home } });
  assert.ok(record2.backupPath);
  const rolledBack = installer.rollbackInstallation(record2, { backupRoot: path.join(store.root, 'backups'), options: { homeDir: home } });
  assert.equal(rolledBack.state, 'rolled_back');
  assert.equal(installer.fingerprintIfPresent(record2.targetPath), record1.installedFingerprint);
  assert.equal(latestArtifact.versions.length, 2);
});

test('preview refuses unmanaged conflicts and execution refuses TOCTOU changes', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-skill-conflict-store-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-skill-conflict-home-'));
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-skill-conflict-source-'));
  const store = new SkillLibraryStore({ userDataDir: userData });
  const archived = await store.archiveDirectory(makeSkill(source, '1.0.0', 'safe'), { sourceType: 'local_directory', sourceUri: 'fixture' });
  const target = path.join(home, '.codex', 'skills', 'install-fixture'); fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'SKILL.md'), 'manual content');
  assert.throws(() => installer.previewInstall({ artifact: archived.artifact, version: archived.version, existingInstallation: null, libraryRoot: store.root, providerId: 'codex', options: { homeDir: home } }), /拒绝覆盖/);
  fs.rmSync(target, { recursive: true, force: true });
  const plan = installer.previewInstall({ artifact: archived.artifact, version: archived.version, existingInstallation: null, libraryRoot: store.root, providerId: 'codex', options: { homeDir: home } });
  fs.mkdirSync(target, { recursive: true }); fs.writeFileSync(path.join(target, 'SKILL.md'), 'changed after preview');
  assert.throws(() => installer.executeInstall(plan, { libraryRoot: store.root, backupRoot: path.join(store.root, 'backups'), currentPlanHash: plan.planHash, options: { homeDir: home } }), /预览后发生变化/);
});
