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

test('Android student home uses exactly four core actions with landscape and narrow navigation', () => {
  assert.match(source, /new GridLayout\(this\)/);
  assert.match(source, /columns = isPhoneLayout\(\).*\? 1 : 2/);
  assert.match(source, /isWideLandscape\(\)/);
  assert.match(source, /buildNavigationRail\(\)/);
  assert.match(source, /buildBottomNavigation\(\)/);
  assert.match(source, /"搜集上传"/);
  assert.match(source, /"主机连接"/);
  assert.match(source, /"教育档案"/);
  assert.match(source, /"学习行动"/);
  const dashboard = source.slice(source.indexOf('private LinearLayout buildStudentDashboard'), source.indexOf('private Button addDashboardAction'));
  assert.equal((dashboard.match(/addDashboardAction\(/g) || []).length, 4);
  assert.doesNotMatch(dashboard, /AI 学习助手|项目知识库/);
});

test('AI assistant, contact and prompt modules have no visible workspace entry', () => {
  const assembly = source.slice(source.indexOf('collectionPage = workspacePage'), source.indexOf('FrameLayout.LayoutParams topParams'));
  assert.doesNotMatch(assembly, /contactCard|agentDialogCard|promptDialogCard|教育管家对话|AI 学习助手/);
  assert.match(source, /morePage = workspacePage\("更多"/);
});

test('terminal and student space lives under host connection instead of More', () => {
  const assembly = source.slice(source.indexOf('collectionPage = workspacePage'), source.indexOf('FrameLayout.LayoutParams topParams'));
  const connection = assembly.slice(assembly.indexOf('connectionPage = workspacePage'), assembly.indexOf('LinearLayout growthRecommendations'));
  const more = assembly.slice(assembly.indexOf('morePage = workspacePage'));
  assert.match(connection, /connectionPage\.addView\(collapsiblePanel\("终端与学生空间"[\s\S]*terminalAndStudent\)\)/);
  assert.doesNotMatch(more, /collapsiblePanel\("终端与学生空间"/);
  assert.match(source, /title\.contains\("学生空间"\).*destination = "connection"/);
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
