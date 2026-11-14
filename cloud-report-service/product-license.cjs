'use strict';

const crypto = require('node:crypto');

const EDITION_RANK = Object.freeze({ TRIAL: 0, FAMILY: 1, PRO: 2, ORG: 3, PLATFORM: 4 });
const EDITION_CAPABILITIES = Object.freeze({
  TRIAL: ['course_learning'],
  FAMILY: ['course_learning'],
  PRO: ['course_learning', 'course_policy_manage', 'tenant_course_manage'],
  ORG: ['course_learning', 'course_policy_manage', 'tenant_course_manage'],
  PLATFORM: ['course_learning', 'course_policy_manage', 'tenant_course_manage', 'platform_course_edit', 'platform_course_publish', 'platform_course_rollback'],
});

function normalizedIssuers(input = {}) {
  const rows = Array.isArray(input) ? input : input.issuers;
  const issuers = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const keyId = String(row?.keyId || '').trim();
    const publicKey = String(row?.publicKey || row?.pem || '').trim();
    const maxEdition = String(row?.maxEdition || 'ORG').trim().toUpperCase();
    if (keyId && publicKey && Object.hasOwn(EDITION_RANK, maxEdition)) issuers.set(keyId, { publicKey, maxEdition });
  }
  return issuers;
}

function verifyProductLicense(token, { trustedIssuers, deviceId, now = Date.now(), allowedProducts = ['WINDOWS_HOST'] } = {}) {
  try {
    const compact = String(token || '').trim();
    const parts = compact.split('.');
    if (parts.length !== 3 || parts[0] !== 'AIE3') throw new Error('需要有效的产品 License v3');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const productId = String(payload.productId || '').toUpperCase();
    const acceptedProducts = new Set((allowedProducts || []).map(value => String(value).toUpperCase()));
    if (payload.schema !== 'edu-manager.license.v3' || !acceptedProducts.has(productId)) throw new Error('许可证产品与当前来源端不匹配');
    const edition = String(payload.edition || payload.plan || '').toUpperCase();
    if (!Object.hasOwn(EDITION_RANK, edition)) throw new Error('许可证版本无效');
    const issuer = normalizedIssuers(trustedIssuers).get(String(payload.keyId || ''));
    if (!issuer) throw new Error('许可证签发密钥不受信任');
    if (EDITION_RANK[edition] > EDITION_RANK[issuer.maxEdition]) throw new Error('签发密钥无权授予此许可证版本');
    if (!crypto.verify('RSA-SHA256', Buffer.from(`AIE3.${parts[1]}`), issuer.publicKey, Buffer.from(parts[2], 'base64url'))) {
      throw new Error('许可证签名验证失败');
    }
    const issuedAt = Date.parse(String(payload.issuedAt || ''));
    const expiresAt = payload.expiresAt ? Date.parse(String(payload.expiresAt)) : 0;
    if (!Number.isFinite(issuedAt) || (payload.expiresAt && !Number.isFinite(expiresAt))) throw new Error('许可证有效期无效');
    if (expiresAt && Number(now) > expiresAt) throw new Error('许可证已过期');
    const requestedDeviceId = String(deviceId || '').trim();
    const boundDeviceId = String(payload.deviceId || '').trim();
    const devicePolicy = String(payload.devicePolicy || 'required_binding');
    if (devicePolicy === 'required_binding' && !boundDeviceId) throw new Error('许可证缺少目标设备码');
    if (boundDeviceId && boundDeviceId.toLowerCase() !== requestedDeviceId.toLowerCase()) throw new Error('许可证与当前设备不匹配');
    const expectedCapabilities = [...(EDITION_CAPABILITIES[edition] || [])].sort();
    const declaredCapabilities = [...new Set((payload.capabilities || []).map(String))].sort();
    if (JSON.stringify(expectedCapabilities) !== JSON.stringify(declaredCapabilities)) throw new Error('许可证能力声明与版本不一致');
    const licenseId = String(payload.licenseId || '').trim();
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(licenseId)) throw new Error('许可证 ID 无效');
    return { ok: true, license: { licenseId, productId, edition, deviceId: boundDeviceId || requestedDeviceId,
      maxActiveStudents: Math.max(1, Math.min(999999, Number.parseInt(payload.maxActiveStudents ?? payload.studentLimit, 10) || 1)),
      tokenHash: crypto.createHash('sha256').update(compact).digest('hex') } };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

function verifyWindowsProductLicense(token, options = {}) {
  return verifyProductLicense(token, { ...options, allowedProducts: ['WINDOWS_HOST'] });
}

function verifyCloudSourceProductLicense(token, options = {}) {
  return verifyProductLicense(token, { ...options, allowedProducts: ['WINDOWS_HOST', 'ANDROID_STANDALONE'] });
}

module.exports = { verifyProductLicense, verifyWindowsProductLicense, verifyCloudSourceProductLicense };
