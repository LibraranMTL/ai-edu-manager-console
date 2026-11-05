const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { canonicalize, syncPublicCourses } = require('../electron/public-course-sync.cjs');
const { createCourseCatalogStore } = require('../electron/course-catalog-store.cjs');

function fixture() {
  const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const digest = crypto.createHash('sha256').update(png).digest('hex');
  const unsigned = { contractId: 'edu-manager.public-course-mvp.v1', schemaVersion: 1, manifestId: 'public-course-stable', manifestRevision: 'manifest-rev-test', releaseId: 'release-test', audienceKey: 'global', audienceRevision: 'global-v1', selectionReason: 'test', issuedAt: '2026-11-05T00:00:00.000Z', effectiveAt: '2026-11-05T00:00:00.000Z', expiresAt: '2026-11-06T00:00:00.000Z', previousRevision: '', minClientVersions: {}, courses: [{ courseId: 'platform:igsce', locale: 'en-GB', title: 'IGCSE', summary: 'Course', provider: 'Provider', launchUrl: 'https://example.com/course', allowedHosts: ['example.com'], coverAssetRevisionId: 'asset-rev-test', gradeBands: ['9'], legalNotice: 'Notice', accountRequirement: '', offlineOpenTtlSeconds: 900 }], assets: [{ assetRevisionId: 'asset-rev-test', sha256: digest, bytes: png.length, mimeType: 'image/png', downloadPath: '/v2/public-content/assets/asset-rev-test' }], tombstones: [], keyId: 'test-key', signatureAlgorithm: 'RSA-SHA256' };
  const manifest = { ...unsigned, signature: crypto.sign('RSA-SHA256', Buffer.from(canonicalize(unsigned)), keys.privateKey).toString('base64') };
  return { manifest, png, publicKeys: new Map([['test-key', keys.publicKey]]) };
}

test('Windows public course sync verifies signature and assets then uses ETag cache', async () => {
  const value = fixture();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'public-course-sync-'));
  const cacheDir = path.join(userDataDir, 'course-catalog', 'public-content');
  let notModified = false;
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(String(url));
    if (String(url).endsWith('/manifest')) return notModified ? new Response(null, { status: 304 }) : Response.json(value.manifest, { headers: { etag: '"manifest-rev-test"' } });
    return new Response(value.png, { status: 200, headers: { 'content-type': 'image/png' } });
  };
  const first = await syncPublicCourses({ baseUrl: 'http://localhost/edu-cloud', allowHttpForTests: true, cacheDir, fetchImpl, publicKeys: value.publicKeys, now: () => Date.parse('2026-11-05T01:00:00Z') });
  assert.equal(first.catalog.courses[0].courseId, 'platform:igsce');
  assert.equal(first.catalog.courses[0].languages[0], 'en-GB');
  assert.match(first.catalog.courses[0].coverAsset, /^cloud-assets\/[a-f0-9]{64}\.png$/);
  const store = createCourseCatalogStore({ userDataDir, appVersion: '0.23.4', resourceRoots: [], trustedCourseKeys: [{ keyId: 'test-key', publicKey: value.publicKeys.get('test-key').export({ type: 'spki', format: 'pem' }) }] });
  assert.equal(store.state().platformCatalog.manifestRevision, 'manifest-rev-test');
  assert.equal(store.coursesForStudent({ id: 'student-a', grade: '9' })[0].courseId, 'platform:igsce');
  assert.equal(fs.existsSync(store.assetPath(store.state().platformCatalog.courses[0].coverAsset)), true);
  notModified = true;
  assert.equal(requested[0], 'http://localhost/edu-cloud/v2/public-content/manifest');
  assert.equal(requested[1], 'http://localhost/edu-cloud/v2/public-content/assets/asset-rev-test');
  const second = await syncPublicCourses({ baseUrl: 'http://localhost/edu-cloud', allowHttpForTests: true, cacheDir, fetchImpl, publicKeys: value.publicKeys, now: () => Date.parse('2026-11-05T01:01:00Z') });
  assert.equal(second.notModified, true);
});

test('Windows public course sync rejects a changed signature and non-HTTPS production URL', async () => {
  const value = fixture(); value.manifest.courses[0].title = 'tampered';
  await assert.rejects(syncPublicCourses({ baseUrl: 'http://localhost', cacheDir: os.tmpdir(), fetchImpl: async () => Response.json(value.manifest), publicKeys: value.publicKeys }), /HTTPS/);
  await assert.rejects(syncPublicCourses({ baseUrl: 'http://localhost', allowHttpForTests: true, cacheDir: fs.mkdtempSync(path.join(os.tmpdir(), 'public-course-sync-bad-')), fetchImpl: async () => Response.json(value.manifest), publicKeys: value.publicKeys, now: () => Date.parse('2026-11-05T01:00:00Z') }), /签名验证失败/);
});
