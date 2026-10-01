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
  assert.match(ui, /投递到关联项目/);
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

test('conversation workspace unifies attribution, imports, candidates, deliveries, and trash', () => {
  assert.match(ui, /conversationWorkspaceTab/);
  assert.match(ui, /conversationWorkspaceCounts/);
  assert.match(ui, /\['awaiting', '待确认归属'/);
  assert.match(ui, /\['inbox', '已导入对话'/);
  assert.match(ui, /\['candidates', '知识候选'/);
  assert.match(ui, /\['delivered', '已投递\/晋升'/);
  assert.match(ui, /\['trash', '回收站'/);
  assert.match(ui, /assignAgentConversationToSelectedStudent/);
});

test('conversation imports support dependency-aware trash, restore, and permanent delete', () => {
  assert.match(main, /function conversationImportDependencySummary/);
  assert.match(main, /canPermanentlyDelete:\s*!registeredProjectOriginal && matchingDeliveries\.length === 0 && promoted === 0/);
  assert.match(main, /retainedCandidates/);
  assert.match(main, /updateArchivedAssetLifecycle/);
  assert.match(main, /function purgeQueuedAgentLifecycleSession/);
  assert.match(main, /function manageConversationImports/);
  assert.match(main, /confirmPermanentDelete/);
  assert.match(main, /markAgentConversationSubmissionDeleted/);
  assert.match(main, /!\['awaiting_attribution', 'deleted'\]\.includes\(existing\.status\)/);
  assert.match(main, /bridge:manageConversationImports/);
  assert.match(preload, /manageConversationImports/);
  assert.match(ui, /manageConversationMaterials/);
});

test('authorized lifecycle conversations expose direct delivery and trash controls', () => {
  assert.match(main, /lifecycleCapture: true/);
  assert.match(main, /sourceType: options\.lifecycleCapture === true \? 'authorized_lifecycle'/);
  assert.match(ui, /deliverCapturedConversation/);
  assert.match(ui, /manageCapturedConversation/);
  assert.match(ui, /管理全部对话资料/);
  assert.match(ui, /会话结束后可投递或移除/);
  assert.match(ui, /已投递会话仍保留/);
  const delivery = main.slice(main.indexOf('async function deliverConversationMaterials'), main.indexOf('function readConversationCandidateRegistry'));
  assert.match(delivery, /writeConversationDeliveries\(student, \{ deliveries \}\)/);
  assert.doesNotMatch(delivery, /materialLifecycleStatus\s*=/);
  assert.doesNotMatch(delivery, /manageConversationImports\(/);
});

test('delivered workspace also includes promoted conversations without material delivery', () => {
  assert.match(ui, /conversationWorkspaceTab === 'delivered'[\s\S]*dependencies\?\.promotedCount/);
  assert.match(ui, /Boolean\(item\.deliveries\?\.length\) \|\| Number\(item\.dependencies\?\.promotedCount \|\| 0\) > 0/);
});
