const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseCourseTrustPolicy } = require('../electron/course-trust-policy.cjs');
const { createCourseCatalogStore } = require('../electron/course-catalog-store.cjs');
const { validateStudentCourseProjection } = require('../electron/student-course-trust.cjs');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const windowsPolicyJson = JSON.parse(read('public/course-catalog/trusted-course-issuers.json'));
const androidPolicyJson = JSON.parse(read('android-standalone-manager/app/src/main/res/raw/trusted_course_issuers.json'));
const windowsStudent = read('electron/terminal-main.cjs');
const androidStudent = read('android-tablet-terminal/src/com/qxmatrix/eduterminal/MainActivity.java');
const host = read('electron/main.cjs');
const windowsStudentBuild = read('scripts/build-windows-terminal-release.cjs');

test('dual trust policy is identical across Windows and Android direct clients', () => {
  assert.deepEqual(androidPolicyJson, windowsPolicyJson);
  const policy = parseCourseTrustPolicy(windowsPolicyJson);
  assert.equal(policy.policyRevision, 'course-trust-transition-2026-11-06-v1');
  assert.equal(policy.accepts('course-catalog-primary-2026'), true);
  assert.equal(policy.accepts('course-catalog-candidate-20261106'), true);
  assert.equal(policy.accepts('course-catalog-unknown'), false);
  assert.equal(policy.publicKeys().size, 2);
});

test('Windows host store exposes both transition anchors without leaking PEM through status', t => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'course-dual-trust-'));
  t.after(() => fs.rmSync(userDataDir, { recursive: true, force: true }));
  const store = createCourseCatalogStore({ userDataDir, appVersion: '0.23.4', resourceRoots: [path.join(root, 'public')] });
  assert.equal(store.trustPolicyRevision(), 'course-trust-transition-2026-11-06-v1');
  assert.deepEqual(store.trustedCourseKeys().map(item => [item.keyId, item.status]), [
    ['course-catalog-primary-2026', 'transition'],
    ['course-catalog-candidate-20261106', 'active'],
  ]);
  assert.equal(store.publicKeys().size, 2);
  assert.equal(JSON.stringify(store.trustedCourseKeys()).includes('BEGIN PUBLIC KEY'), false);
});

test('revocation, fingerprint mutation and duplicate key IDs fail closed', () => {
  const revoked = structuredClone(windowsPolicyJson);
  revoked.issuers[0].status = 'revoked';
  const revokedPolicy = parseCourseTrustPolicy(revoked);
  assert.equal(revokedPolicy.accepts('course-catalog-primary-2026'), false);
  assert.equal(revokedPolicy.publicKeys().size, 1);

  const changedFingerprint = structuredClone(windowsPolicyJson);
  changedFingerprint.issuers[1].fingerprint = '0'.repeat(64);
  assert.throws(() => parseCourseTrustPolicy(changedFingerprint), /指纹不一致/);

  const duplicate = structuredClone(windowsPolicyJson);
  duplicate.issuers.push(structuredClone(duplicate.issuers[0]));
  assert.throws(() => parseCourseTrustPolicy(duplicate), /重复 keyId/);
});

test('host binds verified publisher identity into student projection and both student clients enforce it', () => {
  assert.match(host, /publisherKeyId: String\(state\.platformCatalog\?\.keyId/);
  assert.match(host, /trustPolicyRevision: courseCatalogStore\(\)\.trustPolicyRevision\(\)/);
  assert.match(windowsStudent, /validateStudentCourseProjection\(payload, \{ hostId, studentId \}, courseTrustPolicy\)/);
  assert.match(androidStudent, /COURSE_TRUST_POLICY_REVISION/);
  assert.match(androidStudent, /TRUSTED_COURSE_PUBLISHER_KEYS\.contains\(keyId\)/);
  assert.match(androidStudent, /validateCourseProjectionTrust\(cached\)/);
  assert.match(androidStudent, /course_projection_v2_trust1_/);
});

test('Windows student rejects unknown, revoked, mismatched-policy and cross-student projections', () => {
  const policy = parseCourseTrustPolicy(windowsPolicyJson);
  const valid = { schemaVersion: 2, hostId: 'host-a', studentId: 'student-a', publisherKeyId: 'course-catalog-candidate-20261106', trustPolicyRevision: policy.policyRevision };
  assert.equal(validateStudentCourseProjection(valid, { hostId: 'host-a', studentId: 'student-a' }, policy), valid);
  assert.throws(() => validateStudentCourseProjection({ ...valid, publisherKeyId: 'unknown' }, { hostId: 'host-a', studentId: 'student-a' }, policy), /不受信任/);
  assert.throws(() => validateStudentCourseProjection({ ...valid, trustPolicyRevision: 'old-policy' }, { hostId: 'host-a', studentId: 'student-a' }, policy), /策略与学生端版本不一致/);
  assert.throws(() => validateStudentCourseProjection(valid, { hostId: 'host-a', studentId: 'student-b' }, policy), /范围不匹配/);
  const revokedJson = structuredClone(windowsPolicyJson); revokedJson.issuers[1].status = 'revoked';
  assert.throws(() => validateStudentCourseProjection(valid, { hostId: 'host-a', studentId: 'student-a' }, parseCourseTrustPolicy(revokedJson)), /不受信任/);
});

test('Windows student minimal package carries the trust modules and policy bundle', () => {
  for (const required of [
    'electron/course-trust-policy.cjs',
    'electron/student-course-trust.cjs',
    'public/course-catalog/trusted-course-issuers.json',
  ]) assert.match(windowsStudentBuild, new RegExp(required.replaceAll('/', '[\\\\/]')));
  assert.match(windowsStudentBuild, /\\\\public\\\\course-catalog\\\\trusted-course-issuers\.json/);
});
