const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const host = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');
const tablet = fs.readFileSync(path.join(root, 'android-tablet-terminal', 'src', 'com', 'qxmatrix', 'eduterminal', 'MainActivity.java'), 'utf8');

test('device enrollment creates a visible shared terminal with session capability', () => {
  assert.match(host, /async function handleDeviceEnroll/);
  assert.match(host, /pathname === '\/api\/device\/enroll'/);
  assert.match(host, /terminalMode: 'shared'/);
  assert.match(host, /student-session-v1/);
  assert.match(host, /notify\('onNativeHostServiceChanged', getHostServiceStatus\(\)\)/);
  assert.match(tablet, /postJson\(base \+ "\/api\/device\/enroll", enrollBody, token\)/);
  assert.match(tablet, /saveDeviceCredentials\(base, token\)/);
});

test('Android verifies the device then opens only a student session', () => {
  const connectTask = tablet.slice(tablet.indexOf('class ConnectTask'), tablet.indexOf('class PairConfirmTask'));
  assert.match(connectTask, /\/api\/device\/heartbeat/);
  assert.match(connectTask, /markConnectedNow\(\)/);
  assert.ok(connectTask.indexOf('/api/device/heartbeat') < connectTask.indexOf('markConnectedNow()'));
  assert.match(tablet, /class BootstrapStudentSessionTask/);
  assert.match(tablet, /\/api\/student-session\/auto/);
  assert.match(tablet, /\/api\/student-session\/me/);
  assert.doesNotMatch(tablet, /base \+ "\/api\/students"/);
});

test('Windows uses personal/shared terminal configuration and student login QR codes', () => {
  assert.match(preload, /setHostDeviceTerminalMode/);
  assert.match(ui, /setDeviceTerminalMode/);
  assert.match(ui, /个人终端/);
  assert.match(ui, /共享终端/);
  assert.match(ui, /学生登录 ID 与二维码/);
  assert.doesNotMatch(ui, /授权全部学生/);
  assert.match(host, /handleStudentSessionLogin/);
  assert.match(host, /handleStudentSessionLogout/);
});

test('Windows device management supports inline rename, restore and record deletion', () => {
  assert.doesNotMatch(ui, /window\.prompt\('请输入新的设备名称/);
  assert.match(ui, /device-rename-form/);
  assert.match(ui, /aria-label="设备名称"/);
  assert.match(ui, /恢复设备/);
  assert.match(ui, /删除记录/);
  assert.match(host, /function restoreHostDevice/);
  assert.match(host, /function deleteHostDevice/);
});
