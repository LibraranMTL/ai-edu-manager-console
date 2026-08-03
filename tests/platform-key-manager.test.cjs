const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const {
  ENCRYPTED_BACKUP_SCHEMA,
  TRUST_BUNDLE_SCHEMA,
  createPlatformKeyManager,
} = require('../electron/platform-key-manager.cjs');

function tempRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

test('platform key manager creates separate RSA keys and never exposes private PEM in status or trust bundles', () => {
  const manager = createPlatformKeyManager({ rootDir: tempRoot('platform-keys'), now: '2026-08-02T00:00:00.000Z' });
  const license = manager.createKey({ purpose: 'license_signing', keyId: 'license-platform-2026-01' });
  const course = manager.createKey({ purpose: 'course_catalog_signing', keyId: 'course-catalog-2026-01' });

  assert.notEqual(license.fingerprint, course.fingerprint);
  assert.equal(license.modulusLength, 3072);
  assert.equal(manager.list().active.license_signing, license.keyId);
  assert.equal(JSON.stringify(manager.list()).includes('PRIVATE KEY'), false);

  const trust = manager.exportTrustBundle({});
  assert.equal(trust.schema, TRUST_BUNDLE_SCHEMA);
  assert.equal(trust.keys.length, 2);
  assert.equal(JSON.stringify(trust).includes('PRIVATE KEY'), false);
  assert.ok(trust.keys.every((item) => item.publicKey.includes('PUBLIC KEY')));
});

test('platform key manager validates imported key pairs and purpose boundaries', () => {
  const root = tempRoot('platform-import');
  const manager = createPlatformKeyManager({ rootDir: root });
  const pair = crypto.generateKeyPairSync('rsa', {
    modulusLength: 3072,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const privatePath = path.join(root, 'source-private.pem');
  fs.writeFileSync(privatePath, pair.privateKey);
  const imported = manager.importPrivateKey({ purpose: 'license_signing', keyId: 'imported-license', filePath: privatePath });
  assert.equal(imported.keyId, 'imported-license');
  assert.throws(() => manager.readPrivateKey('course_catalog_signing', imported.keyId), /尚未初始化/);

  const other = crypto.generateKeyPairSync('rsa', {
    modulusLength: 3072,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  assert.throws(() => manager.addKey({ purpose: 'license_signing', keyId: 'bad-pair', privateKey: pair.privateKey, publicKey: other.publicKey }), /不匹配/);
});

test('encrypted key backup restores keys after authenticated decryption and rejects a wrong password', () => {
  const source = createPlatformKeyManager({ rootDir: tempRoot('platform-backup-source') });
  source.createKey({ purpose: 'license_signing', keyId: 'license-platform-backup' });
  source.createKey({ purpose: 'course_catalog_signing', keyId: 'course-catalog-backup' });
  const backupPath = path.join(tempRoot('platform-backup-file'), 'platform-keys.aiekeys');
  const backup = source.createEncryptedBackup({ outputPath: backupPath, password: 'correct horse battery staple' });
  assert.equal(backup.keyCount, 2);
  assert.equal(JSON.parse(fs.readFileSync(backupPath, 'utf8')).schema, ENCRYPTED_BACKUP_SCHEMA);
  assert.equal(fs.readFileSync(backupPath, 'utf8').includes('PRIVATE KEY'), false);

  const restored = createPlatformKeyManager({ rootDir: tempRoot('platform-backup-restored') });
  assert.throws(() => restored.restoreEncryptedBackup({ filePath: backupPath, password: 'wrong password value' }));
  const result = restored.restoreEncryptedBackup({ filePath: backupPath, password: 'correct horse battery staple', drill: true });
  assert.equal(result.restored.length, 2);
  assert.equal(result.drill, true);
  assert.equal(restored.list().active.license_signing, 'license-platform-backup');
});

test('revoked keys cannot be selected for new signatures but remain in public audit metadata', () => {
  const manager = createPlatformKeyManager({ rootDir: tempRoot('platform-revoke') });
  manager.createKey({ purpose: 'license_signing', keyId: 'license-platform-old' });
  const revoked = manager.revoke('license-platform-old', 'rotation completed');
  assert.equal(revoked.status, 'revoked');
  assert.throws(() => manager.selectActive('license_signing', 'license-platform-old'), /撤销/);
  assert.equal(manager.list().keys[0].revocationReason, 'rotation completed');
});
