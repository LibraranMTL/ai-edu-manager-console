const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');

test('course window shows an explicit waiting capture strip before capture starts', () => {
  const strip = ui.indexOf('course-capture-start-strip');
  const waiting = ui.indexOf('待开始', strip);
  const start = ui.indexOf('开始采集', waiting);
  assert.ok(strip > 0 && waiting > strip && start > waiting);
  assert.match(ui.slice(strip, start + 100), />学生</);
  assert.match(ui.slice(strip, start + 100), />项目（可选）</);
  assert.match(ui.slice(strip, start + 100), />屏幕或窗口</);
  assert.match(ui, /打开课程不会自动采集/);
  assert.doesNotMatch(ui, /隔离 WebContentsView 已启用/);
  assert.match(css, /\.course-capture-start-strip[\s\S]*position: fixed/);
});

test('course capture is bound to the active course and switches to the existing floating controls', () => {
  assert.match(preload, /setCourseCaptureSetupVisible\(visible\)/);
  assert.match(preload, /onCaptureChanged\(callback\)/);
  assert.match(main, /bridge:setCourseCaptureSetupVisible/);
  assert.match(main, /courseCaptureSetupVisible = false;[\s\S]*courseView\.setBounds\(courseViewBounds\(\)\)/);
  assert.match(main, /courseCaptureSetupVisible = Boolean\(activeCourse\)/);
  assert.match(main, /function updateCaptureControlWindow\(\)/);
  assert.match(main, /quickCaptureWindow = new BrowserWindow/);
  assert.match(main, /String\(activeCourse\.courseId\) !== requestedCourseId/);
  assert.match(main, /courseId: course\?\.courseId \|\| ''/);
  assert.match(main, /courseProvider: runtime\.session\.courseProvider/);
  assert.match(main, /所选学习项目未绑定该学生或已封存/);
});

test('course receivers use version, hash and integrity without any trust import workflow', () => {
  const heroStart = ui.indexOf('course-catalog-hero');
  const heroEnd = ui.indexOf('course-capture-start-strip', heroStart);
  const primaryActions = ui.slice(heroStart, heroEnd);
  assert.doesNotMatch(primaryActions, /导入课程可信公钥/);
  assert.doesNotMatch(ui, /高级：离线目录信任/);
  assert.doesNotMatch(ui, /导入平台课程验证公钥包/);
  assert.doesNotMatch(preload, /importCourseTrustBundle/);
  assert.doesNotMatch(main, /bridge:importCourseTrustBundle/);
  assert.doesNotMatch(main, /trusted-course-keys\.json/);
  assert.match(ui, /课程包保留版本、文件哈希和完整性校验/);
});

test('native course view follows sidebar collapse and full-screen learning layout', () => {
  assert.match(preload, /setCourseViewLayout\(layoutJson\)/);
  assert.match(main, /bridge:setCourseViewLayout/);
  assert.match(main, /courseSidebarCollapsed \? 24 : 286/);
  assert.match(main, /mainWindow\.setFullScreen\(courseFullscreen\)/);
  assert.match(ui, /全屏学习/);
  assert.match(ui, /退出全屏（Esc）/);
  assert.match(ui, /setSidebarCollapsed\(next\)/);
  assert.match(main, /function exitCourseFullscreen/);
  assert.match(main, /before-input-event[\s\S]*handleCourseFullscreenEscape/);
  assert.match(main, /input\?\.key === 'Escape'/);
  assert.match(main, /sidebarCollapsed: false/);
  assert.match(css, /\.app-shell\.course-fullscreen \.course-catalog-hero/);
  assert.match(css, /\.app-shell\.course-fullscreen \.course-fullscreen-toggle/);
});
