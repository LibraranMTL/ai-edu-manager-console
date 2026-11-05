'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createService } = require('./service.cjs');
const { createHttpServer } = require('./http.cjs');
const { createPublicContentService, verifySignedObject } = require('./public-content.cjs');

const pngFixture = (text = 'fixture') => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(text)]);

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-public-content-'));
  const adminToken = 'admin-token-that-is-longer-than-24-characters';
  const service = createService({ dataDir: root, adminToken });
  const session = service.loginAdmin(adminToken).sessionToken;
  const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicContent = createPublicContentService({
    db: service.db,
    dataDir: root,
    isAdmin: service.isAdmin,
    privateKey: keys.privateKey,
    keyId: 'course-catalog-primary-2026',
  });
  return { root, service, session, keys, publicContent, close() { service.close(); fs.rmSync(root, { recursive: true, force: true }); } };
}

function course(assetRevisionId, overrides = {}) {
  return {
    courseId: 'platform:starfall-k5-math',
    courseRevision: 'course-rev-starfall-1',
    localizationRevision: 'loc-rev-starfall-en-us-1',
    locale: 'en-US',
    title: 'Starfall K-5 Math',
    summary: 'English mathematics learning resources.',
    provider: 'Starfall',
    launchUrl: 'https://www.starfall.com/h/',
    allowedHosts: ['www.starfall.com'],
    coverAssetRevisionId: assetRevisionId,
    gradeBands: ['K', '1', '2', '3', '4', '5'],
    ageRange: '5-11',
    legalNotice: 'Third-party course; the platform supplies a curated link only.',
    accountRequirement: 'Provider rules apply.',
    offlineOpenTtlSeconds: 21600,
    minClientVersions: { windowsHost: '0.23.4', androidStandalone: '1.3.5' },
    ...overrides,
  };
}

test('public course release is signed, idempotent and withdrawable', () => {
  const fx = fixture();
  try {
    const asset = fx.publicContent.putAsset(fx.session, {
      assetId: 'asset:starfall-cover', mimeType: 'image/png', contentBase64: pngFixture('png-fixture').toString('base64'),
    });
    fx.publicContent.saveCourse(fx.session, course(asset.assetRevisionId));
    const validated = fx.publicContent.validateRelease(fx.session, {
      releaseId: 'release:course-mvp-1', courseIds: ['platform:starfall-k5-math'],
      issuedAt: '2026-11-05T00:00:00.000Z', effectiveAt: '2026-11-05T00:00:00.000Z', expiresAt: '2026-11-06T00:00:00.000Z',
      minClientVersions: { windowsHost: '0.23.4', androidStandalone: '1.3.5' },
    });
    assert.equal(validated.status, 'validated');
    assert.equal(verifySignedObject(validated.manifest, fx.keys.publicKey), true);
    const tampered = structuredClone(validated.manifest);
    tampered.courses[0].title = 'Tampered';
    assert.equal(verifySignedObject(tampered, fx.keys.publicKey), false);
    const published = fx.publicContent.publishRelease(fx.session, {
      releaseId: validated.releaseId, expectedManifestSha256: validated.manifestSha256,
    });
    assert.equal(published.status, 'active');
    assert.equal(fx.publicContent.publishRelease(fx.session, {
      releaseId: validated.releaseId, expectedManifestSha256: validated.manifestSha256,
    }).duplicate, true);
    assert.equal(fx.publicContent.activeManifest().manifest.courses.length, 1);
    const withdrawn = fx.publicContent.emergencyWithdraw(fx.session, {
      releaseId: 'release:course-mvp-withdraw-1', courseId: 'platform:starfall-k5-math', reasonCode: 'content_risk', severity: 'high',
    });
    assert.equal(withdrawn.status, 'active');
    assert.equal(fx.publicContent.activeManifest().manifest.courses.length, 0);
    const revocations = fx.publicContent.signedRevocations();
    assert.equal(revocations.payload.tombstones[0].courseId, 'platform:starfall-k5-math');
    assert.equal(verifySignedObject(revocations.payload, fx.keys.publicKey), true);
    const rolledBack = fx.publicContent.rollbackRelease(fx.session, {
      releaseId: 'release:course-mvp-rollback-1', targetManifestRevision: validated.manifest.manifestRevision,
      expectedTargetManifestSha256: validated.manifestSha256,
    });
    assert.equal(rolledBack.status, 'active');
    assert.equal(fx.publicContent.activeManifest().manifest.courses.length, 1);
  } finally { fx.close(); }
});

test('public course contract rejects generic locale, HTTP and changed candidate hash', () => {
  const fx = fixture();
  try {
    const asset = fx.publicContent.putAsset(fx.session, {
      assetId: 'asset:starfall-cover', mimeType: 'image/png', contentBase64: pngFixture('png-fixture').toString('base64'),
    });
    assert.throws(() => fx.publicContent.saveCourse(fx.session, course(asset.assetRevisionId, { locale: 'en' })), /11种locale/);
    assert.throws(() => fx.publicContent.saveCourse(fx.session, course(asset.assetRevisionId, { launchUrl: 'http://www.starfall.com/h/' })), /HTTPS/);
    fx.publicContent.saveCourse(fx.session, course(asset.assetRevisionId));
    const validated = fx.publicContent.validateRelease(fx.session, {
      releaseId: 'release:hash-check', courseIds: ['platform:starfall-k5-math'],
      issuedAt: '2026-11-05T00:00:00.000Z', expiresAt: '2026-11-06T00:00:00.000Z',
    });
    assert.throws(() => fx.publicContent.publishRelease(fx.session, {
      releaseId: validated.releaseId, expectedManifestSha256: '0'.repeat(64),
    }), /候选清单已经变化/);
  } finally { fx.close(); }
});

test('public content uses a separate migration and object root', () => {
  const fx = fixture();
  try {
    assert.equal(fx.publicContent.schemaStatus().migrationId, 'cloud-public-content-v1');
    assert.equal(fs.existsSync(path.join(fx.root, 'public-content-objects')), true);
    assert.ok(fx.service.db.prepare('SELECT 1 FROM schema_migrations WHERE id=?').get('cloud-public-content-v1'));
  } finally { fx.close(); }
});

test('public HTTP endpoints support ETag, 304 and byte ranges', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-public-http-'));
  const adminToken = 'admin-token-that-is-longer-than-24-characters';
  const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const app = createHttpServer({ dataDir: root, adminToken, materialIndexer: false,
    publicContentPrivateKey: keys.privateKey, publicContentKeyId: 'course-catalog-primary-2026' });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const session = app.service.loginAdmin(adminToken).sessionToken;
    const bytes = pngFixture('range-fixture');
    const asset = app.publicContent.putAsset(session, {
      assetId: 'asset:http-cover', mimeType: 'image/png', contentBase64: bytes.toString('base64'),
    });
    app.publicContent.saveCourse(session, course(asset.assetRevisionId));
    const validated = app.publicContent.validateRelease(session, {
      releaseId: 'release:http-1', courseIds: ['platform:starfall-k5-math'],
      issuedAt: '2026-11-05T00:00:00.000Z', expiresAt: '2026-11-06T00:00:00.000Z',
    });
    app.publicContent.publishRelease(session, { releaseId: validated.releaseId, expectedManifestSha256: validated.manifestSha256 });
    const manifest = await fetch(`${base}/v2/public-content/manifest`);
    assert.equal(manifest.status, 200);
    const etag = manifest.headers.get('etag');
    assert.ok(etag);
    assert.equal((await manifest.json()).releaseId, 'release:http-1');
    const unchanged = await fetch(`${base}/v2/public-content/manifest`, { headers: { 'if-none-match': etag } });
    assert.equal(unchanged.status, 304);
    const ranged = await fetch(`${base}/v2/public-content/assets/${asset.assetRevisionId}`, { headers: { range: 'bytes=0-4' } });
    assert.equal(ranged.status, 206);
    assert.equal(Buffer.from(await ranged.arrayBuffer()).equals(bytes.subarray(0, 5)), true);
    assert.equal(ranged.headers.get('content-range'), `bytes 0-4/${bytes.length}`);
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
