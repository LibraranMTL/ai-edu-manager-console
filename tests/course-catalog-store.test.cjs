const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createCourseCatalogStore, mergeCoursesByStableId } = require('../electron/course-catalog-store.cjs');
const { coursePartition, secureCourseWebPreferences } = require('../electron/course-browser.cjs');

const root = path.resolve(__dirname, '..');

test('catalog store initializes last-good cache and persists light institution policy', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'course-catalog-store-'));
  const store = createCourseCatalogStore({ userDataDir: temp, appVersion: '0.14.9', resourceRoots: [path.join(root, 'public')] });
  const state = store.state();
  assert.equal(state.ok, true);
  assert.equal(fs.existsSync(state.paths.cache), true);
  const policy = store.savePolicy({
    courseRules: {
      'platform:starfall-k5-math': { enabled: false, order: 2, studentIds: [], gradeRange: [] },
    },
  });
  assert.equal(policy.courseRules['platform:starfall-k5-math'].enabled, false);
  assert.deepEqual(store.coursesForStudent({ id: 'student-a', grade: '3' }).map((item) => item.courseId), ['platform:codeorg-k12-computing']);
});

test('invalid offline import preserves the last-good catalog', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'course-catalog-rollback-'));
  const store = createCourseCatalogStore({ userDataDir: temp, appVersion: '0.14.9', resourceRoots: [path.join(root, 'public')] });
  const lastVersion = store.state().catalog.catalogVersion;
  const invalid = { ...store.state().catalog, checksum: '0'.repeat(64) };
  const result = store.importPackage(invalid);
  assert.equal(result.ok, false);
  assert.equal(result.rolledBack, true);
  assert.equal(store.state().catalog.catalogVersion, lastVersion);
});

test('tenant custom courses merge beside the signed catalog and use scoped local assets', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'course-catalog-custom-'));
  const store = createCourseCatalogStore({ userDataDir: temp, appVersion: '0.14.10', resourceRoots: [path.join(root, 'public')] });
  fs.mkdirSync(store.customAssetsDir, { recursive: true });
  const filename = `${'a'.repeat(64)}.png`;
  fs.copyFileSync(path.join(root, 'public', 'catalog-assets', 'starfall-k5-math.png'), path.join(store.customAssetsDir, filename));
  store.mergeCustomCourses([{
    courseId: 'tenant:custom-example-course',
    type: 'tenant_custom',
    name: '机构自选测试课程',
    provider: '机构自选课程',
    url: 'https://example.com/course',
    allowedHosts: ['example.com'],
    coverAsset: `custom-assets/${filename}`,
    summary: '验证自选课程与平台目录并存。',
    subjects: [],
    gradeRange: [],
    languages: [],
    accountRequirement: '以课程网站说明为准。',
    effectiveAt: '2026-07-30T00:00:00.000Z',
    expiresAt: null,
    legalNotice: '由导入方负责课程内容与使用授权。',
    status: 'active',
  }]);
  const state = store.state();
  assert.equal(state.platformCatalog.courses.length, 2);
  assert.equal(state.customCatalog.courses.length, 1);
  assert.equal(state.catalog.courses.length, 3);
  assert.match(state.catalog.catalogVersion, /\+custom\./);
  assert.equal(store.assetPathByFilename(filename), path.join(store.customAssetsDir, filename));
  assert.equal(store.coursesForStudent({ id: 'student-a', grade: '3' }).some((item) => item.courseId === 'tenant:custom-example-course'), true);
  store.savePolicy({ courseRules: { 'tenant:custom-example-course': { enabled: true, order: 3, studentIds: ['student-a'], gradeRange: ['3'] } } });
  const removed = store.removeCustomCourse('tenant:custom-example-course');
  assert.equal(removed.course.courseId, 'tenant:custom-example-course');
  assert.equal(store.state().customCatalog.courses.length, 0);
  assert.equal(store.state().catalog.courses.length, 2);
  assert.equal(store.state().policy.courseRules['tenant:custom-example-course'], undefined);
  assert.equal(fs.existsSync(path.join(store.customAssetsDir, filename)), true, 'deletion keeps the cover asset available for audit and recovery');
});

test('signed cloud course replaces a legacy local custom entry with the same stable ID', () => {
  const courseId = 'tenant:custom-example-course';
  const signed = { courseId, name: '云端签名课程', coverAsset: 'cloud-assets/signed.png' };
  const legacy = { courseId, name: '旧本地课程', coverAsset: 'custom-assets/legacy.png' };
  const localOnly = { courseId: 'tenant:local-only', name: '仅本地课程' };
  const merged = mergeCoursesByStableId([signed], [legacy, localOnly]);
  assert.deepEqual(merged.map((course) => course.courseId), [courseId, 'tenant:local-only']);
  assert.equal(merged[0], signed);
});

test('course browser preferences enforce renderer isolation without preload or Node', () => {
  const partition = coursePartition('platform:starfall-k5-math');
  assert.match(partition, /^course-[a-f0-9]{20}$/);
  const preferences = secureCourseWebPreferences(partition);
  assert.equal(preferences.nodeIntegration, false);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.webSecurity, true);
  assert.equal('preload' in preferences, false);
});
