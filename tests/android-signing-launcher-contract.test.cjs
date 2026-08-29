const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'android-standalone-manager');
const launcher = fs.readFileSync(path.join(root, 'publish-release.ps1'), 'utf8');
const chineseLauncher = fs.readFileSync(path.join(root, '发布正式版.ps1'), 'utf8');
const signer = fs.readFileSync(path.join(root, 'sign-release.ps1'), 'utf8');

test('one-click Android publisher persists only non-secret signing location', () => {
  assert.match(launcher, /android-signing-location\.json/);
  assert.match(launcher, /keystorePath = \$location\.keystorePath/);
  assert.match(launcher, /keyAlias = \$location\.keyAlias/);
  const persistedBlock = launcher.slice(launcher.indexOf('$locationJson'), launcher.indexOf('[IO.File]::WriteAllText'));
  assert.doesNotMatch(persistedBlock, /password/i);
  assert.doesNotMatch(launcher, /SetEnvironmentVariable\([^\n]+,\s*'User'/);
});

test('one-click Android publisher securely prompts and scopes all four variables to the signing process', () => {
  assert.match(launcher, /Read-Host 'Keystore password[^']*' -AsSecureString/);
  assert.match(launcher, /Read-Host 'Key password[^']*' -AsSecureString/);
  for (const name of ['EDU_ANDROID_KEYSTORE', 'EDU_ANDROID_KEYSTORE_PASSWORD', 'EDU_ANDROID_KEY_ALIAS', 'EDU_ANDROID_KEY_PASSWORD']) {
    assert.match(launcher, new RegExp(`SetEnvironmentVariable\\('${name}'`));
  }
  assert.match(launcher, /finally\s*\{[\s\S]*previousEnvironment/);
  assert.match(launcher, /& \$releaseScript @releaseArguments/);
  assert.match(launcher, /releaseArguments\.CandidateTag = \$CandidateTag/);
});

test('one-click Android publisher reuses complete process signing configuration without prompting', () => {
  assert.match(launcher, /GetEnvironmentVariable\('EDU_ANDROID_KEYSTORE', 'Process'\)/);
  assert.match(launcher, /GetEnvironmentVariable\('EDU_ANDROID_KEY_ALIAS', 'Process'\)/);
  assert.match(launcher, /GetEnvironmentVariable\('EDU_ANDROID_KEYSTORE_PASSWORD', 'Process'\)/);
  assert.match(launcher, /GetEnvironmentVariable\('EDU_ANDROID_KEY_PASSWORD', 'Process'\)/);
  assert.match(launcher, /if \(\[string\]::IsNullOrEmpty\(\$storePassword\)\)/);
  assert.match(launcher, /if \(\[string\]::IsNullOrEmpty\(\$keyPassword\)\)/);
});

test('Chinese one-click entry delegates to the audited publisher', () => {
  assert.match(chineseLauncher, /publish-release\.ps1/);
  assert.match(chineseLauncher, /@args/);
});

test('formal signer rejects certificates that differ from the previous Android standalone release', () => {
  assert.match(signer, /AI-Education-Manager-Android-Standalone-\*-release\.json/);
  assert.match(signer, /trustedCertificateSha256 -ne \$certificateSha256/);
  assert.match(signer, /would conflict with installed copies/);
});
