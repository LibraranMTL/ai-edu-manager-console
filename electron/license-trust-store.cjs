const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TRUST_BUNDLE_SCHEMA = 'edu-manager.trust-bundle.v1';
const LOCAL_TRUST_SCHEMA = 'edu-manager.local-license-trust.v1';

function publicKeyFingerprint(publicKey) {
  const der = crypto.createPublicKey(publicKey).export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(der).digest('hex');
}

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
}

function readJson(filePath, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; }
}

function normalizeIssuer(input = {}) {
  const keyId = String(input.keyId || '').trim();
  const publicKey = String(input.publicKey || input.pem || '').trim();
  if (!/^[a-z0-9][a-z0-9_-]{2,79}$/i.test(keyId)) throw new Error('可信签发方 keyId 格式无效。');
  if (!publicKey.includes('PUBLIC KEY')) throw new Error(`可信签发方 ${keyId} 缺少有效公钥。`);
  const fingerprint = publicKeyFingerprint(publicKey);
  if (input.fingerprint && String(input.fingerprint).toLowerCase() !== fingerprint) throw new Error(`可信签发方 ${keyId} 的公钥指纹不一致。`);
  const maxEdition = String(input.maxEdition || 'ORG').toUpperCase();
  if (!['TRIAL', 'FAMILY', 'PRO', 'ORG', 'PLATFORM'].includes(maxEdition)) throw new Error(`可信签发方 ${keyId} 的最高版本无效。`);
  return { keyId, publicKey: `${publicKey}\n`, fingerprint, maxEdition, status: input.status === 'revoked' ? 'revoked' : 'active', importedAt: String(input.importedAt || new Date().toISOString()) };
}

function issuersFromBundle(bundle = {}) {
  if (bundle.schema !== TRUST_BUNDLE_SCHEMA || !Array.isArray(bundle.keys)) throw new Error('可信公钥包格式不受支持。');
  return bundle.keys.filter((item) => item?.purpose === 'license_signing').map((item) => normalizeIssuer({ ...item, maxEdition: item.maxEdition || 'PLATFORM' }));
}

function createLicenseTrustStore(options = {}) {
  const localPath = path.resolve(options.localPath);
  const packagedPaths = (options.packagedPaths || []).map((item) => path.resolve(item));

  function packaged() {
    const all = [];
    for (const filePath of packagedPaths) {
      const parsed = readJson(filePath, {});
      for (const issuer of Array.isArray(parsed.issuers) ? parsed.issuers : []) {
        try { all.push(normalizeIssuer(issuer)); } catch { /* Invalid packaged entries fail closed. */ }
      }
    }
    return all;
  }

  function local() {
    const parsed = readJson(localPath, {});
    const result = [];
    for (const issuer of Array.isArray(parsed.issuers) ? parsed.issuers : []) {
      try { result.push(normalizeIssuer(issuer)); } catch { /* Invalid local entries fail closed. */ }
    }
    return result;
  }

  function state() {
    const merged = new Map();
    for (const issuer of [...packaged(), ...local()]) merged.set(issuer.keyId, issuer);
    const issuers = [...merged.values()];
    return {
      schema: 'edu-manager.license-trusted-issuers.v1',
      issuers: issuers.filter((item) => item.status !== 'revoked'),
      allIssuers: issuers.map(({ publicKey: _publicKey, ...item }) => item),
    };
  }

  function inspectBundle(filePath) {
    const issuers = issuersFromBundle(readJson(path.resolve(filePath), {}));
    if (!issuers.length) throw new Error('公钥包中没有平台 License 签发公钥。');
    return issuers.map(({ publicKey: _publicKey, ...item }) => item);
  }

  function importBundle(filePath, approval = {}) {
    const bundle = readJson(path.resolve(filePath), {});
    const issuers = issuersFromBundle(bundle);
    const approved = new Set(Array.isArray(approval.fingerprints) ? approval.fingerprints.map((item) => String(item).toLowerCase()) : []);
    if (!issuers.length || issuers.some((item) => !approved.has(item.fingerprint))) throw new Error('必须逐一确认待导入公钥的完整 SHA-256 指纹。');
    const current = local();
    const byId = new Map(current.map((item) => [item.keyId, item]));
    for (const issuer of issuers) {
      const existing = byId.get(issuer.keyId);
      if (existing && existing.fingerprint !== issuer.fingerprint) throw new Error(`keyId ${issuer.keyId} 已绑定另一公钥，不能覆盖。`);
      byId.set(issuer.keyId, { ...issuer, importedAt: new Date().toISOString(), source: 'admin_confirmed_bundle' });
    }
    atomicWrite(localPath, { schema: LOCAL_TRUST_SCHEMA, updatedAt: new Date().toISOString(), issuers: [...byId.values()] });
    return state();
  }

  function revoke(keyId, reason = '') {
    const issuers = local();
    const target = issuers.find((item) => item.keyId === String(keyId));
    if (!target) throw new Error('只能在本机撤销通过受控流程导入的签发公钥。');
    target.status = 'revoked';
    target.revokedAt = new Date().toISOString();
    target.revocationReason = String(reason || '').trim().slice(0, 500);
    atomicWrite(localPath, { schema: LOCAL_TRUST_SCHEMA, updatedAt: target.revokedAt, issuers });
    return state();
  }

  return { inspectBundle, importBundle, revoke, state };
}

module.exports = { LOCAL_TRUST_SCHEMA, TRUST_BUNDLE_SCHEMA, createLicenseTrustStore, issuersFromBundle, publicKeyFingerprint };
