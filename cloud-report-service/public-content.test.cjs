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

function fixture(now = () => Date.now()) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-public-content-'));
  const adminToken = 'admin-token-that-is-longer-than-24-characters';
  const service = createService({ dataDir: root, adminToken, now });
  const session = service.loginAdmin(adminToken).sessionToken;
  const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicContent = createPublicContentService({
    db: service.db,
    dataDir: root,
    isAdmin: service.isAdmin,
    privateKey: keys.privateKey,
    keyId: 'course-catalog-primary-2026',
    now,
  });
  return { root, service, session, keys, publicContent, close() { service.close(); fs.rmSync(root, { recursive: true, force: true }); } };
}

test('a new deployment serves a stable signed empty revocation list', () => {
  const fx = fixture();
  try {
    const first = fx.publicContent.signedRevocations();
    const second = fx.publicContent.signedRevocations();
    assert.deepEqual(first.payload.tombstones, []);
    assert.match(first.payload.revocationRevision, /^revocations-[a-f0-9]{32}$/);
    assert.equal(verifySignedObject(first.payload, fx.keys.publicKey), true);
    assert.equal(first.etag, second.etag);
    assert.deepEqual(first.payload, second.payload);
  } finally { fx.close(); }
});

test('renewal requires explicit approval and preserves the approved signed content', () => {
  let clock = Date.now(); const fx = fixture(() => clock);
  try {
    const asset = fx.publicContent.putAsset(fx.session, { assetId: 'asset:renew-cover', mimeType: 'image/png', contentBase64: pngFixture('renew').toString('base64') });
    fx.publicContent.saveCourse(fx.session, course(asset.assetRevisionId));
    fx.publicContent.saveCardTemplate(fx.session, cardTemplate());
    fx.publicContent.saveCardPack(fx.session, cardPack());
    const candidate = fx.publicContent.validateRelease(fx.session, { releaseId: 'release:renew-approved-1', courseIds: ['platform:starfall-k5-math'], cardPackIds: [cardPack().packId] });
    fx.publicContent.publishRelease(fx.session, { releaseId: candidate.releaseId, expectedManifestSha256: candidate.manifestSha256 });
    assert.equal(fx.publicContent.renewIfDue().status, 'disabled');
    assert.throws(() => fx.publicContent.configureRenewal(fx.session, { enabled: true, expectedManifestRevision: candidate.manifest.manifestRevision, expectedManifestSha256: '0'.repeat(64) }), /活动清单已变化/);
    fx.publicContent.configureRenewal(fx.session, { enabled: true, expectedManifestRevision: candidate.manifest.manifestRevision, expectedManifestSha256: candidate.manifestSha256 });
    assert.equal(fx.publicContent.renewIfDue().status, 'not_due');
    fx.publicContent.saveCourse(fx.session, course(asset.assetRevisionId, { title: 'Unpublished draft' }));
    clock += 18 * 60 * 60 * 1000 + 1;
    assert.equal(fx.publicContent.renewIfDue().status, 'renewed');
    const renewed = fx.publicContent.activeManifest().manifest;
    assert.equal(verifySignedObject(renewed, fx.keys.publicKey), true);
    assert.equal(renewed.previousRevision, candidate.manifest.manifestRevision);
    assert.deepEqual(renewed.courses, candidate.manifest.courses);
    assert.deepEqual(renewed.cardPacks, candidate.manifest.cardPacks);
    assert.deepEqual(renewed.assets, candidate.manifest.assets);
    assert.equal(Date.parse(renewed.expiresAt) - Date.parse(renewed.issuedAt), 24 * 60 * 60 * 1000);
    assert.equal(fx.publicContent.renewIfDue().status, 'not_due');
    const freshSession = fx.service.loginAdmin('admin-token-that-is-longer-than-24-characters').sessionToken;
    fx.publicContent.emergencyWithdraw(freshSession, { releaseId: 'release:renew-withdraw-1', courseId: 'platform:starfall-k5-math' });
    assert.equal(fx.publicContent.renewalStatus(freshSession).enabled, false);
    assert.equal(fx.publicContent.renewIfDue().status, 'disabled');
    assert.equal(fx.publicContent.activeManifest().manifest.courses.length, 0);
  } finally { fx.close(); }
});

test('expired candidates and corrupted approved assets fail closed', () => {
  let clock = Date.now(); const fx = fixture(() => clock);
  try {
    const asset = fx.publicContent.putAsset(fx.session, { assetId: 'asset:renew-failure-cover', mimeType: 'image/png', contentBase64: pngFixture('safe').toString('base64') });
    fx.publicContent.saveCourse(fx.session, course(asset.assetRevisionId));
    const expired = fx.publicContent.validateRelease(fx.session, { releaseId: 'release:expired-candidate-1', courseIds: ['platform:starfall-k5-math'] });
    clock += 24 * 60 * 60 * 1000;
    const freshSession = fx.service.loginAdmin('admin-token-that-is-longer-than-24-characters').sessionToken;
    assert.throws(() => fx.publicContent.publishRelease(freshSession, { releaseId: expired.releaseId, expectedManifestSha256: expired.manifestSha256 }), /候选清单已过期/);
    const valid = fx.publicContent.validateRelease(freshSession, { releaseId: 'release:renew-failure-1', courseIds: ['platform:starfall-k5-math'] });
    fx.publicContent.publishRelease(freshSession, { releaseId: valid.releaseId, expectedManifestSha256: valid.manifestSha256 });
    fx.publicContent.configureRenewal(freshSession, { enabled: true, expectedManifestRevision: valid.manifest.manifestRevision, expectedManifestSha256: valid.manifestSha256 });
    const file = fx.publicContent.asset(asset.assetRevisionId).filePath;
    const bytes = fs.readFileSync(file); bytes[bytes.length - 1] ^= 1; fs.writeFileSync(file, bytes);
    clock += 19 * 60 * 60 * 1000;
    assert.throws(() => fx.publicContent.renewIfDue(), /资源校验失败/);
    assert.equal(fx.publicContent.activeManifest().manifest.manifestRevision, valid.manifest.manifestRevision);
  } finally { fx.close(); }
});

test('publication rejects a tampered candidate and a candidate based on a superseded active revision', () => {
  const fx = fixture();
  try {
    const asset = fx.publicContent.putAsset(fx.session, { assetId: 'asset:publish-safety-cover', mimeType: 'image/png', contentBase64: pngFixture('safe').toString('base64') });
    fx.publicContent.saveCourse(fx.session, course(asset.assetRevisionId));
    const one = fx.publicContent.validateRelease(fx.session, { releaseId: 'release:publish-safety-one', courseIds: ['platform:starfall-k5-math'] });
    const stale = fx.publicContent.validateRelease(fx.session, { releaseId: 'release:publish-safety-stale', courseIds: ['platform:starfall-k5-math'] });
    fx.publicContent.publishRelease(fx.session, { releaseId: one.releaseId, expectedManifestSha256: one.manifestSha256 });
    assert.throws(() => fx.publicContent.publishRelease(fx.session, { releaseId: stale.releaseId, expectedManifestSha256: stale.manifestSha256 }), /活动清单已变化/);
    const tampered = fx.publicContent.validateRelease(fx.session, { releaseId: 'release:publish-safety-tampered', courseIds: ['platform:starfall-k5-math'] });
    const altered = structuredClone(tampered.manifest); altered.courses[0].title = 'Altered after review';
    fx.service.db.prepare('UPDATE public_content_releases SET manifest_json=? WHERE release_id=?').run(JSON.stringify(altered), tampered.releaseId);
    assert.throws(() => fx.publicContent.publishRelease(fx.session, { releaseId: tampered.releaseId, expectedManifestSha256: tampered.manifestSha256 }), /签名或哈希不匹配/);
    assert.equal(fx.publicContent.activeManifest().manifest.manifestRevision, one.manifest.manifestRevision);
  } finally { fx.close(); }
});

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

function cardTemplate(overrides = {}) {
  return {
    templateId: 'platform:card-template:math-place-value-01',
    templateType: 'single_choice',
    subject: 'Mathematics',
    knowledgePointIds: ['kp:place-value'],
    difficulty: 'basic',
    gradeBands: ['3'],
    ageRange: '8-9',
    locale: 'en-US',
    prompt: 'Which digit represents the tens place in 245?',
    answerPolicy: 'exact',
    answer: '4',
    explanation: 'The tens digit is the second digit from the right.',
    hintPolicy: 'on_request',
    sourceRefs: ['public:math-place-value-v1'],
    courseIds: ['platform:starfall-k5-math'],
    tags: ['place-value'],
    generatorVersion: 'human-authored',
    ...overrides,
  };
}

function cardPack(overrides = {}) {
  return {
    packId: 'platform:card-pack:math-place-value-01',
    title: 'Place Value Practice',
    summary: 'Short practice for the tens and ones places.',
    locale: 'en-US',
    gradeBands: ['3'],
    ageRange: '8-9',
    courseIds: ['platform:starfall-k5-math'],
    tags: ['place-value'],
    templateIds: ['platform:card-template:math-place-value-01'],
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
    const replacement = fx.publicContent.validateRelease(fx.session, {
      releaseId: 'release:course-mvp-2', courseIds: ['platform:starfall-k5-math'],

    });
    fx.publicContent.publishRelease(fx.session, { releaseId: replacement.releaseId, expectedManifestSha256: replacement.manifestSha256 });
    const rolledBack = fx.publicContent.rollbackRelease(fx.session, {
      releaseId: 'release:course-mvp-rollback-1', targetManifestRevision: validated.manifest.manifestRevision,
      expectedTargetManifestSha256: validated.manifestSha256,
    });
    assert.equal(rolledBack.status, 'active');
    assert.equal(fx.publicContent.activeManifest().manifest.courses.length, 1);
    const withdrawn = fx.publicContent.emergencyWithdraw(fx.session, {
      releaseId: 'release:course-mvp-withdraw-1', courseId: 'platform:starfall-k5-math', reasonCode: 'content_risk', severity: 'high',
    });
    assert.equal(withdrawn.status, 'active');
    assert.equal(fx.publicContent.activeManifest().manifest.courses.length, 0);
    const revocations = fx.publicContent.signedRevocations();
    assert.equal(revocations.payload.tombstones[0].courseId, 'platform:starfall-k5-math');
    assert.equal(verifySignedObject(revocations.payload, fx.keys.publicKey), true);
    assert.throws(() => fx.publicContent.rollbackRelease(fx.session, {
      releaseId: 'release:course-mvp-rollback-blocked', targetManifestRevision: validated.manifest.manifestRevision,
      expectedTargetManifestSha256: validated.manifestSha256,
    }), /已紧急撤回课程/);
    assert.throws(() => fx.publicContent.validateRelease(fx.session, {
      releaseId: 'release:course-mvp-republish-blocked', courseIds: ['platform:starfall-k5-math'],

    }), /已紧急撤回课程/);
    const blockedRelease = fx.publicContent.listReleases(fx.session).releases.find(item => item.releaseId === validated.releaseId);
    assert.equal(blockedRelease.containsRevokedCourse, true);
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

test('admin inventory lists assets, course drafts and immutable release hashes', () => {
  const fx = fixture();
  try {
    const asset = fx.publicContent.putAsset(fx.session, {
      assetId: 'asset:list-cover', mimeType: 'image/png', contentBase64: pngFixture('list-fixture').toString('base64'),
    });
    fx.publicContent.saveCourse(fx.session, course(asset.assetRevisionId));
    const validated = fx.publicContent.validateRelease(fx.session, {
      releaseId: 'release:list-001', courseIds: ['platform:starfall-k5-math'],

    });
    assert.equal(fx.publicContent.listAssets(fx.session).assets[0].assetRevisionId, asset.assetRevisionId);
    assert.equal(fx.publicContent.listCourses(fx.session).courses[0].locale, 'en-US');
    assert.equal(fx.publicContent.listReleases(fx.session).releases[0].manifestSha256, validated.manifestSha256);
    assert.throws(() => fx.publicContent.listReleases('not-admin'), /管理员/);
  } finally { fx.close(); }
});

test('public learning-card template and pack drafts enter the signed release without student data', () => {
  const fx = fixture();
  try {
    const asset = fx.publicContent.putAsset(fx.session, {
      assetId: 'asset:card-pack-cover', mimeType: 'image/png', contentBase64: pngFixture('card-pack-fixture').toString('base64'),
    });
    fx.publicContent.saveCourse(fx.session, course(asset.assetRevisionId));
    const savedTemplate = fx.publicContent.saveCardTemplate(fx.session, cardTemplate());
    assert.equal(savedTemplate.status, 'draft');
    const savedPack = fx.publicContent.saveCardPack(fx.session, cardPack());
    assert.equal(savedPack.status, 'draft');
    assert.equal(fx.publicContent.listCardTemplates(fx.session).templates[0].templateId, cardTemplate().templateId);
    assert.equal(fx.publicContent.listCardPacks(fx.session).packs[0].packId, cardPack().packId);
    const validated = fx.publicContent.validateRelease(fx.session, {
      releaseId: 'release:cards-001', courseIds: ['platform:starfall-k5-math'], cardPackIds: [cardPack().packId],

    });
    assert.equal(validated.manifest.cardPacks.length, 1);
    assert.equal(validated.manifest.cardPacks[0].templates[0].templateId, cardTemplate().templateId);
    assert.equal(verifySignedObject(validated.manifest, fx.keys.publicKey), true);
    assert.equal(JSON.stringify(validated.manifest).includes('studentId'), false);
    fx.publicContent.publishRelease(fx.session, { releaseId: validated.releaseId, expectedManifestSha256: validated.manifestSha256 });
    assert.equal(fx.publicContent.activeManifest().manifest.cardPacks[0].packId, cardPack().packId);
    assert.ok(fx.service.db.prepare('SELECT 1 FROM schema_migrations WHERE id=?').get('cloud-public-learning-card-v1'));
  } finally { fx.close(); }
});

test('public learning-card drafts reject unverifiable answers, mixed locales and missing release courses', () => {
  const fx = fixture();
  try {
    assert.throws(() => fx.publicContent.saveCardTemplate(fx.session, cardTemplate({ answer: '' })), /必须提供答案/);
    fx.publicContent.saveCardTemplate(fx.session, cardTemplate());
    assert.throws(() => fx.publicContent.saveCardPack(fx.session, cardPack({ locale: 'en-GB' })), /语言必须一致/);
    const foreignCourseTemplate = cardTemplate({
      templateId: 'platform:card-template:math-foreign-course-01',
      courseIds: ['platform:codeorg-k12-computing'],
    });
    fx.publicContent.saveCardTemplate(fx.session, foreignCourseTemplate);
    assert.throws(() => fx.publicContent.saveCardPack(fx.session, cardPack({
      packId: 'platform:card-pack:math-foreign-course-01',
      templateIds: [foreignCourseTemplate.templateId],
    })), /关联课程必须属于卡片包/);
    fx.publicContent.saveCardPack(fx.session, cardPack());
    assert.throws(() => fx.publicContent.validateRelease(fx.session, {
      releaseId: 'release:cards-missing-course', cardPackIds: [cardPack().packId],

    }), /关联课程未纳入同一发布/);
  } finally { fx.close(); }
});

test('public content observability hashes client identity and reconciles bounded receipts', () => {
  const fx = fixture();
  try {
    const asset = fx.publicContent.putAsset(fx.session, {
      assetId: 'asset:metrics-cover', mimeType: 'image/png', contentBase64: pngFixture('metrics-fixture').toString('base64'),
    });
    fx.publicContent.saveCourse(fx.session, course(asset.assetRevisionId));
    const validated = fx.publicContent.validateRelease(fx.session, {
      releaseId: 'release:metrics-001', courseIds: ['platform:starfall-k5-math'],

    });
    fx.publicContent.publishRelease(fx.session, { releaseId: validated.releaseId, expectedManifestSha256: validated.manifestSha256 });
    fx.publicContent.recordDelivery('manifest.read', 'success', validated.manifest.manifestRevision, 1234);
    const clientId = 'host:high-entropy-installation-id-001';
    const applied = fx.publicContent.recordSyncReceipt({ receiptId: 'receipt:metrics-applied-001', clientInstanceId: clientId,
      clientType: 'windows_host', clientVersion: '0.23.4', outcome: 'applied', manifestRevision: validated.manifest.manifestRevision,
      observedAt: new Date().toISOString() });
    assert.equal(applied.disposition, 'reconciled');
    assert.equal(fx.publicContent.recordSyncReceipt({ receiptId: 'receipt:metrics-applied-001', clientInstanceId: clientId,
      clientType: 'windows_host', clientVersion: '0.23.4', outcome: 'applied', manifestRevision: validated.manifest.manifestRevision }).duplicate, true);
    assert.equal(fx.publicContent.recordSyncReceipt({ receiptId: 'receipt:metrics-retry-001', clientInstanceId: clientId,
      clientType: 'windows_host', clientVersion: '0.23.4', outcome: 'network_failed', attemptCount: 2 }).disposition, 'auto_retry');
    assert.equal(fx.publicContent.recordSyncReceipt({ receiptId: 'receipt:metrics-blocked-001', clientInstanceId: clientId,
      clientType: 'windows_host', clientVersion: '0.23.4', outcome: 'blocked_signature' }).disposition, 'needs_handling');
    const stored = fx.service.db.prepare('SELECT client_hash AS clientHash FROM public_content_sync_receipts WHERE receipt_id=?').get('receipt:metrics-applied-001');
    assert.equal(stored.clientHash, crypto.createHash('sha256').update(clientId).digest('hex'));
    assert.equal(JSON.stringify(fx.publicContent.operations(fx.session, 24)).includes(clientId), false);
    const operations = fx.publicContent.operations(fx.session, 24);
    assert.equal(operations.summary.total, 3);
    assert.equal(operations.summary.needs_handling, 1);
    assert.equal(operations.delivery[0].requestCount, 1);
    assert.equal(operations.receiptAttestation, 'unverified_telemetry');
    assert.ok(operations.alerts.some(item => item.code === 'sync_needs_handling'));
    assert.ok(fx.service.db.prepare('SELECT 1 FROM schema_migrations WHERE id=?').get('cloud-public-content-observability-v1'));
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

    });
    app.publicContent.publishRelease(session, { releaseId: validated.releaseId, expectedManifestSha256: validated.manifestSha256 });
    const manifest = await fetch(`${base}/v2/public-content/manifest`);
    assert.equal(manifest.status, 200);
    const etag = manifest.headers.get('etag');
    assert.ok(etag);
    assert.equal((await manifest.json()).releaseId, 'release:http-1');
    const unchanged = await fetch(`${base}/v2/public-content/manifest`, { headers: { 'if-none-match': etag } });
    assert.equal(unchanged.status, 304);
    const emptyRevocations = await fetch(`${base}/v2/public-content/revocations`);
    assert.equal(emptyRevocations.status, 200);
    const revocationEtag = emptyRevocations.headers.get('etag');
    const emptyPayload = await emptyRevocations.json();
    assert.deepEqual(emptyPayload.tombstones, []);
    assert.equal(verifySignedObject(emptyPayload, keys.publicKey), true);
    assert.equal((await fetch(`${base}/v2/public-content/revocations`, { headers: { 'if-none-match': revocationEtag } })).status, 304);
    const immutableRelease = await fetch(`${base}/v2/public-content/releases/${validated.manifest.manifestRevision}`);
    assert.equal(immutableRelease.status, 200);
    const releaseSnapshot = await immutableRelease.json();
    assert.equal(releaseSnapshot.manifestSha256, validated.manifestSha256);
    assert.equal(releaseSnapshot.manifest.manifestRevision, validated.manifest.manifestRevision);
    assert.deepEqual(releaseSnapshot.manifest.courses.map(item => item.courseId), ['platform:starfall-k5-math']);
    const ranged = await fetch(`${base}/v2/public-content/assets/${asset.assetRevisionId}`, { headers: { range: 'bytes=0-4' } });
    assert.equal(ranged.status, 206);
    assert.equal(Buffer.from(await ranged.arrayBuffer()).equals(bytes.subarray(0, 5)), true);
    assert.equal(ranged.headers.get('content-range'), `bytes 0-4/${bytes.length}`);
    const receipt = await fetch(`${base}/v2/public-content/sync-receipts`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ receiptId: 'receipt:http-applied-001', clientInstanceId: 'host:http-fixture-instance-001', clientType: 'windows_host',
        clientVersion: '0.23.4', outcome: 'applied', manifestRevision: validated.manifest.manifestRevision, observedAt: new Date().toISOString() }) });
    assert.equal(receipt.status, 201);
    assert.equal((await receipt.json()).disposition, 'reconciled');
    const operations = await fetch(`${base}/v2/admin/public-content/operations?windowHours=24`, { headers: { authorization: `Bearer ${session}` } });
    assert.equal(operations.status, 200);
    assert.equal((await operations.json()).summary.reconciled, 1);
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('public learning-card draft HTTP endpoints require an administrator and publish signed card packs', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-public-card-http-'));
  const adminToken = 'admin-token-that-is-longer-than-24-characters';
  const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const app = createHttpServer({ dataDir: root, adminToken, materialIndexer: false,
    publicContentPrivateKey: keys.privateKey, publicContentKeyId: 'course-catalog-primary-2026' });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const denied = await fetch(`${base}/v2/admin/card-templates`);
    assert.equal(denied.status, 401);
    const session = app.service.loginAdmin(adminToken).sessionToken;
    const asset = app.publicContent.putAsset(session, {
      assetId: 'asset:card-http-cover', mimeType: 'image/png', contentBase64: pngFixture('card-http').toString('base64'),
    });
    app.publicContent.saveCourse(session, course(asset.assetRevisionId));
    const headers = { authorization: `Bearer ${session}`, 'content-type': 'application/json' };
    const template = await fetch(`${base}/v2/admin/card-templates`, { method: 'POST', headers, body: JSON.stringify(cardTemplate()) });
    assert.equal(template.status, 201);
    const pack = await fetch(`${base}/v2/admin/card-packs`, { method: 'POST', headers, body: JSON.stringify(cardPack()) });
    assert.equal(pack.status, 201);
    const validate = await fetch(`${base}/v2/admin/releases/validate`, { method: 'POST', headers, body: JSON.stringify({
      releaseId: 'release:cards-http-001', courseIds: ['platform:starfall-k5-math'], cardPackIds: [cardPack().packId],

    }) });
    assert.equal(validate.status, 200);
    const candidate = await validate.json();
    assert.equal(candidate.manifest.cardPacks[0].templates[0].answer, '4');
    const publish = await fetch(`${base}/v2/admin/releases/publish`, { method: 'POST', headers, body: JSON.stringify({
      releaseId: candidate.releaseId, expectedManifestSha256: candidate.manifestSha256,
    }) });
    assert.equal(publish.status, 200);
    const manifest = await fetch(`${base}/v2/public-content/manifest`);
    assert.equal((await manifest.json()).cardPacks[0].packId, cardPack().packId);
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('public asset HTTP upload accepts a base64 envelope larger than the default JSON limit', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-public-http-large-'));
  const adminToken = 'admin-token-that-is-longer-than-24-characters';
  const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const app = createHttpServer({ dataDir: root, adminToken, materialIndexer: false,
    publicContentPrivateKey: keys.privateKey, publicContentKeyId: 'course-catalog-primary-2026' });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const session = app.service.loginAdmin(adminToken).sessionToken;
    const bytes = Buffer.alloc(4 * 1024 * 1024 + 256, 0x2a);
    pngFixture().copy(bytes, 0, 0, 8);
    const response = await fetch(`${base}/v2/admin/content/assets`, {
      method: 'POST',
      headers: { authorization: `Bearer ${session}`, 'content-type': 'application/json' },
      body: JSON.stringify({ assetId: 'asset:large-http-cover', mimeType: 'image/png', contentBase64: bytes.toString('base64') }),
    });
    const responseText = await response.text();
    assert.equal(response.status, 201, responseText);
    assert.equal(JSON.parse(responseText).bytes, bytes.length);
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
