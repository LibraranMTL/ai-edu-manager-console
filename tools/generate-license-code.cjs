const crypto = require('crypto');

const LICENSE_SIGNING_SECRET = 'ai-edu-manager-offline-license-v1';

function usage() {
  console.log('Usage: node tools/generate-license-code.cjs <PLAN> <EXPIRES_YYYYMMDD|PERM> <STUDENT_LIMIT> <DEVICE_LIMIT> [TOKEN]');
  console.log('Example: node tools/generate-license-code.cjs FAMILY 20270706 3 6');
}

function signature(payload) {
  return crypto
    .createHash('sha256')
    .update(`${LICENSE_SIGNING_SECRET}|${payload}`)
    .digest('hex')
    .slice(0, 12)
    .toUpperCase();
}

const [, , planRaw, expiresRaw, studentLimitRaw, deviceLimitRaw, tokenRaw] = process.argv;
if (!planRaw || !expiresRaw || !studentLimitRaw || !deviceLimitRaw) {
  usage();
  process.exit(1);
}

const plan = String(planRaw).trim().toUpperCase();
const expires = String(expiresRaw).trim().toUpperCase();
const studentLimit = String(Number(studentLimitRaw));
const deviceLimit = String(Number(deviceLimitRaw));
const token = String(tokenRaw || crypto.randomBytes(5).toString('hex')).trim().toUpperCase();

if (!/^[A-Z0-9]{3,16}$/.test(plan)) throw new Error('Invalid PLAN');
if (!(expires === 'PERM' || /^\d{8}$/.test(expires))) throw new Error('Invalid EXPIRES');
if (!/^[1-9][0-9]{0,3}$/.test(studentLimit)) throw new Error('Invalid STUDENT_LIMIT');
if (!/^[1-9][0-9]{0,3}$/.test(deviceLimit)) throw new Error('Invalid DEVICE_LIMIT');
if (!/^[A-Z0-9]{6,24}$/.test(token)) throw new Error('Invalid TOKEN');

const payload = ['AIE', plan, expires, studentLimit, deviceLimit, token].join('|');
const code = ['AIE', plan, expires, studentLimit, deviceLimit, token, signature(payload)].join('-');

console.log(code);
