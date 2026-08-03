const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const {
  capabilitiesFor,
  createLicenseRecord,
  parseLicenseCode,
} = require('../tools/license-admin-app/license-core.cjs');

test('license admin issues one unified signed platform v2 edition when a platform private key is supplied', () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const record = createLicenseRecord({
    customerName: '平台内部运营',
    plan: 'PLATFORM',
    studentLimit: 10000,
    deviceLimit: 2,
    expiresAt: '2027-12-31',
  }, { privateKey: privatePem, keyId: 'platform-test-key' });
  assert.equal(record.schema, 'edu-manager.license.v2');
  assert.match(record.code, /^AIE2\./);
  assert.equal('role' in record, false);
  assert.deepEqual(record.capabilities, capabilitiesFor('PLATFORM'));
  const checked = parseLicenseCode(record.code, { privateKey: privatePem });
  assert.equal(checked.ok, true);
  assert.equal(checked.license.plan, 'PLATFORM');
});

test('platform license issuance never falls back to the legacy shared-secret code', () => {
  assert.throws(() => createLicenseRecord({ plan: 'PLATFORM' }), /密钥管理.*创建或导入/);
});

test('non-platform editions cannot receive a platform role', () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  assert.throws(() => createLicenseRecord({
    plan: 'ORG',
    role: 'PLATFORM_ADMIN',
    schema: 'edu-manager.license.v2',
  }, { privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) }), /非平台版|平台身份/);
});
