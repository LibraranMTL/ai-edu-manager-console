const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');

test('project digest imports legacy text only as an optional compatibility fallback', () => {
  assert.match(preload, /applyProjectDigestReceiptText\(projectId, rawText\)/);
  assert.match(main, /function applyProjectDigestReceiptText\(projectId, rawText\)/);
  assert.match(main, /const parsedPayload = extractDigestReceiptPayload\(source\)/);
  assert.match(main, /assumeAllOnCompletion: recentArtifacts\.length > 0/);
  assert.match(main, /JSON\.stringify\(parsedPayload, null, 2\)/);
  assert.match(main, /直接在最终回复中说明“消化完成”/);
  assert.match(ui, /导入历史结果（可选）/);
  assert.match(ui, /校验并同步/);
  assert.match(ui, /JSON、Markdown、纯文本完成说明/);
});
