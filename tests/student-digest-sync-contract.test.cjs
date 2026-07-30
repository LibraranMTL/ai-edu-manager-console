const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');
const mainProcess = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');

test('digest result reads the Agent receipt before upload synchronization', () => {
  const start = mainProcess.indexOf('function syncStudentDigestResult');
  const end = mainProcess.indexOf('function isAllowedUploadFile', start);
  const body = mainProcess.slice(start, end);
  assert.ok(body.indexOf('const state = readStudentDigestState(student)') < body.indexOf('syncStudentMaterialsFromUploadRecords(student)'));
});

test('material refresh preserves completed receipts and separates submitted work', () => {
  assert.match(mainProcess, /completedCoversSubmitted/);
  assert.match(mainProcess, /submittedCount > 0/);
  assert.match(mainProcess, /等待 Agent 完成并写回回执/);
  assert.doesNotMatch(mainProcess, /status: openCount > 0 \? 'pending' : 'idle'/);
});

test('mark submitted only moves records that are actually pending', () => {
  const start = mainProcess.indexOf('function registerStudentDigestBatch');
  const end = mainProcess.indexOf('function markStudentDigestSubmitted', start);
  const body = mainProcess.slice(start, end);
  assert.match(body, /normalizeUploadStatus\(record\.status\) === 'pending_digest'/);
  assert.match(body, /不能建立空消化批次|当前没有待处理资料/);
  assert.match(body, /submittedIds\.has\(String\(record\.id/);
});

test('empty student digest work does not create an actionable task', () => {
  assert.match(mainProcess, /pendingCount > 0 \|\| submittedCount > 0 \|\| \['digesting', 'submitted'\]\.includes\(digestStatus\)/);
  assert.match(mainProcess, /options\.reconcileStudentDigests/);
  assert.match(mainProcess, /!activeStudentDigestIds\.has\(String\(task\.id\)\)/);
  assert.match(mainProcess, /reason: 'no_pending_materials'/);
  assert.match(renderer, /if \(pendingCount <= 0\)/);
  assert.match(renderer, /disabled=\{pendingDigestValue\(student\) <= 0 \|\| submittedDigestValue\(student\) > 0\}/);
  assert.match(renderer, /暂无待处理/);
});

test('failed audit state is preserved after material counters refresh', () => {
  assert.match(mainProcess, /currentStatus === 'failed' \? 'failed' : 'idle'/);
  assert.match(mainProcess, /最近一批资料存在识别失败项/);
});

test('renderer displays pending submission and processing as separate counters', () => {
  assert.match(renderer, /const submittedDigestValue =/);
  assert.match(renderer, /title="待提交消化"/);
  assert.match(renderer, /title="处理中"/);
  assert.doesNotMatch(renderer, /const hostPending = \(stat\?\.pendingDigestCount \?\? 0\) \+ \(stat\?\.submittedDigestCount \?\? 0\)/);
});
