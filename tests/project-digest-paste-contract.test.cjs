const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');

test('project digest can fall back to a pasted strict JSON receipt', () => {
  assert.match(preload, /applyProjectDigestReceiptText\(projectId, rawText\)/);
  assert.match(main, /function applyProjectDigestReceiptText\(projectId, rawText\)/);
  assert.match(main, /validateDigestReceipt\(\{ projectId: ensured\.id, current, request, receipt: parsed\.value, rawFiles \}\)/);
  assert.match(main, /fs\.writeFileSync\(projectDigestReceiptPath\(ensured\), JSON\.stringify\(parsed\.value, null, 2\), 'utf8'\)/);
  assert.match(main, /如果无法写入指定回执路径，请在最终回复中直接输出完整 JSON 回执/);
  assert.match(ui, /粘贴 Agent JSON/);
  assert.match(ui, /校验并同步/);
  assert.match(ui, /Markdown 批次报告不能替代回执/);
});
