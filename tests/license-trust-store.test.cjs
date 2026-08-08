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

test('Windows runtime trusts packaged official issuers and quarantines legacy local trust', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'license-trust-packaged-only-'));
  const packagedPath = path.join(root, 'packaged.json');
  const localPath = path.join(root, 'local-trusted-issuers.json');
  const official = pair();
  const attacker = pair();
  fs.writeFileSync(packagedPath, JSON.stringify({ issuers: [{ keyId: 'license-official', publicKey: official.publicKey, fingerprint: publicKeyFingerprint(official.publicKey), maxEdition: 'PLATFORM' }] }));
  fs.writeFileSync(localPath, JSON.stringify({ issuers: [{ keyId: 'license-attacker', publicKey: attacker.publicKey, maxEdition: 'PLATFORM' }] }));

  const store = createLicenseTrustStore({ localPath, packagedPaths: [packagedPath] });
  const state = store.state();

  assert.equal(state.policy, 'packaged_only');
  assert.deepEqual(state.issuers.map((item) => item.keyId), ['license-official']);
  assert.equal(state.allIssuers.some((item) => Object.hasOwn(item, 'publicKey')), false);
  assert.equal(fs.existsSync(localPath), false);
  const quarantine = path.join(root, 'quarantine');
  assert.equal(fs.readdirSync(quarantine).some((name) => name.startsWith('local-trusted-issuers.ignored-')), true);
  assert.equal(Object.hasOwn(store, 'importBundle'), false);
  assert.equal(Object.hasOwn(store, 'revoke'), false);
});

test('conflicting packaged keys with the same keyId fail closed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'license-trust-conflict-'));
  const firstPath = path.join(root, 'first.json');
  const secondPath = path.join(root, 'second.json');
  const first = pair();
  const second = pair();
  fs.writeFileSync(firstPath, JSON.stringify({ issuers: [{ keyId: 'license-official', publicKey: first.publicKey, maxEdition: 'PLATFORM' }] }));
  fs.writeFileSync(secondPath, JSON.stringify({ issuers: [{ keyId: 'license-official', publicKey: second.publicKey, maxEdition: 'PLATFORM' }] }));
  const store = createLicenseTrustStore({ packagedPaths: [firstPath, secondPath] });
  assert.deepEqual(store.state().issuers, []);
});
