const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const plan = fs.readFileSync(path.join(root, 'docs', '01-产品优化计划-数据治理与跨智能体接入.md'), 'utf8');
const board = fs.readFileSync(path.join(root, 'docs', '02-产品优化计划执行看板.md'), 'utf8');

function section(text, start, end) {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  assert.ok(from >= 0, `missing section: ${start}`);
  assert.ok(to > from, `missing section boundary: ${end}`);
  return text.slice(from, to);
}

test('P6 is split into nine sequential delivery gates', () => {
  const p6 = section(plan, '## 阶段 P6：', '## 阶段 P7：');
  for (let stage = 0; stage <= 8; stage += 1) {
    assert.match(p6, new RegExp(`### P6-${stage}：`));
    assert.match(board, new RegExp(`P6-${stage} `));
  }
});

test('P6 has no external knowledge-engine comparison or dependency gate', () => {
  const p6Plan = section(plan, '## 阶段 P6：', '## 阶段 P7：');
  const p6Board = section(board, '### P6 /', '### 独立开发线');
  for (const content of [p6Plan, p6Board]) {
    assert.doesNotMatch(content, /LLM Wiki|GBrain/i);
    assert.match(content, /不引入外部知识引擎/);
    assert.match(content, /不设置外部知识引擎对比任务/);
  }
});
