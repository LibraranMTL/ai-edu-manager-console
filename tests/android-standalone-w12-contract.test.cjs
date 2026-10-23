const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sourceRoot = path.join(__dirname, '..', 'android-standalone-manager', 'app', 'src', 'main');
const javaRoot = path.join(sourceRoot, 'java', 'com', 'qxmatrix', 'edumanager', 'standalone');
const read = (name) => fs.readFileSync(path.join(javaRoot, name), 'utf8');

test('W12 student archives, projects and reports open the bounded Markdown browser', () => {
  const main = read('MainActivity.kt');
  const browser = read('MarkdownBrowserActivity.kt');
  const store = read('SafWorkspaceStore.kt');
  for (const mode of ['MODE_ARCHIVE', 'MODE_PROJECT', 'MODE_REPORT']) assert.match(main, new RegExp(mode));
  assert.match(browser, /settings\.javaScriptEnabled = false/);
  assert.match(browser, /settings\.allowFileAccess = false/);
  assert.match(browser, /settings\.allowContentAccess = false/);
  assert.match(browser, /StudentIndexRepository\(this\)\.requireExact/);
  assert.match(browser, /ProjectRepository\(this\)\.requireExact/);
  assert.match(store, /fun listMarkdownFiles/);
});

test('W12 completed OCR results can be selected and rendered', () => {
  const main = read('MainActivity.kt');
  const browser = read('MarkdownBrowserActivity.kt');
  assert.match(main, /查看识别结果/);
  assert.match(main, /ocrStatus.*completed/);
  assert.match(main, /openOcrResult/);
  assert.match(browser, /MODE_OCR/);
  assert.match(browser, /ocrMarkdownPath/);
  assert.match(browser, /OCR 结果路径超出当前学生范围/);
});

test('W12 course cards retain imported cover bytes and display summaries', () => {
  const main = read('MainActivity.kt');
  const catalog = read('CourseCatalogService.kt');
  assert.match(main, /ImageView/);
  assert.match(main, /course\.summary/);
  assert.match(main, /courseCatalogService\.coverBytes/);
  assert.match(catalog, /coverPayloads/);
  assert.match(catalog, /state\.writeBytes\("\$COVER_ROOT\/\$cover"/);
});

test('W12 removes external AI launch and download integration while retaining conversation import', () => {
  const main = read('MainActivity.kt');
  const manifest = fs.readFileSync(path.join(sourceRoot, 'AndroidManifest.xml'), 'utf8');
  assert.doesNotMatch(main, /getLaunchIntentForPackage|openOfficialAgentDownload|openAgentTool/);
  assert.doesNotMatch(manifest, /com\.palmclaw|com\.openai\.chatgpt|QUERY_ALL_PACKAGES/);
  assert.match(manifest, /<queries>[\s\S]*android\.media\.action\.IMAGE_CAPTURE[\s\S]*<\/queries>/);
  assert.match(main, /导入智能体对话/);
  assert.match(main, /对话整理结果/);
});

test('W12 accepts either an Agent base URL or a complete chat completions URL', () => {
  const agent = read('AgentAdapter.kt');
  assert.match(agent, /resolveChatCompletionsUrl/);
  assert.match(agent, /endsWith\("\/chat\/completions"/);
  const provider = read('ModelProvider.kt');
  const network = read('UnifiedNetworkClient.kt');
  assert.match(agent, /CompatibleModelProvider/);
  assert.match(provider, /x-request-id/);
  assert.match(provider, /模型服务返回 HTTP/);
  assert.match(provider, /safeId\(http\.requestId\)/);
  assert.match(provider, /followRedirects = false/);
  assert.match(network, /instanceFollowRedirects = request\.followRedirects/);
  assert.doesNotMatch(provider, /error\(http\.body\)|println|Log\.|printStackTrace/);
  assert.doesNotMatch(agent, /URL\("\$\{configuration\.endpoint\}\/chat\/completions"\)/);
});
