const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  capabilitiesFor,
  createLicenseRecord,
  filterRecords,
  issueLicense,
  listRecords,
  parseLicenseCode,
  recordsToCsv,
} = require('../tools/license-admin-app/license-core.cjs');

test('license admin issues one unified signed platform v2 edition when a platform private key is supplied', () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const record = createLicenseRecord({
    customerName: '平台内部运营',
    plan: 'PLATFORM',
    studentLimit: 10000,
    deviceLimit: 2,
    expiresAt: '2027-12-31',
  }, { privateKey: privatePem, keyId: 'platform-test-key' });
  assert.equal(record.schema, 'edu-manager.license.v2');
  assert.match(record.code, /^AIE2\./);
  assert.equal('role' in record, false);
  assert.deepEqual(record.capabilities, capabilitiesFor('PLATFORM'));
  const checked = parseLicenseCode(record.code, { privateKey: privatePem });
  assert.equal(checked.ok, true);
  assert.equal(checked.license.plan, 'PLATFORM');
});

test('platform license issuance never falls back to the legacy shared-secret code', () => {
  assert.throws(() => createLicenseRecord({ plan: 'PLATFORM' }), /密钥管理.*创建或导入/);
});

test('non-platform editions cannot receive a platform role', () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  assert.throws(() => createLicenseRecord({
    plan: 'ORG',
    role: 'PLATFORM_ADMIN',
    schema: 'edu-manager.license.v2',
  }, { privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) }), /非平台版|平台身份/);
});

test('license admin persists, searches and exports the exact target device code', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'license-admin-device-record-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const recordsPath = path.join(root, 'license-records.json');
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const deviceId = 'host-target-device-4f92';

  const issued = issueLicense(recordsPath, {
    schema: 'edu-manager.license.v3',
    productId: 'WINDOWS_HOST',
    customerName: '设备码记录测试客户',
    plan: 'FAMILY',
    studentLimit: 3,
    deviceLimit: 1,
    devicePolicy: 'required_binding',
    deviceId,
  }, { privateKey: privatePem, keyId: 'device-record-test-key' });

  assert.equal(issued.deviceId, deviceId);
  const stored = listRecords(recordsPath);
  assert.equal(stored[0].deviceId, deviceId);
  assert.deepEqual(filterRecords(stored, 'TARGET-DEVICE-4F92').map((record) => record.id), [issued.id]);
  const csv = recordsToCsv(stored);
  assert.match(csv, /授权产品,目标设备码,套餐/);
  assert.match(csv, new RegExp(deviceId));
});

test('license admin history visibly exposes target device codes and legacy gaps', () => {
  const root = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'tools', 'license-admin-app', 'main.cjs'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'tools', 'license-admin-app', 'renderer', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'tools', 'license-admin-app', 'renderer', 'renderer.js'), 'utf8');

  assert.match(main, /filterRecords\(listRecords\(recordsPath\(\)\), query\)/);
  assert.match(html, /搜索目标设备码/);
  assert.match(html, /<th>目标设备码<\/th>/);
  assert.match(renderer, /data-action="copy-device"/);
  assert.match(renderer, /未记录（历史授权）/);
});

test('license admin keeps historical license codes collapsed until explicitly expanded', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'tools', 'license-admin-app', 'renderer', 'renderer.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'tools', 'license-admin-app', 'renderer', 'styles.css'), 'utf8');

  assert.match(renderer, /function compactLicenseCode/);
  assert.match(renderer, /<details class="license-code-details">/);
  assert.match(renderer, /展开完整授权码/);
  assert.match(renderer, /class="full-license-code"/);
  assert.match(styles, /\.license-code-details summary/);
});
