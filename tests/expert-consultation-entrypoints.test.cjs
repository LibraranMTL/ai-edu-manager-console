'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('Windows home and report use the shared expert authorization card', () => {
  const main = read('src', 'main.tsx');
  const workbench = read('src', 'LearningWorkbenchPanel.tsx');
  const card = read('src', 'ExpertConsultationCard.tsx');
  const cloud = read('src', 'CloudDocumentsPanel.tsx');

  assert.match(workbench, /sourcePage="windows_home"/);
  assert.match(main, /sourcePage="windows_report"/);
  assert.match(main, /openExpertConsultation\('windows_home'\)/);
  assert.match(main, /openExpertConsultation\('windows_report', \{/);
  assert.match(main, /setAgentSettingsTab\('cloud'\)/);
  assert.match(main, /!expertAuthorizationFlow/);
  assert.match(main, /\(!expertAuthorizationFlow \|\| windowsLicenseActive\)/);
  assert.match(card, /请求真人专家解读咨询/);
  assert.match(card, /点击本身不会上传、创建咨询单或改变授权/);
  assert.match(cloud, /来自学情报告页/);
  assert.match(cloud, /来自学情工作台首页/);
  assert.match(main, /reportRevision: report\?\.updatedAt \|\| 'not_generated'/);
  assert.match(main, /setExpertConsultationSource\(''\)/);
  assert.match(cloud, /expertContext\?\.reportRevision/);
});

test('Android home and report open scope preview without direct upload', () => {
  const main = read('android-standalone-manager', 'app', 'src', 'main', 'java', 'com', 'qxmatrix', 'edumanager', 'standalone', 'MainActivity.kt');
  const cloud = read('android-standalone-manager', 'app', 'src', 'main', 'java', 'com', 'qxmatrix', 'edumanager', 'standalone', 'CloudSyncActivity.kt');

  assert.match(main, /addExpertConsultationCard\("android_home"\)/);
  assert.match(main, /addExpertConsultationCard\("android_report", "learning_report", reportRevision\)/);
  assert.match(main, /EXTRA_EXPERT_INTENT, true/);
  assert.match(main, /EXTRA_SOURCE_PAGE, sourcePage/);
  assert.match(main, /EXTRA_REPORT_REVISION, reportRevision/);
  assert.match(main, /LearningInsightsStore\(this\)\.reportRevisions/);
  const handler = main.match(/private fun openExpertAuthorization[\s\S]*?\n    private fun launchExpertAuthorization/)?.[0] || '';
  assert.doesNotMatch(handler, /syncNow|setUploadScope|selectRawMaterial/);
  assert.match(cloud, /if \(expertIntent\) root\.post \{ showScopeDialog\(\) \}/);
  assert.match(cloud, /平台会在用户授权后派遣专家一对一解读咨询/);
  assert.match(cloud, /getStringArrayListExtra\(EXTRA_SUGGESTED_CATEGORIES\)/);
  assert.match(cloud, /setPositiveButton\("确认许可"\)/);
});
