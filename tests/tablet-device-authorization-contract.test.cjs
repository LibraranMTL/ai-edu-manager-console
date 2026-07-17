const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const host = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');
const tablet = fs.readFileSync(path.join(root, 'android-tablet-terminal', 'src', 'com', 'qxmatrix', 'eduterminal', 'MainActivity.java'), 'utf8');

test('flashed admin connection settings enroll a visible pending tablet device', () => {
  assert.match(host, /async function handleDeviceEnroll/);
  assert.match(host, /pathname === '\/api\/device\/enroll'/);
  assert.match(host, /allowedStudentIds: \[\]/);
  assert.match(host, /allowedAllStudents: false/);
  assert.match(host, /notify\('onNativeHostServiceChanged', getHostServiceStatus\(\)\)/);
  assert.match(tablet, /postJson\(base \+ "\/api\/device\/enroll", enrollBody, token\)/);
  assert.match(tablet, /saveDeviceCredentials\(base, token\)/);
});

test('tablet verifies authorization before reporting a successful connection', () => {
  const connectTask = tablet.slice(tablet.indexOf('class ConnectTask'), tablet.indexOf('class PairConfirmTask'));
  assert.match(connectTask, /\/api\/device\/heartbeat/);
  assert.match(connectTask, /markConnectedNow\(\)/);
  assert.ok(connectTask.indexOf('/api/device/heartbeat') < connectTask.indexOf('markConnectedNow()'));
  assert.match(tablet, /requiresApproval/);
  assert.match(tablet, /已连接，待 Windows 授权/);
  assert.match(tablet, /授权验证失败/);
});

test('Windows exposes pending devices and a direct student authorization action', () => {
  assert.match(ui, /authorizationStatus === 'pending'/);
  assert.match(ui, /授权全部学生/);
  assert.match(ui, /allowedAllStudents: true, autoAuthorizeNewStudents: true/);
  assert.match(host, /authorizationStatus:/);
  assert.match(host, /requiresApproval/);
});

test('Windows device management supports inline rename, restore and record deletion', () => {
  assert.doesNotMatch(ui, /window\.prompt\('请输入新的设备名称'/);
  assert.match(ui, /device-rename-form/);
  assert.match(ui, /aria-label="设备名称"/);
  assert.match(ui, /恢复设备/);
  assert.match(ui, /删除记录/);
  assert.match(host, /function restoreHostDevice/);
  assert.match(host, /function deleteHostDevice/);
  assert.match(host, /请先撤销设备，再删除设备记录/);
});
