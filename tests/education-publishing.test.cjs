const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  buildPublicationDraft,
  buildPublicationHtml,
  draftMarkdown,
  extractPublicationOutline,
  fingerprint,
  normalizePublicationDocument,
  publicationEligibility,
  repairCollapsedMarkdownTables,
  templateCatalog,
  validateDraftGrounding,
} = require('../electron/education-publishing.cjs');

const REPORT = `---
type: stage_summary
status: confirmed
---

# 整体画像

## 2026-07-15 增量更新

- 最新正式成绩单显示 IB 成绩合计为 25 分，需要继续巩固学术基础。
- Mathematics 春季期升到 5 / 83%，正式期末为 2 / 52%，说明数学表现存在明显波动。

## 学科优势与劣势

### 优势

- 科创与设计项目潜力突出，能够持续完成复杂作品。

### 劣势

- 数学稳定性和语言硬门槛仍需尽快处理。

## 下一阶段目标

1. 每日完成数学基础训练，并记录错题原因。

---

正文中的普通分隔线必须保留。

## 依据来源

- 成绩单.pdf
- 教育档案.md
`;

test('formal document preserves the complete report body and removes only frontmatter and terminal sources', () => {
  const normalized = normalizePublicationDocument(REPORT, { title: '整体画像' });
  assert.equal(normalized.removedFrontmatter, true);
  assert.equal(normalized.removedSources, true);
  assert.match(normalized.bodyMarkdown, /2026-07-15 增量更新/);
  assert.match(normalized.bodyMarkdown, /Mathematics 春季期升到 5 \/ 83%/);
  assert.match(normalized.bodyMarkdown, /正文中的普通分隔线必须保留/);
  assert.doesNotMatch(normalized.bodyMarkdown, /type: stage_summary/);
  assert.doesNotMatch(normalized.bodyMarkdown, /成绩单\.pdf/);

  const draft = buildPublicationDraft(REPORT, { templateId: 'formal', title: '整体画像' });
  assert.equal(draft.mode, 'document');
  assert.equal(draft.markdown, normalized.bodyMarkdown);
  assert.match(draftMarkdown(draft), /# 整体画像/);
});

test('concise and growth drafts extract complete grounded statements instead of bare headings', () => {
  const concise = buildPublicationDraft(REPORT, { templateId: 'concise', title: '整体画像' });
  const texts = concise.sections.flatMap((section) => section.items.map((item) => item.text));
  assert.equal(concise.validation.valid, true);
  assert.ok(texts.length >= 3);
  assert.equal(texts.includes('2026-07-15 增量更新'), false);
  assert.equal(texts.includes('学科优势与劣势'), false);
  assert.equal(texts.includes('优势'), false);
  assert.equal(texts.includes('劣势'), false);
  assert.match(texts.join('\n'), /数学表现存在明显波动/);
  assert.match(texts.join('\n'), /每日完成数学基础训练/);
  assert.equal(validateDraftGrounding(concise, REPORT).coverage, 1);

  const growth = buildPublicationDraft(REPORT, { templateId: 'growth-card', title: '成长要点' });
  assert.equal(growth.mode, 'card');
  assert.ok(growth.sections.length >= 2);
  assert.equal(growth.validation.valid, true);
});

test('archive publication removes bilingual metadata sections without affecting learning report content', () => {
  const archive = `# 学习记录\n\n## 本期进展\n\n已完成统计学复习。\n\n## 基本信息 / Basic Info\n\n姓名：测试学生\n\n## 与其他页面的关系 / Relations\n\n链接到其他档案。\n\n## 风险与不确定性 / Risks & Uncertainty\n\nOCR 可能不准确。\n\n## 来源 / Source\n\n原始截图。`;
  const archiveDraft = buildPublicationDraft(archive, { templateId: 'formal', title: '学习记录', sourceType: 'archive_file' });
  assert.match(archiveDraft.markdown, /已完成统计学复习/);
  assert.doesNotMatch(archiveDraft.markdown, /基本信息|Basic Info|与其他页面的关系|Relations|风险与不确定性|Risks & Uncertainty|来源|Source|姓名：测试学生|原始截图/);

  const reportDraft = buildPublicationDraft(archive, { templateId: 'formal', title: '学习记录', sourceType: 'learning_report' });
  assert.match(reportDraft.markdown, /基本信息 \/ Basic Info/);
});

test('legacy outline remains compatible but no longer emits headings as content points', () => {
  const outline = extractPublicationOutline('# 本周学习进展\n\n## 数学\n\n- 已能独立完成二位数除法\n- 需要继续练习验算\n\n## 下一步\n\n1. 每日完成 10 题', { maxPoints: 6 });
  assert.equal(outline.title, '本周学习进展');
  assert.equal(outline.points.includes('数学'), false);
  assert.equal(outline.points.includes('下一步'), false);
  assert.match(outline.points.join('\n'), /已能独立完成二位数除法/);
  assert.match(outline.points.join('\n'), /每日完成 10 题/);
});

test('internal rule, receipt and audit files cannot be published', () => {
  assert.equal(publicationEligibility('D:\\students\\A\\AGENT.md').eligible, false);
  assert.equal(publicationEligibility('D:\\students\\A\\.edu-manager\\index.md').eligible, false);
  assert.equal(publicationEligibility('D:\\students\\A\\学情分析汇总\\阶段总结.md').eligible, true);
});

test('template catalog keeps PNG and does not introduce JPG', () => {
  const templates = templateCatalog('basic');
  assert.deepEqual(templates.map((item) => item.id), ['formal', 'concise', 'growth-card', 'monochrome']);
  assert.equal(templates.find((item) => item.id === 'growth-card').formats.includes('png'), true);
  assert.equal(templates.some((item) => item.formats.includes('jpg')), false);
});

test('publication HTML renders full formal Markdown and grounded monochrome cards without remote assets', () => {
  const formalHtml = buildPublicationHtml({ templateId: 'formal', outputFormat: 'pdf', colorMode: 'color', title: '整体画像', markdown: REPORT, studentName: '测试学生', generatedAt: '2026/8/3' });
  assert.match(formalHtml, /数学表现存在明显波动/);
  assert.match(formalHtml, /正文中的普通分隔线必须保留/);
  assert.doesNotMatch(formalHtml, /成绩单\.pdf/);

  const html = buildPublicationHtml({ templateId: 'growth-card', outputFormat: 'png', colorMode: 'monochrome', title: '成长要点', markdown: '- 主动提问\n- 持续练习', studentName: '测试学生', generatedAt: '2026/8/3' });
  assert.match(html, /1080px 1920px/);
  assert.match(html, /grid-template-columns:minmax\(0,1fr\)/);
  assert.match(html, /word-break:break-word/);
  assert.match(html, /测试学生/);
  assert.match(html, /主动提问/);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.equal(fingerprint('相同内容'), fingerprint('相同内容'));
  assert.notEqual(fingerprint('内容 A'), fingerprint('内容 B'));
});

test('publication HTML renders aligned Markdown tables and groups repeated card labels once', () => {
  const tableMarkdown = `## 与上学期期中对比分析\n\n| 科目 | 期中IB/百分比 | 期末IB/百分比 | 变化 |\n| :--- | ---: | :---: | --- |\n| 语文 | 5 / 82% | 6 / 85% | +1 |\n| 化学 | 3 / 55% | 5 / 80% | +2 |`;
  const tableHtml = buildPublicationHtml({ templateId: 'formal', outputFormat: 'pdf', title: '对比分析', markdown: tableMarkdown });
  assert.match(tableHtml, /class="table-wrap"/);
  assert.match(tableHtml, /<th>科目<\/th>/);
  assert.match(tableHtml, /<td>化学<\/td>/);
  assert.doesNotMatch(tableHtml, /\|\s*:---\s*\|/);
  assert.match(tableHtml, /table-layout:fixed/);
  assert.match(tableHtml, /overflow-wrap:anywhere/);

  const cardDraft = {
    mode: 'card', title: '每周行动建议', subtitle: '学情报告要点',
    sections: [{ id: 'action', label: '下一步行动', kind: 'action', items: [{ text: '每天完成数学基础训练。' }, { text: '提交后立即核对任务状态。' }, { text: '积累五个高频英语词汇。' }] }],
  };
  const cardHtml = buildPublicationHtml({ templateId: 'growth-card', outputFormat: 'png', draft: cardDraft });
  assert.equal((cardHtml.match(/<h2>下一步行动<\/h2>/g) || []).length, 0);
  assert.equal((cardHtml.match(/<article data-kind=/g) || []).length, 1);
  assert.equal((cardHtml.match(/class="kind-badge"/g) || []).length, 1);
  assert.equal((cardHtml.match(/下一步行动/g) || []).length, 1);
  assert.match(cardHtml, /每天完成数学基础训练/);
  assert.match(cardHtml, /提交后立即核对任务状态/);
  assert.match(cardHtml, /积累五个高频英语词汇/);
});

test('mobile card print uses 9:16 canvas and staged density for long content', () => {
  const mediumDraft = {
    mode: 'card', title: '阶段学习要点', subtitle: '手机纵屏卡片',
    sections: [{ id: 'summary', label: '本期进步', kind: 'timeline', items: [{ text: '持续完成练习并核对结果。'.repeat(75) }] }],
  };
  const compactDraft = {
    ...mediumDraft,
    sections: [{ ...mediumDraft.sections[0], items: [{ text: '持续完成练习并核对结果。'.repeat(110) }] }],
  };
  const mediumHtml = buildPublicationHtml({ templateId: 'growth-card', outputFormat: 'pdf', draft: mediumDraft });
  const compactHtml = buildPublicationHtml({ templateId: 'growth-card', outputFormat: 'pdf', draft: compactDraft });
  assert.match(mediumHtml, /@page\{size:1080px 1920px/);
  assert.match(mediumHtml, /class="page dense"/);
  assert.match(compactHtml, /class="page compact"/);
  assert.doesNotMatch(mediumHtml, /1080px 1440px/);
});

test('collapsed single-line Markdown tables are repaired before PDF rendering', () => {
  const collapsed = `## 九年级下学期期末各科画像\n\n| 科目 | IB | 百分比 | 等级 | 备注 | || ---- | :-: | :-: | :-: | ------------- | || 音乐 | 7 | 90 | A | 学科杰出 | || 物理 | 6 | 88 | A | 自我管理 |`;
  const repaired = repairCollapsedMarkdownTables(collapsed);
  assert.match(repaired, /\| 科目 \| IB \| 百分比 \| 等级 \| 备注 \|\n\| ---- \| :-: \| :-: \| :-: \| ------------- \|/);
  const html = buildPublicationHtml({ templateId: 'formal', outputFormat: 'pdf', title: '整体画像', markdown: collapsed });
  assert.match(html, /<table>/);
  assert.match(html, /<th>科目<\/th>/);
  assert.match(html, /<td>音乐<\/td>/);
  assert.match(html, /<td>物理<\/td>/);
  assert.doesNotMatch(html, /\|\s*\|/);
});

test('P0-P3 publishing bridge, editable draft and safe fallback contract stay wired', () => {
  const root = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');
  assert.match(main, /sanitizeEducationPublicationDraft/);
  assert.match(main, /validateDraftGrounding/);
  assert.match(main, /draftMarkdown\(draft\)/);
  assert.match(main, /page\?\.scrollHeight/);
  assert.match(main, /captureHeight/);
  assert.match(main, /publication_enhancement/);
  assert.match(main, /validateEnhancementCandidate/);
  assert.match(preload, /getEducationPublishingState/);
  assert.match(preload, /startEducationPublicationEnhancement/);
  assert.match(ui, /忠实原文（推荐）/);
  assert.match(ui, /Agent 智能提炼/);
  assert.match(ui, /已自动保留忠实原文草稿/);
  assert.match(ui, /编辑出版草稿/);
  assert.match(ui, /恢复自动草稿/);
  assert.match(ui, /修改只作用于本次输出，不会改动原始报告/);
  assert.match(ui, /PNG 图片/);
  assert.doesNotMatch(ui, /JPG 图片/);
});
