const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');

test('all four report tasks use growth fingerprinted automatic validation', () => {
  assert.match(main, /completionPolicy: 'auto_after_validation'/);
  assert.match(main, /growthFingerprint = String\(safeReadJson\(growthIndexPath\(normalized\)/);
  assert.match(main, /idempotencyKey: `\\?\$\{kind\}:\$\{normalized\.id\}:\$\{period\.key\}:\$\{growthFingerprint/);
  assert.match(main, /idempotencyKey: `weekly_action:\$\{normalized\.id\}:\$\{week\.key\}:\$\{growthFingerprint/);
  assert.match(main, /student_id: \$\{normalized\.id\}/);
  assert.match(main, /growth_fingerprint: \$\{task\.input\?\.growthFingerprint/);
});

test('validated reports publish without a human review transition', () => {
  assert.match(main, /function autoPublishValidatedReport\(task, validation\)/);
  assert.match(main, /const publication = autoPublishValidatedReport\(task, validation\)/);
  assert.match(main, /reviewedBy: 'system_validation'/);
  assert.match(main, /'report_auto_published'/);
});

test('invalid reports retain the previous publication and write one issue record', () => {
  assert.match(main, /function persistReportIssue\(task, validation\)/);
  assert.match(main, /报告暂未更新，上一版仍可使用；需要补充依据。/);
  assert.match(main, /REPORT_AUTO_PUBLICATION_FAILED/);
});
