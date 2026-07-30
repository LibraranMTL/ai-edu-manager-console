const assert = require('node:assert/strict');
const test = require('node:test');
const { mergeOpenAiToolInstall } = require('../electron/openai-tool-install.cjs');

test('new ChatGPT desktop app satisfies merged ChatGPT and Codex installation detection', () => {
  const result = mergeOpenAiToolInstall(
    { installed: false, exePath: '' },
    {
      Version: '26.721.4979.0',
      InstallLocation: 'C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.721.4979.0_x64',
      AppPath: 'C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.721.4979.0_x64\\app\\ChatGPT.exe',
    },
  );
  assert.equal(result.installed, true);
  assert.equal(result.desktopInstalled, true);
  assert.equal(result.cliInstalled, false);
  assert.equal(result.exePath, '');
  assert.match(result.appPath, /ChatGPT\.exe$/);
});

test('Codex CLI remains the only executable used by task adapters', () => {
  const result = mergeOpenAiToolInstall(
    { installed: true, version: '1.0.0', exePath: 'C:\\Tools\\codex.cmd', installLocation: 'C:\\Tools' },
    { Version: '26.7', AppPath: 'C:\\Apps\\ChatGPT.exe', InstallLocation: 'C:\\Apps' },
  );
  assert.equal(result.exePath, 'C:\\Tools\\codex.cmd');
  assert.equal(result.appPath, 'C:\\Apps\\ChatGPT.exe');
  assert.equal(result.cliInstalled, true);
  assert.equal(result.desktopInstalled, true);
});
