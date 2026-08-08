const assert = require('node:assert/strict');
const test = require('node:test');
const { analyzeArchiveMarkdownContent, summarizeArchiveContentHealth } = require('../electron/archive-content-health.cjs');

test('education archive content health separates empty templates partial drafts and real content', () => {
  assert.equal(analyzeArchiveMarkdownContent('').state, 'empty');
  assert.equal(analyzeArchiveMarkdownContent('# 阶段总结\n\n## 核心进展\n\n待生成。\n\n## 问题\n\n- 待补充。').state, 'template');
  assert.equal(analyzeArchiveMarkdownContent('# 阶段总结\n\n## 核心进展\n\n已完成资料整理。\n\n## 问题\n\n- 待补充。').state, 'partial');
  assert.equal(analyzeArchiveMarkdownContent('# 阶段总结\n\n已完成资料整理，并形成两份可追溯的项目成果。').state, 'substantive');
});

test('education archive content health summary reports every attention state', () => {
  const health = summarizeArchiveContentHealth([
    { contentState: 'substantive' },
    { contentState: 'partial' },
    { contentState: 'template' },
    { contentState: 'empty' },
  ]);
  assert.equal(health.total, 4);
  assert.equal(health.needsAttention, 3);
  assert.match(health.message, /1 份占位模板/);
});
