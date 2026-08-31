const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'android-standalone-manager', 'app', 'src', 'main');
const java = path.join(root, 'java', 'com', 'qxmatrix', 'edumanager', 'standalone');
const read = (name) => fs.readFileSync(path.join(java, name), 'utf8');

test('W16 conversation history exposes browse, digest result and controlled deletion actions', () => {
  const main = read('MainActivity.kt');
  const browser = read('MarkdownBrowserActivity.kt');
  for (const label of ['管理已保存对话历史', '浏览对话原文', '进入消化流程', '查看消化结果', '移入回收站']) {
    assert.match(main, new RegExp(label));
  }
  assert.match(browser, /MODE_CONVERSATION/);
  assert.match(browser, /MODE_CONVERSATION_DIGEST/);
  assert.match(browser, /EXTRA_CONVERSATION_ID/);
  assert.match(browser, /readContent\(recordId\)/);
  assert.match(browser, /readDigestArtifact\(recordId\)/);
});

test('W16 conversation originals remain exact-scope immutable evidence with hash verification', () => {
  const service = read('ConversationImportService.kt');
  assert.match(service, /immutable/);
  assert.match(service, /sha256\(bytes\) == record\.getString\("contentHash"\)/);
  assert.match(service, /对话项目不再绑定当前学生/);
  assert.match(service, /edu-manager\.conversation-deletion\.v1/);
  assert.match(service, /explicitUserDelete/);
  assert.match(service, /deleteFileIfExists/);
  assert.match(service, /已消化对话必须保留原文作为候选知识证据/);
});

test('W16 digest follows student and project AGENT rules without cross-scope publication', () => {
  const digest = read('ConversationDigestService.kt');
  assert.match(digest, /student_digest/);
  assert.match(digest, /project_digest/);
  assert.match(digest, /student\.paths\.agentPath/);
  assert.match(digest, /project\.paths\.agentPath/);
  assert.match(digest, /status", "candidate"/);
  assert.match(digest, /项目对话不得直接写入学生主档案/);
  assert.match(digest, /project\.paths\.summaryPath/);
  assert.match(digest, /project\.paths\.conceptPath/);
  assert.match(digest, /project\.paths\.entityPath/);
  assert.match(digest, /project\.paths\.qaPath/);
});

test('formal source advances Android standalone to 1.2.1 code 25', () => {
  const build = fs.readFileSync(path.join(__dirname, '..', 'android-standalone-manager', 'app', 'build.gradle.kts'), 'utf8');
  assert.match(build, /versionCode = 25/);
  assert.match(build, /versionName = "1\.2\.1"/);
  assert.match(build, /isMinifyEnabled = true/);
});
