const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'android-standalone-manager', 'app', 'src', 'main');
const java = path.join(root, 'java', 'com', 'qxmatrix', 'edumanager', 'standalone');
const read = (name) => fs.readFileSync(path.join(java, name), 'utf8');

test('standalone projects keep legacy defaults but new projects opt into the unified workspace registry', () => {
  const models = read('ProjectModels.kt');
  assert.match(models, /materialStorageMode: String = "legacy"/);
  assert.match(models, /materialMigrationState: String = "not_started"/);
  assert.match(models, /materialStorageMode = "workspace-v1"/);
  assert.match(models, /materialMigrationState = "complete"/);
  assert.match(models, /inboxRelativePath", "收件箱"/);
});

test('standalone material authority uses SAF paths, stable versions and bounded availability scans', () => {
  const service = read('LocalProjectMaterialService.kt');
  const store = read('SafWorkspaceStore.kt');
  assert.match(service, /edu-manager\.android-project-materials\.v1|LocalProjectMaterialPolicy\.SCHEMA/);
  assert.match(service, /materialId/);
  assert.match(service, /versions/);
  assert.match(service, /readFrozenVersionBytes/);
  assert.match(service, /完整扫描未在登记位置发现原件/);
  assert.match(service, /MAX_SCAN_FILES/);
  assert.match(store, /writeStreamNewSafely/);
  assert.match(store, /目标文件已存在，未覆盖/);
  assert.doesNotMatch(service, /java\.io\.File\([^)]*relativePath/);
});

test('standalone material UI exposes four distinct views and keeps contribution confirmation separate', () => {
  const activity = read('ProjectMaterialsActivity.kt');
  const manifest = fs.readFileSync(path.join(root, 'AndroidManifest.xml'), 'utf8');
  for (const view of ['materials', 'pending', 'knowledge', 'contributions']) {
    assert.match(activity, new RegExp(`"${view}"`));
  }
  assert.match(activity, /项目资料中心/);
  assert.match(activity, /正式贡献仍须绑定固定资料版本/);
  assert.match(manifest, /ProjectMaterialsActivity/);
});

test('project digestion is persistent, resource constrained and consumes immutable snapshots', () => {
  const queue = read('ProjectDigestQueue.kt');
  const digest = read('LocalProjectDigestService.kt');
  assert.match(queue, /project-digest-queue\.json/);
  assert.match(queue, /frozenMaterials/);
  assert.match(queue, /BackgroundWorkPolicy\.remoteConstraints/);
  const policy = read('BackgroundWorkPolicy.kt');
  assert.match(policy, /setRequiresStorageNotLow\(true\)/);
  assert.match(policy, /setRequiresBatteryNotLow\(true\)/);
  assert.match(policy, /NetworkType\.CONNECTED/);
  assert.match(queue, /resumePending/);
  assert.match(digest, /readFrozenVersionBytes/);
  assert.match(digest, /只提炼项目知识，不直接形成学生能力或贡献结论/);
});

test('standalone organization and migration fail closed and support explicit recovery', () => {
  const policy = read('LocalProjectMaterialPolicy.kt');
  const service = read('LocalProjectMaterialService.kt');
  assert.match(policy, /preserve_external/);
  assert.match(policy, /preserve_dependency/);
  assert.match(policy, /preserve_conflict/);
  assert.match(service, /migration-backups/);
  assert.match(service, /recoverMigration/);
  assert.match(service, /rollbackLatestMigration/);
  assert.match(service, /迁移后目标已变化，不能回滚/);
  assert.match(service, /目标已有同名文件/);
});

test('project package exchange is explicit, hash protected and remaps URIs and student identities', () => {
  const transfer = read('StandaloneProjectPackageService.kt');
  const main = read('MainActivity.kt');
  const activity = read('ProjectMaterialsActivity.kt');
  assert.match(transfer, /edu-manager\.android-project-package\.v1/);
  assert.match(transfer, /manifest\.sha256/);
  assert.match(transfer, /retain-project-and-material-identities-remap-saf-and-students/);
  assert.match(transfer, /projectRootUri = destinationRootUri\.toString\(\)/);
  assert.match(transfer, /相同项目 ID 已在其他目录中存在/);
  assert.match(transfer, /导入目标存在异字节文件，已停止且未覆盖/);
  assert.match(main, /导入项目包/);
  assert.match(activity, /导出显式项目包/);
  assert.doesNotMatch(transfer, /Socket|HttpURLConnection|WorkManager/);
});
