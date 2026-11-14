'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');
const { verifyCloudSourceProductLicense, verifyWindowsProductLicense } = require('./product-license.cjs');

function fixture(productId = 'ANDROID_STANDALONE', deviceId = 'ANDROID-TEST-DEVICE') {
  const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const payload = { schema: 'edu-manager.license.v3', productId, keyId: 'issuer', licenseId: 'license_android_1',
    edition: 'FAMILY', deviceId, issuedAt: '2026-11-12T00:00:00.000Z', expiresAt: '2027-11-12T00:00:00.000Z',
    maxActiveStudents: 2, capabilities: ['course_learning'] };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.sign('RSA-SHA256', Buffer.from(`AIE3.${encoded}`), keys.privateKey).toString('base64url');
  return { token: `AIE3.${encoded}.${signature}`, trustedIssuers: { issuers: [{ keyId: 'issuer', maxEdition: 'PLATFORM', publicKey: keys.publicKey }] }, deviceId };
}

test('cloud source accepts signed Android standalone and preserves product identity', () => {
  const input = fixture();
  const result = verifyCloudSourceProductLicense(input.token, { ...input, now: Date.parse('2026-11-13T00:00:00Z') });
  assert.equal(result.ok, true);
  assert.equal(result.license.productId, 'ANDROID_STANDALONE');
  assert.equal(result.license.maxActiveStudents, 2);
  assert.equal(verifyWindowsProductLicense(input.token, { ...input, now: Date.parse('2026-11-13T00:00:00Z') }).ok, false);
});

test('cloud source rejects device mismatch, tampering and unrelated products', () => {
  const input = fixture();
  assert.equal(verifyCloudSourceProductLicense(input.token, { ...input, deviceId: 'OTHER', now: Date.parse('2026-11-13T00:00:00Z') }).ok, false);
  assert.equal(verifyCloudSourceProductLicense(`${input.token}x`, { ...input, now: Date.parse('2026-11-13T00:00:00Z') }).ok, false);
  const unrelated = fixture('ANDROID_STUDENT');
  assert.equal(verifyCloudSourceProductLicense(unrelated.token, { ...unrelated, now: Date.parse('2026-11-13T00:00:00Z') }).ok, false);
});

test('cloud source continues to accept Windows host licenses', () => {
  const input = fixture('WINDOWS_HOST', 'WINDOWS-TEST-DEVICE');
  assert.equal(verifyCloudSourceProductLicense(input.token, { ...input, now: Date.parse('2026-11-13T00:00:00Z') }).ok, true);
  assert.equal(verifyWindowsProductLicense(input.token, { ...input, now: Date.parse('2026-11-13T00:00:00Z') }).ok, true);
});
