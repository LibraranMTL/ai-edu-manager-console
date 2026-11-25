'use strict';
const crypto = require('node:crypto');
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const PRODUCTS = ['WINDOWS_HOST', 'ANDROID_STANDALONE'];
function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function normalizeCode(value) {
  const code = String(value || '').toUpperCase().replace(/[\s-]/g, '');
  if (!/^AEC1[WA][0-9A-HJKMNP-TV-Z]{32}[0-9A-F]{4}$/.test(code) || digest(code.slice(0, -4)).slice(0, 4).toUpperCase() !== code.slice(-4)) {
    throw Object.assign(new Error('激活码格式或校验位不正确，请检查完整激活码。'), { code: 'INVALID_CODE', status: 400 });
  }
  return code;
}
function generateCode(productId) {
  if (!PRODUCTS.includes(productId)) throw new Error('授权产品不受支持');
  const stem = `AEC1${productId === 'WINDOWS_HOST' ? 'W' : 'A'}` + [...crypto.randomBytes(32)].map(n => ALPHABET[n & 31]).join('');
  return `${stem}${digest(stem).slice(0, 4).toUpperCase()}`.match(/.{1,5}/g).join('-');
}
function codeHash(value) { return digest(normalizeCode(value)); }
function proofText(route, body) {
  return [route, body.operationId, body.productId, body.deviceId, body.publicKey, body.codeHash, String(body.timestamp), body.nonce].join('\n');
}
function signRequest(route, body, privateKey, now = Date.now()) {
  const result = { ...body, timestamp: now, nonce: crypto.randomBytes(24).toString('hex') };
  result.signature = crypto.sign('sha256', Buffer.from(proofText(route, result)), privateKey).toString('base64');
  return result;
}
function verifyRequest(route, body, now = Date.now()) {
  if (!body || !PRODUCTS.includes(body.productId) || !/^[\w-]{8,128}$/.test(body.operationId || '') ||
      !/^[\w-]{6,160}$/.test(body.deviceId || '') || !/^[a-f0-9]{64}$/.test(body.codeHash || '') ||
      !/^[a-f0-9]{48}$/.test(body.nonce || '') || !Number.isSafeInteger(body.timestamp) || Math.abs(now - body.timestamp) > 300000 ||
      !/^[A-Za-z0-9+/=]{80,200}$/.test(body.publicKey || '') || !/^[A-Za-z0-9+/=]{80,160}$/.test(body.signature || '')) return false;
  try {
    const key = crypto.createPublicKey({ key: Buffer.from(body.publicKey, 'base64'), type: 'spki', format: 'der' });
    return key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails.namedCurve === 'prime256v1' &&
      crypto.verify('sha256', Buffer.from(proofText(route, body)), key, Buffer.from(body.signature, 'base64'));
  } catch { return false; }
}
module.exports = { PRODUCTS, normalizeCode, generateCode, codeHash, digest, signRequest, verifyRequest };
