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
  assert.equal(publicManifest.standaloneVersionCode, 26);
  assert.equal(publicManifest.standaloneVersionName, '1.2.2');
  assert.equal(publicManifest.standaloneApkUrl, 'https://www.greatbg.com/download/AI-Education-Manager-Android-Standalone-1.2.2-release.apk');
  assert.equal(publicManifest.standaloneSha256, 'A430636A6A1395507EE711D1A0FA99902F1BD174B49BA0945F053C9231DFC8DB');
});
