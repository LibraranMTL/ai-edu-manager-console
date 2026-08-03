const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_SECRET = 'ai-edu-manager-offline-license-v1';
const LICENSE_SIGNING_SECRET = process.env.AI_EDU_LICENSE_SECRET || DEFAULT_SECRET;
const LICENSE_V2_SCHEMA = 'edu-manager.license.v2';
const PLATFORM_ROLES = new Set(['PLATFORM_EDITOR', 'PLATFORM_PUBLISHER', 'PLATFORM_ADMIN']);

function nowIso() {
  return new Date().toISOString();
}

function normalizeLicenseCode(code) {
  return String(code || '')
    .trim()
    .toUpperCase()
    .replace(/[—–]/g, '-')
    .replace(/\s+/g, '');
}

function planLabel(plan) {
  const value = String(plan || '').toUpperCase();
  if (value === 'FAMILY') return '家庭版';
  if (value === 'PRO') return '专业版';
  if (value === 'ORG') return '机构版';
  if (value === 'PLATFORM') return '平台版';
  if (value === 'TRIAL') return '试用版';
  return value || '未知版本';
}

function roleLabel(role) {
  return '';
}

function normalizeRole(role, plan) {
  const value = String(role || '').toUpperCase().replace(/[^A-Z0-9_]/g, '');
  if (plan !== 'PLATFORM') {
    if (value) throw new Error('非平台版许可证不能授予平台身份。');
    return '';
  }
  if (value && !PLATFORM_ROLES.has(value)) throw new Error('平台版包含不受支持的旧身份。');
  return '';
}

function capabilitiesFor(plan, role = '') {
  const capabilities = ['course_learning'];
  if (['PRO', 'ORG', 'PLATFORM'].includes(plan)) capabilities.push('course_policy_manage', 'tenant_course_manage');
  if (plan === 'PLATFORM') capabilities.push('platform_course_edit', 'platform_course_publish', 'platform_course_rollback');
  return [...new Set(capabilities)];
}

function normalizePlan(plan) {
  return String(plan || 'FAMILY').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16) || 'FAMILY';
}

function licenseSignature(payload) {
  return crypto
    .createHash('sha256')
    .update(`${LICENSE_SIGNING_SECRET}|${payload}`)
    .digest('hex')
    .slice(0, 12)
    .toUpperCase();
}

function licenseExpiryToCode(value) {
  const text = String(value || '').trim();
  if (!text || /^perm(anent)?$/i.test(text) || text === '永久') return 'PERM';
  const compact = text.replace(/[-/.]/g, '');
  if (/^\d{8}$/.test(compact)) return compact;
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }
  return 'PERM';
}

function expiryCodeToDate(expires) {
  return expires === 'PERM'
    ? ''
    : `${expires.slice(0, 4)}-${expires.slice(4, 6)}-${expires.slice(6, 8)}T23:59:59.999+08:00`;
}

function shortHash(code) {
  return crypto.createHash('sha256').update(normalizeLicenseCode(code)).digest('hex');
}

function clampLimit(value, fallback) {
  return Math.max(1, Math.min(9999, Number.parseInt(value, 10) || fallback));
}

function resolveV2PrivateKey(plan, options = {}) {
  if (options.privateKey) return String(options.privateKey);
  const configured = plan === 'PLATFORM'
    ? process.env.AI_EDU_LICENSE_PLATFORM_PRIVATE_KEY
    : process.env.AI_EDU_LICENSE_STANDARD_PRIVATE_KEY;
  if (!configured) {
    throw new Error(plan === 'PLATFORM'
      ? '平台版只能使用 License v2 签发；请先在“平台 License 密钥管理”创建或导入签名密钥。'
      : '请配置 License v2 私钥。');
  }
  return fs.readFileSync(path.resolve(configured), 'utf8');
}

function createLicenseV2Record(input = {}, options = {}) {
  const plan = normalizePlan(input.plan);
  const role = normalizeRole(input.role, plan);
  const issuedAt = nowIso();
  const expiresCode = licenseExpiryToCode(input.expiresAt || input.expires || '');
  const expiresAt = expiryCodeToDate(expiresCode);
  const studentLimit = clampLimit(input.studentLimit, plan === 'PLATFORM' ? 9999 : 3);
  const deviceLimit = clampLimit(input.deviceLimit, 3);
  const keyId = String(options.keyId || (plan === 'PLATFORM'
    ? process.env.AI_EDU_LICENSE_PLATFORM_KEY_ID || 'license-platform-2026'
    : process.env.AI_EDU_LICENSE_STANDARD_KEY_ID || 'license-standard-2026')).trim();
  const devicePolicy = String(input.devicePolicy || 'optional_binding');
  const deviceId = String(input.deviceId || '').trim();
  if (!['optional_binding', 'required_binding'].includes(devicePolicy)) throw new Error('设备绑定策略不受支持。');
  if (devicePolicy === 'required_binding' && !deviceId) throw new Error('必须绑定设备时需要填写稳定主机 ID。');
  const payload = {
    schema: LICENSE_V2_SCHEMA,
    licenseId: `lic-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`,
    customerId: String(input.customerId || '').trim(),
    tenantId: String(input.tenantId || '').trim(),
    edition: plan,
    capabilities: capabilitiesFor(plan, role),
    studentLimit,
    deviceLimit,
    devicePolicy,
    deviceId,
    issuedAt,
    expiresAt,
    issuer: 'license-platform',
    keyId,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const privateKey = resolveV2PrivateKey(plan, options);
  const signature = crypto.sign('RSA-SHA256', Buffer.from(`AIE2.${encoded}`), privateKey).toString('base64url');
  const code = `AIE2.${encoded}.${signature}`;
  return {
    id: payload.licenseId,
    schema: LICENSE_V2_SCHEMA,
    code,
    codeHash: shortHash(code),
    plan,
    planLabel: planLabel(plan),
    capabilities: payload.capabilities,
    expiresAt,
    studentLimit,
    deviceLimit,
    customerName: String(input.customerName || '').trim(),
    contact: String(input.contact || '').trim(),
    orderNo: String(input.orderNo || '').trim(),
    note: String(input.note || '').trim(),
    status: 'issued',
    issuedAt,
    updatedAt: issuedAt,
    keyId,
    publicKeyFingerprint: String(options.publicKeyFingerprint || ''),
    devicePolicy: payload.devicePolicy,
    deviceId: payload.deviceId,
  };
}

function createLicenseRecord(input = {}, options = {}) {
  const plan = normalizePlan(input.plan);
  if (plan === 'PLATFORM' || input.schema === LICENSE_V2_SCHEMA || options.forceV2 === true) {
    return createLicenseV2Record(input, options);
  }
  const expires = licenseExpiryToCode(input.expiresAt || input.expires || '');
  const studentLimit = clampLimit(input.studentLimit, 3);
  const deviceLimit = clampLimit(input.deviceLimit, 3);
  const token = crypto.randomBytes(5).toString('hex').toUpperCase();
  const payload = ['AIE', plan, expires, String(studentLimit), String(deviceLimit), token].join('|');
  const signature = licenseSignature(payload);
  const code = ['AIE', plan, expires, String(studentLimit), String(deviceLimit), token, signature].join('-');
  return {
    id: `lic-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    code,
    codeHash: shortHash(code),
    plan,
    planLabel: planLabel(plan),
    expiresAt: expiryCodeToDate(expires),
    studentLimit,
    deviceLimit,
    customerName: String(input.customerName || '').trim(),
    contact: String(input.contact || '').trim(),
    orderNo: String(input.orderNo || '').trim(),
    note: String(input.note || '').trim(),
    status: 'issued',
    issuedAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function parseLicenseV2(code, options = {}) {
  try {
    const compact = String(code || '').trim();
    const parts = compact.split('.');
    if (parts.length !== 3 || parts[0] !== 'AIE2') throw new Error('License v2 格式不正确。');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (payload.schema !== LICENSE_V2_SCHEMA) throw new Error('License v2 Schema 不受支持。');
    const plan = normalizePlan(payload.edition);
    const role = normalizeRole(payload.role, plan);
    const expectedCapabilities = capabilitiesFor(plan, role).sort();
    const declaredCapabilities = [...new Set((payload.capabilities || []).map(String))].sort();
    const legacyCapabilities = plan === 'PLATFORM' && PLATFORM_ROLES.has(String(payload.role || '').toUpperCase())
      ? (String(payload.role || '').toUpperCase() === 'PLATFORM_EDITOR'
        ? ['course_learning', 'course_policy_manage', 'tenant_course_manage', 'platform_course_edit']
        : expectedCapabilities).slice().sort()
      : null;
    if (JSON.stringify(expectedCapabilities) !== JSON.stringify(declaredCapabilities)
      && (!legacyCapabilities || JSON.stringify(legacyCapabilities) !== JSON.stringify(declaredCapabilities))) throw new Error('License 能力声明不正确。');
    const privateKey = resolveV2PrivateKey(plan, options);
    const publicKey = crypto.createPublicKey(privateKey);
    if (!crypto.verify('RSA-SHA256', Buffer.from(`AIE2.${parts[1]}`), publicKey, Buffer.from(parts[2], 'base64url'))) {
      throw new Error('License v2 签名校验失败。');
    }
    return {
      ok: true,
      license: {
        plan,
        planLabel: planLabel(plan),
        capabilities: expectedCapabilities,
        expiresAt: String(payload.expiresAt || ''),
        studentLimit: Number(payload.studentLimit || 1),
        deviceLimit: Number(payload.deviceLimit || 1),
        keyId: String(payload.keyId || ''),
        codeHash: shortHash(compact),
      },
    };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

function parseLicenseCode(code, options = {}) {
  if (String(code || '').trim().startsWith('AIE2.')) return parseLicenseV2(code, options);
  const normalized = normalizeLicenseCode(code);
  const parts = normalized.split('-');
  if (parts.length !== 7 || parts[0] !== 'AIE') {
    return { ok: false, message: '授权码格式不正确。' };
  }
  const [, plan, expires, studentLimitRaw, deviceLimitRaw, token, signature] = parts;
  if (!/^[A-Z0-9]{3,16}$/.test(plan)) return { ok: false, message: '套餐字段不正确。' };
  if (!(expires === 'PERM' || /^\d{8}$/.test(expires))) return { ok: false, message: '到期日不正确。' };
  const studentLimit = Number(studentLimitRaw);
  const deviceLimit = Number(deviceLimitRaw);
  if (!Number.isInteger(studentLimit) || studentLimit < 1 || studentLimit > 9999) return { ok: false, message: '授权学生数不正确。' };
  if (!Number.isInteger(deviceLimit) || deviceLimit < 1 || deviceLimit > 9999) return { ok: false, message: '授权设备数不正确。' };
  if (!/^[A-Z0-9]{6,24}$/.test(token)) return { ok: false, message: '随机码不正确。' };
  const payload = ['AIE', plan, expires, studentLimitRaw, deviceLimitRaw, token].join('|');
  const expected = licenseSignature(payload);
  if (signature !== expected) return { ok: false, message: '授权码校验失败。' };
  return {
    ok: true,
    license: {
      plan,
      planLabel: planLabel(plan),
      expiresAt: expiryCodeToDate(expires),
      studentLimit,
      deviceLimit,
      token,
      codeHash: shortHash(normalized),
    },
  };
}

function readStore(recordsPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(recordsPath, 'utf8'));
    return {
      version: 1,
      records: Array.isArray(parsed.records) ? parsed.records : [],
    };
  } catch {
    return { version: 1, records: [] };
  }
}

function writeStore(recordsPath, records) {
  fs.mkdirSync(path.dirname(recordsPath), { recursive: true });
  fs.writeFileSync(recordsPath, JSON.stringify({ version: 1, updatedAt: nowIso(), records }, null, 2), 'utf8');
}

function normalizeRecord(record) {
  return {
    status: 'issued',
    ...record,
    planLabel: record.planLabel || planLabel(record.plan),
    updatedAt: record.updatedAt || record.issuedAt || nowIso(),
  };
}

function listRecords(recordsPath) {
  return readStore(recordsPath).records.map(normalizeRecord);
}

function issueLicense(recordsPath, input = {}, options = {}) {
  const record = createLicenseRecord(input, options);
  writeStore(recordsPath, [record, ...listRecords(recordsPath)].slice(0, 10000));
  return record;
}

function updateRecord(recordsPath, id, patch = {}) {
  let updated = null;
  const records = listRecords(recordsPath).map((record) => {
    if (String(record.id) !== String(id)) return record;
    updated = {
      ...record,
      ...patch,
      updatedAt: nowIso(),
    };
    return updated;
  });
  if (!updated) return null;
  writeStore(recordsPath, records);
  return updated;
}

function escapeCsvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function recordsToCsv(records) {
  const header = ['生成时间', '客户', '联系方式', '订单号', '套餐', '到期时间', '学生数', '设备数', '状态', '授权码', '备注'];
  const rows = records.map((record) => [
    record.issuedAt || '',
    record.customerName || '',
    record.contact || '',
    record.orderNo || '',
    record.planLabel || record.plan || '',
    record.expiresAt || '永久',
    record.studentLimit || '',
    record.deviceLimit || '',
    record.status || '',
    record.code || '',
    record.note || '',
  ]);
  return [header, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
}

function statusLabel(status) {
  if (status === 'issued') return '有效';
  if (status === 'revoked') return '已作废';
  if (status === 'replaced') return '已换码';
  if (status === 'expired') return '已过期';
  return status || '未知';
}

module.exports = {
  DEFAULT_SECRET,
  createLicenseRecord,
  createLicenseV2Record,
  capabilitiesFor,
  issueLicense,
  listRecords,
  updateRecord,
  recordsToCsv,
  parseLicenseCode,
  planLabel,
  roleLabel,
  statusLabel,
  normalizeLicenseCode,
};
