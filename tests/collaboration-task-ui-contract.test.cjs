const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');
const taskProtocol = fs.readFileSync(path.join(root, 'electron', 'collaboration-task.cjs'), 'utf8');

test('collaboration tasks are exposed through bridge and use dedicated task-center actions', () => {
  for (const token of ['bridge:getRemoteCollaborationTasks', 'bridge:selectCollaborationTaskFiles', 'bridge:selectCollaborationResultFiles', 'bridge:createRemoteCollaborationTask', 'bridge:updateRemoteCollaborationTask', 'bridge:resolveCollaborationTaskAttachments']) {
    assert.match(main, new RegExp(token.replace(':', '\\:')));
  }
  for (const token of ['getRemoteCollaborationTasks', 'selectCollaborationTaskFiles', 'selectCollaborationResultFiles', 'createRemoteCollaborationTask', 'updateRemoteCollaborationTask', 'resolveCollaborationTaskAttachments']) {
    assert.match(preload, new RegExp(token));
    assert.match(renderer, new RegExp(token));
  }
  for (const label of ['选择资料', '打开附件收件箱', '继续暂存', '采用到原始资料库', '加入所选项目', '拒绝资料', '选择成果文件', '打开成果附件']) {
    assert.match(renderer, new RegExp(label));
  }
  for (const label of ['跨主机任务与协作请求', '布置给', '请求教师协助', '接受任务', '接受协助请求', '稍后处理', '无法完成', '提交给教师', '回复学生', '继续追问', '反馈修改', '确认完成']) {
    assert.match(renderer, new RegExp(label));
  }
  assert.match(main, /activeCollaborationHelpBinding/);
  assert.match(main, /ipcMain\.handle\('bridge:createRemoteCollaborationTask'/);
  assert.match(main, /ipcMain\.handle\('bridge:updateRemoteCollaborationTask'/);
  assert.match(preload, /ipcRenderer\.invoke\('bridge:createRemoteCollaborationTask'/);
  assert.match(preload, /ipcRenderer\.invoke\('bridge:updateRemoteCollaborationTask'/);
  assert.match(renderer, /const raw = await pending/);
  assert.match(main, /adopt_project/);
  assert.match(main, /无需重复复制/);
  assert.match(taskProtocol, /edu-manager\.knowledge-contribution\.v1/);
  assert.match(renderer, /教师知识建议草稿/);
  assert.match(renderer, /selectedTask\?\.kind === 'collaboration_assignment'/);
  assert.match(renderer, /接受并在本机执行/);
});

test('D4-A executes accepted work on the knowledge host and returns validated results through the existing queue', () => {
  assert.match(taskProtocol, /remote_local/);
  assert.match(taskProtocol, /autoStartAfterAccept/);
  assert.match(main, /remoteLocalExecution/);
  assert.match(main, /currentArchiveAccess\(\)\.buildContextBundle/);
  assert.match(main, /executeTaskByAdapter\(applied\.task\.taskId/);
  assert.match(main, /function publishCompletedRemoteCollaborationTask/);
  assert.match(main, /remote_local_result_returned/);
  assert.match(main, /task\.input\?\.remoteLocalExecution \? 'read-only' : 'workspace-write'/);
  assert.match(main, /Agent 未返回可回传的结果或附件/);
  assert.match(main, /submitManualTask/);
});

test('collaboration task eligibility accepts different student ids on the two hosts', () => {
  assert.match(renderer, /item\.nodeId !== localCollaborationNodeId && item\.role === 'learner_authority' && Boolean\(item\.studentId\)/);
  assert.match(main, /sourceStudentId: student\.id/);
  assert.match(main, /targetStudentId: targetRole\.studentId/);
  assert.match(main, /repairCollaborationLocalStudentMappings/);
});

test('collaboration task detail renders messages returned by either host', () => {
  assert.match(renderer, /selectedCollaborationMessages/);
  assert.match(renderer, /event\.payload\?\.message\?\.trim\(\)/);
  assert.match(renderer, /event\.actorNodeId === localCollaborationNodeId \? '我' : '对方'/);
  assert.match(renderer, /协作沟通记录/);
  assert.match(renderer, /event\.message/);
});
