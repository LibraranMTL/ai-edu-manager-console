const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KEY_STORE_SCHEMA = 'edu-manager.platform-key-store.v1';
const TRUST_BUNDLE_SCHEMA = 'edu-manager.trust-bundle.v1';
const ENCRYPTED_BACKUP_SCHEMA = 'edu-manager.encrypted-key-backup.v1';
const PURPOSES = new Set(['license_signing', 'course_catalog_signing']);

function nowIso(now) {
  return now ? new Date(now).toISOString() : new Date().toISOString();
}

function fingerprint(publicKey) {
  const der = crypto.createPublicKey(publicKey).export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(der).digest('hex');
}

function normalizePurpose(value) {
  const purpose = String(value || '').trim();
  if (!PURPOSES.has(purpose)) throw new Error('不支持的密钥用途。');
  return purpose;
}

function safeId(value, fallback) {
  const clean = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return clean || fallback;
}

function atomicWrite(filePath, content, mode = 0o600) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temp, content, { encoding: 'utf8', mode });
  fs.renameSync(temp, filePath);
  try { fs.chmodSync(filePath, mode); } catch { /* Windows ACL is inherited from the controlled userData directory. */ }
}

function readJson(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; }
}

function publicRecord(record) {
  const { privateKeyFile: _privateKeyFile, ...visible } = record;
  return visible;
}

function createPlatformKeyManager(options = {}) {
  const rootDir = path.resolve(String(options.rootDir || ''));
  if (!rootDir) throw new Error('密钥存储目录不能为空。');
  const storePath = path.join(rootDir, 'key-store.json');
  const auditPath = path.join(rootDir, 'key-audit.jsonl');

  function readStore() {
    const parsed = readJson(storePath, {});
    return {
      schema: KEY_STORE_SCHEMA,
      active: parsed.active && typeof parsed.active === 'object' ? parsed.active : {},
      keys: Array.isArray(parsed.keys) ? parsed.keys : [],
      updatedAt: parsed.updatedAt || '',
    };
  }

  function writeStore(store) {
    atomicWrite(storePath, JSON.stringify({ ...store, schema: KEY_STORE_SCHEMA, updatedAt: nowIso(options.now) }, null, 2));
  }

  function audit(action, detail = {}) {
    fs.mkdirSync(rootDir, { recursive: true });
    const entry = { at: nowIso(options.now), action, ...detail };
    fs.appendFileSync(auditPath, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
    return entry;
  }

  function validatePair(privateKey, expectedPublicKey = '') {
    const privateObject = crypto.createPrivateKey(privateKey);
    const publicKey = crypto.createPublicKey(privateObject).export({ type: 'spki', format: 'pem' }).toString();
    if (expectedPublicKey && fingerprint(publicKey) !== fingerprint(expectedPublicKey)) throw new Error('公钥与私钥不匹配。');
    const challenge = crypto.randomBytes(32);
    const signature = crypto.sign('RSA-SHA256', challenge, privateObject);
    if (!crypto.verify('RSA-SHA256', challenge, publicKey, signature)) throw new Error('密钥签名挑战失败。');
    return { privateKey: privateObject.export({ type: 'pkcs8', format: 'pem' }).toString(), publicKey, fingerprint: fingerprint(publicKey) };
  }

  function addKey(input = {}) {
    const purpose = normalizePurpose(input.purpose);
    const validated = validatePair(input.privateKey, input.publicKey);
    const stamp = nowIso(options.now);
    const fallbackId = `${purpose === 'license_signing' ? 'license-platform' : 'course-catalog'}-${stamp.slice(0, 7).replace('-', '')}-${validated.fingerprint.slice(0, 10)}`;
    const keyId = safeId(input.keyId, fallbackId);
    const store = readStore();
    if (store.keys.some((item) => item.keyId === keyId && item.fingerprint !== validated.fingerprint)) throw new Error('该 keyId 已被另一把密钥使用。');
    const privateKeyFile = `${keyId}.private.pem`;
    const publicKeyFile = `${keyId}.public.pem`;
    atomicWrite(path.join(rootDir, privateKeyFile), validated.privateKey);
    atomicWrite(path.join(rootDir, publicKeyFile), validated.publicKey, 0o644);
    const prior = store.keys.find((item) => item.keyId === keyId);
    const record = {
      keyId,
      purpose,
      fingerprint: validated.fingerprint,
      algorithm: 'RSA-SHA256',
      modulusLength: Number(input.modulusLength || 3072),
      privateKeyFile,
      publicKeyFile,
      status: 'active',
      createdAt: prior?.createdAt || stamp,
      updatedAt: stamp,
      source: String(input.source || 'created'),
    };
    store.keys = [record, ...store.keys.filter((item) => item.keyId !== keyId)];
    store.active[purpose] = keyId;
    writeStore(store);
    audit('key_added', { keyId, purpose, fingerprint: validated.fingerprint, source: record.source });
    return publicRecord(record);
  }

  function createKey(input = {}) {
    const purpose = normalizePurpose(input.purpose);
    const modulusLength = Math.max(3072, Number(input.modulusLength || 3072));
    const pair = crypto.generateKeyPairSync('rsa', {
      modulusLength,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    return addKey({ ...input, purpose, modulusLength, privateKey: pair.privateKey, publicKey: pair.publicKey, source: 'generated' });
  }

  function importPrivateKey(input = {}) {
    const filePath = path.resolve(String(input.filePath || ''));
    if (!filePath || !fs.statSync(filePath).isFile()) throw new Error('请选择有效的私钥文件。');
    return addKey({ ...input, privateKey: fs.readFileSync(filePath, 'utf8'), source: 'imported' });
  }

  function list() {
    const store = readStore();
    return { active: { ...store.active }, keys: store.keys.map(publicRecord), updatedAt: store.updatedAt };
  }

  function selectActive(purposeInput, keyIdInput) {
    const purpose = normalizePurpose(purposeInput);
    const keyId = String(keyIdInput || '').trim();
    const store = readStore();
    const record = store.keys.find((item) => item.keyId === keyId && item.purpose === purpose && item.status === 'active');
    if (!record) throw new Error('所选密钥不存在、用途不匹配或已被撤销。');
    readPrivateKey(purpose, keyId);
    store.active[purpose] = keyId;
    writeStore(store);
    audit('key_selected', { keyId, purpose, fingerprint: record.fingerprint });
    return publicRecord(record);
  }

  function readPrivateKey(purposeInput, keyIdInput = '') {
    const purpose = normalizePurpose(purposeInput);
    const store = readStore();
    const keyId = String(keyIdInput || store.active[purpose] || '');
    const record = store.keys.find((item) => item.keyId === keyId && item.purpose === purpose && item.status === 'active');
    if (!record) throw new Error('尚未初始化可用的签名密钥。');
    const privateKey = fs.readFileSync(path.join(rootDir, record.privateKeyFile), 'utf8');
    const publicKey = fs.readFileSync(path.join(rootDir, record.publicKeyFile), 'utf8');
    const validated = validatePair(privateKey, publicKey);
    if (validated.fingerprint !== record.fingerprint) throw new Error('密钥文件指纹与登记信息不一致。');
    return { record: publicRecord(record), privateKey: validated.privateKey, publicKey: validated.publicKey };
  }

  function exportTrustBundle(input = {}) {
    const purposes = input.purposes ? new Set(input.purposes.map(normalizePurpose)) : PURPOSES;
    const store = readStore();
    const keys = store.keys.filter((item) => purposes.has(item.purpose) && item.status !== 'revoked').map((item) => ({
      keyId: item.keyId,
      purpose: item.purpose,
      fingerprint: item.fingerprint,
      publicKey: fs.readFileSync(path.join(rootDir, item.publicKeyFile), 'utf8'),
      maxEdition: item.purpose === 'license_signing' ? 'PLATFORM' : undefined,
      status: item.status,
      createdAt: item.createdAt,
    }));
    const bundle = { schema: TRUST_BUNDLE_SCHEMA, exportedAt: nowIso(options.now), keys };
    if (input.outputPath) atomicWrite(path.resolve(input.outputPath), JSON.stringify(bundle, null, 2), 0o644);
    audit('trust_bundle_exported', { keyIds: keys.map((item) => item.keyId), outputPath: input.outputPath ? path.basename(input.outputPath) : '' });
    return bundle;
  }

  function createEncryptedBackup(input = {}) {
    const password = String(input.password || '');
    if (password.length < 12) throw new Error('备份密码至少需要 12 个字符。');
    const target = path.resolve(String(input.outputPath || ''));
    if (!target) throw new Error('备份文件路径不能为空。');
    const store = readStore();
    const payload = {
      schema: KEY_STORE_SCHEMA,
      exportedAt: nowIso(options.now),
      active: store.active,
      keys: store.keys.map((record) => ({
        ...record,
        privateKey: fs.readFileSync(path.join(rootDir, record.privateKeyFile), 'utf8'),
        publicKey: fs.readFileSync(path.join(rootDir, record.publicKeyFile), 'utf8'),
      })),
    };
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = crypto.scryptSync(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 96 * 1024 * 1024 });
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
    const backup = {
      schema: ENCRYPTED_BACKUP_SCHEMA,
      createdAt: nowIso(options.now),
      kdf: { name: 'scrypt', N: 32768, r: 8, p: 1, salt: salt.toString('base64') },
      cipher: { name: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') },
      ciphertext: ciphertext.toString('base64'),
    };
    atomicWrite(target, JSON.stringify(backup, null, 2));
    audit('encrypted_backup_created', { outputPath: path.basename(target), keyIds: store.keys.map((item) => item.keyId) });
    return { path: target, keyCount: store.keys.length, sha256: crypto.createHash('sha256').update(JSON.stringify(backup)).digest('hex') };
  }

  function restoreEncryptedBackup(input = {}) {
    const password = String(input.password || '');
    const source = path.resolve(String(input.filePath || ''));
    const backup = JSON.parse(fs.readFileSync(source, 'utf8'));
    if (backup.schema !== ENCRYPTED_BACKUP_SCHEMA) throw new Error('备份文件格式不受支持。');
    const salt = Buffer.from(backup.kdf?.salt || '', 'base64');
    const iv = Buffer.from(backup.cipher?.iv || '', 'base64');
    const tag = Buffer.from(backup.cipher?.tag || '', 'base64');
    const key = crypto.scryptSync(password, salt, 32, {
      N: Number(backup.kdf?.N || 32768),
      r: Number(backup.kdf?.r || 8),
      p: Number(backup.kdf?.p || 1),
      maxmem: 96 * 1024 * 1024,
    });
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(Buffer.from(backup.ciphertext || '', 'base64')), decipher.final()]).toString('utf8');
    const payload = JSON.parse(plaintext);
    if (payload.schema !== KEY_STORE_SCHEMA || !Array.isArray(payload.keys)) throw new Error('解密后的密钥清单无效。');
    const restored = [];
    for (const item of payload.keys) restored.push(addKey({ ...item, source: 'restored' }));
    for (const [purpose, keyId] of Object.entries(payload.active || {})) {
      if (restored.some((item) => item.purpose === purpose && item.keyId === keyId)) selectActive(purpose, keyId);
    }
    audit('encrypted_backup_restored', { source: path.basename(source), keyIds: restored.map((item) => item.keyId), drill: input.drill === true });
    return { restored, drill: input.drill === true };
  }

  function revoke(keyIdInput, reason = '') {
    const keyId = String(keyIdInput || '').trim();
    const store = readStore();
    const record = store.keys.find((item) => item.keyId === keyId);
    if (!record) throw new Error('未找到要撤销的密钥。');
    record.status = 'revoked';
    record.revokedAt = nowIso(options.now);
    record.revocationReason = String(reason || '').trim().slice(0, 500);
    if (store.active[record.purpose] === keyId) delete store.active[record.purpose];
    writeStore(store);
    audit('key_revoked', { keyId, purpose: record.purpose, fingerprint: record.fingerprint, reason: record.revocationReason });
    return publicRecord(record);
  }

  return { addKey, createKey, importPrivateKey, list, selectActive, readPrivateKey, exportTrustBundle, createEncryptedBackup, restoreEncryptedBackup, revoke, validatePair };
}

module.exports = {
  ENCRYPTED_BACKUP_SCHEMA,
  KEY_STORE_SCHEMA,
  TRUST_BUNDLE_SCHEMA,
  createPlatformKeyManager,
  fingerprint,
};
