'use strict';
const crypto = require('node:crypto');
const ROUTING_POLICY_VERSION = 'smart-inbox-routing-v2';
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
  const linkedStudentIds = value.type === 'project'
    ? [...new Set((value.linkedStudentIds || []).map(String).filter(Boolean))].sort() : [];
  return { studentId: value.studentId, type: value.type, id: value.type === 'project' ? value.id : '',
    categoryId: String(value.categoryId || ''), ...(linkedStudentIds.length ? { linkedStudentIds } : {}),
    ...(value.provisional === true ? { provisional: true } : {}) };
}
function physicalTarget(value) {
  const normalized = target(value);
  return { studentId: normalized.studentId, type: normalized.type, id: normalized.id,
    categoryId: normalized.categoryId };
}
// Visibility references and a provisional marker are association metadata. They
// must not turn the same physical destination into a second delivery on replay.
const sameTarget = (a, b) => Boolean(a && b
  && JSON.stringify(physicalTarget(a)) === JSON.stringify(physicalTarget(b)));
function studentScopeMatches(item, source) {
  if (!source || source.detached) return false;
  const c = item.studentConfirmation;
  if (c && (c.studentId !== item.studentId || c.sourceId !== source.id || c.identity !== item.identity)) return false;
  return item.studentId === source.studentId || Boolean(!source.studentId && item.studentId && c)
    || Boolean(c?.reassigned && c.sourceStudentId === source.studentId && c.sourceRevision === source.revision);
}
function confidenceThreshold(value = .85) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < .75 || value > 1) throw Error('可信阈值须在0.75至1之间');
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
  // Sensitive content remains local. A project conflict is no longer itself a
  // reason to throw away valid evidence: the host resolves it deterministically.
  if (result.sensitive) return { candidates: [], sensitive: result.sensitive,
    conflict: result.conflict, reason: result.reason.slice(0, 500) };
  if (result.conflict && result.candidates.some(c => !c || typeof c.score !== 'number'
    || typeof c.evidence !== 'string' || typeof c.reason !== 'string')) {
    return { candidates: [], sensitive: result.sensitive, conflict: true, reason: result.reason.slice(0, 500) };
  }
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
    const project = context.projects.find(p => p.id === t.id);
    if (t.type === 'project' && !project) throw Error('分类项目不在授权范围');
    const allowedStudents = t.type === 'project' ? new Set((project.studentIds || [context.studentId]).map(String))
      : new Set([String(context.studentId)]);
    if (!allowedStudents.has(t.studentId)) throw Error('分类建议超出学生范围');
    if (t.categoryId && (t.type !== 'project' || !project.categories.some(p => p.categoryId === t.categoryId))) throw Error('分类目录不在授权范围');
    if (typeof c.score !== 'number' || !Number.isFinite(c.score) || c.score < 0 || c.score > 1 || typeof c.reason !== 'string' || c.reason.length > 500 || typeof c.evidence !== 'string' || c.evidence.length > 1000) throw Error('分类证据或分数无效');
    if (c.evidence && !text.includes(c.evidence)) throw Error('分类引用并非当前正文证据');
    const key = JSON.stringify(t); if (seen.has(key)) throw Error('分类候选重复'); seen.add(key);
    return { ...t, score: c.score, evidence: c.evidence, reason: c.reason };
  }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id) || a.studentId.localeCompare(b.studentId));
  return { candidates, sensitive: result.sensitive, conflict: result.conflict, reason: result.reason.slice(0, 500) };
}
function automaticTarget({ source, item, context, text, suggestion, rules = [], routingV2Enabled = true,
  classificationAttempted = true, sensitiveLocalOnly = false }) {
  const sensitive = risks(text) || suggestion?.sensitive;
  if (!source.automatic || item.manualLocked || item.truncated || item.extractionBlocked || item.originalMissing
    || !text.trim() || sensitive && !sensitiveLocalOnly) return null;
  const explicit = identifiers(text, context.projects);
  if (!routingV2Enabled && (suggestion?.conflict || explicit.length > 1)) return null;
  const projectTarget = (candidate, basis, provisional = false) => {
    const project = context.projects.find(value => value.id === candidate.id);
    if (!project) return null;
    const linkedStudentIds = [...new Set((project.studentIds || [source.studentId]).map(String).filter(Boolean))].sort();
    if (!linkedStudentIds.length || sensitiveLocalOnly && linkedStudentIds.length > 1) return null;
    const primaryStudentId = linkedStudentIds.includes(String(source.studentId))
      ? String(source.studentId) : linkedStudentIds[0] || String(candidate.studentId || source.studentId);
    return { target: target({ ...candidate, studentId: primaryStudentId, linkedStudentIds,
      categoryId: provisional ? '' : candidate.categoryId, provisional }),
      basis, resolutionBasis: basis, provisional, policyVersion: ROUTING_POLICY_VERSION,
      matchedProjectId: project.id, primaryStudentId, linkedStudentIds,
      confidence: Number(candidate.score || 1), evidence: String(candidate.evidence || '') };
  };
  if (explicit.length === 1 && rules.some(r => r.sourceId === source.id && r.studentId === source.studentId && r.identifier === explicit[0].id && r.suspended)) return null;
  if (source.target) {
    if (explicit.length && source.target.type === 'project' && !explicit.some(project => project.id === source.target.id)) return null;
    return source.target.type === 'project'
      ? projectTarget({ ...source.target, score: 1, evidence: '' }, 'source_binding')
      : { target: target(source.target), basis: 'source_binding', resolutionBasis: 'source_binding',
        provisional: false, policyVersion: ROUTING_POLICY_VERSION, matchedProjectId: '',
        primaryStudentId: source.target.studentId, linkedStudentIds: [source.target.studentId], confidence: 1, evidence: '' };
  }
  const sameContentProjects = context.projects.filter(project =>
    (project.materialTerms || []).some(term => term.sha256 && term.sha256 === item.fingerprint?.sha256)
    || (project.historicalAssociations || []).some(association => association.sha256
      && association.sha256 === item.fingerprint?.sha256));
  if (sameContentProjects.length) {
    const selected = [...sameContentProjects].sort((left, right) => String(left.id).localeCompare(String(right.id)))[0];
    return projectTarget({ studentId: source.studentId || selected.studentIds?.[0] || '', type: 'project',
      id: selected.id, categoryId: '', score: 1, evidence: '' },
    sameContentProjects.length === 1 ? 'same_content_history' : 'same_content_stable_tie', sameContentProjects.length > 1);
  }
  const matching = rules.filter(r => r.active && r.sourceId === source.id && r.studentId === source.studentId && explicit.length === 1 && r.identifier === explicit[0].id);
  if (matching.length === 1) {
    const resolved = matching[0].target.type === 'project'
      ? projectTarget({ ...matching[0].target, score: 1, evidence: '' }, 'confirmed_rule')
      : { target: target(matching[0].target), basis: 'confirmed_rule', resolutionBasis: 'confirmed_rule',
        provisional: false, policyVersion: ROUTING_POLICY_VERSION, matchedProjectId: '',
        primaryStudentId: matching[0].target.studentId, linkedStudentIds: [matching[0].target.studentId], confidence: 1, evidence: '' };
    return resolved ? { ...resolved, ruleId: matching[0].id } : null;
  }
  if (!source.studentId && explicit.length === 1) {
    const selected = explicit[0];
    return projectTarget({ studentId: source.studentId || selected.studentIds?.[0] || '', type: 'project',
      id: selected.id, categoryId: '', score: 1,
      evidence: selected.identifiers?.find(value => text.includes(value)) || selected.name || selected.id },
    'verified_project_identifier');
  }
  if (explicit.length > 1) {
    if (!classificationAttempted) return null;
    const suggested = suggestion?.candidates?.find(candidate => candidate?.type === 'project'
      && explicit.some(project => project.id === candidate.id));
    const selected = suggested || [...explicit].sort((left, right) => String(left.id).localeCompare(String(right.id)))[0];
    return projectTarget({ studentId: selected.studentId || source.studentId || selected.studentIds?.[0] || '',
      type: 'project', id: selected.id, categoryId: selected.categoryId || '', score: selected.score || 1,
      evidence: selected.evidence || selected.identifiers?.find(value => text.includes(value)) || selected.name || selected.id },
    suggested ? 'explicit_project_conflict_ranked' : 'explicit_project_conflict_deterministic', true);
  }
  const [first, second] = suggestion?.candidates || [];
  const conflictResolution = suggestion?.conflict === true;
  if (first?.type === 'student' && first.studentId === source.studentId && first.score >= .5
    && first.evidence && text.includes(first.evidence)) {
    return { target: target(first), basis: 'student_raw_fallback', resolutionBasis: 'student_raw_fallback',
      provisional: true, policyVersion: ROUTING_POLICY_VERSION, matchedProjectId: '',
      primaryStudentId: source.studentId, linkedStudentIds: [source.studentId],
      confidence: first.score, evidence: first.evidence };
  }
  const configuredMinimum = confidenceThreshold(source.confidenceThreshold ?? .85);
  const minimum = conflictResolution ? .5 : routingV2Enabled ? .65 : configuredMinimum;
  const confidentCategory = first?.score >= configuredMinimum && first.score - (second?.score || 0) >= .10;
  if (!first || first.type !== 'project'
    || first.score < minimum
    || !first.evidence || !text.includes(first.evidence) || !context.projects.some(p => p.id === first.id)) return null;
  if (explicit.length && !explicit.some(project => project.id === first.id)) return null;
  const exact = explicit.length === 1 && identifiers(first.evidence, context.projects).some(p => p.id === first.id);
  // Semantic routing requires a substantive quotation, not a filename or a one-word guess.
  if (!exact && (text.trim().length < 40 || first.evidence.trim().length < 12)) return null;
  if (first.categoryId && !context.projects.find(p => p.id === first.id)?.categories.some(c => c.categoryId === first.categoryId)) return null;
  return projectTarget(first, exact ? 'verified_project_identifier'
    : conflictResolution ? 'topic_conflict_deterministic'
      : confidentCategory ? 'verified_content_threshold' : 'project_match_provisional_inbox',
  conflictResolution || explicit.length > 1 || !confidentCategory);
}
const ROUTING_SCHEMA = { type: 'object', additionalProperties: false, required: ['candidates', 'sensitive', 'conflict', 'reason'], properties: {
  sensitive: { type: 'boolean' }, conflict: { type: 'boolean' }, reason: { type: 'string' }, candidates: { type: 'array', maxItems: 3, items: {
    type: 'object', additionalProperties: false, required: ['studentId', 'type', 'id', 'categoryId', 'score', 'evidence', 'reason'], properties: {
      studentId: { type: 'string' }, type: { type: 'string', enum: ['student', 'project'] }, id: { type: 'string' }, categoryId: { type: 'string' }, score: { type: 'number', minimum: 0, maximum: 1 }, evidence: { type: 'string' }, reason: { type: 'string' },
    },
  } },
} };
module.exports = { ROUTING_POLICY_VERSION, DEFAULT_SCHEDULE, EXTRACTABLE, digest, schedule, nextRun, target, sameTarget, studentScopeMatches, identifiers, risks, validateSuggestion, automaticTarget, confidenceThreshold, ROUTING_SCHEMA };
