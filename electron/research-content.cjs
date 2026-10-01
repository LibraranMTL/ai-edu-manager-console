'use strict';
const crypto = require('node:crypto');
const { redact } = require('./structured-generation.cjs');
const VERSION = 'guidance-sections-v2';
const LABELS = { pathways: '升学路径', schools: '择校建议', majors: '专业探索', careers: '职业发展' };
const DETAILS = { pathways: ['routeOptions', 'milestones'], schools: ['schoolOptions', 'eligibility'], majors: ['majorOptions', 'trialCourses'], careers: ['roleOptions', 'practiceTasks'] };
const COMMON = ['studentBasis', 'facts', 'inferences', 'missing', 'conditions', 'limitations', 'alternatives', 'actions', 'sourceUrls'];
const strings = { type: 'array', items: { type: 'string' } };
const sectionSchema = key => ({ type: 'object', additionalProperties: false, required: [...COMMON, ...DETAILS[key]], properties: Object.fromEntries([...COMMON, ...DETAILS[key]].map(field => [field, strings])) });
const SECTIONS_SCHEMA = { type: 'object', additionalProperties: false, required: Object.keys(LABELS), properties: Object.fromEntries(Object.keys(LABELS).map(key => [key, sectionSchema(key)])) };
const COMPETITION_FIELDS = ['name', 'category', 'scope', 'organizer', 'officialUrl', 'eligibility', 'deadline', 'season', 'fees', 'matchReasons', 'preparation', 'risks', 'missing', 'sourceUrls'];
const COMPETITIONS_SCHEMA = { type: 'array', items: { type: 'object', additionalProperties: false, required: COMPETITION_FIELDS, properties: {
  ...Object.fromEntries(COMPETITION_FIELDS.map(key => [key, ['matchReasons', 'preparation', 'risks', 'missing', 'sourceUrls'].includes(key) ? strings : { type: 'string' }])),
  category: { type: 'string', enum: ['science_innovation', 'social_practice'] },
  scope: { type: 'string', enum: ['domestic', 'international'] },
} } };
function list(value) { return [...new Set((Array.isArray(value) ? value : []).map(x => String(x || '').trim().slice(0, 1000)).filter(Boolean))].slice(0, 15); }
function sections(raw, sources) {
  if (!raw) return null; // Read legacy plans, but never present shared legacy prose as four independent results.
  const urls = new Set(sources.map(x => x.url));
  const result = {};
  for (const key of Object.keys(LABELS)) {
    const value = raw[key];
    if (!value || typeof value !== 'object') throw new Error(`缺少${LABELS[key]}独立研究结果`);
    if ([...COMMON, ...DETAILS[key]].some(field => !Array.isArray(value[field]))) throw new Error(`${LABELS[key]}字段不符合结构化合同`);
    const section = Object.fromEntries([...COMMON, ...DETAILS[key]].map(field => [field, list(value[field])]));
    if (section.sourceUrls.some(url => !urls.has(url))) throw new Error(`${LABELS[key]}引用了未核验来源`);
    if (section.facts.length && !section.sourceUrls.length) throw new Error(`${LABELS[key]}事实缺少来源`);
    if (!section.missing.length && !section[DETAILS[key][0]].length) throw new Error(`${LABELS[key]}没有专属决策内容或资料不足说明`);
    result[key] = section;
  }
  const signatures = Object.keys(LABELS).filter(key => result[key].facts.length || result[key][DETAILS[key][0]].length).map(key => JSON.stringify([result[key].facts, result[key].actions, result[key][DETAILS[key][0]], result[key][DETAILS[key][1]]]));
  if (new Set(signatures).size !== signatures.length) throw new Error('四类规划结果重复，未形成独立决策；本次结果未保存');
  return result;
}
function competitions(raw, sources, now) {
  if (!Array.isArray(raw)) throw new Error('比赛研究没有返回结构化候选');
  const urls = new Set(sources.map(x => x.url));
  const official = new Set(sources.filter(x => x.official).map(x => x.url));
  const seen = new Set();
  return raw.slice(0, 20).map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw Object.assign(new Error(`第 ${index + 1} 项比赛不是结构化对象，请重新研究`), { code: 'COMPETITION_INVALID_ITEM' });
    const value = Object.fromEntries(COMPETITION_FIELDS.map(key => [key, Array.isArray(item[key]) ? list(item[key]) : String(item[key] || '').trim().slice(0, 1000)]));
    for (const key of ['name', 'category', 'scope']) {
      const valid = key === 'name' ? typeof item.name === 'string' && Boolean(value.name) : COMPETITIONS_SCHEMA.items.properties[key].enum.includes(value[key]);
      if (!valid) throw Object.assign(new Error(`第 ${index + 1} 项比赛字段 ${key} 不符合合同${key === 'name' ? '：须为非空名称' : `：仅允许 ${COMPETITIONS_SCHEMA.items.properties[key].enum.join(' / ')}`}；本次不保存，请重新研究`), { code: 'COMPETITION_INVALID_FIELD', field: key, itemIndex: index });
    }
    if (COMPETITION_FIELDS.filter(key => ['matchReasons', 'preparation', 'risks', 'missing', 'sourceUrls'].includes(key)).some(key => !Array.isArray(item[key]))) throw Object.assign(new Error(`第 ${index + 1} 项比赛列表字段格式无效`), { code: 'COMPETITION_INVALID_FIELD' });
    if (!official.has(value.officialUrl) || !value.sourceUrls.length || value.sourceUrls.some(url => !urls.has(url))) throw new Error('比赛资格和时间必须引用已打开的主办方官方来源');
    if (!value.matchReasons.length || !value.preparation.length || !value.eligibility) throw new Error('比赛缺少个性化依据、资格或准备行动');
    if (seen.has(value.officialUrl)) throw new Error('重复比赛来源');
    seen.add(value.officialUrl);
    if (value.deadline && (!/^\d{4}-\d{2}-\d{2}$/.test(value.deadline) || Number.isNaN(Date.parse(value.deadline)) || new Date(value.deadline).toISOString().slice(0, 10) !== value.deadline)) throw new Error('比赛截止日期无效');
    const expired = value.deadline && new Date(`${value.deadline}T23:59:59Z`) < now;
    return { ...value, id: crypto.createHash('sha256').update(value.officialUrl).digest('hex').slice(0, 20), status: expired ? 'closed' : 'verify_eligibility', missing: [...value.missing, ...(!value.deadline ? ['当前届报名截止时间未核实，不代表正在开放报名'] : []), '参赛资格需按官方规则逐项核对；推荐不等于资格确认'] };
  });
}
function shareDocument(kind, value, student, latestCheck) {
  if (!value) throw new Error('尚无可分享的有效建议版本');
  const heading = kind === 'topics' ? '选题建议' : '规划总览';
  const lines = [`# ${heading}`, '', `版本：${value.version}；生成时间：${value.createdAt}`, '分享范围：建议摘要，不含原始档案、原始文件或证据快照。', '事实、推断与待核实内容应分别阅读；不自动创建项目、报名或申请。', ''];
  const add = (label, values) => { if (values?.length) lines.push(`## ${label}`, ...values.map(x => `- ${x}`), ''); };
  if (kind === 'topics') {
    lines.push('本版本为本地学生依据生成的建议，不代表经过最新联网核验。', '');
    for (const item of value.candidates || []) {
      lines.push(`## ${item.title}`, item.realWorldProblem || '', `适配推断：${item.fitReason || ''}`);
      add('学生依据（事实/推断/缺失）', (item.studentEvidence || []).map(x => `${x.kind}：${x.text}`));
      add('研究与实践路径', item.path); add('预期成果', item.expectedOutcomes); add('安全与伦理', item.safetyEthics); add('待核实', item.verifyItems);
    }
  } else {
    lines.push(`最近联网检查：${latestCheck?.status || '未记录'}；版本来源抓取时间：${value.verifiedAt || '未记录'}。`, '该时间只属于保存版本，不表示刚刚联网核验。', '');
    if (value.sections) for (const [key, section] of Object.entries(value.sections)) {
      lines.push(`## ${LABELS[key]}`);
      for (const field of [...DETAILS[key], ...COMMON]) add(field, section[field]);
    } else { add('旧版总览（未分模块研究）', value.findings); }
    add('可核验来源', (value.sources || []).map(x => `${x.title} — ${x.url}；抓取：${x.fetchedAt}`));
  }
  const content = redact(lines.join('\n'), student).replace(/[A-Za-z]:[\\/][^\s)]+/g, '[本地路径已移除]').replace(/student:[^\s]+/g, '[学生标识已移除]');
  if (Buffer.byteLength(content) > 512 * 1024) throw new Error('分享摘要超出大小限制');
  return { kind, versionId: value.id, name: `${heading}-v${value.version}.md`, content, sha256: crypto.createHash('sha256').update(content).digest('hex') };
}
module.exports = { VERSION, LABELS, DETAILS, COMMON, SECTIONS_SCHEMA, COMPETITIONS_SCHEMA, sections, competitions, shareDocument };
