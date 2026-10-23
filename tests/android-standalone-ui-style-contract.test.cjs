const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(
  __dirname,
  '..',
  'android-standalone-manager',
  'app',
  'src',
  'main',
  'java',
  'com',
  'qxmatrix',
  'edumanager',
  'standalone',
);
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('Android standalone buttons share rounded accessible interaction states', () => {
  const source = read('YouthUi.kt');
  assert.match(source, /enum class YouthButtonRole/);
  assert.match(source, /state_enabled/);
  assert.match(source, /state_pressed/);
  assert.match(source, /state_focused/);
  assert.match(source, /cornerRadius = radius/);
  assert.match(source, /button\.minHeight = dp\(context, if \(compact\) 52 else 62\)/);
  assert.match(source, /button\.maxLines = 2/);
  assert.match(source, /YouthButtonRole\.DANGER/);
});

test('Android standalone uses adaptive youth-friendly action grids without removing skins', () => {
  const main = read('MainActivity.kt');
  const navigation = read('StandaloneNavigation.kt');
  assert.match(main, /private fun addActionGrid/);
  assert.match(main, /GridLayout/);
  assert.match(main, /actionGridColumns/);
  assert.match(main, /YouthUi\.applyLearningCard/);
  assert.match(main, /\$\{student\.name\}的学习舱/);
  assert.match(main, /文件资产中心/);
  assert.match(main, /查看识别结果/);
  assert.match(main, /消化资料/);
  assert.match(main, /preferredColumns = 2/);
  assert.match(main, /configureSectionHeader\("添加资料并查看自动整理进度"/);
  assert.match(main, /YouthUi\.applyStatusCard\(this, palette\)/);
  assert.match(main, /NAVIGATION_ACTIVE/);
  assert.match(navigation, /fun AppSection\.displayLabel/);
  assert.match(main, /uiPreferences\.skin\(\)\.backgroundResource\(\)/);
});

test('Android standalone material hub follows the approved landscape card hierarchy', () => {
  const main = read('MainActivity.kt');
  for (const label of ['文件资产中心', '导入文件', '拍照添加', '连续采集', '手动重新识别', '手动重新整理', '导入对话', '处理回执与记录']) {
    assert.match(main, new RegExp(label));
  }
  assert.match(main, /private fun chooseFileImport/);
  assert.match(main, /private fun choosePhotoImport/);
  assert.match(main, /columnSpec = GridLayout\.spec\(GridLayout\.UNDEFINED, span, span\.toFloat\(\)\)/);
  assert.match(main, /importantForAccessibility = View\.IMPORTANT_FOR_ACCESSIBILITY_NO/);
  assert.match(main, /contentDescription = buildString/);
  assert.match(main, /YouthUi\.applyIconTile/);
  assert.match(main, /YouthUi\.applyDecorativeOrb/);
});

test('Android standalone uses a high-contrast dark shell for every skin', () => {
  const preferences = read('UiPreferences.kt');
  const main = read('MainActivity.kt');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'android-standalone-manager', 'app', 'src', 'main', 'res', 'values', 'styles.xml'), 'utf8');
  assert.match(preferences, /val heading: Int/);
  assert.match(preferences, /Color\.rgb\(10, 17, 36\)/);
  assert.match(preferences, /Color\.rgb\(6, 20, 43\)/);
  assert.match(main, /setBackgroundColor\(palette\.page\)/);
  assert.match(main, /alpha = 0\.12f/);
  assert.match(styles, /Theme\.Material\.NoActionBar/);
  assert.match(styles, /windowLightStatusBar">false/);
});

test('Android standalone supporting activities reuse the same button system', () => {
  for (const name of [
    'CollaborationActivity.kt',
    'CollaborationQrScannerActivity.kt',
    'ConversationKnowledgeActivity.kt',
    'CourseLearningActivity.kt',
    'LicenseQrScannerActivity.kt',
    'MarkdownBrowserActivity.kt',
    'RawMaterialBrowserActivity.kt',
    'ScreenCaptureActivity.kt',
  ]) {
    assert.match(read(name), /YouthUi\.applyButton/, `${name} should use the shared button visual system`);
  }
});
