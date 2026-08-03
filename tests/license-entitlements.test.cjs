const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const {
  capabilitiesFor,
  entitlementFor,
  hasCapability,
  verifyLicenseTokenV2,
} = require('../electron/license-entitlements.cjs');

function signedToken(payload, privateKey) {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto.sign('RSA-SHA256', Buffer.from(`AIE2.${encoded}`), privateKey).toString('base64url');
  return `AIE2.${encoded}.${signature}`;
}

test('platform edition directly grants one unified course administration capability set', () => {
  assert.deepEqual(capabilitiesFor('PRO'), ['course_learning', 'course_policy_manage', 'tenant_course_manage']);
  assert.deepEqual(capabilitiesFor('PLATFORM'), [
    'course_learning',
    'course_policy_manage',
    'tenant_course_manage',
    'platform_course_edit',
    'platform_course_publish',
    'platform_course_rollback',
  ]);
  assert.equal(hasCapability({ active: true, plan: 'PLATFORM' }, 'platform_course_publish'), true);
  assert.equal(hasCapability({ active: true, plan: 'ORG' }, 'platform_course_edit'), false);
  assert.throws(() => entitlementFor({ edition: 'ORG', role: 'PLATFORM_ADMIN' }), /非平台版/);
});

test('license v2 verifies signature, issuer ceiling and declared capabilities', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const base = {
    schema: 'edu-manager.license.v2',
    licenseId: 'lic-platform-1',
    customerId: 'platform-owner',
    tenantId: 'platform',
    edition: 'PLATFORM',
    capabilities: capabilitiesFor('PLATFORM'),
    studentLimit: 10000,
    deviceLimit: 3,
    issuedAt: '2026-08-01T00:00:00.000Z',
    expiresAt: '2027-12-31T23:59:59.000Z',
    keyId: 'platform-key',
  };
  const trustedIssuers = {
    issuers: [{ keyId: 'platform-key', maxEdition: 'PLATFORM', publicKey: publicKey.export({ type: 'spki', format: 'pem' }) }],
  };
  const accepted = verifyLicenseTokenV2(signedToken(base, privateKey), { trustedIssuers, now: '2026-08-01T01:00:00.000Z' });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.license.role, '');
  assert.equal(accepted.license.capabilities.includes('platform_course_publish'), true);

  const standardIssuer = {
    issuers: [{ keyId: 'platform-key', maxEdition: 'ORG', publicKey: publicKey.export({ type: 'spki', format: 'pem' }) }],
  };
  assert.match(verifyLicenseTokenV2(signedToken(base, privateKey), { trustedIssuers: standardIssuer }).message, /无权授予/);
  assert.equal(verifyLicenseTokenV2(`${signedToken(base, privateKey)}x`, { trustedIssuers }).ok, false);
  assert.match(verifyLicenseTokenV2(signedToken({ ...base, capabilities: [...base.capabilities, 'unknown_power'] }, privateKey), { trustedIssuers }).message, /能力声明/);
});

test('expired and device-bound license v2 tokens are rejected safely', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const payload = {
    schema: 'edu-manager.license.v2',
    licenseId: 'lic-org-1',
    edition: 'ORG',
    role: '',
    capabilities: capabilitiesFor('ORG'),
    studentLimit: 100,
    deviceLimit: 10,
    deviceId: 'device-a',
    issuedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-06-30T23:59:59.000Z',
    keyId: 'standard-key',
  };
  const trustedIssuers = {
    issuers: [{ keyId: 'standard-key', maxEdition: 'ORG', publicKey: publicKey.export({ type: 'spki', format: 'pem' }) }],
  };
  assert.match(verifyLicenseTokenV2(signedToken(payload, privateKey), { trustedIssuers, now: '2026-08-01T00:00:00.000Z' }).message, /过期/);
  assert.match(verifyLicenseTokenV2(signedToken({ ...payload, expiresAt: '2027-01-01T00:00:00.000Z' }, privateKey), {
    trustedIssuers,
    now: '2026-08-01T00:00:00.000Z',
    deviceId: 'device-b',
  }).message, /设备不匹配/);
});

test('required device binding fails closed and accepts only the declared host', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const base = {
    schema: 'edu-manager.license.v2',
    licenseId: 'lic-platform-bound',
    edition: 'PLATFORM',
    capabilities: capabilitiesFor('PLATFORM'),
    studentLimit: 1000,
    deviceLimit: 1,
    devicePolicy: 'required_binding',
    issuedAt: '2026-08-01T00:00:00.000Z',
    expiresAt: '2027-08-01T00:00:00.000Z',
    keyId: 'platform-bound-key',
  };
  const trustedIssuers = {
    issuers: [{ keyId: base.keyId, maxEdition: 'PLATFORM', publicKey: publicKey.export({ type: 'spki', format: 'pem' }) }],
  };
  assert.match(verifyLicenseTokenV2(signedToken(base, privateKey), { trustedIssuers }).message, /未包含目标主机 ID/);
  const bound = { ...base, deviceId: 'host-stable-id' };
  assert.match(verifyLicenseTokenV2(signedToken(bound, privateKey), { trustedIssuers }).message, /设备不匹配/);
  assert.equal(verifyLicenseTokenV2(signedToken(bound, privateKey), {
    trustedIssuers,
    deviceId: 'host-stable-id',
    now: '2026-08-02T00:00:00.000Z',
  }).ok, true);
});
