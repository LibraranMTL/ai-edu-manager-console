const path = require('node:path');

const RULE_VERSION = 'workspace-classifier-rule-v1';
const CUES = [
  { category: /参考|资料|文献|规则|课程|学校|素材|赛事/, words: ['参考', '资料', '文献', '规则', '课程', '学校', '素材', '赛事', 'requirement', 'reference', 'source'] },
  { category: /成果|定稿|提交|论文|报告|作品|总结/, words: ['成果', '定稿', '提交', '论文', '报告', '作品', '总结', 'final', 'deliverable', 'report'] },
  { category: /方案|设计|大纲|策划|申请|选题/, words: ['方案', '设计', '大纲', '策划', '申请', '选题', 'proposal', 'plan', 'outline', 'design'] },
  { category: /进展|过程|记录|实验|分析|草稿|修改|复盘/, words: ['进展', '过程', '记录', '实验', '分析', '草稿', '修改', '复盘', 'draft', 'analysis', 'log', 'experiment'] },
  { category: /团队|协作|成员|分工|推荐|反馈/, words: ['团队', '协作', '成员', '分工', '推荐', '反馈', 'team', 'member', 'feedback'] },
  { category: /问题|错题/, words: ['问题', '错题', '疑问', 'error', 'question', 'problem'] },
  { category: /数据/, words: ['数据', '统计', '测量', '问卷', 'data', 'survey', 'measurement'] },
];

function tokens(value) {
  return String(value || '').toLocaleLowerCase('zh-CN')
    .split(/[\s/\\_.()（）【】\[\]{}-]+/).map((item) => item.trim()).filter((item) => item.length >= 2);
}

function suggestProjectMaterialClassifications(index, { limit = 200 } = {}) {
  const categories = (index.categories || []).filter((item) => item.active !== false);
  const results = [];
  for (const material of index.materials || []) {
    if (results.length >= limit) break;
    if (material.classification?.manualLocked || material.classification?.categoryId) continue;
    const logical = String(material.location?.relativePath || '');
    const haystack = ` ${logical.toLocaleLowerCase('zh-CN')} `;
    let best = null;
    for (const category of categories) {
      let score = 0;
      const matches = [];
      const names = [category.name, ...(Array.isArray(category.aliases) ? category.aliases : [])];
      for (const name of names) {
        const normalized = String(name || '').toLocaleLowerCase('zh-CN');
        if (normalized.length >= 2 && haystack.includes(normalized)) {
          score += 8; matches.push(`路径含“${name}”`);
        }
        for (const token of tokens(name)) if (haystack.includes(token)) {
          score += 3; matches.push(`名称线索“${token}”`);
        }
      }
      for (const group of CUES) {
        if (!group.category.test(String(category.name || ''))) continue;
        for (const word of group.words) if (haystack.includes(word.toLocaleLowerCase('zh-CN'))) {
          score += 2; matches.push(`文件线索“${word}”`);
        }
      }
      if (!best || score > best.score || (score === best.score
        && String(category.categoryId).localeCompare(best.category.categoryId) < 0)) {
        best = { category, score, matches };
      }
    }
    if (!best || best.score <= 0) continue;
    results.push({ materialId: material.materialId, expectedVersion: material.version,
      expectedRecordRevision: material.recordRevision, categoryId: best.category.categoryId,
      tags: [], needsConfirmation: true,
      confidence: best.score >= 8 ? 'high' : best.score >= 4 ? 'medium' : 'low',
      evidence: [...new Set(best.matches)].slice(0, 3),
      reason: `自动规则根据${[...new Set(best.matches)].slice(0, 3).join('、')}建议归入“${best.category.name}”；请人工确认，原件不会移动。` });
  }
  return { ruleVersion: RULE_VERSION, items: results };
}

module.exports = { RULE_VERSION, suggestProjectMaterialClassifications };
