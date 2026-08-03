const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createPlatformCourseDraftStore } = require('../electron/platform-course-drafts.cjs');

const root = path.resolve(__dirname, '..');
const imagePath = path.join(root, 'public', 'catalog-assets', 'starfall-k5-math.png');

function validInput(overrides = {}) {
  return {
    name: '平台测试课程',
    provider: '测试提供方',
    summary: '用于验证平台课程草稿编辑和发布前校验。',
    url: 'https://example.com/course',
    allowedHosts: ['example.com'],
    subjects: ['math'],
    gradeRange: ['5'],
    languages: ['zh'],
    accountRequirement: '以课程网站说明为准。',
    legalNotice: '课程内容和商标由课程提供方负责，平台仅提供安全入口。',
    rightsStatus: 'confirmed',
    rightsEvidenceRef: 'LEGAL-2026-001',
    rightsReviewedBy: 'platform-reviewer',
    status: 'active',
    ...overrides,
  };
}

test('platform course draft keeps unpublished edits isolated in its own store', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-course-draft-'));
  const store = createPlatformCourseDraftStore({ userDataDir: temp, now: () => '2026-08-01T08:00:00.000Z' });
  const record = await store.save(validInput(), {
    imagePath,
    baseCatalogVersion: '2026.07.30.1',
    platformCourses: [],
    updatedBy: 'lic-platform-editor',
  });
  assert.match(record.courseId, /^platform:/);
  assert.equal(record.validation.ok, true);
  assert.match(record.course.coverAsset, /^platform-draft-assets\/[a-f0-9]{64}\.png$/);
  assert.equal(fs.existsSync(store.assetPath(record.course.coverAsset)), true);
  assert.equal(store.list().length, 1);
  assert.equal(fs.existsSync(path.join(temp, 'course-catalog', 'last-good.json')), false);
});

test('editing a published platform course preserves its id and allows the packaged cover until changed', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-course-edit-'));
  const store = createPlatformCourseDraftStore({ userDataDir: temp, now: () => '2026-08-01T09:00:00.000Z' });
  const published = {
    courseId: 'platform:existing-course',
    type: 'platform_standard',
    name: '原课程',
    provider: 'Provider',
    url: 'https://example.org/original',
    allowedHosts: ['example.org'],
    coverAsset: 'catalog-assets/starfall-k5-math.png',
    summary: '原课程简介。',
    subjects: [],
    gradeRange: [],
    languages: ['en'],
    accountRequirement: '以网站说明为准。',
    effectiveAt: '2026-07-30T00:00:00.000Z',
    expiresAt: null,
    legalNotice: '原法律说明。',
    status: 'active',
  };
  const record = await store.save(validInput({
    courseId: published.courseId,
    name: '修改后的课程',
    url: 'https://example.org/updated',
    allowedHosts: ['example.org'],
  }), { platformCourses: [published], baseCatalogVersion: '2026.07.30.1' });
  assert.equal(record.courseId, published.courseId);
  assert.equal(record.course.coverAsset, published.coverAsset);
  assert.equal(record.draftRevision, 1);
});

test('platform license authorization replaces the former per-course rights review form', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-course-rights-'));
  const store = createPlatformCourseDraftStore({ userDataDir: temp });
  const record = await store.save(validInput({ rightsStatus: 'pending', rightsEvidenceRef: '' }), {
    imagePath,
    platformCourses: [],
  });
  assert.equal(record.validation.ok, true);
  assert.deepEqual(record.validation.issues, []);
  assert.equal(record.rights.status, 'confirmed');
  assert.equal(record.rights.evidenceRef, 'platform-license-authorized');
});

test('platform course deletion is queued, cancels conflicting edits and can be undone before publishing', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-course-delete-'));
  const store = createPlatformCourseDraftStore({ userDataDir: temp, now: () => '2026-08-02T10:00:00.000Z' });
  const published = {
    courseId: 'platform:delete-me', type: 'platform_standard', name: 'Delete me', provider: 'Provider',
    url: 'https://example.com/course', allowedHosts: ['example.com'], coverAsset: 'catalog-assets/starfall-k5-math.png',
    summary: 'Published course', subjects: [], gradeRange: [], languages: ['en'], accountRequirement: 'None',
    effectiveAt: '2026-08-01T00:00:00.000Z', expiresAt: null, legalNotice: 'Test', status: 'active',
  };
  await store.save(validInput({ courseId: published.courseId }), { platformCourses: [published] });
  const deletion = store.markDeletion(published, { baseCatalogVersion: '2026.08.01.1', updatedBy: 'platform-license' });
  assert.equal(deletion.courseId, published.courseId);
  assert.equal(store.list().length, 0);
  assert.equal(store.listDeletions().length, 1);
  assert.equal(store.cancelDeletion(published.courseId), true);
  assert.equal(store.listDeletions().length, 0);
});
