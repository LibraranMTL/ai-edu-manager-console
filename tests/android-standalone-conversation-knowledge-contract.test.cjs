const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const project = path.join(__dirname, '..');
const mainRoot = path.join(project, 'android-standalone-manager', 'app', 'src', 'main');
const javaRoot = path.join(mainRoot, 'java', 'com', 'qxmatrix', 'edumanager', 'standalone');
const read = (name) => fs.readFileSync(path.join(javaRoot, name), 'utf8');

test('conversation import and record actions use tablet-safe explicit controls', () => {
  const main = read('MainActivity.kt');
  const importBody = main.slice(main.indexOf('private fun showConversationImportMenu'), main.indexOf('private fun chooseConversationSourceAgent'));
  const actionBody = main.slice(main.indexOf('private fun showConversationActions'), main.indexOf('private fun conversationDigestStatusLabel'));
  assert.doesNotMatch(importBody, /setMessage[\s\S]*setItems/);
  assert.doesNotMatch(actionBody, /setMessage[\s\S]*setItems/);
  for (const label of ['粘贴对话文字', '导入 .md / .txt / .json 文件', '导入公开 HTTPS 对话链接']) assert.match(importBody, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(main, /没有对话历史[\s\S]*立即导入/);
  assert.match(main, /showConversationSavedActions/);
});

test('conversation knowledge center exposes inbox governance archive and trash', () => {
  const activity = read('ConversationKnowledgeActivity.kt');
  const manifest = fs.readFileSync(path.join(mainRoot, 'AndroidManifest.xml'), 'utf8');
  for (const label of ['收件箱', '待处理', '候选知识', '已归档', '回收站']) assert.match(activity, new RegExp(label));
  for (const action of ['确认采用', '撤回采用', '标记冲突', '驳回', '恢复待审核', '永久删除']) assert.match(activity, new RegExp(action));
  assert.match(activity, /take\(50\)/);
  assert.match(manifest, /ConversationKnowledgeActivity/);
});

test('v2 index migrates old records and keeps immutable evidence dependency checks', () => {
  const imports = read('ConversationImportService.kt');
  const candidates = read('ConversationCandidateRepository.kt');
  const governance = read('ConversationKnowledgeGovernanceService.kt');
  assert.match(imports, /android-conversation-index\.v2/);
  for (const key of ['analysis', 'lifecycleStatus', 'trashedAt', 'restoredAt']) assert.match(imports, new RegExp(key));
  assert.match(imports, /require\(sha256\(bytes\) == record\.getString\("contentHash"\)\)/);
  assert.match(candidates, /sourceUri/);
  assert.match(governance, /仍有 \$\{dependencies\.size\} 条候选或已采用知识/);
  assert.match(governance, /conversation-promotion/);
});

test('conversation indexes join existing backup and device migration private-state snapshots', () => {
  const backup = read('BackupRestoreService.kt');
  const migration = read('StandaloneDeviceMigrationService.kt');
  assert.match(backup, /education-manager-state/);
  assert.match(backup, /walkTopDown\(\)/);
  assert.match(migration, /education-manager-state/);
  assert.match(migration, /category.*state/);
});
