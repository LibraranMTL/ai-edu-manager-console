const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'android-standalone-manager', 'app', 'src', 'main');
const java = path.join(root, 'java', 'com', 'qxmatrix', 'edumanager', 'standalone');
const main = fs.readFileSync(path.join(java, 'MainActivity.kt'), 'utf8');
const manifest = fs.readFileSync(path.join(root, 'AndroidManifest.xml'), 'utf8');

test('W14 settings expose installation status for the four supported Agent tools', () => {
  assert.match(main, /Agent 工具适配/);
  assert.match(main, /已安装.*toolStates\.count/s);
  assert.match(main, /installedAgentPackage/);
  assert.match(main, /getLaunchIntentForPackage/);
  for (const label of ['PalmClaw', 'MobileClaw', '豆包', 'ChatGPT / Codex']) {
    assert.match(main, new RegExp(label.replace('/', '\\/')));
  }
});

test('W14 installed tools can be opened and missing tools offer allowlisted official HTTPS pages', () => {
  assert.match(main, /if \(installedPackage == null\) "官方下载" else "打开应用"/);
  assert.match(main, /Intent\(Intent\.ACTION_VIEW, uri\)/);
  assert.match(main, /uri\.scheme != "https"/);
  assert.match(main, /allowedDownloadHost/);
  for (const url of [
    'https://github.com/ModalityDance/PalmClaw/releases/latest',
    'https://mobileclaw.cc/',
    'https://www.doubao.com/download/',
    'https://play.google.com/store/apps/details?id=com.openai.chatgpt',
  ]) {
    assert.match(main, new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('W14 Android package visibility covers PalmClaw, MobileClaw, Doubao and ChatGPT', () => {
  for (const packageName of [
    'com.modalitydance.palmclaw',
    'ai.affiora.mobileclaw',
    'com.larus.nova',
    'com.openai.chatgpt',
  ]) {
    assert.match(manifest, new RegExp(packageName.replaceAll('.', '\\.')));
  }
});

test('W14 adapter explicitly avoids reading other apps private data', () => {
  assert.match(main, /不读取账号、聊天记录或其他 App 的私有数据/);
  assert.doesNotMatch(main, /READ_CALL_LOG|QUERY_ALL_PACKAGES/);
});
