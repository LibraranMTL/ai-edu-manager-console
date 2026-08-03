const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  applyCatalogCandidate,
  catalogChecksum,
  catalogSignaturePayload,
  effectiveCourses,
  mergeCourseCaptureRecords,
  normalizeCourseUrl,
  safeCourseNavigation,
  validateCatalogPackage,
} = require('../electron/course-catalog.cjs');

const root = path.resolve(__dirname, '..');
const signedCatalog = JSON.parse(fs.readFileSync(path.join(root, 'public', 'course-catalog', 'catalog.json'), 'utf8'));
const publicKey = fs.readFileSync(path.join(root, 'public', 'course-catalog', 'public-key.pem'), 'utf8');

test('packaged course catalog has a valid checksum, signature and host version', () => {
  assert.equal(catalogChecksum(signedCatalog), signedCatalog.checksum);
  const result = validateCatalogPackage(signedCatalog, { hostVersion: '0.14.9', publicKey });
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(result.catalog.courses.map((item) => item.courseId), [
    'platform:starfall-k5-math',
    'platform:codeorg-k12-computing',
  ]);
});

test('tampered and under-version packages cannot replace last good catalog while signatures are optional', () => {
  const lastGood = validateCatalogPackage(signedCatalog, { hostVersion: '0.14.9', publicKey }).catalog;
  const tampered = structuredClone(signedCatalog);
  tampered.courses[0].url = 'https://attacker.invalid/';
  const rejected = applyCatalogCandidate(tampered, { lastGood }, { hostVersion: '0.14.9', publicKey });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.rolledBack, true);
  assert.equal(rejected.catalog.catalogVersion, lastGood.catalogVersion);

  const oldHost = validateCatalogPackage(signedCatalog, { hostVersion: '0.13.9', publicKey });
  assert.equal(oldHost.ok, false);
  assert.match(oldHost.message, /主机版本/);

  const unsigned = structuredClone(signedCatalog);
  unsigned.signature = '';
  assert.equal(validateCatalogPackage(unsigned, { hostVersion: '0.14.9', publicKey }).ok, true);
  assert.equal(validateCatalogPackage(unsigned, { hostVersion: '0.14.9', publicKey, requireSignature: true }).ok, false);
});

test('URL normalization blocks unknown hosts, credentials and dangerous protocols', () => {
  assert.equal(normalizeCourseUrl('https://code.org/en-US#section', ['code.org']), 'https://code.org/en-US');
  assert.equal(safeCourseNavigation('file:///C:/secret.txt', ['code.org']).ok, false);
  assert.equal(safeCourseNavigation('javascript:alert(1)', ['code.org']).ok, false);
  assert.equal(safeCourseNavigation('https://evil.example/', ['code.org']).ok, false);
  assert.equal(safeCourseNavigation('https://user:secret@code.org/', ['code.org']).ok, false);
});

test('student-effective catalog applies enabled, grade and exact student scope without leakage', () => {
  const catalog = validateCatalogPackage(signedCatalog, { hostVersion: '0.14.9', publicKey }).catalog;
  const policy = {
    schemaVersion: 1,
    courseRules: {
      'platform:starfall-k5-math': { enabled: true, order: 1, gradeRange: ['3'], studentIds: ['student-a'] },
      'platform:codeorg-k12-computing': { enabled: true, order: 0, gradeRange: [], studentIds: ['student-b'] },
    },
  };
  assert.deepEqual(effectiveCourses(catalog, policy, { id: 'student-a', grade: '3' }).map((item) => item.courseId), ['platform:starfall-k5-math']);
  assert.deepEqual(effectiveCourses(catalog, policy, { id: 'student-b', grade: '8' }).map((item) => item.courseId), ['platform:codeorg-k12-computing']);
  assert.deepEqual(effectiveCourses(catalog, policy, { id: 'student-c', grade: '3' }).map((item) => item.courseId), []);
});

test('emergency withdrawal removes a course without affecting the remaining catalog', () => {
  const catalog = structuredClone(validateCatalogPackage(signedCatalog, { hostVersion: '0.14.9', publicKey }).catalog);
  catalog.courses[0].status = 'withdrawn';
  assert.deepEqual(
    effectiveCourses(catalog, {}, { id: 'student-a', grade: '3' }).map((item) => item.courseId),
    ['platform:codeorg-k12-computing'],
  );
});

test('course capture attribution is idempotent and rejects incomplete records', () => {
  const record = {
    studentId: 'student-a',
    courseId: 'platform:starfall-k5-math',
    provider: 'Starfall',
    url: 'https://www.starfall.com/h/',
    targetType: 'project',
    targetId: 'project-a',
    captureSessionId: 'capture-1',
    fileHash: crypto.createHash('sha256').update('frame').digest('hex'),
  };
  const merged = mergeCourseCaptureRecords([record], [record]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].studentId, 'student-a');
  assert.equal(merged[0].targetId, 'project-a');
  assert.throws(() => mergeCourseCaptureRecords([], [{ studentId: 'student-a' }]), /缺少学生、课程/);
});

test('catalog signature input is deterministic regardless of object key order', () => {
  const reordered = Object.fromEntries(Object.entries(signedCatalog).reverse());
  assert.equal(catalogSignaturePayload(reordered), catalogSignaturePayload(signedCatalog));
});
