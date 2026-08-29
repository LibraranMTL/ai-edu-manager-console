const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'android-standalone-manager', 'app', 'src', 'main');
const javaRoot = path.join(root, 'java', 'com', 'qxmatrix', 'edumanager', 'standalone');
const read = (name) => fs.readFileSync(path.join(javaRoot, name), 'utf8');

test('W11 presents the agreed eight-section household tablet navigation', () => {
  const source = read('MainActivity.kt');
  for (const label of ['教育档案', '资料收集与处理', '课程中心', 'AI助手问答', '成长模型', '学情报告', '学习项目', '系统设置']) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /enum class AppSection/);
  assert.match(source, /Configuration\.ORIENTATION_LANDSCAPE/);
});

test('W11 keeps the file asset center and exact-student general capture flow', () => {
  const main = read('MainActivity.kt');
  const activity = read('ScreenCaptureActivity.kt');
  const service = read('CourseCaptureService.kt');
  const assets = read('FileAssetService.kt');
  assert.match(main, /文件资产中心/);
  assert.match(main, /连续屏幕采集/);
  assert.match(activity, /StudentIndexRepository\(this\)\.requireExact/);
  assert.match(activity, /ProjectRepository\(this\)\.requireExact/);
  assert.match(activity, /"capture_kind", "material"/);
  assert.match(activity, /"smart", "change", "interval"/);
  assert.match(activity, /KEY_STUDENT_ID/);
  assert.match(service, /registerCapturedFile/);
  assert.match(service, /const val KEY_STUDENT_ID/);
  assert.match(assets, /fun registerCapturedFile/);
});

test('W11 offers course learning with explicit system-authorized capture startup', () => {
  const main = read('MainActivity.kt');
  const learning = read('CourseLearningActivity.kt');
  assert.match(main, /学习并启动采集/);
  assert.match(main, /EXTRA_AUTO_START_CAPTURE/);
  assert.match(learning, /getBooleanExtra\(EXTRA_AUTO_START_CAPTURE/);
  assert.match(learning, /MediaProjectionManager/);
  assert.match(learning, /handleCapturePrimary\(\)/);
});

test('W11 Agent configuration can be edited, tested, disabled and can launch capability apps', () => {
  const main = read('MainActivity.kt');
  const agent = read('AgentAdapter.kt');
  for (const value of ['配置或修改本地任务 Agent', '测试文本 / 视觉 Agent', '停用本地任务 Agent', '打开 PalmClaw', '打开 MobileClaw']) {
    assert.match(main, new RegExp(value));
  }
  assert.match(agent, /fun saveOrUpdate/);
  assert.match(agent, /fun testConnection/);
  assert.match(agent, /fun clear\(\)/);
  assert.match(main, /getLaunchIntentForPackage/);
});

test('W11 exposes five skins and landscape, portrait and adaptive layouts', () => {
  const source = read('UiPreferences.kt');
  for (const value of ['PURPLE', 'PINK', 'GREEN', 'BLUE', 'ORANGE']) assert.match(source, new RegExp(value));
  for (const value of ['LANDSCAPE', 'PORTRAIT', 'ADAPTIVE']) assert.match(source, new RegExp(value));
  assert.match(source, /SCREEN_ORIENTATION_SENSOR_LANDSCAPE/);
  assert.match(source, /SCREEN_ORIENTATION_SENSOR_PORTRAIT/);
});

test('W11 retains Windows course-package import as an advanced offline compatibility path', () => {
  const source = read('MainActivity.kt');
  assert.match(source, /高级设置/);
  assert.match(source, /导入离线平台课程包/);
  assert.match(source, /startPlatformCourseImport/);
});
