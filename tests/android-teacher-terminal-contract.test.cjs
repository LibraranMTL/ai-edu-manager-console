const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const host = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const teacherRoot = path.join(root, 'android-teacher-terminal');
const teacher = fs.readFileSync(path.join(teacherRoot, 'src', 'com', 'qxmatrix', 'eduteacher', 'MainActivity.java'), 'utf8');
const manifest = fs.readFileSync(path.join(teacherRoot, 'AndroidManifest.xml'), 'utf8');
const strings = fs.readFileSync(path.join(teacherRoot, 'res', 'values', 'strings.xml'), 'utf8');
const icon = fs.readFileSync(path.join(teacherRoot, 'res', 'drawable', 'brand_logo_teacher.xml'), 'utf8');
const build = fs.readFileSync(path.join(teacherRoot, 'build.ps1'), 'utf8');
const windowsBuild = fs.readFileSync(path.join(root, 'scripts', 'build-windows-release.cjs'), 'utf8');
const releaseManifest = fs.readFileSync(path.join(root, 'release', 'edu-manager-version.json'), 'utf8');

test('teacher terminal is an independently installable purple-red Android app', () => {
  assert.match(manifest, /package="com\.qxmatrix\.eduteacher"/);
  assert.match(manifest, /android:versionCode="2"/);
  assert.match(manifest, /android:versionName="0\.1\.1"/);
  assert.match(manifest, /android:icon="@drawable\/brand_logo_teacher"/);
  assert.match(strings, /AI教育管家教师端/);
  assert.match(icon, /#9D174D/);
  assert.match(build, /release\\teacher-terminal/);
  assert.match(build, /AI-edu-manager-teacher-terminal-0\.1\.1\.apk/);
  assert.doesNotMatch(build, /src\\com\\qxmatrix\\eduterminal/);
});

test('teacher pairing declares its role on every supported connection path', () => {
  assert.match(teacher, /capabilities\.put\("teacher-terminal-v1"\)/);
  assert.match(teacher, /json\.put\("deviceRole", "teacher"\)/);
  assert.match(teacher, /enrollBody\.put\("deviceRole", "teacher"\)/);
  assert.match(teacher, /body\.put\("deviceRole", "teacher"\)/);
  assert.match(teacher, /当前设备凭据属于学生终端/);
  assert.match(host, /function normalizeTerminalDeviceRole/);
  assert.match(host, /\.map\(String\)\.includes\('teacher-terminal-v1'\)/);
  assert.match(host, /deviceRole === 'teacher'/);
});

test('teacher device receives every student and every associated project', () => {
  assert.match(host, /function teacherTerminalStudentRecord/);
  assert.match(host, /const isTeacherTerminal = auth\.type === 'device' && auth\.deviceRole === 'teacher'/);
  assert.match(host, /\.map\(isTeacherTerminal \? teacherTerminalStudentRecord : terminalStudentRecord\)/);
  assert.match(host, /request\.authContext\.deviceRole === 'teacher'/);
  assert.match(teacher, /class TeacherBootstrapTask/);
  assert.match(teacher, /base \+ "\/api\/students"/);
  assert.match(teacher, /base \+ "\/api\/projects"/);
  assert.match(teacher, /authorization\.optString\("deviceRole"/);
});

test('teacher home exposes student search and omits student-only modules', () => {
  assert.match(teacher, /studentSearchInput = input\("输入姓名、学生 ID 或年级"\)/);
  assert.match(teacher, /void applyStudentFilter\(String query\)/);
  assert.match(teacher, /collapsiblePanel\("所有学生"/);
  const visibleTree = teacher.slice(teacher.indexOf('LinearLayout basicContent = stack()'), teacher.indexOf('setContentView(screen)'));
  assert.doesNotMatch(visibleTree, /courseCard/);
  assert.doesNotMatch(visibleTree, /contactCard/);
  assert.doesNotMatch(visibleTree, /agentDialogCard/);
  assert.doesNotMatch(visibleTree, /promptDialogCard/);
  assert.doesNotMatch(visibleTree, /精选课程/);
  assert.doesNotMatch(visibleTree, /教育管家对话/);
});

test('uploads target host raw libraries rather than student delivery', () => {
  assert.match(teacher, /\/api\/students\/" \+ activity\.encode\(target\.id\) \+ "\/materials/);
  assert.match(teacher, /\/api\/projects\/" \+ activity\.encode\(target\.id\) \+ "\/materials\?filename=/);
  assert.match(teacher, /studentId=" \+ activity\.encode\(target\.studentId\)/);
  assert.doesNotMatch(teacher, /read receipt|已读回执|通知学生/);
});

test('education archives and per-student/project caches remain enabled', () => {
  assert.match(teacher, /collapsiblePanel\("教育档案"/);
  assert.match(teacher, /\/reports"/);
  assert.match(teacher, /\/growth-summary"/);
  assert.match(teacher, /\/archive\/files"/);
  assert.match(teacher, /String cacheScope = studentId \+ "-project-" \+ projectId/);
  assert.match(teacher, /void cacheMarkdown\(String studentId/);
  assert.match(teacher, /readCachedArchiveFiles\(String studentId\)/);
});

test('student changes and archive navigation reject stale asynchronous results', () => {
  const filter = teacher.slice(teacher.indexOf('void applyStudentFilter'), teacher.indexOf('void applySelectedStudentState'));
  assert.match(filter, /applySelectedStudentState\(\)/);
  assert.match(teacher, /long archiveViewGeneration = 0L/);
  assert.match(teacher, /viewGeneration != activity\.archiveViewGeneration/);
  assert.match(teacher, /allArchiveFiles\.clear\(\);\s*archiveFiles\.clear\(\);\s*renderArchiveFileList\(\)/);
  assert.match(teacher, /if \(archiveFiles\.size\(\) > 0\) loadArchiveFile\(archiveFiles\.get\(0\)\)/);
  assert.match(teacher, /archiveCard\.setVisibility\(View\.VISIBLE\)/);
  assert.match(teacher, /getLocationInWindow\(targetLocation\)/);
});

test('teacher updates cannot fall back to a student APK channel', () => {
  assert.match(teacher, /teacherTerminalVersionCode/);
  assert.match(teacher, /teacherTerminalVersionName/);
  assert.match(teacher, /teacherTerminalUrl/);
  assert.match(teacher, /teacherTerminalNotes/);
  const updateTask = teacher.slice(teacher.indexOf('class TabletUpdateCheckTask'), teacher.indexOf('class DownloadApkTask'));
  assert.doesNotMatch(updateTask, /tabletTerminalUrl|androidUrl|apkUrl/);
});

test('Windows host release packages and advertises teacher-terminal support', () => {
  assert.match(windowsBuild, /teacher-terminal-v1/);
  assert.match(windowsBuild, /teacherTerminalStudentRecord/);
  assert.match(windowsBuild, /teacherTerminalSupport: true/);
  assert.match(releaseManifest, /"windowsVersionName": "0\.16\.8"/);
  assert.match(releaseManifest, /"teacherTerminalVersionName": "0\.1\.1"/);
  assert.match(releaseManifest, /AI-edu-manager-teacher-terminal-0\.1\.1\.apk/);
});
