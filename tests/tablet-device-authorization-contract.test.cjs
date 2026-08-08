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

test('connection settings keep multiple endpoints and automatically fall back without changing authorization', () => {
  const connectTask = tablet.slice(tablet.indexOf('class ConnectTask'), tablet.indexOf('class ConnectionEndpointTask'));
  const candidates = tablet.slice(tablet.indexOf('List<String> connectionCandidates()'), tablet.indexOf('void rememberSuccessfulEndpoint'));
  assert.match(tablet, /PREF_ENDPOINT_CANDIDATES/);
  assert.match(tablet, /List<String> connectionCandidates\(\)/);
  assert.match(tablet, /rememberSuccessfulEndpoint\(String base\)/);
  assert.match(candidates, /connectionMode\(\) == 1 && manual\.length\(\) > 0 && isTailscaleServerUrl\(manual\)/);
  assert.match(candidates, /candidates\.add\(manual\)/);
  assert.match(connectTask, /for \(int i = 0; i < bases\.size\(\); i\+\+\)/);
  assert.match(connectTask, /连接失败，正在自动尝试/);
  assert.match(connectTask, /new ConnectionEndpointTask\(activity, base\)/);
  assert.match(tablet, /主机地址已刷新，无需重新授权/);
  assert.match(tablet, /&& !refreshAddressOnly\) tokenInput\.setText\(value\)/);
});

test('connection failures distinguish endpoint reachability from real authorization rejection', () => {
  assert.match(tablet, /String connectionFailureState\(String detail\)/);
  assert.match(tablet, /return "连接超时"/);
  assert.match(tablet, /return "主机地址不可达"/);
  assert.match(tablet, /return "端口连接被拒绝"/);
  assert.match(tablet, /return "授权失效"/);
  assert.doesNotMatch(connectTaskSource(), /ConnectionSummaryTask\(activity, "授权验证失败"/);
});

function connectTaskSource() {
  return tablet.slice(tablet.indexOf('class ConnectTask'), tablet.indexOf('class ConnectionEndpointTask'));
}

test('Windows pairing advertises a cached MagicDNS fallback without exposing another user setting', () => {
  assert.match(host, /function getTailscaleDnsUrls\(port\)/);
  assert.match(host, /Self\?\.DNSName/);
  assert.match(host, /tailscaleDnsUrlCache/);
  assert.match(host, /hostId: identity\.hostId/);
  assert.match(host, /tailscaleUrls: info\.tailscaleUrls/);
  assert.doesNotMatch(ui, /MagicDNS 设置/);
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
