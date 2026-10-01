'use strict';
const crypto = require('node:crypto');
function sourceProof(deviceId, privateKey, method, route, body = '') {
  const timestamp = String(Date.now());
  const nonce = crypto.randomBytes(18).toString('base64url');
  const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
  return { 'x-cloud-device-id': deviceId, 'x-cloud-timestamp': timestamp, 'x-cloud-nonce': nonce,
    'x-cloud-body-sha256': bodyHash,
    'x-cloud-signature': crypto.sign('sha256', Buffer.from(`${method}\n${route}\n${timestamp}\n${nonce}\n${bodyHash}`), privateKey).toString('base64url') };
}
module.exports = { sourceProof };
