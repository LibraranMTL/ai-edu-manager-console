const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const releaseScript = fs.readFileSync(path.join(root, 'scripts', 'build-windows-release.cjs'), 'utf8');

test('Windows release builds through an isolated local staging directory', () => {
  assert.equal(packageJson.scripts['build:win'], 'pnpm test && node scripts/build-windows-release.cjs');
  assert.match(releaseScript, /process\.env\.LOCALAPPDATA/);
  assert.match(releaseScript, /release-stage/);
  assert.match(releaseScript, /runPackageBin\('electron-builder', 'electron-builder', \['--projectDir', stageRoot/);
  assert.match(releaseScript, /resolvePackageBin/);
  assert.match(releaseScript, /processExists\(Number\(lock\?\.pid\)\)/);
  assert.match(releaseScript, /Another Windows release build is active/);
  assert.doesNotMatch(releaseScript, /rmSync\(path\.join\(repoRoot, 'dist'/);
});

test('staged runtime is dependency-free after Vite has bundled renderer dependencies', () => {
  assert.match(releaseScript, /main: 'electron\/main\.cjs'/);
  assert.match(releaseScript, /files: \['dist\/\*\*\/\*', 'electron\/\*\*\/\*', 'package\.json'\]/);
  assert.doesNotMatch(releaseScript, /runtimePackage\.(?:dependencies|devDependencies)/);
  assert.match(releaseScript, /Minimal runtime package unexpectedly contains node_modules/);
  assert.match(releaseScript, /app\.asar exceeds 20 MiB/);
  assert.deepEqual(packageJson.build.asarUnpack, ['electron/invoke-agent.ps1']);
  assert.match(releaseScript, /asarUnpack: \['electron\/invoke-agent\.ps1'\]/);
  assert.match(releaseScript, /Packaged Agent parameter bridge is missing/);
});

test('Windows release keeps the approved multilingual locale set', () => {
  for (const locale of ['zh-CN', 'zh-TW', 'en-US', 'en-GB', 'fr', 'es', 'es-419', 'ja', 'ko', 'vi', 'ms']) {
    assert.match(releaseScript, new RegExp(`['"]${locale}['"]`));
  }
  assert.match(releaseScript, /Electron locale mismatch/);
});

test('release artifacts are published only after package audits pass', () => {
  const asarAudit = releaseScript.indexOf('const asarFiles = asar.listPackage');
  const localeAudit = releaseScript.indexOf('Electron locale mismatch');
  const publish = releaseScript.indexOf('publishFile(stagedExe, releaseExe)');
  assert.ok(asarAudit > 0 && localeAudit > asarAudit && publish > localeAudit);
  assert.match(releaseScript, /Copy verification failed/);
  assert.match(releaseScript, /Temporary release artifact remained after publish/);
  assert.match(releaseScript, /primary-artifact-locked-publish-optimized/);
  assert.match(releaseScript, /build-audit\.json/);
});
