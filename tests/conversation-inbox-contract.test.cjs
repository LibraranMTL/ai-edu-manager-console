const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');

test('conversation inbox exposes one-confirmation delivery to student and linked projects', () => {
  assert.match(main, /function deliverConversationMaterials/);
  assert.match(main, /project\.studentIds[\s\S]*student\.id/);
  assert.match(main, /Agent对话资料/);
  assert.match(main, /bridge:deliverConversationMaterials/);
  assert.match(preload, /deliverConversationMaterials/);
  assert.match(ui, /确认投递所选/);
  assert.match(ui, /投递到关联项目原始资料库/);
});

test('conversation share links use bounded safe fetching and a paste fallback', () => {
  assert.match(main, /validateConversationShareUrl/);
  assert.match(main, /readBoundedResponseText/);
  assert.match(main, /AbortController/);
  assert.match(main, /redirect: 'manual'/);
  assert.match(main, /fallbackRequired: true/);
  assert.match(preload, /importConversationShareUrl/);
  assert.match(ui, /导入分享对话/);
});

test('conversation inbox exposes automatic topics, filters, and contextual entries', () => {
  assert.match(main, /analyzeConversationAsset/);
  assert.match(ui, /全部主题/);
  assert.match(ui, /从对话资料箱添加/);
  assert.match(ui, /conversationInboxSearch/);
});
