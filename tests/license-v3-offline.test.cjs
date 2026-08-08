const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { createLicenseV3Record } = require('../tools/license-admin-app/license-core.cjs');
const { verifyLicenseTokenV3 } = require('../electron/license-entitlements.cjs');
const { studentSeatDecision } = require('../electron/license-seat-policy.cjs');

function fixture(productId = 'ANDROID_STANDALONE') {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
  const record = createLicenseV3Record({
    productId,
    plan: 'FAMILY',
    studentLimit: 3,
    deviceLimit: 1,
    devicePolicy: 'required_binding',
    deviceId: productId === 'ANDROID_STANDALONE' ? 'ANDROID-AAAA-BBBB-CCCC-DDDD' : 'host-fixed-id',
    expiresAt: '2027-12-31',
  }, { privateKey: privatePem, keyId: 'offline-key' });
  return { record, trustedIssuers: { issuers: [{ keyId: 'offline-key', maxEdition: 'PLATFORM', publicKey: publicPem }] } };
}

test('offline v3 license is product scoped, device bound and carries active student seats', () => {
  const { record, trustedIssuers } = fixture();
  const accepted = verifyLicenseTokenV3(record.code, {
    trustedIssuers,
    productId: 'ANDROID_STANDALONE',
    deviceId: 'ANDROID-AAAA-BBBB-CCCC-DDDD',
    now: '2026-08-08T00:00:00.000Z',
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.license.maxActiveStudents, 3);
  assert.equal(accepted.license.productId, 'ANDROID_STANDALONE');
  assert.equal(verifyLicenseTokenV3(record.code, { trustedIssuers, productId: 'WINDOWS_HOST', deviceId: 'ANDROID-AAAA-BBBB-CCCC-DDDD' }).ok, false);
  assert.equal(verifyLicenseTokenV3(record.code, { trustedIssuers, productId: 'ANDROID_STANDALONE', deviceId: 'ANDROID-OTHER' }).ok, false);
});

test('Windows student creation, adoption, sync, backup and migration enforce the licensed seat limit', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  const migration = fs.readFileSync(path.join(__dirname, '..', 'electron', 'host-migration.cjs'), 'utf8');
  assert.match(main, /function assertStudentCapacity/);
  assert.match(main, /function initStudentWorkspace[\s\S]*?assertCanAddStudent\('新建学生档案'\)/);
  assert.match(main, /function ensureAdoptedKnowledgeBase[\s\S]*?assertCanAddStudent\('接管学生档案'\)/);
  assert.match(main, /function syncStudentsIndex[\s\S]*?assertStudentCapacity\(students, currentStudents/);
  assert.match(main, /function restoreHostData[\s\S]*?assertStudentCapacity\(parsed\.students/);
  assert.match(migration, /maxActiveStudents[\s\S]*?迁移包包含/);
});

test('seat policy blocks increases above the limit but preserves existing over-limit archives', () => {
  const students = (count) => Array.from({ length: count }, (_, index) => ({ id: `student-${index}`, status: 'ready' }));
  assert.equal(studentSeatDecision({ maxActiveStudents: 3, currentStudents: students(2), nextStudents: students(3) }).allowed, true);
  assert.equal(studentSeatDecision({ maxActiveStudents: 3, currentStudents: students(3), nextStudents: students(4) }).allowed, false);
  assert.equal(studentSeatDecision({ maxActiveStudents: 3, currentStudents: students(5), nextStudents: students(5) }).allowed, true);
  assert.equal(studentSeatDecision({ maxActiveStudents: 3, currentStudents: students(5), nextStudents: students(6) }).allowed, false);
});

test('Android standalone gates startup and student additions behind an offline signed license', () => {
  const root = path.join(__dirname, '..', 'android-standalone-manager', 'app', 'src', 'main');
  const activity = fs.readFileSync(path.join(root, 'java', 'com', 'qxmatrix', 'edumanager', 'standalone', 'MainActivity.kt'), 'utf8');
  const repository = fs.readFileSync(path.join(root, 'java', 'com', 'qxmatrix', 'edumanager', 'standalone', 'StudentIndexRepository.kt'), 'utf8');
  const manager = fs.readFileSync(path.join(root, 'java', 'com', 'qxmatrix', 'edumanager', 'standalone', 'LicenseManager.kt'), 'utf8');
  assert.match(activity, /if \(!licenseManager\.status\(\)\.active\)/);
  assert.match(activity, /Android 单机版产品激活/);
  assert.match(repository, /licenseManager\.requireCanAddStudent\(current\.size\)/);
  assert.match(manager, /PRODUCT_ID = "ANDROID_STANDALONE"/);
  assert.match(manager, /Signature\.getInstance\("SHA256withRSA"\)/);
});
