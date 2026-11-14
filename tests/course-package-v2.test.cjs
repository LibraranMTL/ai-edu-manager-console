const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createCourseCatalogStore } = require('../electron/course-catalog-store.cjs');
const {
  createSignedCoursePackage,
  nextCatalogVersion,
  verifySignedCoursePackage,
} = require('../electron/course-package-v2.cjs');

const root = path.resolve(__dirname, '..');
const imagePath = path.join(root, 'public', 'catalog-assets', 'starfall-k5-math.png');

function keys() {
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }),
  };
}

function publishableDraft() {
  return {
    courseId: 'platform:package-test',
    validation: { ok: true, issues: [] },
    course: {
      courseId: 'platform:package-test',
      type: 'platform_standard',
      name: '签名包测试课程',
      provider: '测试提供方',
      url: 'https://example.com/course',
      allowedHosts: ['example.com'],
      coverAsset: 'platform-draft-assets/test.png',
      summary: '验证签名课程包可以生成、校验并安装。',
      subjects: ['math'],
      gradeRange: ['5'],
      languages: ['zh'],
      accountRequirement: '以课程网站说明为准。',
      effectiveAt: '2026-08-01T00:00:00.000Z',
      expiresAt: null,
      legalNotice: '测试课程法律与版权说明。',
      status: 'active',
    },
  };
}

test('platform publisher creates and verifies an installable publisher-signed course package', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'course-package-v2-'));
  const resourceRoot = path.join(temp, 'resources');
  const userDataDir = path.join(temp, 'user-data');
  fs.mkdirSync(path.join(resourceRoot, 'course-catalog'), { recursive: true });
  const { privateKey, publicKey } = keys();
  fs.writeFileSync(path.join(resourceRoot, 'course-catalog', 'public-key.pem'), publicKey);
  const outputPath = path.join(temp, 'catalog-2026.08.01.1.edu-coursepkg');
  const built = createSignedCoursePackage({
    privateKey,
    publicKey,
    keyId: 'course-test-key',
    drafts: [publishableDraft()],
    baseCatalog: { catalogVersion: '', courses: [] },
    issuedAt: '2026-08-01T08:00:00.000Z',
    catalogVersion: '2026.08.01.1',
    outputPath,
    resolveAssetPath: () => imagePath,
  });
  assert.equal(built.ok, true);
  assert.equal(fs.existsSync(outputPath), true);
  const verified = verifySignedCoursePackage(outputPath, { publicKeys: new Map([['course-test-key', publicKey]]), hostVersion: '0.15.7' });
  assert.equal(verified.ok, true, verified.message);
  assert.equal(verified.catalog.courses[0].courseId, 'platform:package-test');
  assert.match(verified.catalog.courses[0].coverAsset, /^platform-assets\/[a-f0-9]{64}\.png$/);

  const store = createCourseCatalogStore({ userDataDir, appVersion: '0.15.7', resourceRoots: [resourceRoot], trustedCourseKeys: [{ keyId: 'course-test-key', publicKey }] });
  const imported = store.importSignedCoursePackage(outputPath);
  assert.equal(imported.ok, true, imported.message);
  assert.equal(store.state().platformCatalog.catalogVersion, '2026.08.01.1');
  assert.equal(fs.existsSync(store.assetPath(imported.catalog.courses[0].coverAsset)), true);
  assert.equal(store.state().currentPlatformPackage.canReExport, true);
  const reExportedPath = path.join(temp, 're-exported-current.edu-coursepkg');
  const reExported = store.exportCurrentCoursePackage(reExportedPath);
  assert.equal(reExported.catalogVersion, '2026.08.01.1');
  assert.equal(fs.existsSync(reExportedPath), true);
  assert.equal(fs.readFileSync(reExportedPath).equals(fs.readFileSync(outputPath)), true);
  assert.equal(reExported.sha256, crypto.createHash('sha256').update(fs.readFileSync(outputPath)).digest('hex'));
  const archivedPath = path.join(userDataDir, 'course-catalog', 'platform-packages', store.state().currentPlatformPackage.filename);
  const tampered = fs.readFileSync(archivedPath);
  tampered[Math.floor(tampered.length / 2)] ^= 0xff;
  fs.writeFileSync(archivedPath, tampered);
  assert.throws(() => store.exportCurrentCoursePackage(path.join(temp, 'tampered-export.edu-coursepkg')), /完整性校验失败/);
});

test('course package rejects drafts that did not pass rights validation', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'course-package-invalid-'));
  const { privateKey, publicKey } = keys();
  assert.throws(() => createSignedCoursePackage({
    privateKey,
    publicKey,
    keyId: 'course-test-key',
    drafts: [{ ...publishableDraft(), validation: { ok: false, issues: ['版权未确认'] } }],
    baseCatalog: { catalogVersion: '', courses: [] },
    outputPath: path.join(temp, 'invalid.edu-coursepkg'),
    resolveAssetPath: () => imagePath,
  }), /未通过发布前校验/);
});

test('course package downgrade is blocked unless a platform rollback explicitly authorizes it', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'course-package-rollback-'));
  const resourceRoot = path.join(temp, 'resources');
  fs.mkdirSync(path.join(resourceRoot, 'course-catalog'), { recursive: true });
  const { privateKey, publicKey } = keys();
  fs.writeFileSync(path.join(resourceRoot, 'course-catalog', 'public-key.pem'), publicKey);
  const build = (version) => {
    const outputPath = path.join(temp, `${version}.edu-coursepkg`);
    createSignedCoursePackage({
      privateKey,
      publicKey,
      keyId: 'course-test-key',
      drafts: [publishableDraft()],
      baseCatalog: { catalogVersion: '', courses: [] },
      issuedAt: '2026-08-01T08:00:00.000Z',
      catalogVersion: version,
      outputPath,
      resolveAssetPath: () => imagePath,
    });
    return outputPath;
  };
  const older = build('2026.08.01.1');
  const newer = build('2026.08.01.2');
  const store = createCourseCatalogStore({ userDataDir: path.join(temp, 'user-data'), appVersion: '0.15.7', resourceRoots: [resourceRoot], trustedCourseKeys: [{ keyId: 'course-test-key', publicKey }] });
  assert.equal(store.importSignedCoursePackage(newer).ok, true);
  const blocked = store.importSignedCoursePackage(older);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'COURSE_CATALOG_DOWNGRADE_BLOCKED');
  assert.equal(store.state().platformCatalog.catalogVersion, '2026.08.01.2');
  assert.equal(store.importSignedCoursePackage(older, { allowRollback: true }).ok, true);
  assert.equal(store.state().platformCatalog.catalogVersion, '2026.08.01.1');
});

test('catalog versions increment within the same UTC release day', () => {
  assert.equal(nextCatalogVersion('2026.08.01.4', new Date('2026-08-01T12:00:00Z')), '2026.08.01.5');
  assert.equal(nextCatalogVersion('2026.07.31.9', new Date('2026-08-01T12:00:00Z')), '2026.08.01.1');
});

test('course package rejects an unknown or wrong receiver trust key', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'course-package-key-rotation-'));
  const oldPair = keys();
  const newPair = keys();
  const outputPath = path.join(temp, 'rotated.edu-coursepkg');
  createSignedCoursePackage({
    privateKey: newPair.privateKey,
    publicKey: newPair.publicKey,
    keyId: 'course-key-2026-b',
    drafts: [publishableDraft()],
    baseCatalog: { catalogVersion: '', courses: [] },
    catalogVersion: '2026.08.02.1',
    outputPath,
    resolveAssetPath: () => imagePath,
  });
  const accepted = verifySignedCoursePackage(outputPath, {
    publicKey: oldPair.publicKey,
    publicKeys: new Map([['course-key-2026-b', newPair.publicKey]]),
    hostVersion: '0.15.7',
  });
  assert.equal(accepted.ok, true, accepted.message);
  const unknownKey = verifySignedCoursePackage(outputPath, {
    publicKeys: new Map([['course-key-2026-a', oldPair.publicKey]]),
    hostVersion: '0.15.7',
  });
  assert.equal(unknownKey.ok, false);
  assert.match(unknownKey.message, /不受信任/);
  const wrongKey = verifySignedCoursePackage(outputPath, {
    publicKeys: new Map([['course-key-2026-b', oldPair.publicKey]]),
    hostVersion: '0.15.7',
  });
  assert.equal(wrongKey.ok, false);
  assert.match(wrongKey.message, /签名验证失败/);
});

test('platform publisher can publish a deletion-only catalog revision', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'course-package-delete-'));
  const { privateKey, publicKey } = keys();
  const existing = publishableDraft().course;
  const outputPath = path.join(temp, 'delete.edu-coursepkg');
  const built = createSignedCoursePackage({
    privateKey,
    publicKey,
    keyId: 'course-test-key',
    drafts: [],
    deletedCourseIds: [existing.courseId],
    baseCatalog: { catalogVersion: '2026.08.01.1', courses: [existing] },
    catalogVersion: '2026.08.02.1',
    issuedAt: '2026-08-02T10:00:00.000Z',
    outputPath,
    resolveAssetPath: () => imagePath,
  });
  assert.equal(built.catalog.courses.length, 0);
  const verified = verifySignedCoursePackage(outputPath, { publicKeys: new Map([['course-test-key', publicKey]]), hostVersion: '0.15.9' });
  assert.equal(verified.ok, true, verified.message);
  assert.equal(verified.catalog.courses.length, 0);
});
