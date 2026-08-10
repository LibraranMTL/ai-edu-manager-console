const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('collaboration UI exposes role-neutral device trust, exact student mapping, inbox and recovery controls', () => {
  const ui = read('src/main.tsx');
  const preload = read('electron/preload.cjs');
  const main = read('electron/main.cjs');

  for (const label of [
    '开启知识协作',
    '连接协作设备并添加共享学生',
    '生成临时码、二维码并复制连接信息',
    '连接并双向确认',
    '复制当前学生的映射邀请',
    '读取学生映射邀请或确认回执',
    '不交换 API Token',
    '检查协作收件箱',
    '重建协作索引',
    '备份协作状态',
    '恢复最近备份',
    '协作设备',
    '共享学生',
    '暂停',
    '恢复',
    '撤销',
    '删除',
    '清理全部已撤销设备',
  ]) {
    assert.match(ui, new RegExp(label));
  }
  assert.doesNotMatch(ui, /我是教师\/家长，邀请学生主机/);
  assert.doesNotMatch(ui, /我是学生资料主机，邀请教师/);

  for (const bridgeMethod of [
    'initializeCollaborationWorkspace',
    'createCollaborationDeviceInvitation',
    'joinCollaborationDevice',
    'createCollaborationStudentMappingOffer',
    'acceptCollaborationStudentMappingClipboard',
    'scanCollaborationInbox',
    'rebuildCollaborationIndex',
    'backupCollaborationState',
    'restoreLatestCollaborationState',
    'updateCollaborationBindingStatus',
    'deleteRevokedCollaborationBindings',
  ]) {
    assert.match(preload, new RegExp(bridgeMethod));
  }

  assert.match(main, /\/api\/collaboration\/device-pair\/join/);
  assert.match(main, /\/api\/collaboration\/student-map\/accept/);
  assert.match(main, /androidPullNextMatch/);
  assert.match(main, /function handleCollaborationAndroidPullNext/);
  assert.match(main, /function handleCollaborationAndroidPullChunk/);
  assert.match(main, /function handleCollaborationAndroidPullAck/);
  assert.match(main, /function completeCollaborationStudentMappingAcceptance\(payload\)/);
  assert.match(main, /completedMappingAcceptances/);
  assert.match(main, /recordCollaborationDevicePairAttempt/);
  assert.match(main, /bridge:createCollaborationDeviceInvitation/);
  assert.match(main, /bridge:joinCollaborationDevice/);
  assert.match(main, /bridge:createCollaborationStudentMappingOffer/);
  assert.match(main, /bridge:acceptCollaborationStudentMappingClipboard/);
  assert.match(main, /bridge:updateCollaborationBindingStatus/);
  assert.match(main, /bridge:deleteRevokedCollaborationBindings/);
  assert.match(main, /只有已撤销的协作设备可以删除/);
  assert.match(main, /delete secrets\[removedId\]/);
  assert.match(main, /协作设备已暂停/);
  assert.match(main, /协作设备已恢复/);
  assert.match(main, /协作设备已撤销/);
  assert.match(main, /stage: 'device_invitation_ready'/);
  assert.match(main, /connectionInfoText: JSON\.stringify\(connectionInfo\)/);
  assert.match(main, /stage: 'device_connected'/);
  assert.match(main, /stage: 'student_mapping_offered'/);
  assert.match(main, /stage: 'student_mapping_accepted'/);
  assert.match(main, /stage: 'student_mapping_completed'/);
});

test('collaboration pairing renders device-first guidance and actionable result feedback', () => {
  const ui = read('src/main.tsx');
  const styles = read('src/styles.css');

  assert.match(ui, /collaboration-pairing-wizard/);
  assert.match(ui, /collaboration-pairing-feedback/);
  assert.match(ui, /aria-live="polite"/);
  assert.match(ui, /下一步：/);
  assert.match(ui, /六位临时码：/);
  assert.match(ui, /邀请有效至：/);
  assert.match(ui, /对端节点：/);
  assert.match(ui, /Android 单机版知识协作连接二维码/);
  assert.match(ui, /QRCode\.toDataURL\(connectionInfoText/);
  assert.match(styles, /\.collaboration-pairing-wizard ol/);
  assert.match(styles, /\.collaboration-pairing-feedback\.device_connected/);
  assert.match(styles, /\.collaboration-pairing-code/);
  assert.match(styles, /\.collaboration-device-qr img/);
  assert.match(styles, /\.collaboration-pairing-feedback\.error/);
});

test('collaboration UI explains privacy-preserving statistics and controlled exchange scope', () => {
  const ui = read('src/main.tsx');

  assert.match(ui, /仅共享数量、处理状态和更新时间，不共享文件名、路径或内容/);
  assert.match(ui, /不同步本机索引、运行锁或 Agent 缓存/);
  assert.match(ui, /共享 .* 的资料统计/);
});
