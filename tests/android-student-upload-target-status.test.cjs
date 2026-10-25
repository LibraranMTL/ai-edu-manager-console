const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'android-tablet-terminal', 'src', 'com', 'qxmatrix', 'eduterminal', 'MainActivity.java'),
  'utf8',
);

test('manual material upload requires an explicit student or project destination', () => {
  const method = source.slice(
    source.indexOf('void chooseUploadTarget('),
    source.indexOf('void uploadMaterialsToTarget('),
  );
  assert.match(method, /int checked = -1/);
  assert.match(method, /确认上传位置（/);
  assert.match(method, /项目资料 ·/);
  assert.match(method, /学生原始资料库 ·/);
  assert.match(method, /position < 0[\s\S]*请选择学生原始资料库或一个项目[\s\S]*return;/);
  assert.doesNotMatch(method, /position = initialChecked/);
});

test('upload status is derived from the current student queue and exact host receipt state', () => {
  const method = source.slice(
    source.indexOf('void refreshProjectMaterialQueueStatus()'),
    source.indexOf('void uploadPendingSharedMaterials()'),
  );
  assert.match(method, /selectedStudent\.id\.equals\(entry\.studentId\)/);
  assert.match(method, /uploadEntryMatchesCurrentScope\(entry\)/);
  assert.match(method, /当前学生上传：等待发送/);
  assert.match(method, /只有“主机已确认接收并登记”代表主机已完成接收/);
  assert.match(method, /状态：/);
  assert.match(method, /位置：/);
  assert.match(method, /项目资料 ·/);
  assert.match(method, /主机已确认接收并登记/);
  assert.doesNotMatch(method, /ProjectMaterialUploadJobService\.KEY_STATUS/);
});

test('reliable upload copy starts immediately but does not claim host receipt early', () => {
  const task = source.slice(
    source.indexOf('class EnqueueProjectMaterialsTask'),
    source.indexOf('class UploadResultTask'),
  );
  assert.match(task, /已安全保存并开始发送/);
  assert.match(task, /网络中断，本机会自动重试/);
  assert.match(task, /主机已确认接收并登记/);
  assert.doesNotMatch(task, /已入队/);
  assert.match(task, /scheduleUploadStatusRefreshes\(\)/);
});
