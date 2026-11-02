const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  codexDesktopCliCandidatePaths,
  mergeOpenAiToolInstall,
  parseCodexCliVersion,
  selectNewestCodexCliCandidate,
} = require('../electron/openai-tool-install.cjs');

test('desktop package contributes its bundled current Codex CLI candidate', () => {
  assert.deepEqual(codexDesktopCliCandidatePaths({
    InstallLocation: 'C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.1027.6604.0_x64',
    AppPath: 'C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.1027.6604.0_x64\\app\\ChatGPT.exe',
  }), [
    'C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.1027.6604.0_x64\\app\\resources\\codex.exe',
  ]);
});

test('Codex CLI versions are parsed and the newest installed runtime wins', () => {
  assert.deepEqual(parseCodexCliVersion('codex-cli 0.153.4'), {
    raw: '0.153.4', major: 0, minor: 153, patch: 4, prerelease: '',
  });
  const selected = selectNewestCodexCliCandidate([
    { path: 'C:\\old\\codex.cmd', version: '0.130.0-alpha.5' },
    { path: 'C:\\new\\codex.exe', version: '0.153.4' },
  ]);
  assert.equal(selected.path, 'C:\\new\\codex.exe');
});

test('host discovery probes all Codex candidates asynchronously instead of blocking Electron startup', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /function findPreferredCodexCliInstall/);
  assert.match(main, /async function refreshPreferredCodexCliInstall/);
  assert.match(main, /OpenAI', 'Codex', 'bin/);
  assert.match(main, /await Promise\.all/);
  assert.match(main, /probeExecutableAsync\(candidate, \['--version'\], 3500\)/);
  assert.match(main, /selectNewestCodexCliCandidate\(probed\)/);
  const pathLookup = main.slice(main.indexOf('function findExecutablesInPath'), main.indexOf('function findVersionedExecutable'));
  assert.doesNotMatch(pathLookup, /spawnSync/);
  const fastLookup = main.slice(main.indexOf('function findPreferredCodexCliInstall'), main.indexOf('async function refreshPreferredCodexCliInstall'));
  assert.doesNotMatch(fastLookup, /probeExecutable\(/);
  assert.match(main, /requires a newer version of Codex/);
  assert.match(main, /AGENT_RUNTIME_INCOMPATIBLE/);
});

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
