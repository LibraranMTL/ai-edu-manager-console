'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { previewMigration } = require('../scripts/preview-public-course-migration.cjs');
const crypto = require('node:crypto');
const { createHttpServer } = require('../cloud-report-service/http.cjs');
const { prepareMigration } = require('../scripts/prepare-public-course-migration.cjs');
const { applyMigration, verifyPlan } = require('../scripts/apply-public-course-migration.cjs');

test('migration preview preserves ids, maps four English locales and only reports orphan assets', () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'course-migration-preview-'));
  const root = path.join(userData, 'course-catalog');
  fs.mkdirSync(path.join(root, 'custom-assets'), { recursive: true });
  const platformCourses = [
    ['platform:starfall-k5-math', ['en'], 'platform-assets/a.png'],
    ['platform:codeorg-k12-computing', ['en'], 'platform-assets/b.png'],
    ['platform:igsce', [], 'platform-assets/c.png'],
  ].map(([courseId, languages, coverAsset]) => ({ courseId, type: 'platform_standard', languages, coverAsset, url: 'https://example.com' }));
  const tenantCourse = { courseId: 'tenant:custom-5e20b98a0efe27f02cf2', type: 'tenant_custom', languages: [],
    coverAsset: 'custom-assets/used.png', url: 'https://example.com' };
  fs.writeFileSync(path.join(root, 'last-good.json'), JSON.stringify({ catalogVersion: '2026.08.05.1', courses: platformCourses }));
  fs.writeFileSync(path.join(root, 'tenant-custom-courses.json'), JSON.stringify({ courses: [tenantCourse] }));
  fs.writeFileSync(path.join(root, 'institution-policy.json'), JSON.stringify({ courseRules: { 'platform:igsce': { enabled: true },
    'tenant:custom-5e20b98a0efe27f02cf2': { enabled: true } } }));
  fs.writeFileSync(path.join(root, 'custom-assets', 'used.png'), 'used');
  fs.writeFileSync(path.join(root, 'custom-assets', 'orphan-one.png'), 'orphan');
  fs.writeFileSync(path.join(root, 'custom-assets', 'orphan-two.png'), 'orphan');
  try {
    const result = previewMigration(userData);
    assert.equal(result.writePerformed, false);
    assert.equal(result.summary.courseCount, 4);
    assert.equal(result.summary.autoMapped, 4);
    assert.equal(result.summary.needsHandling, 0);
    assert.deepEqual(Object.fromEntries(result.courses.map(item => [item.courseId, item.locale])), {
      'platform:starfall-k5-math': 'en-US',
      'platform:codeorg-k12-computing': 'en-US',
      'platform:igsce': 'en-GB',
      'tenant:custom-5e20b98a0efe27f02cf2': 'en-GB',
    });
    assert.ok(result.courses.every(item => item.courseId === item.targetCourseId));
    assert.deepEqual(result.summary.orphanCustomAssetCandidates, ['orphan-one.png', 'orphan-two.png']);
  } finally { fs.rmSync(userData, { recursive: true, force: true }); }
});

test('migration candidate separates private policy and validates four courses without publishing', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'course-migration-candidate-'));
  const userData = path.join(root, 'user-data');
  const courseRoot = path.join(userData, 'course-catalog');
  const output = path.join(root, 'candidate');
  const serverData = path.join(root, 'cloud');
  fs.mkdirSync(path.join(courseRoot, 'platform-assets'), { recursive: true });
  fs.mkdirSync(path.join(courseRoot, 'custom-assets'), { recursive: true });
  const ids = ['platform:starfall-k5-math', 'platform:codeorg-k12-computing', 'platform:igsce', 'tenant:custom-5e20b98a0efe27f02cf2'];
  const courses = ids.map((courseId, index) => {
    const bytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`course-${index}`)]);
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    const directory = courseId.startsWith('tenant:') ? 'custom-assets' : 'platform-assets';
    fs.writeFileSync(path.join(courseRoot, directory, `${digest}.png`), bytes);
    return { courseId, type: courseId.startsWith('tenant:') ? 'tenant_custom' : 'platform_standard', name: `Course ${index}`,
      provider: `Provider ${index}`, url: `https://course${index}.example.com/learn`, allowedHosts: [`course${index}.example.com`],
      coverAsset: `${directory}/${digest}.png`, summary: `Summary ${index}`, gradeRange: index < 2 ? ['K', '1'] : [],
      languages: index < 2 ? ['en'] : [], accountRequirement: 'Provider rules apply.', legalNotice: 'Third-party course.' };
  });
  for (const label of ['orphan-one', 'orphan-two']) {
    const bytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(label)]);
    fs.writeFileSync(path.join(courseRoot, 'custom-assets', `${crypto.createHash('sha256').update(bytes).digest('hex')}.png`), bytes);
  }
  fs.writeFileSync(path.join(courseRoot, 'last-good.json'), JSON.stringify({ catalogVersion: '2026.08.05.1', courses: courses.slice(0, 3) }));
  fs.writeFileSync(path.join(courseRoot, 'tenant-custom-courses.json'), JSON.stringify({ courses: courses.slice(3) }));
  fs.writeFileSync(path.join(courseRoot, 'institution-policy.json'), JSON.stringify({ courseRules: {
    'platform:starfall-k5-math': { enabled: true, order: 0, studentIds: ['student-private-a'] },
    'platform:codeorg-k12-computing': { enabled: true, order: 0, studentIds: ['student-private-b'] },
  } }));
  const adminToken = 'admin-token-that-is-longer-than-24-characters';
  const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const app = createHttpServer({ dataDir: serverData, adminToken, materialIndexer: false,
    publicContentPrivateKey: keys.privateKey, publicContentKeyId: 'course-catalog-primary-2026' });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  try {
    const prepared = prepareMigration(userData, output, { releaseId: 'release:migration-fixture-001' });
    assert.equal(prepared.courseCount, 4);
    assert.equal(prepared.assetCount, 4);
    assert.equal(prepared.policyRuleCount, 2);
    const { plan } = verifyPlan(output);
    assert.equal(JSON.stringify(plan).includes('student-private-a'), false);
    assert.equal(fs.readFileSync(path.join(output, 'local-policy-plan.private.json'), 'utf8').includes('student-private-a'), true);
    assert.deepEqual(Object.fromEntries(plan.courseDrafts.map(course => [course.courseId, course.locale])), {
      'platform:codeorg-k12-computing': 'en-US', 'platform:igsce': 'en-GB',
      'platform:starfall-k5-math': 'en-US', 'tenant:custom-5e20b98a0efe27f02cf2': 'en-GB',
    });
    const dryRun = await applyMigration(output, {});
    assert.equal(dryRun.dryRun, true);
    const session = app.service.loginAdmin(adminToken).sessionToken;
    const receipt = await applyMigration(output, { commit: true, expectedPlanSha256: plan.planSha256, sessionToken: session,
      baseUrl: `http://127.0.0.1:${app.server.address().port}`, allowHttpForTests: true });
    assert.equal(receipt.writePerformed, true);
    assert.equal(receipt.publishPerformed, false);
    assert.equal(receipt.courseIds.length, 4);
    assert.match(receipt.manifestSha256, /^[a-f0-9]{64}$/);
    assert.equal(app.publicContent.listReleases(session).releases[0].status, 'validated');
    assert.throws(() => app.publicContent.activeManifest(), /尚无已生效/);
    assert.equal(JSON.stringify(app.publicContent.listCourses(session)).includes('student-private-a'), false);
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
