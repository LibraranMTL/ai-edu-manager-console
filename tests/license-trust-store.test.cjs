const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLicenseTrustStore, publicKeyFingerprint } = require('../electron/license-trust-store.cjs');

function pair() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

test('license trust import requires exact administrator-confirmed fingerprints and preserves multiple key ids', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'license-trust-'));
  const packagedPath = path.join(root, 'packaged.json');
  const localPath = path.join(root, 'local.json');
  const bundlePath = path.join(root, 'bundle.json');
  const oldKey = pair();
  const newKey = pair();
  fs.writeFileSync(packagedPath, JSON.stringify({ issuers: [{ keyId: 'license-platform-old', publicKey: oldKey.publicKey, maxEdition: 'PLATFORM' }] }));
  fs.writeFileSync(bundlePath, JSON.stringify({ schema: 'edu-manager.trust-bundle.v1', keys: [{ keyId: 'license-platform-new', purpose: 'license_signing', publicKey: newKey.publicKey, fingerprint: publicKeyFingerprint(newKey.publicKey), maxEdition: 'PLATFORM' }] }));
  const store = createLicenseTrustStore({ localPath, packagedPaths: [packagedPath] });

  assert.throws(() => store.importBundle(bundlePath, { fingerprints: [] }), /逐一确认/);
  const state = store.importBundle(bundlePath, { fingerprints: [publicKeyFingerprint(newKey.publicKey)] });
  assert.deepEqual(state.issuers.map((item) => item.keyId).sort(), ['license-platform-new', 'license-platform-old']);
  assert.equal(state.allIssuers.some((item) => Object.hasOwn(item, 'publicKey')), false);
});

test('license trust store refuses a keyId collision and can revoke only locally imported trust', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'license-trust-revoke-'));
  const localPath = path.join(root, 'local.json');
  const bundlePath = path.join(root, 'bundle.json');
  const first = pair();
  const second = pair();
  const writeBundle = (publicKey) => fs.writeFileSync(bundlePath, JSON.stringify({ schema: 'edu-manager.trust-bundle.v1', keys: [{ keyId: 'license-platform-one', purpose: 'license_signing', publicKey, fingerprint: publicKeyFingerprint(publicKey), maxEdition: 'PLATFORM' }] }));
  const store = createLicenseTrustStore({ localPath, packagedPaths: [] });
  writeBundle(first.publicKey);
  store.importBundle(bundlePath, { fingerprints: [publicKeyFingerprint(first.publicKey)] });
  writeBundle(second.publicKey);
  assert.throws(() => store.importBundle(bundlePath, { fingerprints: [publicKeyFingerprint(second.publicKey)] }), /不能覆盖/);
  const revoked = store.revoke('license-platform-one', 'suspected leak');
  assert.equal(revoked.issuers.length, 0);
  assert.equal(revoked.allIssuers[0].status, 'revoked');
});
