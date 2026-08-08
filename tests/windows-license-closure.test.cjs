const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { createLicenseV3Record } = require('../tools/license-admin-app/license-core.cjs');
const { activateWindowsLicenseV3, evaluateStoredWindowsLicense } = require('../electron/windows-license-policy.cjs');

function fixture() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
  const record = createLicenseV3Record({
    productId: 'WINDOWS_HOST',
    plan: 'FAMILY',
    studentLimit: 3,
    deviceLimit: 1,
    devicePolicy: 'required_binding',
    deviceId: 'host-paid-customer',
    expiresAt: '2027-12-31',
  }, { privateKey: privatePem, keyId: 'official-key' });
  return { record, trustedIssuers: { issuers: [{ keyId: 'official-key', maxEdition: 'PLATFORM', publicKey: publicPem }] } };
}

test('Windows 0.16.5 accepts only device-bound License v3', () => {
  const { record, trustedIssuers } = fixture();
  const accepted = activateWindowsLicenseV3(record.code, {
    trustedIssuers,
    deviceId: 'host-paid-customer',
    now: new Date('2026-08-08T00:00:00.000Z'),
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.license.schema, 'edu-manager.license.v3');
  assert.equal(evaluateStoredWindowsLicense(accepted.license, {
    trustedIssuers,
    deviceId: 'host-paid-customer',
    now: new Date('2026-08-08T00:00:00.000Z'),
  }).active, true);
  assert.equal(activateWindowsLicenseV3(record.code, { trustedIssuers, deviceId: 'another-host' }).ok, false);
});

test('legacy codes and editable local license objects never activate Windows', () => {
  const { trustedIssuers } = fixture();
  for (const legacy of ['AIE-FAMILY-PERM-3-1-ABCDEF-ABCDEF123456', 'AIE2.fake.signature', '']) {
    const result = activateWindowsLicenseV3(legacy, { trustedIssuers, deviceId: 'host-paid-customer' });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'LICENSE_V3_REQUIRED');
  }
  for (const localObject of [
    { status: 'active', studentLimit: 9999 },
    { schema: 'edu-manager.license.v2', status: 'active', licenseToken: 'AIE2.fake.signature' },
    { schema: 'edu-manager.license.v3', status: 'active', licenseToken: 'AIE3.fake.signature' },
  ]) {
    assert.equal(evaluateStoredWindowsLicense(localObject, { trustedIssuers, deviceId: 'host-paid-customer' }).active, false);
  }
});

test('packaged Windows source has no runtime trust override or shared-secret legacy verifier', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.doesNotMatch(main, /AI_EDU_LICENSE_TRUSTED_ISSUERS/);
  assert.doesNotMatch(main, /LICENSE_SIGNING_SECRET/);
  assert.doesNotMatch(main, /verifyLicenseTokenV2/);
  assert.match(main, /activateWindowsLicenseV3/);
  assert.match(main, /evaluateStoredWindowsLicense/);
});

test('Windows settings exposes and copies the exact License v3 device id', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.tsx'), 'utf8');
  assert.match(ui, /License v3 设备码/);
  assert.match(ui, /hostServiceStatus\?\.hostIdentity\?\.hostId/);
  assert.match(ui, /已复制 License v3 设备码/);
  assert.match(ui, /不同于终端连接使用的 HOST-/);
});
