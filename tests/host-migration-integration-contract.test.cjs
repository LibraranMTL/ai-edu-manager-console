const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'electron', 'host-migration-worker.cjs'), 'utf8');

test('host migration runs directory scanning and file transfer outside the Electron main thread', () => {
  assert.match(main, /new Worker\(path\.join\(__dirname, 'host-migration-worker\.cjs'\)\)/);
  assert.match(worker, /inspectMigrationSources/);
  assert.match(worker, /createMigrationPackage/);
  assert.match(worker, /restoreMigrationPackage/);
  assert.match(main, /host-migration:progress/);
  assert.match(preload, /onHostMigrationProgress/);
});

test('host migration IPC exposes plan, plain export, inspection and staged restore', () => {
  for (const channel of [
    'bridge:getHostMigrationPlan',
    'bridge:createHostMigrationPackage',
    'bridge:inspectHostMigrationPackage',
    'bridge:restoreHostMigrationPackage',
  ]) {
    assert.match(main, new RegExp(channel.replace(':', '\\:')));
    assert.match(preload, new RegExp(channel.replace(':', '\\:')));
  }
  assert.match(renderer, /分析迁移内容/);
  assert.match(renderer, /创建迁移包/);
  assert.doesNotMatch(renderer, /迁移包密码（至少 8 个字符）/);
  assert.match(renderer, /旧版加密迁移包密码/);
  assert.match(renderer, /选择并校验迁移包/);
  assert.match(renderer, /恢复到空白目录/);
  assert.match(main, /projectRecords: readProjects\(\)\.map\(normalizeProject\)/);
  assert.match(renderer, /result\.projectRecords/);
});

test('project migration state uses a consistent SQLite snapshot while restore still accepts legacy arrays', () => {
  const section = main.slice(main.indexOf('function migrationStateVirtualFiles'), main.indexOf('function migrationStateDirectorySources'));
  assert.match(section, /migration-projects\/project-state\.sqlite3/);
  assert.doesNotMatch(section, /\['projects\.json'/);
  assert.match(main, /const projects = Array\.isArray\(restoredLegacyProjects\) \? restoredLegacyProjects/);
  assert.match(main, /Array\.isArray\(restoredLegacyProjects\?\.projects\) \? restoredLegacyProjects\.projects : null/);
});

test('migration security separates machine identity and private credentials from portable data', () => {
  assert.match(main, /sanitizeMigrationSettings/);
  assert.match(main, /delete sanitized\.license/);
  assert.match(main, /delete sanitized\.apiToken/);
  assert.match(main, /固定主机身份/);
  assert.match(main, /协作直传密钥/);
  assert.match(renderer, /不会迁移/);
  assert.match(renderer, /新电脑需要重新激活并重新连接终端/);
  assert.doesNotMatch(main.slice(main.indexOf('function migrationStateVirtualFiles'), main.indexOf('function migrationStateDirectorySources')), /collaborationDirectSecretsPath/);
  assert.doesNotMatch(main.slice(main.indexOf('function migrationStateVirtualFiles'), main.indexOf('function migrationStateDirectorySources')), /hostIdentityPath/);
});

test('host migration carries a consistent SQLite asset snapshot instead of a full JSON index', () => {
  const section = main.slice(main.indexOf('function migrationStateVirtualFiles'), main.indexOf('function migrationStateDirectorySources'));
  assert.match(section, /migration-assets\/asset-index\.sqlite3/);
  assert.doesNotMatch(section, /asset-index\.json/);
  assert.match(main, /await assetStore\(\)\.backupTo\(snapshotPath\)/);
  assert.match(main, /assetStore\(\)\.importSnapshot\(sqliteSnapshot/);
});

test('complete migration includes every registered student directory and defaults project directories on', () => {
  assert.match(main, /student\.rawPath \|\| getRawDir/);
  assert.match(main, /student\.summaryPath \|\| getSummaryDir/);
  assert.match(main, /growthModelDirForStudent\(student\)/);
  assert.match(main, /educationArchiveVersionRoot\(student\)/);
  assert.match(main, /item\.required \|\| selected\.has\(item\.id\)/);
  assert.match(main, /project\.projectRootPath/);
  assert.match(main, /project\.workspacePath/);
  assert.match(main, /project\.knowledgeRootPath/);
  assert.match(renderer, /setHostMigrationExternalIds\(\(result\.externalSources \|\| \[\]\)\.map/);
  assert.match(renderer, /disabled=\{Boolean\(source\.required\)\}/);
  assert.match(renderer, /把\$\{source\.label\}复制进迁移包/);
});
