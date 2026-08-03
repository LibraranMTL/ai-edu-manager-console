const assert = require('node:assert/strict');
const test = require('node:test');
const {
  ENHANCEMENT_PROMPT_REVISION,
  ENHANCEMENT_SCHEMA,
  buildEnhancementPrompt,
  defaultPromptTemplate,
  promptTemplateCatalog,
  validateEnhancementCandidate,
} = require('../electron/education-publication-enhancement.cjs');

const SOURCE = `# 本周学情\n\n## 本期进步\n\n数学测验由 72 分提高到 86 分。\n\n## 下一步行动\n\n每天完成 10 道分数运算并记录错因。`;

test('enhancement prompt catalog follows the selected publication template', () => {
  assert.equal(ENHANCEMENT_PROMPT_REVISION, 'evidence-first-v2');
  assert.equal(defaultPromptTemplate('formal'), 'formal-faithful');
  assert.equal(defaultPromptTemplate('growth-card'), 'growth-evidence');
  assert.ok(promptTemplateCatalog('growth-card').some((item) => item.id === 'student-action'));
  assert.ok(promptTemplateCatalog('formal').every((item) => item.targetTemplates.includes('formal')));
  const prompt = buildEnhancementPrompt({ templateId: 'growth-card', sourcePath: 'D:\\report.md', resultPath: 'D:\\result.json' });
  assert.match(prompt, /sourceQuote/);
  assert.match(prompt, /证据优先摘编/);
  assert.match(prompt, /item\.text 也必须逐字摘自原文/);
  assert.match(prompt, /D:\\result\.json/);
  assert.match(prompt, new RegExp(ENHANCEMENT_SCHEMA.replace(/\./g, '\\.')));
});

test('grounded structured Agent result is accepted and carries visual semantics', () => {
  const result = validateEnhancementCandidate({
    schema: ENHANCEMENT_SCHEMA,
    title: '本周成长卡',
    subtitle: '基于本周学情',
    layout: 'card',
    sections: [{
      id: 'progress', label: '本期进步', kind: 'metrics', items: [{
        text: '数学测验由 72 分提高到 86 分。',
        sourceQuote: '数学测验由 72 分提高到 86 分。',
        sourceRefs: ['本期进步'], emphasis: 'highlight',
      }],
    }],
  }, SOURCE, { templateId: 'growth-card' });
  assert.equal(result.valid, true);
  assert.equal(result.draft.sections[0].kind, 'metrics');
  assert.equal(result.draft.sections[0].items[0].emphasis, 'highlight');
  assert.equal(result.coverage, 1);
});

test('partially invalid Agent output keeps only verbatim grounded excerpts instead of falling back entirely', () => {
  const result = validateEnhancementCandidate({
    schema: ENHANCEMENT_SCHEMA,
    title: '本周成长卡', layout: 'card',
    sections: [{ id: 'progress', label: '本期进步', kind: 'metrics', items: [{
      text: '数学测验由 72 分提高到 86 分。', sourceQuote: '数学测验由 72 分提高到 86 分。', sourceRefs: ['本期进步'],
    }, {
      text: '数学已经达到全班第一。', sourceQuote: '数学已经达到全班第一。', sourceRefs: ['本期进步'],
    }] }],
  }, SOURCE, { templateId: 'growth-card' });
  assert.equal(result.valid, true);
  assert.equal(result.grounded, 1);
  assert.equal(result.dropped, 1);
  assert.equal(result.draft.sections[0].items.length, 1);
  assert.match(result.warnings[0], /已剔除/);
});

test('ungrounded quote or invented numbers rejects Agent draft so caller can retain source draft', () => {
  const result = validateEnhancementCandidate({
    schema: ENHANCEMENT_SCHEMA,
    title: '错误草稿', layout: 'summary',
    sections: [{ id: 'progress', label: '进步', kind: 'metrics', items: [{
      text: '数学已经达到 99 分。', sourceQuote: '数学已经达到 99 分。', sourceRefs: ['本期进步'],
    }] }],
  }, SOURCE, { templateId: 'concise' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0);
});
