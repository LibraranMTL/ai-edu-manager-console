'use strict';
const crypto = require('node:crypto');
const DEFAULT_SCHEDULE = Object.freeze({ mode: 'daily', time: '20:00', weekday: 1, minutes: 1440 });
const EXTRACTABLE = new Set(['.txt', '.md', '.csv', '.docx', '.xlsx', '.pptx', '.pdf', '.jpg', '.jpeg', '.png', '.bmp', '.tif', '.tiff', '.webp']);
const digest = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
function schedule(value = DEFAULT_SCHEDULE) {
  if (!['manual', 'interval', 'daily', 'weekly'].includes(value.mode)) throw Error('扫描周期无效');
  const result = { ...DEFAULT_SCHEDULE, ...value };
  if (!Number.isInteger(result.minutes) || result.minutes < 15 || result.minutes > 525600) throw Error('扫描间隔须为15至525600分钟');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(result.time)) throw Error('扫描时间无效');
  if (!Number.isInteger(result.weekday) || result.weekday < 0 || result.weekday > 6) throw Error('扫描星期无效');
  return { mode: result.mode, minutes: result.minutes, time: result.time, weekday: result.weekday };
}
function nextRun(value, from = Date.now()) {
  const s = schedule(value);
  if (s.mode === 'manual') return '';
  if (s.mode === 'interval') return new Date(from + s.minutes * 60000).toISOString();
  const date = new Date(from), [hour, minute] = s.time.split(':').map(Number);
  date.setHours(hour, minute, 0, 0);
  if (s.mode === 'weekly') date.setDate(date.getDate() + (s.weekday - date.getDay() + 7) % 7);
  if (date.getTime() <= from) date.setDate(date.getDate() + (s.mode === 'weekly' ? 7 : 1));
  return date.toISOString();
}
function target(value) {
  if (!value || typeof value.studentId !== 'string' || !value.studentId || !['student', 'project'].includes(value.type)) throw Error('请选择有效学生和投递目标');
  if (value.type === 'project' && (typeof value.id !== 'string' || !value.id)) throw Error('请选择有效项目');
  return { studentId: value.studentId, type: value.type, id: value.type === 'project' ? value.id : '', categoryId: String(value.categoryId || '') };
}
const sameTarget = (a, b) => Boolean(a && b && JSON.stringify(target(a)) === JSON.stringify(target(b)));
function studentScopeMatches(item, source) {
  if (!source || source.detached) return false;
  const c = item.studentConfirmation;
  if (c && (c.studentId !== item.studentId || c.sourceId !== source.id || c.identity !== item.identity)) return false;
  return item.studentId === source.studentId || Boolean(!source.studentId && item.studentId && c)
    || Boolean(c?.reassigned && c.sourceStudentId === source.studentId && c.sourceRevision === source.revision);
}
function confidenceThreshold(value = .95) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < .95 || value > 1) throw Error('可信阈值须在0.95至1之间');
  return value;
}
// Host evidence, not a model's self-reported confidence, controls auto delivery.
function identifiers(text, projects) {
  return projects.filter(project => [String(project.id), ...(project.identifiers || [])].some(id => id.length >= 3 &&
    new RegExp(`(^|[^\\p{L}\\p{N}_-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}_-])`, 'u').test(text)));
}
function risks(text) {
  return /身份证|病历|诊断报告|银行卡|银行账户|医疗记录|护照号码|medical record|passport number|bank account/i.test(text);
}
function validateSuggestion(result, context, text) {
  const allowed = new Set(['candidates', 'sensitive', 'conflict', 'reason']);
  if (!result || !Array.isArray(result.candidates) || result.candidates.length > 3) throw Error('分类结果不符合受控合同');
  if (typeof result.sensitive !== 'boolean' || typeof result.conflict !== 'boolean' || typeof result.reason !== 'string') throw Error('分类风险字段无效');
  // Suggestions attached to sensitive or conflicting material are never used:
  // the item stays in manual review. Discard them before target validation so
  // provider formatting drift cannot trigger a retry or become a route.
  if (result.sensitive || result.conflict) return { candidates: [], sensitive: result.sensitive,
    conflict: result.conflict, reason: result.reason.slice(0, 500) };
  const extensions = Object.keys(result).filter(k => !allowed.has(k));
  // Some providers occasionally add a short explanatory string beside a
  // no-candidate refusal. No extension can influence routing when there is no
  // candidate, so canonicalize all of them away instead of repeating the
  // Agent call. Any candidate-bearing response with extensions still fails
  // closed, including path/command/target-like fields.
  if (extensions.length && result.candidates.length) throw Error('分类结果不符合受控合同');
  const seen = new Set();
  const candidates = result.candidates.map(c => {
    if (Object.keys(c).some(k => !['studentId', 'type', 'id', 'categoryId', 'score', 'evidence', 'reason'].includes(k))) throw Error('分类建议包含未授权字段');
    const t = target(c);
    if (t.studentId !== context.studentId) throw Error('分类建议超出学生范围');
    const project = context.projects.find(p => p.id === t.id);
    if (t.type === 'project' && !project) throw Error('分类项目不在授权范围');
    if (t.categoryId && (t.type !== 'project' || !project.categories.some(p => p.categoryId === t.categoryId))) throw Error('分类目录不在授权范围');
    if (typeof c.score !== 'number' || !Number.isFinite(c.score) || c.score < 0 || c.score > 1 || typeof c.reason !== 'string' || c.reason.length > 500 || typeof c.evidence !== 'string' || c.evidence.length > 1000) throw Error('分类证据或分数无效');
    if (c.evidence && !text.includes(c.evidence)) throw Error('分类引用并非当前正文证据');
    const key = JSON.stringify(t); if (seen.has(key)) throw Error('分类候选重复'); seen.add(key);
    return { ...t, score: c.score, evidence: c.evidence, reason: c.reason };
  }).sort((a, b) => b.score - a.score);
  return { candidates, sensitive: result.sensitive, conflict: result.conflict, reason: result.reason.slice(0, 500) };
}
function automaticTarget({ source, item, context, text, suggestion, rules = [] }) {
  if (!source.automatic || !source.studentId || item.manualLocked || item.truncated || item.extractionBlocked || item.originalMissing || !text.trim() || risks(text) || suggestion?.sensitive || suggestion?.conflict) return null;
  const explicit = identifiers(text, context.projects);
  if (explicit.length > 1) return null;
  if (explicit.length === 1 && rules.some(r => r.sourceId === source.id && r.studentId === source.studentId && r.identifier === explicit[0].id && r.suspended)) return null;
  if (source.target) {
    if (explicit.length && source.target.type === 'project' && explicit[0].id !== source.target.id) return null;
    return { target: target(source.target), basis: 'source_binding' };
  }
  const matching = rules.filter(r => r.active && r.sourceId === source.id && r.studentId === source.studentId && explicit.length === 1 && r.identifier === explicit[0].id);
  if (matching.length === 1) return { target: target(matching[0].target), basis: 'confirmed_rule', ruleId: matching[0].id };
  const [first, second] = suggestion?.candidates || [];
  if (!first || first.studentId !== source.studentId || first.type !== 'project'
    || first.score < confidenceThreshold(source.confidenceThreshold ?? .95) || first.score - (second?.score || 0) < .20
    || !first.evidence || !text.includes(first.evidence) || !context.projects.some(p => p.id === first.id)) return null;
  if (explicit.length && explicit[0].id !== first.id) return null;
  const exact = explicit.length === 1 && identifiers(first.evidence, context.projects).some(p => p.id === first.id);
  // Semantic routing requires a substantive quotation, not a filename or a one-word guess.
  if (!exact && (text.trim().length < 40 || first.evidence.trim().length < 12)) return null;
  if (first.categoryId && !context.projects.find(p => p.id === first.id)?.categories.some(c => c.categoryId === first.categoryId)) return null;
  return { target: target(first), basis: exact ? 'verified_project_identifier' : 'verified_content_threshold' };
}
const ROUTING_SCHEMA = { type: 'object', additionalProperties: false, required: ['candidates', 'sensitive', 'conflict', 'reason'], properties: {
  sensitive: { type: 'boolean' }, conflict: { type: 'boolean' }, reason: { type: 'string' }, candidates: { type: 'array', maxItems: 3, items: {
    type: 'object', additionalProperties: false, required: ['studentId', 'type', 'id', 'categoryId', 'score', 'evidence', 'reason'], properties: {
      studentId: { type: 'string' }, type: { type: 'string', enum: ['student', 'project'] }, id: { type: 'string' }, categoryId: { type: 'string' }, score: { type: 'number', minimum: 0, maximum: 1 }, evidence: { type: 'string' }, reason: { type: 'string' },
    },
  } },
} };
module.exports = { DEFAULT_SCHEDULE, EXTRACTABLE, digest, schedule, nextRun, target, sameTarget, studentScopeMatches, identifiers, risks, validateSuggestion, automaticTarget, confidenceThreshold, ROUTING_SCHEMA };
