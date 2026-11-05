const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateWindowsVersion, nextWindowsVersion } = require('../scripts/version-policy.cjs');

const root = path.join(__dirname, '..');

test('Windows versions advance from patch 1 through 10, with the requested 0.17.11 exception', () => {
  assert.equal(nextWindowsVersion('0.8.1'), '0.8.2');
  assert.equal(nextWindowsVersion('0.8.9'), '0.8.10');
  assert.equal(nextWindowsVersion('0.8.10'), '0.9.1');
  assert.equal(nextWindowsVersion('0.9.10'), '0.10.1');
  assert.equal(nextWindowsVersion('0.17.10'), '0.17.11');
  assert.equal(nextWindowsVersion('0.17.11'), '0.18.1');
  assert.equal(nextWindowsVersion('0.23.0'), '0.23.1');
  assert.equal(nextWindowsVersion('0.23.1'), '0.23.2');
  assert.equal(nextWindowsVersion('0.23.2'), '0.23.3');
});

test('Windows release policy rejects zero and patch numbers above 10', () => {
  assert.throws(() => validateWindowsVersion('0.8.0'), /1-10/);
  assert.throws(() => validateWindowsVersion('0.8.11'), /1-10/);
  assert.deepEqual(validateWindowsVersion('0.17.11'), { major: 0, minor: 17, patch: 11 });
  assert.deepEqual(validateWindowsVersion('0.23.0'), { major: 0, minor: 23, patch: 0 });
  assert.throws(() => validateWindowsVersion('0.17.12'), /1-10/);
  assert.throws(() => validateWindowsVersion('0.8'), /无效版本号/);
});

test('candidate builds preserve the stable manifest, while a formal build aligns it with package.json', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const releaseManifest = JSON.parse(fs.readFileSync(path.join(root, 'release', 'edu-manager-version.json'), 'utf8'));
  const windowsManifest = JSON.parse(fs.readFileSync(path.join(root, 'release', 'windows', 'edu-manager-version.json'), 'utf8'));
  const terminalVersion = JSON.parse(fs.readFileSync(path.join(root, 'windows-terminal-version.json'), 'utf8'));
  const downloadPage = fs.readFileSync(path.join(root, 'release', '网站文件', 'download.html'), 'utf8');
  assert.equal(packageJson.version, '0.23.4');
  const candidateTag = String(process.env.EDU_WINDOWS_CANDIDATE_TAG || '').trim();
  const sourceAheadOfStable = releaseManifest.windowsVersionName !== packageJson.version;
  if (candidateTag || sourceAheadOfStable) {
    assert.notEqual(releaseManifest.windowsVersionName, packageJson.version);
    assert.equal(releaseManifest.windowsVersionName, '0.23.3');
  } else {
    assert.equal(releaseManifest.windowsVersionName, packageJson.version);
    assert.equal(releaseManifest.windowsVersionCode, 272);
  }
  assert.equal(releaseManifest.windowsReleaseStatus, 'stable');
  assert.equal(windowsManifest.windowsVersionName, releaseManifest.windowsVersionName);
  assert.equal(releaseManifest.windowsTerminalVersionName, windowsManifest.windowsTerminalVersionName);
  assert.equal(terminalVersion.versionName, '0.18.7');
  assert.equal(terminalVersion.versionCode, 237);
  assert.equal(terminalVersion.releaseStatus, 'candidate');
  assert.equal(releaseManifest.windowsTerminalVersionName, '0.18.6');
  assert.equal(releaseManifest.windowsTerminalVersionCode, 236);
  assert.equal(releaseManifest.windowsTerminalReleaseStatus, 'stable');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'release', '网站文件', 'edu-manager-version.json'), 'utf8')).windowsTerminalVersionName, '0.18.6');
  const isCandidate = releaseManifest.windowsReleaseStatus === 'candidate';
  const terminalIsCandidate = releaseManifest.windowsTerminalReleaseStatus === 'candidate';
  assert.equal(windowsManifest.windowsReleaseStatus, releaseManifest.windowsReleaseStatus);
  assert.equal(windowsManifest.windowsTerminalReleaseStatus, releaseManifest.windowsTerminalReleaseStatus);
  if (!isCandidate) {
    assert.match(releaseManifest.windowsUrl, new RegExp(`Windows-${releaseManifest.windowsVersionName}\\.zip$`));
    assert.match(downloadPage, new RegExp(`Windows-${releaseManifest.windowsVersionName}(?:-[a-z0-9.-]+)?\\.zip`, 'i'));
  }
  if (!terminalIsCandidate) {
    assert.match(releaseManifest.windowsTerminalUrl, new RegExp(`student-terminal-Windows-${releaseManifest.windowsTerminalVersionName.replaceAll('.', '\\.')}\\.exe$`));
  }
  const publishedTerminalFilename = new URL(releaseManifest.windowsTerminalUrl).pathname.split('/').pop();
  assert.match(downloadPage, new RegExp(publishedTerminalFilename.replaceAll('.', '\\.')));
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  assert.match(changelog, new RegExp(`## \\[${packageJson.version.replaceAll('.', '\\.')}\\]`));
});

test('every released Windows iteration is recorded in the main changelog', () => {
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  assert.match(changelog, /## \[0\.17\.9\]/);
  for (const version of ['0.7.19', '0.7.20', '0.7.21', '0.7.22', '0.7.23', '0.7.24', '0.7.25', '0.7.26', '0.7.27', '0.7.28', '0.7.29', '0.7.30', '0.7.31', '0.7.32', '0.7.33', '0.7.34', '0.7.35', '0.7.36', '0.7.37', '0.7.38', '0.7.39', '0.7.40', '0.7.41', '0.7.42', '0.7.43', '0.7.44', '0.7.45', '0.7.46', '0.7.47', '0.7.48', '0.7.49', '0.7.50', '0.7.51', '0.8.1', '0.8.2', '0.8.3', '0.8.4', '0.8.5', '0.8.6', '0.8.7', '0.8.8', '0.8.9', '0.8.10', '0.9.1', '0.9.2', '0.9.3', '0.9.4', '0.9.5', '0.9.6', '0.9.7', '0.9.8', '0.9.9', '0.9.10', '0.10.1', '0.10.2', '0.10.3', '0.10.4', '0.10.5', '0.10.6', '0.10.7', '0.10.8', '0.10.9', '0.10.10', '0.11.1', '0.11.2', '0.11.3', '0.11.4', '0.11.5', '0.11.6', '0.11.7', '0.11.8', '0.11.9', '0.11.10', '0.12.1', '0.12.2', '0.12.3', '0.12.4', '0.12.5', '0.12.6', '0.12.7', '0.12.8', '0.12.9', '0.12.10', '0.13.1', '0.13.2', '0.13.3', '0.13.4', '0.13.5', '0.13.6', '0.13.7', '0.13.8', '0.13.9', '0.13.10', '0.14.1', '0.14.2', '0.14.3', '0.14.4', '0.14.5', '0.14.6', '0.14.7', '0.14.8', '0.14.9', '0.14.10', '0.15.1', '0.15.2', '0.15.3', '0.15.4', '0.15.5', '0.15.6', '0.15.7', '0.15.8', '0.15.9', '0.15.10', '0.16.1', '0.16.2', '0.16.3', '0.16.4', '0.16.5', '0.16.6', '0.16.7', '0.16.8', '0.16.9', '0.16.10', '0.17.1', '0.17.2', '0.17.3', '0.17.4', '0.17.5', '0.17.6', '0.17.7', '0.17.8']) {
    assert.match(changelog, new RegExp(`## \\[${version.replaceAll('.', '\\.')}\\]`));
  }
});
