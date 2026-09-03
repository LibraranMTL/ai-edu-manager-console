const assert = require('node:assert/strict');
const test = require('node:test');

async function loadRenderer() {
  return import('../src/terminal-markdown.js');
}

test('Windows student Markdown renderer creates semantic tables with inline formatting', async () => {
  const { renderTerminalMarkdown } = await loadRenderer();
  const html = renderTerminalMarkdown(`# 历史变化

| 阶段 | 标志性表现 |
| :--- | ---: |
| 七年级 | **形成兴趣**，保持专注 |
| 八年级 | 使用 \`复盘\` |`);
  assert.match(html, /<h1>历史变化<\/h1>/);
  assert.match(html, /<div class="markdown-table-wrap"><table>/);
  assert.match(html, /<thead><tr>/);
  assert.match(html, /class="align-left"/);
  assert.match(html, /class="align-right"/);
  assert.match(html, /<strong>形成兴趣<\/strong>/);
  assert.match(html, /<code>复盘<\/code>/);
  assert.doesNotMatch(html, /\| :--- \|/);
});

test('Windows student Markdown renderer supports common block and inline syntax', async () => {
  const { renderTerminalMarkdown } = await loadRenderer();
  const html = renderTerminalMarkdown(`---
private: hidden
---
## 小结

- 普通项目
- [x] 已完成
1. 第一步
2. 第二步

> 只读说明

~~旧结论~~与*新观察*

\`\`\`text
<原始代码>
\`\`\`

[参考链接](https://example.com)`);
  assert.doesNotMatch(html, /private: hidden/);
  assert.match(html, /<h2>小结<\/h2>/);
  assert.match(html, /<ul>/);
  assert.match(html, /class="markdown-task"/);
  assert.match(html, /<ol>/);
  assert.match(html, /<blockquote>只读说明<\/blockquote>/);
  assert.match(html, /<del>旧结论<\/del>/);
  assert.match(html, /<em>新观察<\/em>/);
  assert.match(html, /<pre><code class="language-text">&lt;原始代码&gt;<\/code><\/pre>/);
  assert.match(html, /href="https:\/\/example\.com"/);
});

test('Windows student Markdown renderer escapes raw HTML and refuses unsafe links', async () => {
  const { renderTerminalMarkdown } = await loadRenderer();
  const html = renderTerminalMarkdown('<script>alert(1)</script>\n\n[危险链接](javascript:alert(1))');
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(html, /\[危险链接\]\(javascript:alert\(1\)\)/);
});

test('Windows student Markdown table parser keeps escaped pipes and normalizes short rows', async () => {
  const { renderTerminalMarkdown } = await loadRenderer();
  const html = renderTerminalMarkdown('| 项目 | 表现 | 备注 |\n| --- | --- | --- |\n| 科学 | A \\| B |\n');
  assert.match(html, /<td class="align-left">A \| B<\/td>/);
  assert.match(html, /<td class="align-left"><\/td>/);
});
