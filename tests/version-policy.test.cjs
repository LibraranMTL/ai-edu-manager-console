const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateWindowsVersion, nextWindowsVersion } = require('../scripts/version-policy.cjs');

const root = path.join(__dirname, '..');

test('Windows versions advance from patch 1 through 10 then increment minor', () => {
  assert.equal(nextWindowsVersion('0.8.1'), '0.8.2');
  assert.equal(nextWindowsVersion('0.8.9'), '0.8.10');
  assert.equal(nextWindowsVersion('0.8.10'), '0.9.1');
  assert.equal(nextWindowsVersion('0.9.10'), '0.10.1');
});

test('Windows release policy rejects zero and patch numbers above 10', () => {
  assert.throws(() => validateWindowsVersion('0.8.0'), /1-10/);
  assert.throws(() => validateWindowsVersion('0.8.11'), /1-10/);
  assert.throws(() => validateWindowsVersion('0.8'), /无效版本号/);
});

test('package and release manifests use one Windows version', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const releaseManifest = JSON.parse(fs.readFileSync(path.join(root, 'release', 'edu-manager-version.json'), 'utf8'));
  const windowsManifest = JSON.parse(fs.readFileSync(path.join(root, 'release', 'windows', 'edu-manager-version.json'), 'utf8'));
  const downloadPage = fs.readFileSync(path.join(root, 'release', '网站文件', 'download.html'), 'utf8');
  assert.equal(packageJson.version, '0.15.9');
  assert.equal(releaseManifest.windowsVersionName, packageJson.version);
  assert.equal(windowsManifest.windowsVersionName, packageJson.version);
  assert.equal(releaseManifest.windowsTerminalVersionName, packageJson.version);
  assert.equal(windowsManifest.windowsTerminalVersionName, packageJson.version);
  assert.match(releaseManifest.windowsUrl, new RegExp(`Windows-${packageJson.version}\\.zip$`));
  assert.match(releaseManifest.windowsTerminalUrl, new RegExp(`Windows-${packageJson.version}\\.exe$`));
  assert.match(downloadPage, new RegExp(`Windows-${packageJson.version}(?:-[a-z0-9.-]+)?\\.zip`, 'i'));
  assert.match(downloadPage, new RegExp(`student-terminal-Windows-${packageJson.version}\\.exe`));
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  assert.match(changelog, new RegExp(`## \\[${packageJson.version.replaceAll('.', '\\.')}\\]`));
});

test('every released Windows iteration is recorded in the main changelog', () => {
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  for (const version of ['0.7.19', '0.7.20', '0.7.21', '0.7.22', '0.7.23', '0.7.24', '0.7.25', '0.7.26', '0.7.27', '0.7.28', '0.7.29', '0.7.30', '0.7.31', '0.7.32', '0.7.33', '0.7.34', '0.7.35', '0.7.36', '0.7.37', '0.7.38', '0.7.39', '0.7.40', '0.7.41', '0.7.42', '0.7.43', '0.7.44', '0.7.45', '0.7.46', '0.7.47', '0.7.48', '0.7.49', '0.7.50', '0.7.51', '0.8.1', '0.8.2', '0.8.3', '0.8.4', '0.8.5', '0.8.6', '0.8.7', '0.8.8', '0.8.9', '0.8.10', '0.9.1', '0.9.2', '0.9.3', '0.9.4', '0.9.5', '0.9.6', '0.9.7', '0.9.8', '0.9.9', '0.9.10', '0.10.1', '0.10.2', '0.10.3', '0.10.4', '0.10.5', '0.10.6', '0.10.7', '0.10.8', '0.10.9', '0.10.10', '0.11.1', '0.11.2', '0.11.3', '0.11.4', '0.11.5', '0.11.6', '0.11.7', '0.11.8', '0.11.9', '0.11.10', '0.12.1', '0.12.2', '0.12.3', '0.12.4', '0.12.5', '0.12.6', '0.12.7', '0.12.8', '0.12.9', '0.12.10', '0.13.1', '0.13.2', '0.13.3', '0.13.4', '0.13.5', '0.13.6', '0.13.7', '0.13.8', '0.13.9', '0.13.10', '0.14.1', '0.14.2', '0.14.3', '0.14.4', '0.14.5', '0.14.6', '0.14.7', '0.14.8', '0.14.9', '0.14.10', '0.15.1', '0.15.2', '0.15.3', '0.15.4', '0.15.5', '0.15.6', '0.15.7', '0.15.8', '0.15.9']) {
    assert.match(changelog, new RegExp(`## \\[${version.replaceAll('.', '\\.')}\\]`));
  }
});
