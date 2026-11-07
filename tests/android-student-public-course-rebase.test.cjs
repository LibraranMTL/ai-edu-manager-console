const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('Android student public-course candidate preserves the 0.6.27 F0 feature baseline', () => {
  const source = read('android-tablet-terminal/src/com/qxmatrix/eduterminal/MainActivity.java');
  const build = read('android-tablet-terminal/build.ps1');

  for (const marker of [
    'ConversationDraftStore',
    'MarkdownReadOnlyDialog',
    'chooseProjectComprehensiveReport',
    'openWeeklyKnowledgeGrowth',
    'showLearningStatusDialog',
  ]) {
    assert.match(source, new RegExp(marker), `missing latest 0.6.27 feature marker: ${marker}`);
  }
  assert.match(build, /ConversationDraftStore\.java/);
  assert.match(build, /MarkdownReadOnlyDialog\.java/);
});

test('Android student public-course candidate adds isolated projection trust and open-time revalidation', () => {
  const source = read('android-tablet-terminal/src/com/qxmatrix/eduterminal/MainActivity.java');
  for (const marker of [
    'COURSE_PROJECTION_PREFIX',
    'COURSE_ETAG_PREFIX',
    'TRUSTED_COURSE_PUBLISHER_KEYS',
    'fetchCourseProjection',
    'validateCourseProjectionTrust',
    'If-None-Match',
    'revalidateAndOpenCourse',
    'leaseValid',
  ]) {
    assert.match(source, new RegExp(marker), `missing public-course marker: ${marker}`);
  }
  assert.match(source, /return "https"\.equalsIgnoreCase\(uri\.getScheme\(\)\)/);
  assert.doesNotMatch(source, /return \("https"\.equalsIgnoreCase\(uri\.getScheme\(\)\) \|\| "http"/);
});

test('Android student candidate increments version and enforces the existing upgrade certificate', () => {
  const manifest = read('android-tablet-terminal/AndroidManifest.xml');
  const source = read('android-tablet-terminal/src/com/qxmatrix/eduterminal/MainActivity.java');
  const build = read('android-tablet-terminal/build.ps1');

  assert.match(manifest, /android:versionCode="98"/);
  assert.match(manifest, /android:versionName="0\.6\.28"/);
  assert.match(source, /VERSION_NAME = "0\.6\.28"/);
  assert.match(source, /VERSION_CODE = 98/);
  assert.match(build, /42FF27472C21FD214C17A9DFB153DA0454489D4E2AD70CE823F3369118A5F1CB/);
  assert.match(build, /EDU_ANDROID_STUDENT_KEYSTORE/);
  assert.match(build, /EDU_ANDROID_STUDENT_CANDIDATE_TAG/);
  assert.doesNotMatch(build, /keytool -genkeypair/);
});
