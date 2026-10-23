const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const host = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');
const tablet = fs.readFileSync(path.join(root, 'android-tablet-terminal', 'src', 'com', 'qxmatrix', 'eduterminal', 'MainActivity.java'), 'utf8');
const tabletManifest = fs.readFileSync(path.join(root, 'android-tablet-terminal', 'AndroidManifest.xml'), 'utf8');

test('V2 discovery advertises stable identity without credentials and retains V1 discovery', () => {
  const payload = host.match(/function discoveryPayload\([\s\S]*?\n\}/);
  assert.ok(payload, 'discoveryPayload should exist');
  assert.match(payload[0], /machineCode/);
  assert.match(payload[0], /deviceId/);
  assert.match(payload[0], /lanUrls/);
  assert.doesNotMatch(payload[0], /apiToken|pairCode/);
  assert.match(host, /HOST_DISCOVERY_REQUEST_V1 = 'AI_EDU_MANAGER_DISCOVER_V1'/);
  assert.match(host, /HOST_DISCOVERY_REQUEST_V2 = 'AI_EDU_MANAGER_DISCOVER'/);
  assert.match(host, /rememberDiscoveredTablet/);
  assert.match(host, /identityKey = `tablet:\$\{payload\.deviceId\}`/);
});

test('V2 pair requests require bilateral acceptance and keep random request tokens out of UI state', () => {
  assert.match(host, /\/api\/pair\/request/);
  assert.match(host, /\/api\/pair\/status/);
  assert.match(host, /\/api\/pair\/tablet-accept/);
  assert.match(host, /\/api\/pair\/reject/);
  assert.match(host, /\/api\/pair\/cancel/);
  assert.match(host, /cancelReason: 'superseded'/);
  assert.match(host, /pending_host_accept/);
  assert.match(host, /pending_tablet_accept/);
  assert.match(host, /verifyRequestToken/);
  assert.match(host, /const \{ requestTokenHash, issuedToken, issuedTokenExpiresAt, \.\.\.safe \} = request/);
  assert.doesNotMatch(ui, /requestTokenHash|issuedToken/);
});

test('revoked devices cannot self-restore and accepted devices start in student-session mode', () => {
  const enrollment = host.match(/function enrollPairedTablet\([\s\S]*?\n\}/);
  assert.ok(enrollment, 'V2 enrollment helper should exist');
  assert.match(enrollment[0], /existing\?\.revoked/);
  assert.match(enrollment[0], /不能自行恢复/);
  assert.match(enrollment[0], /student-session-v1/);
  assert.match(enrollment[0], /terminalMode/);
  assert.match(enrollment[0], /requiresApproval: false/);
  assert.match(host, /machineCodeConflict/);
});

test('Windows UI and bridge expose fixed-code bilateral discovery while preserving legacy methods', () => {
  for (const method of ['renameHostIdentity', 'findLanTablets', 'inviteLanTablet', 'acceptHostPairRequest', 'rejectPairRequest']) {
    assert.match(preload, new RegExp(method));
    assert.match(ui, new RegExp(method));
  }
  assert.match(ui, /本机固定主机码/);
  assert.match(ui, /查找学生终端/);
  assert.match(ui, /固定学生终端码/);
  assert.match(ui, /最近连接申请/);
  assert.match(ui, /在线/);
  assert.match(ui, /其他连接方式：二维码、六位配对码、粘贴与连接备份/);
  assert.match(host, /pairCode: pairPayload\.pairCode/);
  assert.match(host, /\/api\/pair\/confirm/);
});

test('Android uses V2 no-code requests, supports host invitations, and preserves V1, QR, paste and backup', () => {
  assert.match(tablet, /HOST_DISCOVERY_REQUEST_V2 = "AI_EDU_MANAGER_DISCOVER"/);
  assert.match(tablet, /HOST_DISCOVERY_REQUEST_V1 = "AI_EDU_MANAGER_DISCOVER_V1"/);
  assert.match(tablet, /class PairRequestV2Task/);
  assert.match(tablet, /\/api\/pair\/request/);
  assert.match(tablet, /\/api\/pair\/status/);
  assert.match(tablet, /class PairInviteDecisionTask/);
  assert.match(tablet, /\/api\/pair\/tablet-accept/);
  assert.match(tablet, /button\("等待主机连接", false\)/);
  assert.match(tablet, /protected void onStop\(\)[\s\S]*?stopWaitingForHostInvite\(\)/);
  assert.match(tablet, /button\("查找局域网主机", true\)/);
  assert.match(tablet, /filterNearbyHostsByCode/);
  assert.match(tablet, /host\.protocolVersion >= 2[\s\S]*?host\.machineCode\.toUpperCase\(\)\.contains\(query\)/);
  assert.match(tablet, /String discoveryEndpoint = response\.getAddress\(\)\.getHostAddress\(\) \+ ":" \+ port/);
  assert.match(tablet, /boolean sameEndpoint = discoveryEndpoint\.equals\(existing\.discoveryEndpoint\)/);
  assert.match(tablet, /boolean sameIdentity = hostDeviceId\.length\(\) > 0/);
  assert.match(tablet, /existing\.protocolVersion > incoming\.protocolVersion/);
  assert.match(tablet, /connectedIdentityText/);
  assert.match(tablet, /\/api\/pair\/cancel/);
  assert.match(tablet, /promptNearbyHostPairCode/);
  assert.match(tablet, /code\.matches\("\\\\d\{6\}"\)/);
  assert.match(tablet, /扫码绑定主机/);
  assert.match(tablet, /粘贴连接信息/);
  assert.match(tablet, /CONNECTION_BACKUP_KIND/);
});

test('host-to-tablet discovery survives common Wi-Fi broadcast filtering', () => {
  assert.match(host, /require\('\.\/lan-discovery\.cjs'\)/);
  assert.match(host, /targets = lanDiscoveryBroadcastTargets\(\)/);
  assert.match(host, /for \(const target of targets\)/);
  assert.match(tabletManifest, /android\.permission\.ACCESS_WIFI_STATE/);
  assert.match(tabletManifest, /android\.permission\.CHANGE_WIFI_MULTICAST_STATE/);
  assert.match(tablet, /WifiManager\.MulticastLock tabletDiscoveryMulticastLock/);
  assert.match(tablet, /acquireTabletDiscoveryMulticastLock\(\)/);
  assert.match(tablet, /releaseTabletDiscoveryMulticastLock\(\)/);
  assert.match(tablet, /announceTabletDiscoveryPresence\(socket\)/);
});

test('device-bound host identity is excluded from portable backups', () => {
  assert.doesNotMatch(host, /hostIdentity: getHostIdentity\(\)/);
  assert.match(host, /delete backupSettings\.license/);
  assert.match(host, /currentSettings\.license/);
  assert.match(host, /writeHostIdentity/);
  assert.match(tablet, /backup\.put\("tabletMachineCode", tabletMachineCode\(\)\)/);
  assert.match(tablet, /backup\.put\("hostMachineCode"/);
  assert.match(tablet, /PREF_DEVICE_ID/);
});

test('Windows student terminals reuse the tablet wire role while preserving platform and capabilities', () => {
  assert.match(host, /platform: String\(payload\.platform \|\| 'android'\)/);
  assert.match(host, /targetTabletMachineCode: tablet\.machineCode/);
  assert.match(host, /tabletPlatform: String\(body\.platform \|\| 'android'\)/);
  assert.match(host, /tabletCapabilities: Array\.isArray\(body\.capabilities\)/);
  assert.match(host, /platform: String\(input\.tabletPlatform \|\| existing\?\.platform \|\| 'android'\)/);
  assert.match(host, /input\.tabletCapabilities/);
});

test('P3 host uses student-terminal wording and keeps legacy bridge aliases', () => {
  assert.match(host, /discoveredTerminals: discoveredTablets/);
  assert.match(host, /bridge:findLanTerminals/);
  assert.match(host, /bridge:inviteLanTerminal/);
  assert.match(preload, /findLanTerminals/);
  assert.match(preload, /inviteLanTerminal/);
  assert.match(ui, /附近学生终端/);
  assert.match(ui, /Android 或 Windows 学生终端/);
  assert.match(ui, /await bridge\(\)\?\.findLanTerminals\?\.\(\) \?\? await bridge\(\)\?\.findLanTablets/);
  assert.match(ui, /await bridge\(\)\?\.inviteLanTerminal\?\.\(terminalId\) \?\? await bridge\(\)\?\.inviteLanTablet/);
  assert.match(styles, /\.pair-request-item button[\s\S]*?white-space: nowrap/);
});
