const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'android-standalone-manager', 'app', 'src', 'main');
const java = path.join(root, 'java', 'com', 'qxmatrix', 'edumanager', 'standalone');
const read = (name) => fs.readFileSync(path.join(java, name), 'utf8');

test('W13 OCR keeps local output when the configured text model rejects multimodal input', () => {
  const agent = read('AgentAdapter.kt');
  const ocr = read('OcrVisionService.kt');
  const main = read('MainActivity.kt');
  assert.match(agent, /visionModel/);
  assert.match(agent, /configuration\.visionModel\.ifBlank \{ configuration\.model \}/);
  assert.match(ocr, /runCatching \{ analyzeVision/);
  assert.match(ocr, /visionStatus.*unavailable/);
  assert.match(main, /支持图片输入的视觉模型/);
});

test('W13 local collection supports explicit camera capture through FileProvider', () => {
  const main = read('MainActivity.kt');
  const manifest = fs.readFileSync(path.join(root, 'AndroidManifest.xml'), 'utf8');
  assert.match(main, /MediaStore\.ACTION_IMAGE_CAPTURE/);
  assert.match(main, /Android 拍照导入/);
  assert.match(manifest, /androidx\.core\.content\.FileProvider/);
});

test('W13 course learning exposes all capture modes and live saved-count refresh', () => {
  const course = read('CourseLearningActivity.kt');
  assert.match(course, /智能混合（推荐）/);
  assert.match(course, /画面变化时采集/);
  assert.match(course, /固定间隔（每 30 秒）/);
  assert.match(course, /postDelayed\(this, 1_500L\)/);
  assert.match(course, /putExtra\("capture_mode", selectedCaptureMode\)/);
});

test('W13 five skins bind supplied backgrounds and Robogala logo', () => {
  const ui = read('UiPreferences.kt');
  const main = read('MainActivity.kt');
  for (const skin of ['skin_purple', 'skin_pink', 'skin_green', 'skin_blue', 'skin_orange']) {
    assert.match(ui, new RegExp(`R\\.drawable\\.${skin}`));
    assert.equal(fs.existsSync(path.join(root, 'res', 'drawable-nodpi', `${skin}.jpg`)), true);
  }
  assert.match(main, /R\.drawable\.robogala_logo/);
  assert.equal(fs.existsSync(path.join(root, 'res', 'drawable-nodpi', 'robogala_logo.png')), true);
});

test('W13 homepage guidance and course-cover recovery hint are user visible', () => {
  const main = read('MainActivity.kt');
  for (const label of ['添加资料', '处理中', '需要补充', '知识更新', '成长变化', '报告与档案']) assert.match(main, new RegExp(label));
  assert.match(main, /封面未载入/);
  assert.match(main, /请重新导入课程包/);
});

test('W13 sidebar scrolls intermediate sections and pins system settings at the bottom', () => {
  const main = read('MainActivity.kt');
  assert.match(main, /filterNot \{ it == AppSection\.SETTINGS \}/);
  assert.match(main, /ScrollView\(this@MainActivity\).*LinearLayout\.LayoutParams\(ViewGroup\.LayoutParams\.MATCH_PARENT, 0, 1f\)/s);
  assert.match(main, /val settings = themedButton\(AppSection\.SETTINGS\.label\)/);
});

test('W13 Agent conversations are explicit, immutable, deduplicated and shareable', () => {
  const main = read('MainActivity.kt');
  const service = read('ConversationImportService.kt');
  const manifest = fs.readFileSync(path.join(root, 'AndroidManifest.xml'), 'utf8');
  assert.match(main, /导入智能体对话历史/);
  assert.match(main, /打开豆包/);
  assert.match(service, /explicitUserSave/);
  assert.match(service, /immutable/);
  assert.match(service, /相同对话已经保存/);
  assert.match(manifest, /android\.intent\.action\.SEND/);
  assert.match(manifest, /com\.larus\.nova/);
});
