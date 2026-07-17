const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'android-tablet-terminal', 'src', 'com', 'qxmatrix', 'eduterminal', 'MainActivity.java'), 'utf8');

test('tablet connection settings export a versioned sensitive backup', () => {
  assert.match(source, /CONNECTION_BACKUP_KIND = "ai-edu-manager-tablet-connection-backup"/);
  assert.match(source, /Intent\.ACTION_CREATE_DOCUMENT/);
  assert.match(source, /backup\.put\("deviceId", deviceId\(\)\)/);
  assert.match(source, /backup\.put\("apiToken", apiToken\(\)\)/);
  assert.match(source, /连接备份包含设备授权凭据/);
});

test('tablet imports a connection backup and reconnects after identity confirmation', () => {
  assert.match(source, /Intent\.ACTION_OPEN_DOCUMENT/);
  assert.match(source, /恢复原设备身份/);
  assert.match(source, /editor\.putString\(PREF_DEVICE_ID, backupDeviceId\)/);
  assert.match(source, /connectAndLoadStudents\(\)/);
  assert.match(source, /备份版本过新，请先升级平板终端/);
});
