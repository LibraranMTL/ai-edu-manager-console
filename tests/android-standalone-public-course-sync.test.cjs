const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const service = read('android-standalone-manager/app/src/main/java/com/qxmatrix/edumanager/standalone/PublicCourseSyncService.kt');
const worker = read('android-standalone-manager/app/src/main/java/com/qxmatrix/edumanager/standalone/PublicCourseSyncWorker.kt');
const catalog = read('android-standalone-manager/app/src/main/java/com/qxmatrix/edumanager/standalone/CourseCatalogService.kt');
const learning = read('android-standalone-manager/app/src/main/java/com/qxmatrix/edumanager/standalone/CourseLearningActivity.kt');
const main = read('android-standalone-manager/app/src/main/java/com/qxmatrix/edumanager/standalone/MainActivity.kt');
const gradle = read('android-standalone-manager/app/build.gradle.kts');
const trustPolicy = JSON.parse(read('android-standalone-manager/app/src/main/res/raw/trusted_course_issuers.json'));

test('standalone cloud sync preserves the deployment prefix and accepts only signed HTTPS public content', () => {
  assert.match(service, /DEFAULT_BASE_URL: String = BuildConfig\.PUBLIC_CONTENT_BASE_URL/u);
  assert.match(gradle, /environmentVariable\("EDU_PUBLIC_CONTENT_BASE_URL"\)/u);
  assert.match(gradle, /orElse\("https:\/\/www\.greatbg\.com\/edu-cloud"\)/u);
  assert.match(gradle, /publicContentUri\.scheme == "https"/u);
  assert.match(service, /base\.scheme == "https"/u);
  assert.match(service, /"If-None-Match"/u);
  assert.match(service, /200 -> adoptManifest/u);
  assert.match(service, /304 -> verifiedActive/u);
  assert.match(service, /verifyCoursePublisherSignature/u);
  assert.match(service, /sniffImageMime\(bytes\) == asset\.getString\("mimeType"\)/u);
  assert.match(service, /SYNC_RECEIPTS_PATH = "v2\/public-content\/sync-receipts"/u);
  assert.match(service, /clientInstanceId[\s\S]*?UUID\.randomUUID/u);
  assert.match(service, /"clientType", "android_standalone"/u);
  assert.match(service, /runCatching \{ submitReceipt\(baseUrl, result, nowMillis\) \}/u);
  assert.match(service, /"publisherKeyId"/u);
  assert.match(service, /"trustPolicyRevision"/u);
  assert.match(catalog, /R\.raw\.trusted_course_issuers/u);
  assert.match(catalog, /status in acceptedStatuses/u);
  assert.deepEqual(trustPolicy.issuers.map(item => item.keyId), ['course-catalog-primary-2026', 'course-catalog-candidate-20261106']);
});

test('withdrawals are checked before active cache promotion and cloud cache fails closed', () => {
  const syncBody = service.slice(service.indexOf('fun sync('), service.indexOf('fun cloudCatalog'));
  assert.ok(syncBody.indexOf('syncRevocations(baseUrl, nowMillis)') < syncBody.indexOf('state.writeBytes(CLOUD_ACTIVE'));
  assert.match(service, /revokedCourseIds\(\)/u);
  assert.match(catalog, /if \(cloud\.hasCloudCache\(\)\) return cloud\.cloudCatalog\(\)/u);
  assert.match(catalog, /cloudManaged && studentSnapshot && course\.type == "platform_standard"/u);
  assert.match(catalog, /course\.coverAsset\.startsWith\("cloud-assets\/"\)/u);
});

test('foreground, background and open-time revocation checks are all wired', () => {
  assert.match(worker, /PeriodicWorkRequestBuilder<PublicCourseSyncWorker>\(15, TimeUnit\.MINUTES\)/u);
  assert.match(main, /PUBLIC_COURSE_SYNC_INTERVAL_MS = 60_000L/u);
  assert.match(main, /PublicCourseSyncWorker\.schedule\(this\)/u);
  assert.match(main, /同步云端课程/u);
  assert.match(learning, /courseValidationHandler\.postDelayed\(this, 60_000L\)/u);
  assert.match(learning, /课程已撤回、授权已变化或离线租约到期/u);
  assert.match(learning, /webView\.stopLoading\(\); webView\.loadUrl\("about:blank"\)/u);
});
