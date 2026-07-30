const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('collaboration UI exposes setup, bilateral pairing, inbox and recovery controls', () => {
  const ui = read('src/main.tsx');
  const preload = read('electron/preload.cjs');
  const main = read('electron/main.cjs');

  for (const label of [
    '开启知识协作',
    '连接另一台 Windows 主机',
    '我是教师/家长，邀请学生主机',
    '我是学生资料主机，邀请教师',
    '读取邀请并生成确认回执',
    '读取确认回执并完成连接',
    '不需要交换 API Token',
    '检查协作收件箱',
    '重建协作索引',
    '备份协作状态',
    '恢复最近备份',
    '已绑定协作主机',
    '暂停',
    '恢复',
    '撤销',
    '删除记录',
    '清理全部已撤销记录',
  ]) {
    assert.match(ui, new RegExp(label));
  }

  for (const bridgeMethod of [
    'initializeCollaborationWorkspace',
    'createManualCollaborationInvitation',
    'acceptManualCollaborationClipboard',
    'scanCollaborationInbox',
    'rebuildCollaborationIndex',
    'backupCollaborationState',
    'restoreLatestCollaborationState',
    'updateCollaborationBindingStatus',
    'deleteRevokedCollaborationBindings',
  ]) {
    assert.match(preload, new RegExp(bridgeMethod));
  }

  assert.match(main, /edu-manager\.collaboration-invitation\.v1/);
  assert.match(main, /bridge:updateCollaborationBindingStatus/);
  assert.match(main, /bridge:deleteRevokedCollaborationBindings/);
  assert.match(main, /只有已撤销的协作关系可以删除/);
  assert.match(main, /delete secrets\[removedId\]/);
  assert.match(main, /协作关系已暂停/);
  assert.match(main, /协作关系已恢复/);
  assert.match(main, /协作关系已撤销/);
  assert.match(main, /stage: 'invitation_copied'/);
  assert.match(main, /stage: 'acceptance_copied'/);
  assert.match(main, /stage: 'completed'/);
});

test('collaboration pairing renders a three-step guide and actionable result feedback', () => {
  const ui = read('src/main.tsx');
  const styles = read('src/styles.css');

  assert.match(ui, /collaboration-pairing-wizard/);
  assert.match(ui, /collaboration-pairing-feedback/);
  assert.match(ui, /aria-live="polite"/);
  assert.match(ui, /下一步：/);
  assert.match(ui, /邀请有效至：/);
  assert.match(ui, /对端节点：/);
  assert.match(styles, /\.collaboration-pairing-wizard ol/);
  assert.match(styles, /\.collaboration-pairing-feedback\.completed/);
  assert.match(styles, /\.collaboration-pairing-feedback\.error/);
});

test('collaboration UI explains privacy-preserving statistics and controlled exchange scope', () => {
  const ui = read('src/main.tsx');

  assert.match(ui, /仅共享数量、处理状态和更新时间，不共享文件名、路径或内容/);
  assert.match(ui, /不同步本机索引、运行锁或 Agent 缓存/);
  assert.match(ui, /共享 .* 的资料统计/);
});
