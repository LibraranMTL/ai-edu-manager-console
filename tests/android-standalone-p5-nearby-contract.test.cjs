const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const android = path.join(root, 'android-standalone-manager');
const java = path.join(android, 'app', 'src', 'main', 'java', 'com', 'qxmatrix', 'edumanager', 'standalone');
const read = (value) => fs.readFileSync(value, 'utf8');

test('P5 registers an explicit user-started Android nearby foreground receiver', () => {
  const manifest = read(path.join(android, 'app', 'src', 'main', 'AndroidManifest.xml'));
  const service = read(path.join(java, 'CollaborationNearbyService.kt'));
  assert.match(manifest, /android:name="\.CollaborationNearbyService"/);
  assert.match(manifest, /android:foregroundServiceType="dataSync"/);
  assert.match(service, /ACTION_START/);
  assert.match(service, /ACTION_STOP/);
  assert.match(service, /START_NOT_STICKY/);
  assert.match(service, /setOngoing\(true\)/);
  assert.match(service, /附近知识协作/);
});

test('P5 Android peers discover one another over LAN or hotspot without Bluetooth', () => {
  const service = read(path.join(java, 'CollaborationNearbyService.kt'));
  const client = read(path.join(java, 'CollaborationNetworkClient.kt'));
  const state = read(path.join(java, 'CollaborationNearbyState.kt'));
  assert.match(service, /AI_EDU_MANAGER_DISCOVERY/);
  assert.match(service, /put\("role", "standalone"\)/);
  assert.match(service, /DatagramSocket/);
  assert.match(client, /put\("searchRole", "all"\)/);
  assert.match(client, /setOf\("host", "standalone"\)/);
  assert.match(state, /HTTP_PORT = 18779/);
  assert.match(state, /DISCOVERY_PORT = 18778/);
  assert.doesNotMatch(service, /BLUETOOTH|Bluetooth/);
});

test('P5 pairing and student mapping remain exact, signed and human-confirmed', () => {
  const protocol = read(path.join(java, 'CollaborationPairingProtocol.kt'));
  const activity = read(path.join(java, 'CollaborationActivity.kt'));
  assert.match(protocol, /createDeviceInvitation/);
  assert.match(protocol, /completeDevicePairing/);
  assert.match(protocol, /pairingCodeHash/);
  assert.match(protocol, /createStudentMappingOffer/);
  assert.match(protocol, /verifyStudentMappingAcceptance/);
  assert.match(protocol, /constantTimeEquals/);
  assert.match(activity, /必须人工核对学生；不会按姓名猜测/);
  assert.match(activity, /生成本机邀请二维码和六位码/);
  assert.match(activity, /CollaborationQrRenderer/);
});

test('P5 direct receiver enforces signed exact-student resumable transfer', () => {
  const receiver = read(path.join(java, 'CollaborationNearbyDirectReceiver.kt'));
  const database = read(path.join(java, 'CollaborationDatabase.kt'));
  assert.match(receiver, /CollaborationDirectProtocol\.requestSignature/);
  assert.match(receiver, /MAX_CLOCK_SKEW_MS/);
  assert.match(receiver, /consumeNonce\(bindingId, nonce/);
  assert.match(receiver, /x-edu-content-sha256/);
  assert.match(receiver, /descriptor\.optString\("studentId"\) == auth\.map\.localStudentId/);
  assert.match(receiver, /student_archive_publication/);
  assert.match(receiver, /student_archive_asset_revision/);
  assert.match(receiver, /MAX_FILE_BYTES = 64L \* 1024 \* 1024/);
  assert.match(receiver, /receivedBytes/);
  assert.match(receiver, /reverseSyncQueued/);
  assert.match(database, /activeStudentMapForTransport/);
});

test('P5-R limits pairing attempts and persists bounded replay protection', () => {
  const state = read(path.join(java, 'CollaborationNearbyState.kt'));
  const repository = read(path.join(java, 'CollaborationRepository.kt'));
  assert.match(state, /MAX_PAIRING_FAILURES = 5/);
  assert.match(state, /recordPairingFailure/);
  assert.match(state, /pairingCooldownMillis/);
  assert.match(state, /KEY_RECENT_NONCES/);
  assert.match(state, /MAX_RECENT_NONCES = 512/);
  assert.match(repository, /requirePairingAllowed/);
  assert.match(repository, /设备连接邀请因连续验证失败已自动作废/);
});

test('P5-R bounds and cleans interrupted inbound packages without touching governed output', () => {
  const state = read(path.join(java, 'CollaborationNearbyState.kt'));
  const receiver = read(path.join(java, 'CollaborationNearbyDirectReceiver.kt'));
  assert.match(state, /INBOUND_RETENTION_MS = 7L \* 24 \* 60 \* 60 \* 1000/);
  assert.match(state, /MAX_STAGING_BYTES = 4L \* 1024 \* 1024 \* 1024/);
  assert.match(state, /MIN_FREE_BYTES = 512L \* 1024 \* 1024/);
  assert.match(receiver, /cleanupStalePackages/);
  assert.match(receiver, /clearForDevice/);
  assert.match(receiver, /reservedPayloadBytes/);
  assert.match(receiver, /projectedAppendBytes/);
  assert.match(receiver, /AtomicFile/);
  assert.match(receiver, /session\.root\.deleteRecursively\(\)/);
});

test('P5-R reports actual receiver startup and reverse queue states', () => {
  const service = read(path.join(java, 'CollaborationNearbyService.kt'));
  const state = read(path.join(java, 'CollaborationNearbyState.kt'));
  const receiver = read(path.join(java, 'CollaborationNearbyDirectReceiver.kt'));
  assert.match(service, /setStartupError/);
  assert.match(state, /starting: Boolean/);
  assert.match(state, /lastError: String/);
  assert.match(receiver, /reverse_failed/);
  assert.match(receiver, /reverseStatus == "reverse_queued"/);
  assert.doesNotMatch(receiver, /reverseSyncQueued", true/);
});

test('P5-R keeps the user interface in exactly three collaboration sections', () => {
  const activity = read(path.join(java, 'CollaborationActivity.kt'));
  const repository = read(path.join(java, 'CollaborationRepository.kt'));
  const database = read(path.join(java, 'CollaborationDatabase.kt'));
  const sections = [...activity.matchAll(/sectionTitle\("([^"]+)"\)/g)].map((match) => match[1]);
  assert.deepEqual(sections, ['协作设备', '共享学生', '同步异常']);
  assert.match(activity, /添加协作设备/);
  assert.match(activity, /开启附近接收/);
  assert.match(activity, /POST_NOTIFICATIONS/);
  assert.match(activity, /changeStudentMapStatus/);
  assert.match(repository, /fun updateStudentMapStatus/);
  assert.match(database, /cancelQueueForStudentMap/);
  assert.match(database, /INNER JOIN collaboration_devices/);
  assert.doesNotMatch(activity, /sectionTitle\("附近 Android 单机版"\)/);
});

test('P5-R candidate preserves the optimized unencrypted directory migration baseline', () => {
  const migration = read(path.join(java, 'StandaloneDeviceMigrationService.kt'));
  const models = read(path.join(java, 'StandaloneDeviceMigrationModels.kt'));
  const build = read(path.join(android, 'app', 'build.gradle.kts'));
  assert.match(models, /edu-manager\.standalone-portable-folder\.v1/);
  assert.match(migration, /!descriptor\.optBoolean\("encrypted", true\)/);
  assert.match(migration, /MANIFEST_HASH_PATH/);
  assert.match(migration, /completedKeys/);
  assert.match(build, /versionName = "1\.2\.2"/);
  assert.match(build, /versionCode = 26/);
});

test('P5 keeps original materials and secrets outside the collaboration payload', () => {
  const sync = read(path.join(java, 'CollaborationSyncService.kt'));
  const receiver = read(path.join(java, 'CollaborationNearbyDirectReceiver.kt'));
  const security = read(path.join(java, 'CollaborationSecurity.kt'));
  assert.match(sync, /SYNC_KINDS = setOf\("confirmed_knowledge", "growth_model", "learning_report", "education_archive"\)/);
  assert.doesNotMatch(receiver, /rawPath|storageRootUri|treeUri|License|API Token/);
  assert.match(security, /CollaborationSecretCipher/);
  assert.match(security, /AndroidKeyStore/);
});

test('ordinary Android student terminal remains outside the knowledge-node protocol', () => {
  const studentRoot = path.join(root, 'android-tablet-terminal');
  const sources = [];
  const walk = (directory) => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (/\.(kt|java|xml)$/.test(entry.name)) sources.push(read(absolute));
    }
  };
  walk(studentRoot);
  assert.ok(sources.length > 0, 'student terminal sources must exist before checking protocol isolation');
  const combined = sources.join('\n');
  assert.doesNotMatch(combined, /CollaborationNearbyService|android-nearby-v1|student-map-offer/);
});

test('P5 physical acceptance checks the packaged receiver and Android-to-Android matrix', () => {
  const verifier = read(path.join(android, 'verify-physical-device.ps1'));
  assert.match(verifier, /CollaborationNearbyService/);
  assert.match(verifier, /knowledge-collaboration-p5/);
  for (const gate of [
    'collaboration-android-nearby-receiver',
    'collaboration-android-wifi-hotspot',
    'collaboration-android-pairing-guard',
    'collaboration-android-reverse-sync',
    'collaboration-android-staging-guard',
  ]) assert.match(verifier, new RegExp(gate));
});
