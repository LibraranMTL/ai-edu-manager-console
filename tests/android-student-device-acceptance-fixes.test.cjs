const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const activity = read('android-tablet-terminal/src/com/qxmatrix/eduterminal/MainActivity.java');
const learning = read('android-shared/src/com/qxmatrix/terminallearning/TerminalLearningDialog.java');
const host = read('electron/main.cjs');

test('unbound personal terminals keep exact-ID and QR controls visible until the host binds a student', () => {
  assert.match(host, /requiresStudentBinding: terminalMode === 'personal' && !boundStudentId/u);
  assert.match(activity, /boolean canEnterStudent = !active && \("shared"\.equals\(terminalMode\) \|\| personalRequiresBinding\)/u);
  assert.match(activity, /device\.optBoolean\("requiresStudentBinding"/u);
  assert.match(activity, /请输入本人学生 ID 或扫码完成首次绑定/u);
  assert.match(host, /terminalMode === 'personal' && !devices\[index\]\.boundStudentId/u);
});

test('a saved host connection is restored on cold start so a bound personal terminal auto-enters', () => {
  assert.match(activity, /if \(normalizedBaseUrl\(\)\.length\(\) > 0 && apiToken\(\)\.length\(\) > 0\) \{\s*connectAndLoadStudents\(\);/);
  assert.match(activity, /postJson\(base \+ "\/api\/student-session\/auto", new JSONObject\(\), deviceToken\)/);
  const sessionUi = activity.slice(activity.indexOf('void updateStudentSessionUi()'), activity.indexOf('void chooseAutoDeliveryFolder()'));
  assert.match(sessionUi, /updateConversationImportUi\(\)/);
});

test('transport failure and stale bootstrap responses preserve the current student session', () => {
  const bootstrap = activity.slice(activity.indexOf('class BootstrapStudentSessionTask'), activity.indexOf('class StudentLoginTask'));
  assert.match(bootstrap, /if \(error instanceof java\.io\.IOException\) throw error/);
  assert.match(bootstrap, /transportFailure = error instanceof java\.io\.IOException/);
  assert.match(bootstrap, /主机暂不可连接，学生会话和待上传资料已保留/);
  assert.match(bootstrap, /isCurrentBootstrapSession\(existingSessionToken\)/);
  assert.match(bootstrap, /BootstrapSessionApplyTask/);
  assert.match(activity, /expectedToken\.equals\(dataToken\(\)\) && expectedToken\.equals\(savedToken\)/);
});

test('the back-to-top affordance stays above portrait bottom navigation', () => {
  assert.match(activity, /topParams\.setMargins\(0, 0, dp\(20\), dp\(isWideLandscape\(\) \? 20 : 88\)\)/);
});

test('an expired bound personal session renews once with device authorization and preserves student scope', () => {
  assert.match(activity, /renewPersonalStudentSessionAfterUnauthorized\(urlText, token, error\)/u);
  assert.match(activity, /postJsonOnce\(base \+ "\/api\/student-session\/auto", new JSONObject\(\), deviceToken\)/u);
  assert.match(activity, /boolean studentScopedRoute = path\.startsWith\("\/api\/students\/"\)/u);
  assert.match(activity, /!"\/api\/student-session\/auto"\.equals\(path\)/u);
  assert.match(activity, /if \(!studentScopedRoute\) return null/u);
  assert.match(activity, /expectedStudentId\.length\(\) > 0 && !expectedStudentId\.equals\(renewedStudentId\)/u);
  assert.match(activity, /主机返回的学生与当前学生空间不一致，已停止读取/u);
  assert.match(activity, /if \(!"personal"\.equals\(terminalMode\)\) return null/u);
  assert.match(activity, /return getJsonOnce\(urlText, renewedToken\)/u);
  assert.match(activity, /return postJsonOnce\(urlText, body, renewedToken\)/u);
});

test('learning reports and growth details use read-only dialogs instead of the hidden archive card', () => {
  assert.match(activity, /void applyLearningReport\(/u);
  assert.match(activity, /showReadOnlyDetailDialog\(title, metadata, body\)/u);
  assert.match(activity, /new LearningReportResultTask/u);
  assert.match(activity, /showReadOnlyDetailDialog\("成长模型"/u);
  assert.match(activity, /点击“查看成长模型”阅读详情/u);
});

test('archive requests are generation scoped and each file carries its own source identity', () => {
  assert.match(activity, /long archiveRequestGeneration/u);
  assert.match(activity, /requestGeneration != archiveRequestGeneration \|\| showingProjectKnowledge/u);
  assert.match(activity, /new ArchiveFile\(item, "project", studentId, project\.id\)/u);
  assert.match(activity, /"project"\.equals\(file\.sourceType\)/u);
  assert.match(activity, /refreshProjectKnowledgeAfterConflict/u);
  assert.match(host, /PROJECT_ARCHIVE_CHANGED/u);
  assert.match(host, /sendJson\(response, error\.code === 'PROJECT_ARCHIVE_CHANGED' \? 409 : 400/u);
});

test('structured planning is capability gated and rendered from host sections only', () => {
  assert.match(host, /planningSections: true/u);
  assert.match(learning, /capabilities\.optBoolean\("planningSections"\)/u);
  assert.match(learning, /当前主机尚未提供结构化规划栏目；请先更新主机端/u);
  const planning = host.slice(host.indexOf('function handleTerminalPlanning'), host.indexOf('async function handleTerminalPlanningFavorites'));
  for (const section of ['pathways', 'majors', 'careers']) assert.match(planning, new RegExp(section));
});

test('Android student release matches the signed application and preserves other current releases', () => {
  const manifest = read('android-tablet-terminal/AndroidManifest.xml');
  const build = read('android-tablet-terminal/build.ps1');
  const formal = read('release/edu-manager-version.json');
  assert.match(manifest, /android:versionCode="104"/u);
  assert.match(manifest, /android:versionName="0\.6\.34"/u);
  assert.match(build, /\$versionName = '0\.6\.34'/u);
  assert.match(build, /AI-edu-manager-tablet-terminal-\$versionName\.apk/u);
  assert.match(formal, /"tabletTerminalVersionCode": 104/u);
  assert.match(formal, /"tabletTerminalVersionName": "0\.6\.34"/u);
  assert.match(formal, /AI-edu-manager-tablet-terminal-0\.6\.34\.apk/u);
  assert.match(formal, /"teacherTerminalVersionName": "0\.1\.5"/u);
  assert.match(formal, /"windowsVersionName": "0\.23\.8"/u);
  assert.match(formal, /"windowsTerminalVersionName": "0\.18\.10"/u);
  assert.match(formal, /"standaloneVersionName": "1\.3\.7"/u);
});

test('Android student refreshes its scoped v2 course projection every sixty seconds', () => {
  assert.match(activity, /COURSE_PROJECTION_PREFIX = "course_projection_v2_trust1_"/u);
  assert.match(activity, /courseRefreshHandler\.postDelayed\(courseRefreshRunnable, 60_000L\)/u);
  assert.match(activity, /courseRefreshHandler\.removeCallbacks\(courseRefreshRunnable\)/u);
  assert.match(activity, /\/api\/v2\/students\//u);
});

test('Android student release build fails closed without its existing upgrade certificate', () => {
  const build = read('android-tablet-terminal/build.ps1');
  assert.match(build, /EDU_ANDROID_STUDENT_KEYSTORE/u);
  assert.match(build, /EDU_ANDROID_STUDENT_KEYSTORE_PASSWORD/u);
  assert.match(build, /42FF27472C21FD214C17A9DFB153DA0454489D4E2AD70CE823F3369118A5F1CB/u);
  assert.doesNotMatch(build, /-genkeypair/u);
});
