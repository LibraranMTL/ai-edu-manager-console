const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'android-tablet-terminal', 'src', 'com', 'qxmatrix', 'eduterminal', 'MainActivity.java'),
  'utf8',
);

test('Android student buttons use rounded feature colors and complete interaction states', () => {
  assert.match(source, /button\.setBackground\(buttonBackground\(text, primary\)\)/);
  assert.match(source, /drawable\.setCornerRadius\(dp\(18\)\)/);
  assert.match(source, /state_enabled/);
  assert.match(source, /state_pressed/);
  assert.match(source, /state_focused/);
  assert.match(source, /buttonTextColors\(primary\)/);
});

test('Android student section entries show icon, title and helpful copy as learning cards', () => {
  assert.match(source, /panelButtonText\(false, title, description\)/);
  assert.match(source, /featureIcon\(title\)/);
  assert.match(source, /toggle\.setMaxLines\(2\)/);
  assert.match(source, /toggle\.setContentDescription\(title \+ "。" \+ description\)/);
  assert.match(source, /featureColor\(String text\)/);
});

test('Android student card and hero surfaces keep rounded readable containers', () => {
  assert.match(source, /layout\.setBackground\(cardBackground\(\)\)/);
  assert.match(source, /drawable\.setCornerRadius\(dp\(22\)\)/);
  assert.match(source, /brandRow\.setBackground\(heroBackground\(\)\)/);
  assert.match(source, /我的学习空间 · 资料、课程和成长记录都在这里/);
});

test('Android student home uses an adaptive square-card grid and landscape navigation', () => {
  assert.match(source, /new GridLayout\(this\)/);
  assert.match(source, /actionGridColumns\(\)/);
  assert.match(source, /isWideLandscape\(\)/);
  assert.match(source, /buildNavigationRail\(\)/);
  assert.match(source, /精选课程/);
  assert.match(source, /上传学习资料/);
  assert.match(source, /屏幕资料采集/);
  assert.match(source, /AI 学习助手/);
  assert.match(source, /学情报告/);
  assert.match(source, /学情档案/);
});

test('Android student layout rebuilds after real device rotation', () => {
  assert.match(source, /onConfigurationChanged\(Configuration newConfig\)/);
  assert.match(source, /disposeUiWebViews\(\)/);
  assert.match(source, /buildUi\(\);\s*loadPrefs\(\);/);
  assert.match(source, /configuration\.orientation == Configuration\.ORIENTATION_LANDSCAPE/);
});

test('Student feature cards expose readable labels and keyboard focus states', () => {
  assert.match(source, /button\.setContentDescription\(title \+ "。" \+ description\)/);
  assert.match(source, /dashboardButtonBackground\(color\)/);
  assert.match(source, /android\.R\.attr\.state_focused/);
  assert.match(source, /dp\(isPhoneLayout\(\) \? 112 : 132\)/);
});
