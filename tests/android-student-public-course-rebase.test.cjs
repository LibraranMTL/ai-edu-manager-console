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

test('Android student dashboard candidate increments version and enforces the existing upgrade certificate', () => {
  const manifest = read('android-tablet-terminal/AndroidManifest.xml');
  const source = read('android-tablet-terminal/src/com/qxmatrix/eduterminal/MainActivity.java');
  const build = read('android-tablet-terminal/build.ps1');

  assert.match(manifest, /android:versionCode="102"/);
  assert.match(manifest, /android:versionName="0\.6\.32"/);
  assert.match(source, /VERSION_NAME = "0\.6\.32"/);
  assert.match(source, /VERSION_CODE = 102/);
  assert.match(build, /42FF27472C21FD214C17A9DFB153DA0454489D4E2AD70CE823F3369118A5F1CB/);
  assert.match(build, /EDU_ANDROID_STUDENT_KEYSTORE/);
  assert.match(build, /EDU_ANDROID_STUDENT_CANDIDATE_TAG/);
  assert.doesNotMatch(build, /keytool -genkeypair/);
});

test('student dashboard composes existing session-scoped data without requiring a new host endpoint', () => {
  const source = read('android-tablet-terminal/src/com/qxmatrix/eduterminal/MainActivity.java');
  for (const marker of [
    '今天最值得推进的一件事', '本周行动', '重点项目', '五维学情', '最近7天资料统计图',
    'refreshLearningWorkbenchHome', 'dashboardWorkbenchActions', 'dashboardWorkbenchDimensions', 'showWeeklyStatsEmptyDialog',
    '/api/student-session/learning-state', '/api/student-session/learning-status', '/api/student-session/me',
    '/api/student-session/knowledge-growth/weeks', '/api/student-session/knowledge-growth/',
    'readHostWeeklyMaterialImage', 'showWeeklyStatsReadErrorDialog',
    'showProjectMentorDialog', 'showLearningMentorDialog', '项目管理', '学习导师',
  ]) assert.match(source, new RegExp(marker));
  assert.match(source, /archivePage\.addView\(collapsiblePanel\("知识点跟踪"/);
  assert.match(source, /projectPage\.addView\(collapsiblePanel\("项目资料与知识"/);
  assert.match(source, /projectPage\.addView\(collapsiblePanel\("项目综合报告"/);
  assert.match(source, /learningActionPage\.addView\(collapsiblePanel\("学习导师"/);
  assert.doesNotMatch(source, /\/api\/student-session\/learning-workbench/);
  assert.match(source, /主机已经生成的当前学生完整七日资料统计 PNG/);
  assert.match(source, /学生端不会用空泛模板替代真实任务/);
  assert.match(source, /进入项目管理核对资料、综合报告和下一步任务/);
  assert.match(source.slice(source.indexOf('void refreshLearningWorkbenchHome'), source.indexOf('String dashboardPriorityFromStatus')), /readHostWeeklyMaterialImage/);
  assert.doesNotMatch(source, /studentSessionMaterialStats/);
  assert.doesNotMatch(source, /createWeeklyMaterialChart/);
  assert.match(source, /点击上方“复制正文”/);
  assert.match(source, /String\[\]\[\] projectMentorActions\(\)/);
  assert.match(source, /String\[\]\[\] learningMentorActions\(\)/);
});
