const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_SECRET = 'ai-edu-manager-offline-license-v1';
const LICENSE_SIGNING_SECRET = process.env.AI_EDU_LICENSE_SECRET || DEFAULT_SECRET;

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
  if (value === 'TRIAL') return '试用版';
  return value || '未知版本';
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

function createLicenseRecord(input = {}) {
  const plan = normalizePlan(input.plan);
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

function parseLicenseCode(code) {
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

function issueLicense(recordsPath, input = {}) {
  const record = createLicenseRecord(input);
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
  issueLicense,
  listRecords,
  updateRecord,
  recordsToCsv,
  parseLicenseCode,
  planLabel,
  statusLabel,
  normalizeLicenseCode,
};
