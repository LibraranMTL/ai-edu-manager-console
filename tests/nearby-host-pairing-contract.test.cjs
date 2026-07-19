const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const host = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const tablet = fs.readFileSync(
  path.join(root, 'android-tablet-terminal', 'src', 'com', 'qxmatrix', 'eduterminal', 'MainActivity.java'),
  'utf8',
);

test('Windows host advertises discovery metadata without credentials', () => {
  const payload = host.match(/function discoveryPayload\(\) \{[\s\S]*?\n\}/);
  assert.ok(payload, 'discoveryPayload should exist');
  assert.match(payload[0], /AI_EDU_MANAGER_DISCOVERY/);
  assert.match(payload[0], /hostName/);
  assert.match(payload[0], /lanUrls/);
  assert.doesNotMatch(payload[0], /apiToken|pairCode/);
  assert.match(host, /HOST_DISCOVERY_REQUEST = 'AI_EDU_MANAGER_DISCOVER_V1'/);
  assert.match(host, /startHostDiscovery\(\)/);
  assert.match(host, /stopHostDiscovery\(\)/);
});

test('short-code pairing registers a pending device for Windows approval', () => {
  const handler = host.match(/async function handlePairConfirm\([\s\S]*?\n\}/);
  assert.ok(handler, 'handlePairConfirm should exist');
  assert.match(handler[0], /allowedStudentIds: \[\]/);
  assert.match(handler[0], /allowedAllStudents: false/);
  assert.match(handler[0], /requiresApproval: true/);
  assert.match(handler[0], /Windows 主机端授权学生/);
});

test('Android exposes nearby discovery and preserves scan and paste options', () => {
  assert.match(tablet, /button\("查找附近主机", true\)/);
  assert.match(tablet, /button\("扫码绑定主机", true\)/);
  assert.match(tablet, /button\("粘贴连接信息", false\)/);
  assert.match(tablet, /AI_EDU_MANAGER_DISCOVER_V1/);
  assert.match(tablet, /promptNearbyHostPairCode/);
  assert.match(tablet, /code\.matches\("\\\\d\{6\}"\)/);
  assert.match(tablet, /等待 Windows 授权/);
  assert.match(tablet, /beginAuthorizationPolling\(\)/);
  assert.match(tablet, /authorizationPollsRemaining = 12/);
  assert.match(tablet, /postDelayed[\s\S]*5000/);
});
