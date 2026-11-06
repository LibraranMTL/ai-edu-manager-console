const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const TRUST_POLICY_SCHEMA = 'edu-manager.course-trust-policy.v1';
const TRUST_POLICY_FILENAME = 'trusted-course-issuers.json';
const ACCEPTED_STATUSES = new Set(['active', 'transition']);

function fingerprint(publicKey) {
  const der = crypto.createPublicKey(publicKey).export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(der).digest('hex');
}

function normalizeIssuer(input = {}) {
  const keyId = String(input.keyId || '').trim();
  const publicKey = String(input.publicKey || '').trim();
  const status = String(input.status || '').trim();
  if (!/^[a-z0-9][a-z0-9_-]{2,79}$/i.test(keyId)) throw new Error('课程信任策略包含无效 keyId。');
  if (!['active', 'transition', 'revoked'].includes(status)) throw new Error(`课程密钥 ${keyId} 的状态无效。`);
  if (!publicKey.includes('PUBLIC KEY')) throw new Error(`课程密钥 ${keyId} 缺少公钥。`);
  const actualFingerprint = fingerprint(publicKey);
  if (String(input.fingerprint || '').toLowerCase() !== actualFingerprint) throw new Error(`课程密钥 ${keyId} 的指纹不一致。`);
  return { keyId, status, fingerprint: actualFingerprint, publicKey: `${publicKey}\n` };
}

function parseCourseTrustPolicy(value) {
  if (value?.schema !== TRUST_POLICY_SCHEMA) throw new Error('课程信任策略合同无效。');
  const policyRevision = String(value.policyRevision || '').trim();
  if (!/^[a-z0-9][a-z0-9._:-]{7,119}$/i.test(policyRevision)) throw new Error('课程信任策略修订无效。');
  if (!Array.isArray(value.issuers) || value.issuers.length < 1) throw new Error('课程信任策略没有发布者。');
  const issuers = value.issuers.map(normalizeIssuer);
  const byId = new Map();
  for (const issuer of issuers) {
    if (byId.has(issuer.keyId)) throw new Error(`课程信任策略包含重复 keyId：${issuer.keyId}`);
    byId.set(issuer.keyId, issuer);
  }
  if (!issuers.some(item => ACCEPTED_STATUSES.has(item.status))) throw new Error('课程信任策略没有可用发布者。');
  return {
    schema: TRUST_POLICY_SCHEMA,
    policyRevision,
    issuers,
    accepts(keyId) { return ACCEPTED_STATUSES.has(byId.get(String(keyId || ''))?.status); },
    publicKeys() { return new Map(issuers.filter(item => ACCEPTED_STATUSES.has(item.status)).map(item => [item.keyId, item.publicKey])); },
  };
}

function loadCourseTrustPolicy(options = {}) {
  const candidates = (options.resourceRoots || []).map(root => path.join(path.resolve(root), 'course-catalog', TRUST_POLICY_FILENAME));
  const policyPath = candidates.find(candidate => fs.existsSync(candidate));
  if (!policyPath) {
    if (options.required === false) return null;
    throw new Error('未找到内置课程信任策略。');
  }
  let payload;
  try { payload = JSON.parse(fs.readFileSync(policyPath, 'utf8')); }
  catch { throw new Error('内置课程信任策略无法解析。'); }
  return parseCourseTrustPolicy(payload);
}

module.exports = { ACCEPTED_STATUSES, TRUST_POLICY_SCHEMA, fingerprint, loadCourseTrustPolicy, normalizeIssuer, parseCourseTrustPolicy };
