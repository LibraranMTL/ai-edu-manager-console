'use strict';

// Run with Electron against the actual ASAR, not source modules or a mocked IPC.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

function writeZip(file, name, text) {
  const filename = Buffer.from(name), data = Buffer.from(text);
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  crc = (crc ^ 0xffffffff) >>> 0;
  const local = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(filename.length, 28);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + filename.length, 12); end.writeUInt32LE(local.length + filename.length + data.length, 16);
  fs.writeFileSync(file, Buffer.concat([local, filename, data, central, filename, end]));
}

async function verify(runtimeDir, fixtureRoot, liveHome) {
  const { SkillLibraryService } = require(path.join(runtimeDir, 'skill-library-service.cjs'));
  const { extractSkillArchive } = require(path.join(runtimeDir, 'skill-archive-extractor.cjs'));
  const homeDir = path.join(fixtureRoot, 'home');
  const manifest = '---\nname: packaged-runtime-test\ndescription: Synthetic packaged runtime verification.\n---\nOnly return fixture text.\n';
  for (const profile of ['.codex', '.codebuddy', '.qclaw']) {
    const skill = path.join(homeDir, profile, 'skills', 'packaged-runtime-test');
    fs.mkdirSync(skill, { recursive: true });
    fs.writeFileSync(path.join(skill, 'SKILL.md'), manifest);
  }
  const service = new SkillLibraryService({ userDataDir: path.join(fixtureRoot, 'user-data'), homeDir, codexHome: path.join(homeDir, '.codex') });
  assert.equal(service.snapshot().scope, 'host');
  const result = await service.scanSources({});
  assert.equal(result.status, 'completed');
  assert.equal(result.scans.length, 3);
  for (const scan of result.scans) {
    assert.equal(scan.candidates.length, 1, `${scan.providerId} worker discovery`);
    assert.equal(scan.candidates[0].inspectionStatus, 'ready_to_archive');
  }
  const zip = path.join(fixtureRoot, 'fixture.zip');
  writeZip(zip, 'packaged-runtime-test/SKILL.md', manifest);
  const extracted = await extractSkillArchive(zip, path.join(fixtureRoot, 'zip-staging'));
  assert.equal(fs.readFileSync(path.join(extracted.contentRoot, 'SKILL.md'), 'utf8'), manifest);
  writeZip(zip, '../escape.md', 'must not escape');
  await assert.rejects(extractSkillArchive(zip, path.join(fixtureRoot, 'unsafe-staging')));
  assert.equal(fs.existsSync(path.join(fixtureRoot, 'escape.md')), false);
  const customRoot = path.join(fixtureRoot, '自定义 Skill 存档'); fs.mkdirSync(customRoot);
  const originalRoot = service.store.root;
  const archived = await service.store.archiveDirectory(path.join(homeDir, '.codex/skills/packaged-runtime-test'), { sourceType: 'local_directory', sourceUri: 'fixture' });
  service.options.dialog = { async showOpenDialog() { return { canceled: false, filePaths: [customRoot] }; } };
  const choice = await service.action('chooseArchiveRoot');
  const mkdirSync = fs.mkdirSync;
  fs.mkdirSync = function(target, ...args) {
    if (path.resolve(target) === path.resolve(fixtureRoot)) throw Object.assign(Error('existing drive-like parent must not be created'), { code: 'EPERM' });
    return mkdirSync.call(fs, target, ...args);
  };
  try { await service.action('migrateArchiveRoot', { selectionId: choice.selectionId }); }
  finally { fs.mkdirSync = mkdirSync; }
  assert.equal(service.snapshot().library.rootPath, customRoot);
  const reopened = new SkillLibraryService({ userDataDir: path.join(fixtureRoot, 'user-data'), homeDir });
  assert.equal(reopened.store.root, customRoot);
  assert.equal(reopened.store.readArtifact(archived.artifact.artifactId).versions.length, 1);
  reopened.store.writeReceipt('scans', { receiptId: 'after-migration', createdAt: new Date().toISOString() });
  assert.ok(fs.existsSync(path.join(customRoot, 'receipts/scans/after-migration.json')));
  assert.equal(fs.existsSync(path.join(originalRoot, 'receipts/scans/after-migration.json')), false);
  let liveScan;
  if (liveHome) {
    const live = new SkillLibraryService({ userDataDir: path.join(fixtureRoot, 'live-readonly-user-data'), homeDir: liveHome, codexHome: process.env.CODEX_HOME || path.join(liveHome, '.codex') });
    const scanned = await live.scanSources({});
    assert.equal(scanned.status, 'completed');
    liveScan = scanned.scans.map(scan => ({ providerId: scan.providerId, candidates: scan.candidates.length, statuses: scan.candidates.reduce((counts, item) => { const status = item.inspectionStatus; counts[status] = (counts[status] || 0) + 1; return counts; }, {}) }));
  }
  return { schema: 'edu-manager.skill-packaged-runtime-verification.v1', verifiedAt: new Date().toISOString(), runtimeDir, fixtureRoot, electron: process.versions.electron || null,
    snapshotPassed: true, workerScanPassed: true, zipExtractPassed: true, zipTraversalBlocked: true,
    customRootMigrationPassed: true, driveRootParentMkdirAvoided: true, customRootRestartPassed: true, customRootNewWritesPassed: true,
    syntheticScans: result.scans.map(scan => ({ providerId: scan.providerId, candidates: scan.candidates.length })), liveScan,
    sourceAccess: 'read-only; all receipts and fixture writes isolated', licenseAndRendererTested: false };
}

module.exports = { verify, writeZip };
const entryIndex = process.argv.findIndex(arg => path.resolve(arg) === __filename);
if (require.main === module || (process.versions.electron && entryIndex > 0)) {
  const [runtimeDir, reportFile, liveHome] = process.argv.slice(entryIndex + 1);
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-skill-package-'));
  let app;
  if (process.versions.electron && !process.env.ELECTRON_RUN_AS_NODE) {
    app = require('electron').app;
    app.setPath('userData', path.join(fixtureRoot, 'electron-user-data'));
    app.disableHardwareAcceleration();
  }
  const watchdog = setTimeout(() => { console.error('Skills packaged runtime verification timed out'); if (app) app.exit(1); else process.exit(1); }, 90000);
  Promise.resolve(app?.whenReady()).then(() => verify(path.resolve(runtimeDir), fixtureRoot, liveHome)).then(report => {
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    clearTimeout(watchdog);
    if (app) app.exit(0);
  }).catch(error => {
    console.error(error.stack); clearTimeout(watchdog);
    if (app) app.exit(1); else process.exitCode = 1;
  });
}
