const crypto = require('crypto');

const ENHANCEMENT_SCHEMA = 'edu-manager.education-publication-enhancement.v1';
const ENHANCEMENT_PROMPT_REVISION = 'evidence-first-v2';

const PROMPT_TEMPLATES = Object.freeze([
  { id: 'formal-faithful', name: '正式报告优化', description: '保留完整事实和主体层级，只改善结构与表达', targetTemplates: ['formal', 'monochrome'] },
  { id: 'concise-brief', name: '简明报告', description: '从原文摘录核心结论、进展、关注点和建议', targetTemplates: ['concise'] },
  { id: 'growth-evidence', name: '成长要点', description: '从原文摘录成长变化、能力证据与下一步行动', targetTemplates: ['growth-card', 'concise'] },
  { id: 'parent-communication', name: '家长沟通', description: '选择原文中清晰通俗的近期表现和家庭建议', targetTemplates: ['concise', 'growth-card'] },
  { id: 'student-action', name: '学生行动', description: '只选择原文已经明确提出的可执行、可检查行动', targetTemplates: ['growth-card'] },
  { id: 'project-outcome', name: '项目成果', description: '从原文摘录目标、过程、成果和能力证据', targetTemplates: ['concise', 'growth-card'] },
]);

function hashText(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function normalizedText(value) {
  return String(value || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_>#|]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function promptTemplateCatalog(templateId = '') {
  const target = String(templateId || '');
  return PROMPT_TEMPLATES
    .filter((item) => !target || item.targetTemplates.includes(target))
    .map((item) => ({ ...item }));
}

function defaultPromptTemplate(templateId) {
  if (templateId === 'formal' || templateId === 'monochrome') return 'formal-faithful';
  if (templateId === 'growth-card') return 'growth-evidence';
  return 'concise-brief';
}

function extractJsonCandidate(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  const text = String(value || '').trim();
  if (!text) return null;
  const attempts = [text];
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) => match[1].trim());
  attempts.push(...fenced);
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) attempts.push(text.slice(firstBrace, lastBrace + 1));
  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      // Try the next JSON envelope.
    }
  }
  return null;
}

function buildEnhancementPrompt(options = {}) {
  const promptTemplateId = String(options.promptTemplateId || defaultPromptTemplate(options.templateId));
  const promptTemplate = PROMPT_TEMPLATES.find((item) => item.id === promptTemplateId) || PROMPT_TEMPLATES[0];
  const resultPath = String(options.resultPath || '');
  const sourcePath = String(options.sourcePath || '');
  return `请根据原始教育资料生成“${promptTemplate.name}”结构化草稿。本任务采用“证据优先摘编”，不是自由创作或常识补全。

原文文件：${sourcePath}
目标出版模板：${options.templateId || 'concise'}
任务目标：${promptTemplate.description}
学生范围：${options.studentName || '-'}（${options.studentId || '-'}）

必须按以下顺序工作：
A. 先阅读原文并定位能够独立成立的原句；
B. 将这段连续原句逐字复制到 sourceQuote；禁止拼接相隔的句子，禁止改写 sourceQuote；
C. item.text 也必须逐字摘自原文中的一段连续文字。为了避免事实漂移，禁止同义改写、推断因果、扩大结论或自行提出建议；
D. 最后逐项核对：item.text 和 sourceQuote 都能在原文中直接搜索命中，所有数字、日期、姓名、成绩和比较词均与原文完全一致；不满足就删除该条。

严格规则：
1. 只能选择原文明确写出的事实、判断和建议，不得使用常识补充，不得生成原文没有的成绩、日期、身份、诊断、因果、评价或行动方案。
2. “大幅进步”“保持领先”“需要优先补足”等评价词，只有原文逐字出现时才能使用；否则只摘录原始陈述。
3. sourceQuote 必须是支持该条目的最短连续原文；item.text 必须是可独立阅读的连续原文。两者可以相同。
4. sourceRefs 只填写真实存在的原文标题或章节名，不能替代 sourceQuote。
5. 行动建议只能摘录原文已经明确提出的行动；原文没有建议时，不要创建 action 章节。
6. 正式报告保持原文主体完整；简明报告和卡片只做选择、分类、排序和视觉标注，不改写事实。
7. 不生成 HTML、CSS、PDF 或图片，只返回下面结构的 JSON。
8. 同一事实只出现一次；每个章节最多 8 条，每条不超过 240 字。宁缺毋滥，建议输出 4—10 条高质量依据，不要凑数。

视觉语义由 kind 和 emphasis 控制：
- metrics：包含原文中的关键数字或量化结果；
- timeline：原文明确记录的时间变化或阶段进展；
- strength：原文明确肯定的优势；
- attention：原文明确指出的风险、薄弱点或待办；
- action：原文已经明确提出的下一步行动；
- narrative：不属于以上类型的普通事实。
- emphasis 只给原文明确强调或最关键的 1—3 条，其余使用 normal。

JSON 结构：
{
  "schema": "${ENHANCEMENT_SCHEMA}",
  "title": "使用原文标题或中性标题，不添加事实",
  "subtitle": "使用中性说明，不添加事实",
  "layout": "document|summary|card",
  "sections": [
    {
      "id": "progress",
      "label": "本期进步",
      "kind": "narrative|metrics|timeline|strength|attention|action",
      "items": [
        {
          "text": "逐字复制、可独立阅读的连续原文",
          "sourceQuote": "逐字复制的连续原文依据",
          "sourceRefs": ["原文章节名"],
          "emphasis": "normal|highlight"
        }
      ]
    }
  ]
}

请将纯 JSON 写入：${resultPath}
最终回复也只输出相同 JSON，不要输出解释。`;
}

function numericTokens(value) {
  return String(value || '').match(/\d+(?:[.,]\d+)?%?/g) || [];
}

function validateEnhancementCandidate(candidateInput, sourceMarkdown, options = {}) {
  const candidate = extractJsonCandidate(candidateInput);
  const sourceNormalized = normalizedText(sourceMarkdown);
  const fatalErrors = [];
  const warnings = [];
  if (!candidate) return { valid: false, errors: ['Agent 未返回有效 JSON。'], warnings: [], draft: null, coverage: 0, grounded: 0, total: 0, dropped: 0 };
  if (String(candidate.schema || '') !== ENHANCEMENT_SCHEMA) fatalErrors.push('结构协议版本不匹配。');
  const rawSections = Array.isArray(candidate.sections) ? candidate.sections.slice(0, 10) : [];
  const sections = [];
  let total = 0;
  let grounded = 0;
  for (let sectionIndex = 0; sectionIndex < rawSections.length; sectionIndex += 1) {
    const section = rawSections[sectionIndex] || {};
    const items = [];
    for (const rawItem of (Array.isArray(section.items) ? section.items.slice(0, 8) : [])) {
      const text = String(rawItem?.text || '').trim().slice(0, 1000);
      const sourceQuote = String(rawItem?.sourceQuote || '').trim().slice(0, 2000);
      if (!text) continue;
      total += 1;
      const textNormalized = normalizedText(text);
      const quoteNormalized = normalizedText(sourceQuote);
      const textFound = Boolean(textNormalized.length >= 4 && sourceNormalized.includes(textNormalized));
      const quoteFound = Boolean(quoteNormalized.length >= 4 && sourceNormalized.includes(quoteNormalized));
      const quoteNumbers = numericTokens(sourceQuote);
      const unsupportedNumbers = numericTokens(text).filter((token) => !quoteNumbers.includes(token));
      const itemGrounded = textFound && quoteFound && !unsupportedNumbers.length;
      if (!itemGrounded) {
        const reasons = [];
        if (!textFound) reasons.push('展示文字不是连续原文');
        if (!quoteFound) reasons.push('sourceQuote 无法在原文命中');
        if (unsupportedNumbers.length) reasons.push(`包含未支持数字 ${unsupportedNumbers.join('、')}`);
        warnings.push(`已剔除“${text.slice(0, 32)}”：${reasons.join('，')}。`);
        continue;
      }
      grounded += 1;
      items.push({
        id: `agent-${sectionIndex + 1}-${items.length + 1}-${hashText(`${text}\n${sourceQuote}`).slice(0, 10)}`,
        text,
        sourceHeading: String((Array.isArray(rawItem?.sourceRefs) ? rawItem.sourceRefs[0] : '') || section.label || '').trim().slice(0, 160),
        sourceHash: hashText(sourceQuote),
        sourceQuote,
        sourceRefs: (Array.isArray(rawItem?.sourceRefs) ? rawItem.sourceRefs : []).map((item) => String(item || '').trim().slice(0, 240)).filter(Boolean).slice(0, 6),
        grounded: true,
        emphasis: rawItem?.emphasis === 'highlight' ? 'highlight' : 'normal',
      });
    }
    if (items.length) sections.push({
      id: String(section.id || `section-${sectionIndex + 1}`).slice(0, 80),
      label: String(section.label || '内容要点').trim().slice(0, 80) || '内容要点',
      kind: ['narrative', 'metrics', 'timeline', 'strength', 'attention', 'action'].includes(String(section.kind)) ? String(section.kind) : 'narrative',
      items,
    });
  }
  if (!rawSections.length) fatalErrors.push('Agent 草稿没有内容章节。');
  const coverage = total ? grounded / total : 0;
  const dropped = Math.max(0, total - grounded);
  const minimumGroundedItems = Math.min(total, Math.max(1, Number(options.minimumGroundedItems) || 1));
  const minimumCoverage = Math.min(1, Math.max(0.5, Number(options.minimumCoverage) || 0.5));
  if (!sections.length || grounded < minimumGroundedItems) fatalErrors.push(`可核对内容不足（${grounded}/${Math.max(total, minimumGroundedItems)}）。`);
  if (total && coverage < minimumCoverage) fatalErrors.push(`原文依据覆盖率不足（${grounded}/${total}，至少需要 ${Math.round(minimumCoverage * 100)}%）。`);
  const valid = Boolean(sections.length && grounded >= minimumGroundedItems && coverage >= minimumCoverage && !fatalErrors.length);
  return {
    valid,
    errors: [...new Set(fatalErrors)].slice(0, 20),
    warnings: [...new Set(warnings)].slice(0, 20),
    total,
    grounded,
    dropped,
    coverage,
    draft: valid ? {
      title: String(options.fallbackTitle || candidate.title || '教育内容报告').trim().slice(0, 160),
      subtitle: String(options.fallbackSubtitle || candidate.subtitle || '').trim().slice(0, 240),
      layout: ['document', 'summary', 'card'].includes(String(candidate.layout)) ? String(candidate.layout) : String(options.fallbackMode || 'summary'),
      sections,
    } : null,
  };
}

module.exports = {
  ENHANCEMENT_PROMPT_REVISION,
  ENHANCEMENT_SCHEMA,
  PROMPT_TEMPLATES,
  buildEnhancementPrompt,
  defaultPromptTemplate,
  extractJsonCandidate,
  promptTemplateCatalog,
  validateEnhancementCandidate,
};
