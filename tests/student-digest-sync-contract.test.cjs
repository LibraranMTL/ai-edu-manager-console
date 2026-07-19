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
  const start = mainProcess.indexOf('function markStudentDigestSubmitted');
  const end = mainProcess.indexOf('function latestFileMtime', start);
  const body = mainProcess.slice(start, end);
  assert.match(body, /normalizeUploadStatus\(record\.status\) !== 'pending_digest'/);
});

test('failed audit state is preserved after material counters refresh', () => {
  assert.match(mainProcess, /currentStatus === 'failed' \? 'failed' : 'idle'/);
  assert.match(mainProcess, /最近一批资料存在识别失败项/);
});

test('renderer displays pending submission and waiting receipt as separate counters', () => {
  assert.match(renderer, /const submittedDigestValue =/);
  assert.match(renderer, /title="待提交消化"/);
  assert.match(renderer, /title="等待 Agent 回执"/);
  assert.doesNotMatch(renderer, /const hostPending = \(stat\?\.pendingDigestCount \?\? 0\) \+ \(stat\?\.submittedDigestCount \?\? 0\)/);
});
