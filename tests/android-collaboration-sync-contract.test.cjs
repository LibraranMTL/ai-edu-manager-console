const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (value) => fs.readFileSync(path.join(root, value), 'utf8');

test('P3 Android actively pulls and pushes through the authenticated Windows direct channel', () => {
  const sync = read('android-standalone-manager/app/src/main/java/com/qxmatrix/edumanager/standalone/CollaborationSyncService.kt');
  const worker = read('android-standalone-manager/app/src/main/java/com/qxmatrix/edumanager/standalone/CollaborationWorker.kt');
  const main = read('electron/main.cjs');

  assert.match(sync, /CollaborationDirectProtocol\.requestSignature/);
  assert.match(sync, /\/api\/collaboration\/direct\/packages/);
  assert.match(sync, /\/api\/collaboration\/android\/pull/);
  assert.match(sync, /X-Edu-Chunk-Sha256/);
  assert.match(sync, /student_archive_publication/);
  assert.match(sync, /student_archive_asset_revision/);
  assert.match(sync, /entries\.chunked\(MAX_PUBLICATION_ENTRIES\)/);
  assert.match(sync, /MAX_PUBLICATION_ENTRIES = 999/);
  assert.match(sync, /MAX_FILES_PER_SCOPE = 20_000/);
  assert.match(sync, /CollaborationSyncPolicy\.MAX_FILES_PER_SCOPE \+ 1/);
  assert.match(sync, /jsonRequest\(endpoint, "GET", path, map\.transportBindingId/);
  assert.doesNotMatch(sync, /jsonRequest\([^\n]+device\.transportBindingId/);
  assert.match(worker, /SYNC_STUDENT_ARCHIVE/);
  assert.match(main, /handleCollaborationAndroidPullNext/);
  assert.match(main, /handleCollaborationAndroidPullChunk/);
  assert.match(main, /handleCollaborationAndroidPullAck/);
  assert.match(main, /item\.transportBindingIds\?\.includes\(auth\.binding\.bindingId\)/);
  assert.match(main, /assertDirectStudentArchiveManifestScope\(auth, files\)/);
  assert.match(main, /assertDirectStudentArchiveContentScope\(auth, manifest, packageRoot\)/);
  assert.match(main, /publication\.lineageId !== expectedLineage/);
  assert.doesNotMatch(sync, /ServerSocket|HttpServer\.create/);
});

test('P4-R Android manual sync is foreground and large SAF files stream sequentially', () => {
  const sync = read('android-standalone-manager/app/src/main/java/com/qxmatrix/edumanager/standalone/CollaborationSyncService.kt');
  const worker = read('android-standalone-manager/app/src/main/java/com/qxmatrix/edumanager/standalone/CollaborationWorker.kt');
  const repository = read('android-standalone-manager/app/src/main/java/com/qxmatrix/edumanager/standalone/CollaborationRepository.kt');
  const manifest = read('android-standalone-manager/app/src/main/AndroidManifest.xml');

  assert.match(repository, /scheduleRecovery\(appContext, foreground = true\)/);
  assert.match(worker, /setForeground\(foregroundInfo\(\)\)/);
  assert.match(worker, /FOREGROUND_SERVICE_TYPE_DATA_SYNC/);
  assert.match(manifest, /androidx\.work\.impl\.foreground\.SystemForegroundService/);
  assert.match(manifest, /android:foregroundServiceType="dataSync"/);
  assert.match(worker, /nextQueueAttemptAt\(\)/);
  assert.match(worker, /scheduleFollowUp/);
  assert.match(sync, /store\.openInputStream\(payload\.workspacePath\)\.use/);
  assert.match(sync, /CollaborationStreamPolicy\.skipFully\(input, offset\)/);
  assert.match(sync, /CollaborationStreamPolicy\.readExactly\(input, length\)/);
  assert.doesNotMatch(sync, /readWorkspaceChunk/);
});

test('P3 direct delivery separates exact-student authorization from device routing', () => {
  const main = read('electron/main.cjs');

  assert.match(main, /function collaborationAuthBindingForPackage\(manifest, packageRoot\)/);
  assert.match(main, /selectStudentArchiveAuthorizationBinding\(state\.bindings/);
  assert.match(main, /const authBinding = collaborationAuthBindingForPackage\(manifest, published\.packageRoot\)/);
  assert.match(main, /const routeBinding = collaborationBindingForPeer\(manifest\.targetNodeId\)/);
  assert.match(main, /const authBinding = collaborationAuthBindingForPackage\(manifest, record\.packageRoot\)[\s\S]*?binding\.bindingId === record\.bindingId/);
  assert.match(main, /auth: \{ bindingId: authBinding\.bindingId, nodeId: manifest\.sourceNodeId, secret \}/);
  assert.match(main, /collaborationDirectTargets\(routeBinding, record\.targetNodeId\)/);
});

test('P3 Android keeps exact-student SAF isolation and never synchronizes raw materials', () => {
  const sync = read('android-standalone-manager/app/src/main/java/com/qxmatrix/edumanager/standalone/CollaborationSyncService.kt');
  const repository = read('android-standalone-manager/app/src/main/java/com/qxmatrix/edumanager/standalone/CollaborationRepository.kt');

  assert.match(sync, /publication\.optString\("targetStudentId"\) == student\.id/);
  assert.match(sync, /publication\.optString\("sourceStudentId"\) == map\.peerStudentId/);
  assert.match(sync, /mapping\.treeUri == student\.storageRootUri/);
  assert.match(sync, /confirmed_knowledge/);
  assert.match(sync, /growth_model/);
  assert.match(sync, /learning_report/);
  assert.match(sync, /education_archive/);
  assert.doesNotMatch(sync, /student\.paths\.rawPath/);
  assert.match(repository, /students\.requireExact/);
});

test('P3 Android checkpoints materialization and preserves concurrent or deleted files', () => {
  const sync = read('android-standalone-manager/app/src/main/java/com/qxmatrix/edumanager/standalone/CollaborationSyncService.kt');
  const database = read('android-standalone-manager/app/src/main/java/com/qxmatrix/edumanager/standalone/CollaborationDatabase.kt');

  assert.match(database, /collaboration_package_checkpoints/);
  assert.match(database, /MIGRATION_1_2/);
  assert.match(database, /MIGRATION_2_3/);
  assert.match(database, /MIGRATION_3_4/);
  assert.match(database, /collaboration_file_inventory/);
  assert.match(database, /version = 4/);
  assert.match(sync, /status = "materialized"/);
  assert.match(sync, /status = "acknowledged"/);
  assert.match(sync, /协作冲突/);
  assert.match(sync, /协作回收站/);
  assert.match(sync, /remote_delete_local_modified/);
  assert.match(sync, /concurrent_revision/);
  assert.match(sync, /!entry\.optBoolean\("tombstone"\)/);
  assert.match(sync, /conflict-\$\{CollaborationCrypto\.sha256/);
});

test('P4-R Room v4 schema persists the incremental collaboration inventory', () => {
  const schema = JSON.parse(read(
    'android-standalone-manager/app/schemas/com.qxmatrix.edumanager.standalone.CollaborationDatabase/4.json',
  ));
  const tables = new Map(schema.database.entities.map((entity) => [entity.tableName, entity]));
  const inventory = tables.get('collaboration_file_inventory');

  assert.equal(schema.database.version, 4);
  assert.ok(inventory, 'Room v4 must export the collaboration file inventory table');
  assert.deepEqual(inventory.primaryKey.columnNames, ['localStudentId', 'kind', 'relativePath']);
  assert.ok(inventory.fields.some((field) => field.columnName === 'verifiedAtMillis'));
  assert.ok(inventory.fields.some((field) => field.columnName === 'contentSha256'));
});
