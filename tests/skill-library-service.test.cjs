'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSkillLibraryService } = require('../electron/skill-library-service.cjs');

function createSkill(root, name) {
  const target = path.join(root, name); fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'SKILL.md'), `---\nname: ${name}\ndescription: service integration fixture\n---\nbody\n`);
  return target;
}

test('service keeps renderer path authority opaque and blocks QClaw install', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-skill-service-store-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-skill-service-home-'));
  createSkill(path.join(home, '.qclaw', 'skills'), 'q-only');
  const service = createSkillLibraryService({ userDataDir: userData, homeDir: home });
  const scan = await service.action('scanSources', { providerIds: ['qclaw'] });
  assert.equal(scan.status, 'completed');
  const candidate = scan.scans[0].candidates[0];
  const archived = await service.action('archiveDiscovered', { discoveryIds: [candidate.discoveryId] });
  assert.equal(archived.results[0].sourceUnchanged, true);
  const artifact = service.store.listArtifacts({})[0];
  await assert.rejects(service.action('previewInstall', { artifactId: artifact.artifactId, versionId: artifact.currentVersionId, providerId: 'qclaw', targetPath: path.join(home, 'escape') }), /不能安装/);
  assert.equal(service.snapshot().scope, 'host');
  assert.equal(service.snapshot().mcpEnabled, false);
});

test('directory import accepts one Skill or a folder of direct Skill children and reports every outcome', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-skill-import-store-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-skill-import-home-'));
  const single = createSkill(home, 'single-skill');
  const batch = path.join(home, 'batch'); fs.mkdirSync(batch);
  createSkill(batch, 'batch-one'); createSkill(batch, 'batch-two'); fs.mkdirSync(path.join(batch, 'not-a-skill'));
  let selected = single;
  const service = createSkillLibraryService({ userDataDir: userData, homeDir: home, dialog: { async showOpenDialog() { return { filePaths: [selected] }; } } });
  let choice = await service.action('chooseImportDirectory');
  let result = await service.action('importDirectory', { selectionId: choice.selectionId });
  assert.equal(result.mode, 'single'); assert.equal(result.counts.archived, 1); assert.equal(result.total, 1);
  selected = batch; choice = await service.action('chooseImportDirectory');
  result = await service.action('importDirectory', { selectionId: choice.selectionId });
  assert.equal(result.mode, 'batch'); assert.equal(result.counts.archived, 2); assert.equal(result.total, 2);
  choice = await service.action('chooseImportDirectory');
  result = await service.action('importDirectory', { selectionId: choice.selectionId });
  assert.equal(result.counts.duplicate, 2);
  assert.equal(service.store.listArtifacts({}).length, 3);
  const removed = service.store.listArtifacts({}).find(item => item.identity.name === 'single-skill');
  const deletion = await service.action('deleteArtifact', { artifactId: removed.artifactId, currentVersionId: removed.currentVersionId });
  assert.equal(deletion.deleted, true);
  assert.equal(service.store.listArtifacts({}).some(item => item.artifactId === removed.artifactId), false);
});

test('manual install actions disclose only a validated archive path and export a separate copy', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-skill-manual-store-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-skill-manual-home-'));
  const exportRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-skill-manual-export-'));
  let copied = '', opened = '';
  const service = createSkillLibraryService({
    userDataDir: userData, homeDir: home,
    clipboard: { writeText(value) { copied = value; } },
    shell: { async openPath(value) { opened = value; return ''; } },
    dialog: { async showOpenDialog() { return { filePaths: [exportRoot] }; } },
  });
  const archived = await service.store.archiveDirectory(createSkill(home, 'manual-service'), { sourceType: 'local_directory', sourceUri: 'manual-service-fixture' });
  const identity = { artifactId: archived.artifact.artifactId, versionId: archived.version.versionId };

  const info = await service.action('manualInstallInfo', identity);
  assert.equal(info.readOnlyArchive, true);
  await service.action('copyManualInstallPath', identity);
  await service.action('openManualInstallPath', identity);
  assert.equal(copied, info.archivePath);
  assert.equal(opened, info.archivePath);

  const choice = await service.action('chooseManualExportRoot');
  const result = await service.action('exportManualInstallCopy', { ...identity, selectionId: choice.selectionId });
  assert.ok(fs.existsSync(path.join(result.exportPath, 'SKILL.md')));
  assert.notEqual(result.exportPath, info.archivePath);
});
