const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');
const digestCard = fs.readFileSync(path.join(root, 'src', 'DigestStatusCard.tsx'), 'utf8');

test('daily digest card uses plain-language states and keeps diagnostics folded', () => {
  const ordinary = digestCard.slice(0, digestCard.indexOf('{advancedActions &&'));
  assert.doesNotMatch(ordinary, /等待 Agent 回执|检查 Agent 回执|返回的 JSON|需要帮助/);
  assert.match(ordinary, /处理中/);
  assert.match(ordinary, /刷新处理结果/);
  assert.match(ordinary, /需要补充/);
  assert.match(digestCard, /<summary>高级与诊断<\/summary>/);
});

test('home and project overview present education outcomes instead of protocol terms', () => {
  const home = main.slice(main.indexOf('今日教育资料闭环'), main.indexOf('<details className="home-advanced-tools">'));
  assert.doesNotMatch(home, /回执|MCP|适配器|事务|SHA|审计/);
  assert.match(home, /添加资料/);
  assert.match(home, /需要补充/);
  assert.match(main, /title="待整理知识"/);
  assert.match(main, /title="需要补充"/);
  assert.match(main, /<em>自动处理<\/em>/);
});
