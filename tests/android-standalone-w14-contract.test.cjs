const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'android-standalone-manager', 'app', 'src', 'main');
const java = path.join(root, 'java', 'com', 'qxmatrix', 'edumanager', 'standalone');
const main = fs.readFileSync(path.join(java, 'MainActivity.kt'), 'utf8');
const manifest = fs.readFileSync(path.join(root, 'AndroidManifest.xml'), 'utf8');

test('W14 settings keep the bounded task Agent and remove external Agent-tool adaptation', () => {
  for (const label of ['配置任务 Agent', '测试 Agent', '停用任务 Agent']) assert.match(main, new RegExp(label));
  assert.doesNotMatch(main, /受控模型网关|showGatewaySettings|Agent 工具适配|installedAgentPackage|getLaunchIntentForPackage/);
});

test('W14 conversation material paths remain available after assistant deletion', () => {
  assert.match(main, /showConversationImportMenu/);
  assert.match(main, /openConversationKnowledge/);
  assert.match(main, /EXTRA_OPEN_CONVERSATION_IMPORT/);
  assert.match(main, /renderSection\(AppSection\.MATERIALS\)\s*\n\s*showConversationImportMenu/);
});

test('W14 Android package visibility does not expose external AI apps', () => {
  for (const packageName of [
    'com.modalitydance.palmclaw',
    'ai.affiora.mobileclaw',
    'com.larus.nova',
    'com.openai.chatgpt',
  ]) {
    assert.doesNotMatch(manifest, new RegExp(packageName.replaceAll('.', '\\.')));
  }
  assert.doesNotMatch(manifest, /<queries>/);
});

test('W14 does not request broad access to other apps private data', () => {
  assert.doesNotMatch(main, /READ_CALL_LOG|QUERY_ALL_PACKAGES/);
  assert.doesNotMatch(manifest, /QUERY_ALL_PACKAGES/);
});
