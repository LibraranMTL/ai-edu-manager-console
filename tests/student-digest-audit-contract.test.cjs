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

test('materials page renders audit controls and has no undefined Clock icon', () => {
  assert.match(renderer, /消化覆盖审计/);
  assert.match(renderer, /复制二次核对指令/);
  assert.match(renderer, /同步复核结果/);
  assert.match(styles, /\.digest-audit-list/);
  assert.doesNotMatch(renderer, /<Clock\s/);
});
