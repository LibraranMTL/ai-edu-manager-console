const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repo = path.resolve(__dirname, '..');
const root = path.join(repo, 'android-standalone-manager', 'app', 'src', 'main', 'java', 'com', 'qxmatrix', 'edumanager', 'standalone');
const backup = fs.readFileSync(path.join(root, 'BackupRestoreService.kt'), 'utf8');
const activity = fs.readFileSync(path.join(root, 'MainActivity.kt'), 'utf8');
const gradle = fs.readFileSync(path.join(repo, 'android-standalone-manager', 'app', 'build.gradle.kts'), 'utf8');
const windows = fs.readFileSync(path.join(repo, 'electron', 'host-migration.cjs'), 'utf8');
const releaseScript = fs.readFileSync(path.join(repo, 'android-standalone-manager', 'sign-release.ps1'), 'utf8');
const physicalVerificationScript = fs.readFileSync(path.join(repo, 'android-standalone-manager', 'verify-physical-device.ps1'), 'utf8');

test('W10 uses the authoritative Windows migration package and manifest schemas', () => {
  for (const schema of ['edu-manager.migration-package.v1', 'edu-manager.migration-manifest.v1']) {
    assert.match(windows, new RegExp(schema.replaceAll('.', '\\.')));
    assert.match(backup, new RegExp(schema.replaceAll('.', '\\.')));
  }
  assert.match(backup, /edu-manager\.migration-report\.v1/);
});

test('W10 encrypts each payload with scrypt and AES-256-GCM and excludes secrets', () => {
  assert.match(backup, /SCrypt\.generate/);
  assert.match(backup, /16384, 8, 1, 32/);
  assert.match(backup, /AES\/GCM\/NoPadding/);
  assert.match(backup, /storedSha256/);
  assert.match(backup, /authTag/);
  for (const excluded of ['agent-api-token', 'android-keystore-key', 'media-projection-grant', 'old-saf-grants']) assert.match(backup, new RegExp(excluded));
  assert.doesNotMatch(backup, /preferences.*local_agent|credential.*put/);
});

test('W10 verifies before activation, restores only to an empty tree and remaps old SAF roots', () => {
  assert.match(backup, /target\.listFiles\(\)\.isEmpty\(\)/);
  assert.match(backup, /暂存空间不足[\s\S]*110%/);
  assert.match(backup, /for \(index in 0 until entries\.length\(\)\) decryptEntry[\s\S]*remapStagedState[\s\S]*restoreManagedFiles/);
  assert.match(backup, /storageRootUri.*targetUri/s);
  assert.match(backup, /projectRootUri.*targetUri/s);
  assert.match(backup, /migrated-external/);
  assert.match(backup, /snapshotPrivateState/);
  assert.match(backup, /restorePrivateSnapshot/);
});

test('W10 refuses to write a migration package inside any source tree', () => {
  assert.match(backup, /requireDestinationOutsideManagedRoots/);
  assert.match(backup, /DocumentsContract\.getDocumentId/);
  assert.match(backup, /cleanupFailedDestination/);
  assert.match(backup, /DocumentsContract\.deleteDocument/);
  assert.match(backup, /DocumentFile\.fromTreeUri[\s\S]*findFile[\s\S]*target\.delete\(\)/);
  assert.match(backup, /迁移包不能保存在正在备份的资料根目录内/);
  assert.match(activity, /请保存到下载目录、U 盘或其他独立位置/);
});

test('W10 UI requires explicit export/restore choices and never persists the password', () => {
  assert.match(activity, /ACTION_CREATE_DOCUMENT/);
  assert.match(activity, /ACTION_OPEN_DOCUMENT/);
  assert.match(activity, /至少 8 个字符/);
  assert.match(activity, /密码不会写入备份、日志或设置/);
  assert.match(activity, /pendingBackupPassword\?\.fill/);
  assert.match(activity, /pendingRestorePassword\?\.fill/);
  assert.doesNotMatch(activity, /putString\([^\n]*password|writeBytes[^\n]*password/i);
  assert.match(activity, /private fun showProgress/);
  assert.match(activity, /progress\.dismiss\(\)/);
  assert.doesNotMatch(activity, /showMessage\("正在校验课程包/);
  assert.doesNotMatch(activity, /showMessage\("备份正在进行/);
});

test('W10 release signing accepts credentials only through the process environment', () => {
  for (const name of ['EDU_ANDROID_KEYSTORE', 'EDU_ANDROID_KEYSTORE_PASSWORD', 'EDU_ANDROID_KEY_ALIAS', 'EDU_ANDROID_KEY_PASSWORD']) assert.match(gradle, new RegExp(name));
  assert.match(gradle, /releaseSigningReady/);
  assert.doesNotMatch(gradle, /storePassword\s*=\s*"|keyPassword\s*=\s*"/);
});

test('W10 formal release pipeline rejects debug or repository-owned keys and verifies the final APK', () => {
  for (const name of ['EDU_ANDROID_KEYSTORE', 'EDU_ANDROID_KEYSTORE_PASSWORD', 'EDU_ANDROID_KEY_ALIAS', 'EDU_ANDROID_KEY_PASSWORD']) {
    assert.match(releaseScript, new RegExp(name));
  }
  assert.match(releaseScript, /keystorePath\.StartsWith\(\$repositoryPrefix/);
  assert.match(releaseScript, /Android Debug/);
  assert.match(releaseScript, /apksigner verify --verbose --print-certs --print-certs-pem/);
  assert.match(releaseScript, /X509Certificate2/);
  assert.match(releaseScript, /edu-android-release-/);
  assert.match(releaseScript, /Copy-Item -LiteralPath \$builtApk -Destination \$verificationApk/);
  assert.match(releaseScript, /aapt dump badging \$verificationApk/);
  assert.match(releaseScript, /APK Signature Scheme v2\\\): true/);
  assert.match(releaseScript, /com\.qxmatrix\.edumanager\.standalone/);
  assert.match(releaseScript, /\[IO\.FileMode\]::CreateNew/);
  assert.match(releaseScript, /\$sourceStream\.CopyTo\(\$destinationStream\)/);
  assert.match(releaseScript, /\$destinationStream\.Flush\(\$true\)/);
  assert.match(releaseScript, /Get-FileHash -LiteralPath \$finalPath -Algorithm SHA256[\s\S]{0,500}\[IO\.File\]::Delete\(\$stagedPath\)/);
  assert.doesNotMatch(releaseScript, /Copy-Item -LiteralPath \$stagedPath -Destination \$finalPath -Force/);
  assert.match(releaseScript, /正式发布目标已存在，请先提升版本号/);
  assert.match(releaseScript, /\[string\]\$OutputDirectory/);
  assert.match(releaseScript, /\[string\]\$CandidateTag/);
  assert.match(releaseScript, /releaseStatus = if/);
  assert.match(releaseScript, /edu-manager\.android-release\.v1/);
  assert.match(releaseScript, /Get-FileHash -LiteralPath \$finalPath -Algorithm SHA256/);
  assert.match(releaseScript, /verify-physical-device\.ps1/);
  assert.match(releaseScript, /PhysicalChecklist/);
  assert.doesNotMatch(releaseScript, /storePassword\s*=|keyPassword\s*=|password\s*:\s*['"]/i);
});

test('W10 final acceptance requires a product-signed APK and a physical tablet', () => {
  assert.match(physicalVerificationScript, /apksigner verify --verbose --print-certs/);
  assert.match(physicalVerificationScript, /Android Debug certificate detected/);
  assert.match(physicalVerificationScript, /ro\.kernel\.qemu/);
  assert.match(physicalVerificationScript, /\^emulator-/);
  assert.match(physicalVerificationScript, /final household-tablet acceptance requires a physical device/);
  assert.match(physicalVerificationScript, /install', '-r'/);
  assert.match(physicalVerificationScript, /am', 'start', '-W', '-S'/);
  assert.match(physicalVerificationScript, /installedVersionName -ne \$expectedVersionName/);
  assert.match(physicalVerificationScript, /edu-manager\.android-physical-acceptance\.v1/);
  assert.match(physicalVerificationScript, /automated-ready-manual-pending/);
  for (const gate of ['student-workspace', 'file-asset-ocr', 'project-knowledge', 'course-learning', 'screen-capture', 'backup-restore', 'reboot-persistence']) {
    assert.match(physicalVerificationScript, new RegExp(gate));
  }
  assert.doesNotMatch(physicalVerificationScript, /overall\s*=\s*'passed'/);
});

test('P4 physical acceptance has an explicit knowledge collaboration profile', () => {
  assert.match(physicalVerificationScript, /\[switch\]\$KnowledgeCollaboration/);
  assert.match(physicalVerificationScript, /Knowledge collaboration acceptance requires Android standalone 1\.1\.3 or newer/);
  assert.match(physicalVerificationScript, /CollaborationActivity/);
  assert.match(physicalVerificationScript, /CollaborationNearbyService/);
  assert.match(physicalVerificationScript, /CollaborationDatabase/);
  assert.match(physicalVerificationScript, /CollaborationRecoveryWorker/);
  assert.match(physicalVerificationScript, /knowledge-collaboration-p5/);
  for (const gate of [
    'collaboration-pairing-three-paths',
    'collaboration-exact-student-map',
    'collaboration-scope-isolation',
    'collaboration-large-inventory',
    'collaboration-large-file-resume',
    'collaboration-foreground-recovery',
    'collaboration-conflict-delete',
    'collaboration-lan-tailscale',
    'collaboration-student-terminal-regression',
    'collaboration-android-nearby-receiver',
    'collaboration-android-wifi-hotspot',
    'collaboration-android-pairing-guard',
    'collaboration-android-reverse-sync',
    'collaboration-android-staging-guard',
  ]) {
    assert.match(physicalVerificationScript, new RegExp(gate));
  }
});
