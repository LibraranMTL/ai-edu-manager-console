const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('Windows host and student terminal expose scoped course catalog contracts', () => {
  const host = read('electron', 'main.cjs');
  const hostUi = read('src', 'main.tsx');
  const preload = read('electron', 'preload.cjs');
  const terminal = read('electron', 'terminal-main.cjs');
  const browser = read('electron', 'course-browser.cjs');

  assert.match(host, /requireStudentAccess\(request, response, studentId\)/);
  assert.match(host, /coursesForStudent\(student\)/);
  assert.match(host, /courseUploadAttribution\(url, student\)/);
  assert.match(host, /canImportCustomCourses\(license\)/);
  assert.match(host, /importCustomCoursesFromExcel/);
  assert.match(host, /CUSTOM_COURSE_IMPORT_PLAN_REQUIRED/);
  assert.match(host, /CUSTOM_COURSE_DIRECT_UPLOAD_PLAN_REQUIRED/);
  assert.match(host, /COURSE_MANAGEMENT_PLAN_REQUIRED/);
  assert.match(host, /function courseManagementRequiredJson/);
  assert.match(host, /function saveCourseInstitutionPolicy\(policyJson\) \{\s*const locked = courseManagementRequiredJson\(\)/);
  assert.match(host, /function importOfflineCourseCatalog\(\) \{\s*const locked = courseManagementRequiredJson\(\)/);
  assert.match(host, /async function exportCustomCourseTemplate\(\) \{\s*const locked = courseManagementRequiredJson\(\)/);
  assert.match(host, /async function selectCustomCourseImage\(\) \{\s*const locked = courseManagementRequiredJson\('CUSTOM_COURSE_DIRECT_UPLOAD_PLAN_REQUIRED'\)/);
  assert.match(host, /async function saveDirectCustomCourse\(inputJson\) \{\s*const locked = courseManagementRequiredJson\('CUSTOM_COURSE_DIRECT_UPLOAD_PLAN_REQUIRED'\)/);
  assert.match(host, /pendingCustomCourseImages\.get\(imageToken\)/);
  assert.match(host, /imageEntry\?\.path \|\| existingImagePath/);
  assert.doesNotMatch(host, /imagePath:\s*input\.imagePath/);
  assert.match(host, /tenant_custom_direct_save/);
  assert.match(host, /tenant_custom_direct_edit/);
  assert.match(host, /tenant_custom_course_deleted/);
  assert.match(host, /function deleteCustomCourse/);
  assert.match(host, /function queuePlatformCourseDeletion/);
  assert.match(host, /deletedCourseIds/);
  assert.match(host, /CUSTOM_COURSE_EDIT_TARGET_INVALID/);
  assert.match(host, /课程 ID、启用状态和学生分配保持不变/);
  assert.match(host, /ipcMain\.handle\('bridge:selectCustomCourseImage'/);
  assert.match(host, /ipcMain\.handle\('bridge:saveDirectCustomCourse'/);
  assert.match(host, /platformCourseCapabilityRequiredJson\('platform_course_edit'/);
  assert.match(host, /platformCourseCapabilityRequiredJson\('platform_course_publish'/);
  assert.match(host, /platformCourseCapabilityRequiredJson\('platform_course_rollback'/);
  assert.match(host, /createCoursePackage/);
  assert.match(host, /importCoursePackage/);
  assert.doesNotMatch(host, /COURSE_CATALOG_PRIVATE_KEY/);
  assert.match(host, /ipcMain\.on\('bridge:publishPlatformCourseCatalog'/);
  assert.match(host, /ipcMain\.on\('bridge:reExportPlatformCourseCatalog'/);
  assert.match(host, /ipcMain\.on\('bridge:rollbackPlatformCourseCatalog'/);
  assert.match(preload, /selectCustomCourseImage\(\)/);
  assert.match(preload, /saveDirectCustomCourse\(inputJson\)/);
  assert.match(preload, /deleteCustomCourse\(courseId\)/);
  assert.match(preload, /queuePlatformCourseDeletion\(courseId\)/);
  assert.match(preload, /cancelPlatformCourseDeletion\(courseId\)/);
  assert.doesNotMatch(preload, /getPlatformPublishPreview\(\)/);
  assert.match(preload, /publishPlatformCourseCatalog\(releaseNotes\)/);
  assert.match(preload, /reExportPlatformCourseCatalog\(\)/);
  assert.match(preload, /rollbackPlatformCourseCatalog\(\)/);
  assert.match(host, /\.filter\(courseAllowedByCurrentPlan\)/);
  assert.match(host, /当前授权不能使用机构自选课程/);
  assert.match(hostUi, /type CourseSubmenu = 'learning' \| 'management'/);
  assert.match(hostUi, /edu-manager-course-submenu/);
  assert.match(hostUi, /'nav\.courses\.learning': '课程学习'/);
  assert.match(hostUi, /'nav\.courses\.management': '课程管理'/);
  assert.match(hostUi, />\{t\('nav\.courses\.learning'\)\}<\/span>/);
  assert.match(hostUi, />\{t\('nav\.courses\.management'\)\}<\/span>/);
  assert.match(hostUi, /courseSubmenu === 'learning'/);
  assert.match(hostUi, /courseSubmenu === 'management'/);
  assert.match(hostUi, /courseManagementAllowed = !isWindows \|\| Boolean\([\s\S]*licenseCapability\('tenant_course_manage'\)/);
  assert.match(hostUi, /platformCourseEditAllowed = !isWindows \|\| licenseCapability\('platform_course_edit'\)/);
  assert.match(hostUi, /platformCoursePublishAllowed = !isWindows \|\| licenseCapability\('platform_course_publish'\)/);
  assert.match(hostUi, /publishPlatformCourseCatalog/);
  assert.match(hostUi, /生成\/导出平台课程包/);
  assert.match(hostUi, /重新导出当前版本/);
  assert.match(hostUi, /只有平台版可以生成或导出平台课程包/);
  assert.match(hostUi, /disabled=\{!courseManagementAllowed\}/);
  assert.match(hostUi, /专业版、机构版和平台版/);
  assert.match(hostUi, /新增一门机构精选课程/);
  assert.match(hostUi, />课程名称</);
  assert.match(hostUi, />课程简介</);
  assert.match(hostUi, />课程链接</);
  assert.match(hostUi, /上传课程图片/);
  assert.match(hostUi, /保存课程/);
  assert.match(hostUi, /function directCourseUrlIssue/);
  assert.match(hostUi, /course-direct-feedback/);
  assert.match(hostUi, /aria-live="polite"/);
  assert.match(hostUi, /课程链接不能包含空格/);
  assert.match(hostUi, /编辑机构精选课程/);
  assert.match(hostUi, />\s*<Pencil size=\{17\} \/>编辑课程\s*</);
  assert.match(hostUi, /保存修改/);
  assert.match(hostUi, /删除课程/);
  assert.match(hostUi, /删除平台课程/);
  assert.match(hostUi, /待发布删除/);
  assert.match(hostUi, /平台精选课程由平台版维护/);
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
  assert.match(activity, /"https"\.equalsIgnoreCase\(uri\.getScheme\(\)\)[\s\S]*"http"\.equalsIgnoreCase\(uri\.getScheme\(\)\)/);
  assert.match(activity, /courseCaptureButton\.setText\(active/);
  assert.match(activity, /handleCapturePrimary\(\)/);
  assert.match(activity, /REQUEST_SCREEN_CAPTURE/);
  assert.match(activity, /copyParams = phoneLayout[\s\S]{0,180}MATCH_PARENT, LinearLayout\.LayoutParams\.WRAP_CONTENT/);
  assert.match(capture, /KEY_COURSE_ID/);
  assert.match(capture, /metadata\.put\("courseUrl", courseUrl\)/);
  assert.match(capture, /courseCompletedAt = courseId\.length\(\) == 0 \? 0L : endedAt/);
});

test('first-party release payload includes both covers and the integrity catalog', () => {
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
