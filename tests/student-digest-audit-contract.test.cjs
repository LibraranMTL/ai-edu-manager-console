const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');
const mainProcess = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');

test('digest coverage audit is exposed through the full Electron bridge', () => {
  for (const method of ['getStudentDigestAudit', 'generateStudentDigestAudit', 'syncStudentDigestAudit']) {
    assert.match(preload, new RegExp(method));
    assert.match(mainProcess, new RegExp(`bridge:${method}`));
    assert.match(renderer, new RegExp(method));
  }
});

test('digest audit keeps a per-file manifest and a structured receipt contract', () => {
  assert.match(mainProcess, /digest-manifest\.json/);
  assert.match(mainProcess, /digest-receipt\.json/);
  assert.match(mainProcess, /digest-audit\.json/);
  assert.match(mainProcess, /covered \| partial \| failed \| skipped/);
  assert.match(mainProcess, /图片必须进行视觉识别/);
  assert.match(mainProcess, /confidence/);
  assert.match(mainProcess, /artifacts/);
  assert.match(mainProcess, /digestAuditStatus/);
  assert.match(mainProcess, /coverageStatus === 'covered'/);
  assert.match(mainProcess, /\['failed', 'partial', 'missing_source'\]/);
  assert.match(mainProcess, /manifestIds\.has\(String\(record\.id\)\)/);
  assert.match(mainProcess, /Boolean\(digestReceiptMatch\(record, entries\)\)/);
});

test('secondary review uses an isolated receipt with strict run and batch validation', () => {
  assert.match(mainProcess, /digest-review-request\.json/);
  assert.match(mainProcess, /digest-review-receipt\.json/);
  assert.match(mainProcess, /reviewRunId/);
  assert.match(mainProcess, /selectedItemIds/);
  assert.match(mainProcess, /二次复核回执不属于当前复核轮次/);
  assert.match(mainProcess, /二次复核回执与当前消化批次不一致/);
  assert.match(mainProcess, /二次复核回执缺少 .* 个所选资料 ID/);
  assert.match(mainProcess, /不要覆盖第一次回执/);
  assert.match(mainProcess, /synced: false/);
  assert.match(mainProcess, /synced: true/);
});

test('secondary review matching prioritizes immutable upload ids', () => {
  assert.match(mainProcess, /entry\.id \|\| entry\.recordId/);
  assert.match(mainProcess, /if \(exactId\) return exactId/);
  assert.match(mainProcess, /"id": "消化清单中的资料 ID"/);
});

test('materials page renders audit controls and has no undefined Clock icon', () => {
  assert.match(renderer, /消化覆盖审计/);
  assert.match(renderer, /复制二次核对指令/);
  assert.match(renderer, /同步复核结果/);
  assert.match(styles, /\.digest-audit-list/);
  assert.doesNotMatch(renderer, /<Clock\s/);
});

test('materials page does not report a stale review receipt as synchronized', () => {
  assert.match(renderer, /result\.synced === false/);
  assert.match(renderer, /未发现可同步的新复核结果/);
});
