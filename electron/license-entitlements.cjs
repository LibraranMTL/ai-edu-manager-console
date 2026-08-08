const crypto = require('crypto');

const LICENSE_V2_SCHEMA = 'edu-manager.license.v2';
const LICENSE_V3_SCHEMA = 'edu-manager.license.v3';
const LICENSE_PRODUCTS = new Set(['WINDOWS_HOST', 'ANDROID_STANDALONE']);
const LICENSE_EDITIONS = new Set(['TRIAL', 'FAMILY', 'PRO', 'ORG', 'PLATFORM']);
const PLATFORM_ROLES = new Set(['PLATFORM_EDITOR', 'PLATFORM_PUBLISHER', 'PLATFORM_ADMIN']);
const EDITION_RANK = { TRIAL: 0, FAMILY: 1, PRO: 2, ORG: 3, PLATFORM: 4 };

const EDITION_CAPABILITIES = {
  TRIAL: ['course_learning'],
  FAMILY: ['course_learning'],
  PRO: ['course_learning', 'course_policy_manage', 'tenant_course_manage'],
  ORG: ['course_learning', 'course_policy_manage', 'tenant_course_manage'],
  PLATFORM: ['course_learning', 'course_policy_manage', 'tenant_course_manage', 'platform_course_edit', 'platform_course_publish', 'platform_course_rollback'],
};

const LEGACY_PLATFORM_CAPABILITIES = {
  PLATFORM_EDITOR: ['course_learning', 'course_policy_manage', 'tenant_course_manage', 'platform_course_edit'],
  PLATFORM_PUBLISHER: ['course_learning', 'course_policy_manage', 'tenant_course_manage', 'platform_course_edit', 'platform_course_publish', 'platform_course_rollback'],
  PLATFORM_ADMIN: ['course_learning', 'course_policy_manage', 'tenant_course_manage', 'platform_course_edit', 'platform_course_publish', 'platform_course_rollback'],
};

function planLabel(edition) {
  const value = String(edition || '').toUpperCase();
  if (value === 'TRIAL') return '试用版';
  if (value === 'FAMILY') return '家庭版';
  if (value === 'PRO') return '专业版';
  if (value === 'ORG') return '机构版';
  if (value === 'PLATFORM') return '平台版';
  return value || '未知版本';
}

function roleLabel(role) {
  return '';
}

function normalizeEdition(value) {
  const edition = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!LICENSE_EDITIONS.has(edition)) throw new Error(`不支持的许可证版本：${edition || '空'}`);
  return edition;
}

function normalizeRole(value, edition) {
  const role = String(value || '').toUpperCase().replace(/[^A-Z0-9_]/g, '');
  if (edition !== 'PLATFORM') {
    if (role) throw new Error('非平台版许可证不能授予平台身份。');
    return '';
  }
  if (role && !PLATFORM_ROLES.has(role)) throw new Error('平台版许可证包含不受支持的旧身份。');
  return '';
}

function capabilitiesFor(editionInput, roleInput = '') {
  const edition = normalizeEdition(editionInput);
  normalizeRole(roleInput, edition);
  return [...(EDITION_CAPABILITIES[edition] || [])];
}

function entitlementFor(input = {}) {
  const edition = normalizeEdition(input.edition || input.plan);
  const role = normalizeRole(input.role, edition);
  return {
    edition,
    plan: edition,
    planLabel: planLabel(edition),
    role,
    roleLabel: roleLabel(role),
    capabilities: capabilitiesFor(edition, role),
  };
}

function hasCapability(license = {}, capability) {
  if (license.active !== true) return false;
  const expected = String(capability || '');
  const declared = Array.isArray(license.capabilities) ? license.capabilities : [];
  if (declared.includes(expected)) return true;
  try {
    return capabilitiesFor(license.edition || license.plan, license.role).includes(expected);
  } catch {
    return false;
  }
}

function base64UrlDecode(value) {
  return Buffer.from(String(value || ''), 'base64url');
}

function normalizeTrustedIssuers(input = {}) {
  const issuers = Array.isArray(input) ? input : input.issuers;
  const result = new Map();
  for (const raw of Array.isArray(issuers) ? issuers : []) {
    const keyId = String(raw?.keyId || '').trim();
    const publicKey = String(raw?.publicKey || raw?.pem || '').trim();
    if (!keyId || !publicKey) continue;
    let maxEdition;
    try {
      maxEdition = normalizeEdition(raw.maxEdition || 'ORG');
    } catch {
      continue;
    }
    result.set(keyId, { keyId, publicKey, maxEdition });
  }
  return result;
}

function verifyLicenseTokenV2(token, options = {}) {
  try {
    const compact = String(token || '').trim();
    const parts = compact.split('.');
    if (parts.length !== 3 || parts[0] !== 'AIE2') throw new Error('License v2 格式不正确。');
    const payloadBytes = base64UrlDecode(parts[1]);
    const payload = JSON.parse(payloadBytes.toString('utf8'));
    if (payload.schema !== LICENSE_V2_SCHEMA) throw new Error('License v2 Schema 不受支持。');
    const entitlement = entitlementFor(payload);
    const trusted = normalizeTrustedIssuers(options.trustedIssuers);
    const issuer = trusted.get(String(payload.keyId || ''));
    if (!issuer) throw new Error('License 签发密钥不受信任。');
    if (EDITION_RANK[entitlement.edition] > EDITION_RANK[issuer.maxEdition]) {
      throw new Error('当前签发密钥无权授予该版本。');
    }
    const signature = base64UrlDecode(parts[2]);
    if (!signature.length || !crypto.verify('RSA-SHA256', Buffer.from(`AIE2.${parts[1]}`), issuer.publicKey, signature)) {
      throw new Error('License v2 签名验证失败。');
    }
    const issuedAt = String(payload.issuedAt || '');
    const expiresAt = String(payload.expiresAt || '');
    if (!issuedAt || Number.isNaN(Date.parse(issuedAt))) throw new Error('License v2 签发时间无效。');
    if (expiresAt && Number.isNaN(Date.parse(expiresAt))) throw new Error('License v2 到期时间无效。');
    const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    if (expiresAt && now.getTime() > Date.parse(expiresAt)) throw new Error('License 已过期。');
    const deviceId = String(options.deviceId || '');
    const boundDeviceId = String(payload.deviceId || '');
    const devicePolicy = String(payload.devicePolicy || 'optional_binding');
    if (!['optional_binding', 'required_binding'].includes(devicePolicy)) throw new Error('License 设备绑定策略不受支持。');
    if (devicePolicy === 'required_binding' && !boundDeviceId) throw new Error('该 License 要求绑定设备，但未包含目标主机 ID。');
    if (boundDeviceId && (!deviceId || boundDeviceId !== deviceId)) throw new Error('License 与当前设备不匹配。');
    const expectedCapabilities = entitlement.capabilities;
    if (Array.isArray(payload.capabilities)) {
      const declared = [...new Set(payload.capabilities.map((item) => String(item)))].sort();
      const expected = [...expectedCapabilities].sort();
      const legacyExpected = entitlement.edition === 'PLATFORM' && PLATFORM_ROLES.has(String(payload.role || '').toUpperCase())
        ? [...LEGACY_PLATFORM_CAPABILITIES[String(payload.role || '').toUpperCase()]].sort()
        : null;
      if (JSON.stringify(declared) !== JSON.stringify(expected) && (!legacyExpected || JSON.stringify(declared) !== JSON.stringify(legacyExpected))) {
        throw new Error('License 能力声明与版本身份不一致。');
      }
    }
    return {
      ok: true,
      license: {
        schema: LICENSE_V2_SCHEMA,
        licenseId: String(payload.licenseId || ''),
        customerId: String(payload.customerId || ''),
        tenantId: String(payload.tenantId || ''),
        ...entitlement,
        studentLimit: Math.max(1, Math.min(999999, Number.parseInt(payload.studentLimit, 10) || 1)),
        deviceLimit: Math.max(1, Math.min(999999, Number.parseInt(payload.deviceLimit, 10) || 1)),
        devicePolicy,
        deviceId: boundDeviceId,
        issuedAt,
        expiresAt,
        issuer: String(payload.issuer || ''),
        keyId: issuer.keyId,
        tokenHash: crypto.createHash('sha256').update(compact).digest('hex'),
      },
    };
  } catch (error) {
    return { ok: false, code: 'LICENSE_V2_REJECTED', message: error.message };
  }
}

function normalizeProductId(value) {
  const productId = String(value || '').trim().toUpperCase();
  if (!LICENSE_PRODUCTS.has(productId)) throw new Error(`不支持的授权产品：${productId || '空'}`);
  return productId;
}

function verifyLicenseTokenV3(token, options = {}) {
  try {
    const compact = String(token || '').trim();
    const parts = compact.split('.');
    if (parts.length !== 3 || parts[0] !== 'AIE3') throw new Error('License v3 格式不正确。');
    const payload = JSON.parse(base64UrlDecode(parts[1]).toString('utf8'));
    if (payload.schema !== LICENSE_V3_SCHEMA) throw new Error('License v3 Schema 不受支持。');
    const productId = normalizeProductId(payload.productId);
    const expectedProductId = String(options.productId || '').trim().toUpperCase();
    if (expectedProductId && productId !== expectedProductId) throw new Error('License 产品与当前应用不匹配。');
    const entitlement = entitlementFor(payload);
    const trusted = normalizeTrustedIssuers(options.trustedIssuers);
    const issuer = trusted.get(String(payload.keyId || ''));
    if (!issuer) throw new Error('License 签发密钥不受信任。');
    if (EDITION_RANK[entitlement.edition] > EDITION_RANK[issuer.maxEdition]) throw new Error('当前签发密钥无权授予该版本。');
    if (!crypto.verify('RSA-SHA256', Buffer.from(`AIE3.${parts[1]}`), issuer.publicKey, base64UrlDecode(parts[2]))) {
      throw new Error('License v3 签名验证失败。');
    }
    const issuedAt = String(payload.issuedAt || '');
    const expiresAt = String(payload.expiresAt || '');
    if (!issuedAt || Number.isNaN(Date.parse(issuedAt))) throw new Error('License 签发时间无效。');
    if (expiresAt && Number.isNaN(Date.parse(expiresAt))) throw new Error('License 到期时间无效。');
    const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    if (expiresAt && now.getTime() > Date.parse(expiresAt)) throw new Error('License 已过期。');
    const devicePolicy = String(payload.devicePolicy || 'required_binding');
    const boundDeviceId = String(payload.deviceId || '').trim();
    const deviceId = String(options.deviceId || '').trim();
    if (!['optional_binding', 'required_binding'].includes(devicePolicy)) throw new Error('License 设备绑定策略不受支持。');
    if (devicePolicy === 'required_binding' && !boundDeviceId) throw new Error('License 缺少目标设备码。');
    if (boundDeviceId && boundDeviceId.toLowerCase() !== deviceId.toLowerCase()) throw new Error('License 与当前设备不匹配。');
    const declared = [...new Set((payload.capabilities || []).map(String))].sort();
    const expected = [...entitlement.capabilities].sort();
    if (JSON.stringify(declared) !== JSON.stringify(expected)) throw new Error('License 能力声明与授权版本不一致。');
    const maxActiveStudents = Math.max(1, Math.min(999999, Number.parseInt(payload.maxActiveStudents ?? payload.studentLimit, 10) || 1));
    const maxDevices = Math.max(1, Math.min(999999, Number.parseInt(payload.maxDevices ?? payload.deviceLimit, 10) || 1));
    return {
      ok: true,
      license: {
        schema: LICENSE_V3_SCHEMA,
        licenseId: String(payload.licenseId || ''),
        productId,
        customerId: String(payload.customerId || ''),
        tenantId: String(payload.tenantId || ''),
        ...entitlement,
        maxActiveStudents,
        studentLimit: maxActiveStudents,
        maxDevices,
        deviceLimit: maxDevices,
        devicePolicy,
        deviceId: boundDeviceId,
        issuedAt,
        expiresAt,
        issuer: String(payload.issuer || ''),
        keyId: issuer.keyId,
        tokenHash: crypto.createHash('sha256').update(compact).digest('hex'),
      },
    };
  } catch (error) {
    return { ok: false, code: 'LICENSE_V3_REJECTED', message: error.message };
  }
}

module.exports = {
  EDITION_CAPABILITIES,
  EDITION_RANK,
  LICENSE_EDITIONS,
  LICENSE_V2_SCHEMA,
  LICENSE_V3_SCHEMA,
  LICENSE_PRODUCTS,
  PLATFORM_ROLES,
  ROLE_CAPABILITIES: {},
  capabilitiesFor,
  entitlementFor,
  hasCapability,
  normalizeTrustedIssuers,
  normalizeProductId,
  planLabel,
  roleLabel,
  verifyLicenseTokenV2,
  verifyLicenseTokenV3,
};
