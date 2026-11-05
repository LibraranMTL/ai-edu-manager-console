'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { previewMigration } = require('../scripts/preview-public-course-migration.cjs');

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
