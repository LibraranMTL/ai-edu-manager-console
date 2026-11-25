const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('platform license is the only platform publishing credential and receivers verify integrity', () => {
  const main = read('electron', 'main.cjs');
  const preload = read('electron', 'preload.cjs');
  const ui = read('src', 'main.tsx');
  assert.match(main, /activateWindowsLicenseV3[\s\S]*deviceId: getHostIdentity\(\)\.hostId/);
  assert.doesNotMatch(main, /verifyLicenseTokenV2|AI_EDU_LICENSE_TRUSTED_ISSUERS|LICENSE_SIGNING_SECRET/);
  assert.match(main, /bridge:importLicenseFile/);
  assert.doesNotMatch(main, /bridge:importTrustedLicenseIssuerBundle/);
  assert.doesNotMatch(preload, /importTrustedLicenseIssuerBundle/);
  assert.doesNotMatch(ui, /导入可信签发方公钥包|importLicenseTrustBundle/);
  assert.doesNotMatch(main, /bridge:importCourseSigningKey/);
  assert.doesNotMatch(main, /bridge:importCourseTrustBundle/);
  assert.doesNotMatch(main, /bridge:createCourseSigningKey/);
  assert.doesNotMatch(main, /COURSE_CATALOG_PRIVATE_KEY/);
  assert.match(main, /createCoursePackage/);
  assert.match(main, /platform_course_catalog_published[\s\S]*packageSha256/);
  assert.doesNotMatch(preload, /getPlatformPublishPreview\(\)/);
  assert.match(preload, /publishPlatformCourseCatalog\(releaseNotes\)/);
  assert.match(ui, /平台版 License 是唯一发布条件/);
  assert.doesNotMatch(ui, /配置平台发布主机/);
  assert.match(ui, /课程包保留版本、文件哈希和完整性校验/);
  assert.doesNotMatch(ui, /平台课程编辑[^与]*身份/);
});

test('license admin packages the canonical key manager and uses its package version', () => {
  const packageJson = JSON.parse(read('tools', 'license-admin-app', 'package.json'));
  const main = read('tools', 'license-admin-app', 'main.cjs');
  const preload = read('tools', 'license-admin-app', 'preload.cjs');
  const html = read('tools', 'license-admin-app', 'renderer', 'index.html');
  const renderer = read('tools', 'license-admin-app', 'renderer', 'renderer.js');
  assert.equal(packageJson.version, '0.5.0');
  assert.match(JSON.stringify(packageJson.build.extraResources), /platform-key-manager\.cjs/);
  assert.match(main, /package\.json/);
  assert.match(main, /process\.resourcesPath[\s\S]*platform-key-manager\.cjs/);
  assert.match(main, /license:createKeyBackup/);
  assert.match(main, /license:restoreKeyBackup/);
  assert.match(main, /license:revokePlatformKey/);
  assert.match(preload, /exportTrustBundle/);
  assert.doesNotMatch(html, /platformRoleField|PLATFORM_EDITOR|PLATFORM_PUBLISHER|PLATFORM_ADMIN|平台身份/);
  assert.doesNotMatch(renderer, /platformRoleField|roleLabel/);
});

test('Windows release script scans sources, staged runtime and packaged artifacts for secrets', () => {
  const build = read('scripts', 'build-windows-release.cjs');
  assert.match(build, /secret-scan-source/);
  assert.match(build, /secret-scan-stage/);
  assert.match(build, /secret-scan-package/);
  assert.match(build, /license_v2_token/);
  assert.match(build, /private_pem/);
  assert.match(build, /platform-key-manager\.cjs/);
  assert.match(build, /assertWindowsLicenseClosure/);
  assert.match(build, /windows-license-policy\.cjs/);
});
