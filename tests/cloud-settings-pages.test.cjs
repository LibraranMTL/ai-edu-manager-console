'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('cloud settings are split into four user-facing secondary pages with selectable upload scope', () => {
  const panel = read('src/CloudDocumentsPanel.tsx');
  for (const label of ['上传与下载设置', '同步结果', '外部 Agent 云端访问', '云端成果收件箱', 'Windows主机下载许可', '授权上传学情资料', '已下载的本机副本']) {
    assert.match(panel, new RegExp(label));
  }
  assert.match(panel, /data-cloud-page="connection"/);
  assert.match(panel, /data-cloud-page="results"/);
  assert.match(panel, /data-cloud-page="agents"/);
  assert.match(panel, /data-cloud-page="inbox"/);
  assert.match(panel, /基础信息（默认全部选择，可手工调整）/);
  assert.match(panel, /姓名（建档必需）/);
  assert.match(panel, /健康资料：未授权/);
  assert.match(panel, /授权上传学情资料，平台将派遣专属真人专家进行分析提供建议/);
  assert.match(panel, /资料按类别授权，不按单文件授权/);
  assert.match(panel, /cloudReportSetUploadScope/);
  assert.match(panel, /savedUploadScope/);
  assert.match(panel, /uploadScopePersistence/);
  assert.match(panel, />保存选择</);
  assert.match(panel, /选择已保存在本机；旧许可未被扩大/);
});

test('upload scope save is available before enrollment and preserves the returned selection', () => {
  const panel = read('src/CloudDocumentsPanel.tsx');
  const saveButton = panel.indexOf('>保存选择</button>');
  const configuredOnlyStatus = panel.indexOf('{uploadStatus.configured && <>', saveButton);
  assert.ok(saveButton > 0);
  assert.ok(configuredOnlyStatus > saveButton, 'save must remain outside the configured-only status block');
  assert.match(panel, /setProfileFields\(status\.savedUploadScope\?\.profileFields/);
  assert.match(panel, /setMaterialCategories\(status\.savedUploadScope\?\.materialCategories/);
});

test('cloud page loading is conditional and inbox listing does not force synchronous recovery', () => {
  const panel = read('src/CloudDocumentsPanel.tsx');
  const main = read('electron/main.cjs');
  const renderer = read('src/main.tsx');
  assert.match(panel, /page !== 'results'/);
  assert.match(panel, /page === 'inbox'.*refreshInbox\(false\)/);
  assert.match(panel, /Promise\.allSettled/);
  assert.match(main, /if \(recover === true\) await recoverCloudInboxResults\(runtime\)/);
  assert.doesNotMatch(main, /bridge:cloudReportListInbox'[\s\S]{0,180}await recoverCloudInboxResults\(runtime\); return/);
  assert.match(renderer, /React\.lazy\(\(\) => import\('\.\/CloudDocumentsPanel'\)/);
  assert.match(renderer, /正在加载云端同步设置/);
});
