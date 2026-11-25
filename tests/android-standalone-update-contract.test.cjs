const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'android-standalone-manager', 'app', 'src', 'main');
const java = path.join(root, 'java', 'com', 'qxmatrix', 'edumanager', 'standalone');
const main = fs.readFileSync(path.join(java, 'MainActivity.kt'), 'utf8');
const update = fs.readFileSync(path.join(java, 'AppUpdateService.kt'), 'utf8');
const manifest = fs.readFileSync(path.join(root, 'AndroidManifest.xml'), 'utf8');
const paths = fs.readFileSync(path.join(root, 'res', 'xml', 'file_paths.xml'), 'utf8');
const publicManifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'release', 'edu-manager-version.json'), 'utf8'));
const buildGradle = fs.readFileSync(path.join(__dirname, '..', 'android-standalone-manager', 'app', 'build.gradle.kts'), 'utf8');

test('Android standalone settings exposes its own version update action', () => {
  assert.match(main, /YouthAction\([^\n]*"检查版本更新"[\s\S]*checkForAppUpdate\(\)/);
  assert.match(main, /packageManager\.getPackageInfo\(packageName, 0\)/);
  assert.match(update, /standaloneVersionCode/);
  assert.match(update, /standaloneVersionName/);
  assert.match(update, /standaloneApkUrl/);
  assert.match(update, /standaloneSha256/);
});

test('Android standalone update download is bounded, hashed and restricted to official HTTPS', () => {
  assert.match(update, /MAX_APK_BYTES/);
  assert.match(update, /SHA-256 校验失败/);
  assert.match(update, /url\.protocol == "https"/);
  assert.match(update, /url\.host\.equals\("www\.greatbg\.com"/);
  assert.match(update, /url\.path\.startsWith\("\/download\/"\)/);
});

test('Android standalone update uses scoped FileProvider installation permission', () => {
  assert.match(manifest, /REQUEST_INSTALL_PACKAGES/);
  assert.doesNotMatch(manifest, /MANAGE_EXTERNAL_STORAGE|QUERY_ALL_PACKAGES/);
  assert.match(paths, /app_updates/);
  assert.match(main, /Settings\.ACTION_MANAGE_UNKNOWN_APP_SOURCES/);
  assert.match(main, /FileProvider\.getUriForFile/);
});

test('public update manifest publishes the current standalone release channel', () => {
  const sourceVersionCode = Number(buildGradle.match(/versionCode\s*=\s*(\d+)/)?.[1]);
  const sourceVersionName = buildGradle.match(/versionName\s*=\s*"([^"]+)"/)?.[1];
  const candidate = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'android-standalone-manager', 'candidate.json'), 'utf8'));
  assert.equal(candidate.versionCode, sourceVersionCode);
  assert.equal(candidate.versionName, sourceVersionName);
  assert.equal(candidate.releaseStatus, 'candidate');
  assert.ok(publicManifest.standaloneVersionCode <= sourceVersionCode, 'published channel cannot exceed source candidate');
  const publishedRecordPath = path.join(__dirname, '..', 'android-standalone-manager', 'delivery', `AI-Education-Manager-Android-Standalone-${publicManifest.standaloneVersionName}-release.json`);
  const publishedRecord = JSON.parse(fs.readFileSync(publishedRecordPath, 'utf8'));
  assert.equal(publishedRecord.releaseStatus, 'release');
  assert.equal(publishedRecord.versionCode, publicManifest.standaloneVersionCode);
  assert.equal(publishedRecord.sha256.toUpperCase(), publicManifest.standaloneSha256);
  const publicFileName = publishedRecord.publicFileName || publishedRecord.fileName;
  assert.ok([`AI-Education-Manager-Android-Standalone-${publicManifest.standaloneVersionName}.apk`, `AI-Education-Manager-Android-Standalone-${publicManifest.standaloneVersionName}-release.apk`].includes(publicFileName));
  assert.equal(publicManifest.standaloneApkUrl, `https://www.greatbg.com/download/${publicFileName}`);
  assert.match(publicManifest.standaloneSha256, /^[A-F0-9]{64}$/);
  assert.equal(publicManifest.managerApkReleaseStatus, 'internal');
  assert.equal(publicManifest.managerApkUrl, '');
});
