const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const main = read('electron', 'terminal-main.cjs');
const preload = read('electron', 'terminal-preload.cjs');
const ui = read('src', 'terminal-main.tsx');
const styles = read('src', 'terminal-styles.css');
const helper = read('electron', 'terminal-lan-pairing.cjs');

test('P0 Windows terminal exposes one stable fixed machine code without using it as a password', () => {
  assert.match(main, /machineCode\('tablet', terminalDeviceId\)/);
  assert.match(main, /machineCode\('tablet', deviceId\(\)\)/);
  assert.match(main, /terminal:copy-machine-code/);
  assert.match(preload, /copyMachineCode/);
  assert.match(ui, /本机固定终端码/);
  assert.match(ui, /用于主机在局域网中识别本终端，不是密码/);
  assert.match(ui, /复制终端码/);
  assert.match(styles, /\.terminal-machine-code/);
  assert.doesNotMatch(ui, /终端码验证码|机器码验证码/);
});

test('P1 Windows terminal discovers V1 and V2 hosts, filters by fixed code and requests bilateral acceptance', () => {
  assert.match(main, /dgram\.createSocket\(\{ type: 'udp4', reuseAddr: true \}\)/);
  assert.match(main, /lanDiscoveryBroadcastTargets\(\)/);
  assert.match(main, /HOST_DISCOVERY_REQUEST_V1/);
  assert.match(main, /HOST_DISCOVERY_REQUEST_V2/);
  assert.match(main, /\/api\/pair\/request/);
  assert.match(main, /\/api\/pair\/status/);
  assert.match(main, /\/api\/pair\/cancel/);
  assert.match(main, /pendingPairRequest/);
  assert.match(main, /requestToken: _requestToken/);
  assert.match(preload, /findLanHosts/);
  assert.match(preload, /requestHostPair/);
  assert.match(preload, /cancelPairRequest/);
  assert.match(ui, /扫描局域网主机/);
  assert.match(ui, /等待主机接受/);
  assert.match(ui, /局域网手工连接：粘贴信息、主机地址和六位配对码/);
  assert.match(helper, /hostUrlFromDiscovery/);
  assert.match(helper, /filterDiscoveredHosts/);
  assert.doesNotMatch(ui, /requestToken/);
});

test('P2 host invitations reach the Windows terminal and require an explicit accept or reject decision', () => {
  assert.match(main, /HOST_PAIR_INVITE/);
  assert.match(main, /rememberIncomingPairInvite/);
  assert.match(main, /targetTabletId/);
  assert.match(main, /targetTabletMachineCode/);
  assert.match(main, /\/api\/pair\/tablet-accept/);
  assert.match(main, /\/api\/pair\/reject/);
  assert.match(main, /acceptPendingPairInvite/);
  assert.match(main, /rejectPendingPairInvite/);
  assert.match(preload, /acceptPairInvite/);
  assert.match(preload, /rejectPairInvite/);
  assert.match(ui, /邀请连接/);
  assert.match(ui, /decidePairInvite\('accept'\)/);
  assert.match(ui, /decidePairInvite\('reject'\)/);
  assert.match(styles, /\.terminal-pair-item\.invite/);
  assert.doesNotMatch(ui, /四位|PIN/);
});

test('P3 Windows terminal handles expiry, port conflicts and legacy fallback without exposing secrets', () => {
  assert.match(main, /pendingPairInvite\?\.expiresAt/);
  assert.match(main, /主机连接邀请已超时/);
  assert.match(main, /error\.code === 'EADDRINUSE'/);
  assert.match(main, /不要在同一台电脑同时运行主机版和学生端/);
  assert.match(main, /pendingPairRequest: null,[\s\S]*?pendingPairInvite: null/);
  assert.match(ui, /网络隔离设备/);
  assert.match(ui, /六位配对码/);
  assert.doesNotMatch(ui, /requestToken|device token|API Token/);
});
