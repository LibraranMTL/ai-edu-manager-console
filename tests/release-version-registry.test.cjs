const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadRegistry, expectedManifestFields, collectVersionRegistryViolations, synchronizeReleaseVersionFiles } = require('../scripts/release-version-registry.cjs');

const root = path.resolve(__dirname, '..');

test('release version registry is the consistent source for manifests, download page and Android build metadata', () => {
  const registry = loadRegistry(root);
  assert.equal(registry.channel, 'production');
  assert.deepEqual(collectVersionRegistryViolations(root), []);
  const fields = expectedManifestFields(registry);
  assert.equal(fields.tabletTerminalVersionName, '0.6.27');
  assert.equal(fields.teacherTerminalVersionName, '0.1.5');
  assert.equal(fields.windowsVersionName, '0.23.3');
  assert.deepEqual(synchronizeReleaseVersionFiles(root, registry), []);
  for (const relativePath of ['android-tablet-terminal/build.ps1', 'android-teacher-terminal/build.ps1']) {
    const source = require('node:fs').readFileSync(path.join(root, relativePath), 'utf8');
    assert.match(source, /check-release-version-registry\.cjs/);
  }
});

test('registry validation reports a divergent manifest version before release', () => {
  const registry = loadRegistry(root);
  const divergent = structuredClone(registry);
  divergent.products.androidStudent.versionName = '0.6.99';
  const violations = collectVersionRegistryViolations(root, divergent);
  assert.ok(violations.some((item) => item.includes('tabletTerminalVersionName')));
  assert.ok(violations.some((item) => item.includes('AndroidManifest.xml')));
  assert.ok(violations.some((item) => item.includes('download.html')));
});
