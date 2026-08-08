const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function publicKeyFingerprint(publicKey) {
  const der = crypto.createPublicKey(publicKey).export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(der).digest('hex');
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
  return { keyId, publicKey: `${publicKey}\n`, fingerprint, maxEdition, status: input.status === 'revoked' ? 'revoked' : 'active', source: 'packaged' };
}

function createLicenseTrustStore(options = {}) {
  const localPath = options.localPath ? path.resolve(options.localPath) : '';
  const packagedPaths = (options.packagedPaths || []).map((item) => path.resolve(item));
  let quarantineResult = null;

  function quarantineLegacyLocalTrust() {
    if (quarantineResult) return quarantineResult;
    if (!localPath || !fs.existsSync(localPath)) {
      quarantineResult = { found: false, quarantined: false };
      return quarantineResult;
    }
    try {
      const quarantineDir = path.join(path.dirname(localPath), 'quarantine');
      fs.mkdirSync(quarantineDir, { recursive: true });
      const target = path.join(quarantineDir, `local-trusted-issuers.ignored-${Date.now()}.json`);
      fs.renameSync(localPath, target);
      quarantineResult = { found: true, quarantined: true, target };
    } catch (error) {
      // Even if moving the legacy file fails, it is never read or trusted.
      quarantineResult = { found: true, quarantined: false, error: String(error.message || error) };
    }
    return quarantineResult;
  }

  function packaged() {
    const byId = new Map();
    const rejectedIds = new Set();
    for (const filePath of packagedPaths) {
      const parsed = readJson(filePath, {});
      for (const rawIssuer of Array.isArray(parsed.issuers) ? parsed.issuers : []) {
        try {
          const issuer = normalizeIssuer(rawIssuer);
          const existing = byId.get(issuer.keyId);
          if (existing && existing.fingerprint !== issuer.fingerprint) {
            byId.delete(issuer.keyId);
            rejectedIds.add(issuer.keyId);
          } else if (!rejectedIds.has(issuer.keyId)) {
            byId.set(issuer.keyId, issuer);
          }
        } catch {
          // Invalid packaged entries fail closed.
        }
      }
    }
    return [...byId.values()];
  }

  function state() {
    quarantineLegacyLocalTrust();
    const issuers = packaged();
    return {
      schema: 'edu-manager.license-trusted-issuers.v2',
      policy: 'packaged_only',
      issuers: issuers.filter((item) => item.status !== 'revoked'),
      allIssuers: issuers.map(({ publicKey: _publicKey, ...item }) => item),
    };
  }

  return { quarantineLegacyLocalTrust, state };
}

module.exports = { createLicenseTrustStore, publicKeyFingerprint };
