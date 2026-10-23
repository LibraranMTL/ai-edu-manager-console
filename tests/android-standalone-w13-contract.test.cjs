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
  assert.match(main, /ClipData\.newRawUri/);
  assert.doesNotMatch(main, /intent\.resolveActivity\(packageManager\) == null/);
  assert.match(main, /Android 拍照导入/);
  assert.match(main, /选择拍照投递位置/);
  const photoTarget = main.slice(main.indexOf('private fun showPhotoImportTarget'), main.indexOf('private fun commitCapturedPhoto'));
  assert.match(photoTarget, /setSingleChoiceItems\(labels, selected\)/);
  assert.doesNotMatch(photoTarget, /setMessage\("照片尚未归档/);
  assert.match(photoTarget, /"学生资料库 · \$\{student\.name\}"/);
  assert.match(photoTarget, /"项目库 · \$\{target\.label\.removeSuffix/);
  assert.doesNotMatch(photoTarget, /进入学生自动整理流程|进入项目资料收件箱/);
  assert.match(main, /原始资料库/);
  assert.match(main, /项目库/);
  assert.match(main, /LocalProjectMaterialService\(this@MainActivity\)\.importUri/);
  assert.match(main, /project\.status == "active" && target\.studentId in project\.studentIds/);
  assert.match(main, /BooleanArray\(students\.size\) \{ index -> students\[index\]\.id == currentStudentId \}/);
  assert.match(manifest, /androidx\.core\.content\.FileProvider/);
  assert.match(manifest, /<queries>[\s\S]*android\.media\.action\.IMAGE_CAPTURE[\s\S]*<\/queries>/);
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
  for (const label of ['收集资料', '整理消化', '学情报告', '学习行动', '项目进展', '成长变化']) assert.match(main, new RegExp(label));
  assert.match(main, /封面未载入/);
  assert.match(main, /请重新导入课程包/);
});

test('W13 sidebar shows the five learning-loop destinations and keeps settings separate', () => {
  const main = read('MainActivity.kt');
  assert.match(main, /primarySections\(\)\.forEach/);
  assert.match(main, /ScrollView\(this@MainActivity\).*LinearLayout\.LayoutParams\(ViewGroup\.LayoutParams\.MATCH_PARENT, 0, 1f\)/s);
  assert.match(main, /val settings = themedButton\("⚙  设置"/);
});

test('W13 Agent conversations are explicit, immutable, deduplicated and shareable', () => {
  const main = read('MainActivity.kt');
  const service = read('ConversationImportService.kt');
  const manifest = fs.readFileSync(path.join(root, 'AndroidManifest.xml'), 'utf8');
  assert.match(main, /导入智能体对话历史/);
  assert.doesNotMatch(main, /打开豆包|打开 PalmClaw|ChatGPT \/ Codex/);
  assert.match(service, /explicitUserSave/);
  assert.match(service, /immutable/);
  assert.match(service, /相同对话已经保存/);
  assert.match(manifest, /android\.intent\.action\.SEND/);
  assert.doesNotMatch(manifest, /com\.larus\.nova|com\.openai\.chatgpt/);
});
