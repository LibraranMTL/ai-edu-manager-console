const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repo = path.resolve(__dirname, '..');
const base = path.join(repo, 'android-standalone-manager', 'app', 'src', 'main');
const sourceRoot = path.join(base, 'java', 'com', 'qxmatrix', 'edumanager', 'standalone');
const read = (name) => fs.readFileSync(path.join(sourceRoot, name), 'utf8');
const catalog = read('CourseCatalogService.kt');
const learning = read('CourseLearningActivity.kt');
const capture = read('CourseCaptureService.kt');
const repository = read('CourseCaptureRepository.kt');
const activity = read('MainActivity.kt');
const manifest = fs.readFileSync(path.join(base, 'AndroidManifest.xml'), 'utf8');

test('W9 consumes signed platform packages and exact-student offline platform plus tenant snapshots', () => {
  assert.match(catalog, /ProtocolBaseline\.COURSE_PACKAGE_SCHEMA/);
  assert.match(catalog, /courses\/last-good\.json/);
  assert.match(catalog, /较旧课程目录不能覆盖最后可用版本/);
  assert.match(catalog, /platform_standard/);
  assert.match(catalog, /platform:/);
  assert.match(catalog, /课程包文件清单与归档内容不一致/);
  assert.match(catalog, /课程目录校验值不匹配/);
  assert.match(catalog, /CourseCatalogCanonicalJson\.canonicalize/);
  assert.match(catalog, /joinToString\(separator = ","/);
  assert.match(catalog, /catalogNullableText\(value, "expiresAt"\)/);
  assert.doesNotMatch(catalog, /JSONObject\.quote/);
  assert.match(catalog, /平台课程封面路径无效/);
  assert.match(catalog, /课程包缺少平台课程封面/);
  assert.match(catalog, /平台课程封面哈希与文件名不一致/);
  assert.match(catalog, /requiredText\(value, "legalNotice"\)/);
  assert.match(catalog, /validateCatalog\(catalog, setOf\("platform_standard"\)\)/);
  assert.match(catalog, /OFFLINE_SNAPSHOT_SCHEMA/);
  assert.match(catalog, /tenant_custom/);
  assert.match(activity, /机构课程/);
  assert.doesNotMatch(activity, /课程管理中心|编辑课程/);
});

test('W9 course learning uses an isolated restricted WebView without native bridges', () => {
  assert.match(learning, /safeBrowsingEnabled = true/);
  assert.match(learning, /allowFileAccess = false/);
  assert.match(learning, /allowContentAccess = false/);
  assert.match(learning, /MIXED_CONTENT_NEVER_ALLOW/);
  assert.match(learning, /request\?\.deny\(\)/);
  assert.match(learning, /onReceivedSslError[\s\S]*handler\?\.cancel\(\)/);
  assert.match(learning, /setDownloadListener/);
  assert.match(learning, /shouldInterceptRequest/);
  assert.doesNotMatch(learning, /addJavascriptInterface/);
});

test('W9 capture is user initiated MediaProjection foreground work bound to one exact student', () => {
  assert.match(learning, /setOnClickListener \{ handleCapturePrimary\(\) \}/);
  assert.match(learning, /createScreenCaptureIntent/);
  assert.match(learning, /REQUEST_SCREEN_CAPTURE/);
  assert.match(capture, /getMediaProjection/);
  assert.match(capture, /FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION/);
  assert.match(capture, /StudentIndexRepository\(this\)\.requireExact\(studentId\)/);
  assert.match(capture, /SafWorkspaceStore\(this, Uri\.parse\(rootUri\)\)/);
  assert.match(capture, /课程采集/);
  assert.match(capture, /CAPTURE_PROTOCOL_VERSION/);
  assert.match(repository, /ProtocolBaseline\.COURSE_CAPTURE_SCHEMA/);
  assert.match(repository, /student_raw_library/);
});

test('W9 manifest declares only explicit MediaProjection foreground permissions', () => {
  assert.match(manifest, /FOREGROUND_SERVICE_MEDIA_PROJECTION/);
  assert.match(manifest, /POST_NOTIFICATIONS/);
  assert.match(manifest, /foregroundServiceType="mediaProjection"/);
  assert.doesNotMatch(manifest, /MANAGE_EXTERNAL_STORAGE|QUERY_ALL_PACKAGES/);
});
