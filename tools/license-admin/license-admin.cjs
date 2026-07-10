#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LICENSE_SIGNING_SECRET = process.env.AI_EDU_LICENSE_SECRET || 'ai-edu-manager-offline-license-v1';
const recordsPath = path.join(__dirname, 'license-records.json');

function usage() {
  console.log(`AI教育管家授权管理工具

Usage:
  node tools/license-admin/license-admin.cjs issue --customer "客户名" --contact "微信/邮箱" --plan FAMILY --expires 2027-12-31 --students 3 --devices 3 --note "订单备注"
  node tools/license-admin/license-admin.cjs list
  node tools/license-admin/license-admin.cjs export

Options:
  --plan       TRIAL | FAMILY | PRO | ORG，默认 FAMILY
  --expires    YYYY-MM-DD / YYYYMMDD / PERM，留空为永久
  --students   授权学生数，默认 3
  --devices    授权平板设备数，默认 3

提示：该工具仅供内部发码使用，不随客户版 Windows 主机端打包发布。`);
}

function argValue(args, name, fallback = '') {
  const index = args.indexOf(`--${name}`);
  if (index < 0 || index + 1 >= args.length) return fallback;
  return args[index + 1];
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

function readRecords() {
  try {
    const parsed = JSON.parse(fs.readFileSync(recordsPath, 'utf8'));
    return Array.isArray(parsed.records) ? parsed.records : [];
  } catch {
    return [];
  }
}

function writeRecords(records) {
  fs.mkdirSync(path.dirname(recordsPath), { recursive: true });
  fs.writeFileSync(recordsPath, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), records }, null, 2), 'utf8');
}

function escapeCsvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function issue(args) {
  const plan = String(argValue(args, 'plan', 'FAMILY')).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16) || 'FAMILY';
  const expires = licenseExpiryToCode(argValue(args, 'expires', 'PERM'));
  const studentLimit = Math.max(1, Math.min(9999, Number.parseInt(argValue(args, 'students', '3'), 10) || 3));
  const deviceLimit = Math.max(1, Math.min(9999, Number.parseInt(argValue(args, 'devices', '3'), 10) || 3));
  const token = crypto.randomBytes(5).toString('hex').toUpperCase();
  const payload = ['AIE', plan, expires, String(studentLimit), String(deviceLimit), token].join('|');
  const signature = licenseSignature(payload);
  const code = ['AIE', plan, expires, String(studentLimit), String(deviceLimit), token, signature].join('-');
  const record = {
    id: `lic-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    code,
    codeHash: crypto.createHash('sha256').update(normalizeLicenseCode(code)).digest('hex'),
    plan,
    planLabel: planLabel(plan),
    expiresAt: expiryCodeToDate(expires),
    studentLimit,
    deviceLimit,
    customerName: argValue(args, 'customer', '').trim(),
    contact: argValue(args, 'contact', '').trim(),
    note: argValue(args, 'note', '').trim(),
    status: 'issued',
    issuedAt: new Date().toISOString(),
  };
  writeRecords([record, ...readRecords()].slice(0, 1000));
  console.log(code);
  console.error(`已生成授权码：${record.planLabel}，学生 ${studentLimit}，设备 ${deviceLimit}，记录文件：${recordsPath}`);
}

function list() {
  const records = readRecords();
  if (records.length === 0) {
    console.log('暂无授权码记录。');
    return;
  }
  records.slice(0, 50).forEach((record, index) => {
    console.log(`${index + 1}. ${record.customerName || '未填写客户'} | ${record.planLabel || record.plan} | 学生 ${record.studentLimit} | 设备 ${record.deviceLimit} | ${record.expiresAt || '永久'} | ${record.code}`);
  });
  if (records.length > 50) console.log(`仅显示前 50 条，共 ${records.length} 条。`);
}

function exportCsv() {
  const records = readRecords();
  const header = ['生成时间', '客户', '联系方式', '套餐', '到期时间', '学生数', '设备数', '状态', '授权码', '备注'];
  const rows = records.map((record) => [
    record.issuedAt || '',
    record.customerName || '',
    record.contact || '',
    record.planLabel || record.plan || '',
    record.expiresAt || '永久',
    record.studentLimit || '',
    record.deviceLimit || '',
    record.status || '',
    record.code || '',
    record.note || '',
  ]);
  const csv = [header, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
  const target = path.join(__dirname, `license-records-${new Date().toISOString().slice(0, 10)}.csv`);
  fs.writeFileSync(target, `\uFEFF${csv}`, 'utf8');
  console.log(target);
}

const [command, ...args] = process.argv.slice(2);
if (!command || command === 'help' || command === '--help' || command === '-h') {
  usage();
} else if (command === 'issue') {
  issue(args);
} else if (command === 'list') {
  list();
} else if (command === 'export') {
  exportCsv();
} else {
  usage();
  process.exitCode = 1;
}
