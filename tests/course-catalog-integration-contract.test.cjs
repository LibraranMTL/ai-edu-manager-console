const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('Windows host and student terminal expose scoped course catalog contracts', () => {
  const host = read('electron', 'main.cjs');
  const hostUi = read('src', 'main.tsx');
  const terminal = read('electron', 'terminal-main.cjs');
  const browser = read('electron', 'course-browser.cjs');

  assert.match(host, /requireStudentAccess\(request, response, studentId\)/);
  assert.match(host, /coursesForStudent\(student\)/);
  assert.match(host, /courseUploadAttribution\(url, student\)/);
  assert.match(host, /canImportCustomCourses\(license\)/);
  assert.match(host, /importCustomCoursesFromExcel/);
  assert.match(host, /CUSTOM_COURSE_IMPORT_PLAN_REQUIRED/);
  assert.match(host, /COURSE_MANAGEMENT_PLAN_REQUIRED/);
  assert.match(host, /function courseManagementRequiredJson/);
  assert.match(host, /function saveCourseInstitutionPolicy\(policyJson\) \{\s*const locked = courseManagementRequiredJson\(\)/);
  assert.match(host, /function importOfflineCourseCatalog\(\) \{\s*const locked = courseManagementRequiredJson\(\)/);
  assert.match(host, /async function exportCustomCourseTemplate\(\) \{\s*const locked = courseManagementRequiredJson\(\)/);
  assert.match(host, /\.filter\(courseAllowedByCurrentPlan\)/);
  assert.match(host, /当前授权不能使用机构自选课程/);
  assert.match(hostUi, /type CourseSubmenu = 'learning' \| 'management'/);
  assert.match(hostUi, /edu-manager-course-submenu/);
  assert.match(hostUi, />课程学习<\/span>/);
  assert.match(hostUi, />课程管理<\/span>/);
  assert.match(hostUi, /courseSubmenu === 'learning'/);
  assert.match(hostUi, /courseSubmenu === 'management'/);
  assert.match(hostUi, /courseManagementAllowed = !isWindows \|\| Boolean\([\s\S]*\['PRO', 'ORG'\]\.includes/);
  assert.match(hostUi, /disabled=\{!courseManagementAllowed\}/);
  assert.match(hostUi, /课程管理仅向已激活的专业版和机构版开放/);
  assert.match(terminal, /\/api\/students\/\$\{encodeURIComponent\(studentId\)\}\/courses/);
  assert.match(terminal, /String\(payload\.studentId \|\| ''\) !== studentId/);
  assert.match(browser, /nodeIntegration: false/);
  assert.match(browser, /contextIsolation: true/);
  assert.match(browser, /sandbox: true/);
  assert.match(browser, /setPermissionRequestHandler/);
  assert.match(browser, /COURSE_DOWNLOAD_BLOCKED/);
});

test('Android course WebView denies native capabilities and keeps capture user initiated', () => {
  const activity = read('android-tablet-terminal', 'src', 'com', 'qxmatrix', 'eduterminal', 'MainActivity.java');
  const capture = read('android-tablet-terminal', 'src', 'com', 'qxmatrix', 'eduterminal', 'CaptureProjectionService.java');

  assert.match(activity, /setSafeBrowsingEnabled\(true\)/);
  assert.match(activity, /setAllowFileAccess\(false\)/);
  assert.match(activity, /setAllowContentAccess\(false\)/);
  assert.match(activity, /setMixedContentMode\(WebSettings\.MIXED_CONTENT_NEVER_ALLOW\)/);
  assert.match(activity, /request\.deny\(\)/);
  assert.doesNotMatch(activity, /addJavascriptInterface/);
  assert.match(activity, /"https"\.equalsIgnoreCase\(uri\.getScheme\(\)\)/);
  assert.match(activity, /courseCaptureButton\.setText\(active/);
  assert.match(activity, /handleCapturePrimary\(\)/);
  assert.match(activity, /REQUEST_SCREEN_CAPTURE/);
  assert.match(activity, /copyParams = phoneLayout[\s\S]{0,180}MATCH_PARENT, LinearLayout\.LayoutParams\.WRAP_CONTENT/);
  assert.match(capture, /KEY_COURSE_ID/);
  assert.match(capture, /metadata\.put\("courseUrl", courseUrl\)/);
  assert.match(capture, /courseCompletedAt = courseId\.length\(\) == 0 \? 0L : endedAt/);
});

test('first-party release payload includes both covers and the signed catalog', () => {
  for (const relativePath of [
    ['public', 'course-catalog', 'catalog.json'],
    ['public', 'course-catalog', 'public-key.pem'],
    ['public', 'catalog-assets', 'starfall-k5-math.png'],
    ['public', 'catalog-assets', 'codeorg-k12-computing.png'],
  ]) {
    const filePath = path.join(root, ...relativePath);
    assert.equal(fs.existsSync(filePath), true, `${relativePath.join('/')} is missing`);
    assert.ok(fs.statSync(filePath).size > 0, `${relativePath.join('/')} is empty`);
  }
});
