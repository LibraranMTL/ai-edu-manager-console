'use strict';
const crypto = require('node:crypto');
const ROUTING_POLICY_VERSION = 'smart-inbox-routing-v7';
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
const normalizedList = value => [...new Set((Array.isArray(value) ? value : []).map(v => String(v || '').trim()).filter(Boolean))];
function validateUserRule(input, previous = null) {
  const action = String(input.action || previous?.action || 'deliver');
  if (!['deliver', 'ignore'].includes(action)) throw Error('规则动作无效');
  const studentId = String(input.studentId ?? previous?.studentId ?? '');
  if (!studentId) throw Error('规则必须限定学生');
  const targetValue = input.target === null ? null : input.target || previous?.target || null;
  const rule = {
    id: String(input.id || previous?.id || ''), name: String(input.name ?? previous?.name ?? '').trim().slice(0, 120),
    studentId, sourceId: String(input.sourceId ?? previous?.sourceId ?? ''), action,
    target: action === 'deliver' ? target(targetValue) : null,
    enabled: Boolean(input.enabled ?? previous?.enabled ?? true), priority: Math.max(-1000, Math.min(1000, Math.trunc(Number(input.priority ?? previous?.priority ?? 0) || 0))),
    includeWords: normalizedList(input.includeWords ?? previous?.includeWords).slice(0, 50),
    excludeWords: normalizedList(input.excludeWords ?? previous?.excludeWords).slice(0, 50),
    pathIncludes: normalizedList(input.pathIncludes ?? previous?.pathIncludes).slice(0, 30),
    extensions: normalizedList(input.extensions ?? previous?.extensions).map(v => (v.startsWith('.') ? v : `.${v}`).toLowerCase()).slice(0, 30),
    projectAliases: normalizedList(input.projectAliases ?? previous?.projectAliases).slice(0, 30),
    sourceAgent: String(input.sourceAgent ?? previous?.sourceAgent ?? '').trim().toLowerCase().slice(0, 120),
    conversationKind: String(input.conversationKind ?? previous?.conversationKind ?? ''),
  };
  if (!['', 'internal_task', 'conversation', 'document'].includes(rule.conversationKind)) throw Error('会话类型无效');
  if (!rule.name) throw Error('规则名称不能为空');
  if (rule.target && rule.target.studentId !== studentId) throw Error('规则目标与学生范围不一致');
  if (![rule.includeWords, rule.excludeWords, rule.pathIncludes, rule.extensions, rule.projectAliases].some(values => values.length)
    && !rule.sourceId && !rule.sourceAgent && !rule.conversationKind) throw Error('规则至少需要来源或一个匹配条件');
  if (action === 'ignore' && !rule.includeWords.length && !rule.pathIncludes.length && !rule.extensions.length && rule.conversationKind !== 'internal_task') {
    throw Error('忽略规则必须包含正文、路径或文件类型条件');
  }
  return rule;
}
function matchUserRules({ rules = [], source, item, text = '', context }) {
  const conversation = require('./smart-inbox-conversation.cjs');
  const messages = conversation.businessMessages(text), body = messages.join('\n'), locator = `${item.name || ''}\n${item.locator || ''}`.toLocaleLowerCase(), extension = require('node:path').extname(String(item.name || '')).toLowerCase();
  const explicit = identifiers(body, context.projects || []);
  const hits = [], bypassed = [];
  for (const value of rules) {
    if (!value?.enabled || String(value.studentId) !== String(item.studentId || source.studentId || '')
      || value.sourceId && value.sourceId !== source.id) continue;
    let rule; try { rule = validateUserRule(value, value); } catch { continue; }
    if (rule.sourceAgent && rule.sourceAgent !== String(item.conversationSourceAgent || '').toLowerCase()
      || rule.conversationKind && rule.conversationKind !== item.conversationKind) continue;
    const aliasHits = rule.projectAliases.filter(word => body.includes(word) || locator.includes(word.toLocaleLowerCase()));
    const includeHits = rule.includeWords.filter(word => body.includes(word));
    const excludeHits = rule.excludeWords.filter(word => body.includes(word));
    const pathHits = rule.pathIncludes.filter(word => locator.includes(word.toLocaleLowerCase()));
    const extensionHit = !rule.extensions.length || rule.extensions.includes(extension);
    if (rule.includeWords.length && !includeHits.length || rule.pathIncludes.length && !pathHits.length
      || rule.extensions.length && !extensionHit || rule.projectAliases.length && !aliasHits.length || excludeHits.length) continue;
    if (rule.action === 'ignore' && (explicit.length || conversation.userMessages(text) && item.conversationKind !== 'internal_task'
      && (!rule.includeWords.length || messages.some(message => message.trim() && !rule.includeWords.some(word => message.includes(word)))))) {
      bypassed.push({ ruleId: rule.id, reason: '忽略条件仅覆盖会话局部或与实质项目证据冲突，保留资料继续分类。' });
      continue;
    }
    hits.push({ rule, includeHits, pathHits, aliasHits, extensionHit, evidence: [...includeHits, ...pathHits, ...aliasHits, ...(rule.extensions.length ? [extension] : []), ...(rule.conversationKind ? [`类型：${rule.conversationKind}`] : []), ...(rule.sourceAgent ? [`Agent：${rule.sourceAgent}`] : [])] });
  }
  hits.sort((a, b) => b.rule.priority - a.rule.priority || String(a.rule.id).localeCompare(String(b.rule.id)));
  if (!hits.length) return { status: 'none', hits: [], bypassed, explicitProjectIds: explicit.map(p => p.id) };
  const top = hits.filter(hit => hit.rule.priority === hits[0].rule.priority);
  const signatures = new Set(top.map(hit => hit.rule.action === 'ignore' ? 'ignore' : `deliver:${hit.rule.target.studentId}:${hit.rule.target.type}:${hit.rule.target.id}:${hit.rule.target.categoryId}`));
  if (signatures.size > 1) return { status: 'conflict', hits: top, reason: '同优先级规则给出不同动作或目标，请人工确认。', explicitProjectIds: explicit.map(p => p.id) };
  const selected = top[0];
  if (selected.rule.action === 'deliver' && selected.rule.target.type === 'project' && explicit.length
    && !explicit.some(project => project.id === selected.rule.target.id)) {
    return { status: 'conflict', hits: top, reason: '规则目标与正文中的明确项目标识矛盾，请人工确认。', explicitProjectIds: explicit.map(p => p.id) };
  }
  if (selected.rule.action === 'ignore' && explicit.length) {
    return { status: 'conflict', hits: top, reason: '忽略规则与正文中的明确学习项目证据矛盾，请人工确认。', explicitProjectIds: explicit.map(p => p.id) };
  }
  return { status: 'matched', action: selected.rule.action, target: selected.rule.target, hit: selected, hits: top,
    reason: `命中规则“${selected.rule.name}”：${selected.evidence.join('、') || '来源范围'}`, explicitProjectIds: explicit.map(p => p.id) };
}
function selectRoutingCandidates({ context, text = '', item = {}, ruleMatch = null, limit = 5 }) {
  const projects = context.projects || [], explicit = identifiers(text, projects), scores = new Map();
  const add = (id, points, evidence) => { const old = scores.get(id) || { id, score: 0, evidence: [] }; old.score += points; if (evidence) old.evidence.push(evidence); scores.set(id, old); };
  for (const project of explicit) add(project.id, 100, '正文明确项目标识');
  if (ruleMatch?.target?.type === 'project') add(ruleMatch.target.id, 120, `规则：${ruleMatch.hit?.rule?.name || ''}`);
  const haystack = `${item.name || ''}\n${item.locator || ''}\n${text}`.toLocaleLowerCase();
  // These equivalences and bigrams are weak retrieval hints only. They cannot
  // exclude an authorized project or establish automatic delivery evidence.
  const normalizeHints = value => String(value).toLocaleLowerCase().replace(/摆锤/g, '单摆').replace(/课桌/g, '学习桌');
  const hintText = normalizeHints(haystack);
  const commonBigrams = new Set(['研究', '实验', '设计', '项目', '资料', '学生', '学习', '分析', '模型', '记录', '测试', '进行', '使用', '关系', '影响']);
  for (const project of projects) {
    for (const value of [project.name, ...(project.identifiers || []), ...(project.aliases || [])].filter(Boolean)) {
      const word = String(value).toLocaleLowerCase(); if (word.length >= 3 && haystack.includes(word)) add(project.id, 20, `名称或别名：${value}`);
    }
    const summaryTerms = String(project.summary || '').split(/[\s,，。；;、:：/\\|()[\]{}]+/u).filter(v => v.length >= 3).slice(0, 20);
    const matched = summaryTerms.filter(word => String(text).includes(word)).slice(0, 5);
    if (matched.length) add(project.id, matched.length, `简介词：${matched.join('、')}`);
    // Weak local recall is for suggestions only; it cannot prove that projects
    // outside the selected window are unrelated or authorize automatic routing.
    const words = `${project.name || ''} ${project.summary || ''}`.toLocaleLowerCase().match(/[\p{Script=Han}]{2,}|[a-z0-9][a-z0-9._-]{2,}/gu) || [];
    const fragments = new Set();
    for (const word of words.slice(0, 30)) {
      if (/^[\p{Script=Han}]+$/u.test(word) && word.length >= 4) {
        for (let n = 0; n <= word.length - 3; n++) fragments.add(word.slice(n, n + 3));
      } else if (word.length >= 3) fragments.add(word);
    }
    const hits = [...fragments].filter(fragment => haystack.includes(fragment)).slice(0, 5);
    if (hits.length >= 2) add(project.id, hits.length, `本机词片段：${hits.join('、')}`);
    const bigrams = new Set();
    for (const word of normalizeHints(`${project.name || ''} ${project.summary || ''} ${(project.aliases || []).join(' ')}`).match(/[\p{Script=Han}]{2,}/gu) || []) {
      for (let n = 0; n < word.length - 1; n++) if (!commonBigrams.has(word.slice(n, n + 2))) bigrams.add(word.slice(n, n + 2));
    }
    const hintHits = [...bigrams].filter(value => hintText.includes(value)).slice(0, 5);
    if (hintHits.length >= 2) add(project.id, hintHits.length, `本机主题线索：${hintHits.join('、')}`);
  }
  const ranked = [...scores.values()].sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));
  // A small authorized scope fits in full. A weak lexical hit is a ranking
  // hint, not permission to omit competing projects while claiming coverage.
  if (projects.length <= limit) {
    const seen = new Set(ranked.map(value => value.id));
    const all = [...ranked, ...projects.filter(project => !seen.has(project.id)).map(project => ({ id: project.id, score: 0, evidence: [] }))];
    return { candidateIds: all.map(value => value.id), candidates: all, totalProjects: projects.length,
      complete: true, strong: ranked.some(value => value.score >= 100), reason: '' };
  }
  if (!ranked.length) return { candidateIds: [], candidates: [], totalProjects: projects.length, complete: projects.length <= limit,
    reason: projects.length <= limit ? '' : '没有足够的本机证据将项目缩小到安全候选范围。' };
  const boundary = ranked[Math.min(limit, ranked.length) - 1]?.score;
  const tiedBeyondLimit = ranked.length > limit && ranked[limit].score === boundary;
  if (tiedBeyondLimit) return { candidateIds: [], candidates: ranked, totalProjects: projects.length, complete: false, reason: '候选项目在截断边界上证据相同，未强行排除。' };
  const selected = ranked.slice(0, limit);
  const strong = selected.some(value => value.score >= 100);
  return { candidateIds: selected.map(v => v.id), candidates: selected, totalProjects: projects.length,
    complete: projects.length <= limit || strong && !ranked.slice(limit).some(value => value.score >= selected[selected.length - 1].score), strong,
    reason: selected.length < projects.length ? `已由本机证据缩小为 ${selected.length} 个候选项目。` : '' };
}
function boundedRoutingContext(context, text) {
  const matches = identifiers(text, context.projects || []);
  if (matches.length > 5 || (!matches.length && context.projects.length > 5)) {
    return { context: null, reason: '候选项目过多，无法可靠缩小范围，请确认项目。', candidateIds: matches.map(p => p.id) };
  }
  const selected = context.projects.length <= 5 ? context.projects : matches;
  const compact = { ...context, profile: { summary: String(context.profile?.summary || '').slice(0, 300), source: context.profile?.source || '', confirmed: false },
    projects: selected.map(p => ({ ...p, summary: String(p.summary || '').slice(0, 300),
      categories: (p.categories || []).slice(0, 20), materialTerms: (p.materialTerms || []).slice(0, 12),
      knowledgeTerms: (p.knowledgeTerms || []).slice(0, 12), historicalAssociations: [] })) };
  if (Buffer.byteLength(JSON.stringify(compact)) > 100 * 1024) return { context: null, reason: '候选项目内容仍过多，请确认项目。', candidateIds: selected.map(p => p.id) };
  return { context: compact, candidateIds: selected.map(p => p.id), totalProjects: context.projects.length, compressed: selected.length !== context.projects.length || Buffer.byteLength(JSON.stringify(compact)) < Buffer.byteLength(JSON.stringify(context)) };
}
function normalizeLegacyRoutingResult(value, schema) {
  if (schema?.properties?.assessment && schema?.properties?.candidates && value && typeof value === 'object'
    && !Object.hasOwn(value, 'assessment')) return { ...value, assessment: null };
  return value;
}
function validateSuggestion(result, context, text) {
  try { return validateSuggestionInput(result, context, text); }
  catch (error) { if (!error.code) error.code = 'ROUTING_FIELDS_INVALID'; throw error; }
}
function validateSuggestionInput(result, context, text) {
  result = require('./smart-inbox-content.cjs').parseRoutingResult(result);
  // With no candidate and no claimed subject, provider commentary is not
  // ownership evidence. Discard this non-authorizing field rather than invent
  // a quote or repeat the model call. Any routing-bearing result stays strict.
  if (Array.isArray(result?.candidates) && !result.candidates.length && result.assessment?.studentId === ''
    && ['internal', 'other', 'unknown'].includes(result.assessment.kind) && typeof result.assessment.subjectEvidence === 'string'
    && !require('./smart-inbox-content.cjs').quoteExists(text, result.assessment.subjectEvidence))
    result = { ...result, assessment: { ...result.assessment, subjectEvidence: '' } };
  const allowed = new Set(['candidates', 'sensitive', 'conflict', 'reason', 'assessment']);
  if (!result || !Array.isArray(result.candidates) || result.candidates.length > 3) throw Error('分类结果不符合受控合同');
  if (typeof result.sensitive !== 'boolean' || typeof result.conflict !== 'boolean' || typeof result.reason !== 'string') throw Error('分类风险字段无效');
  // Legacy sensitive flags are retained for compatibility, not a routing gate.
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
    if (t.type === 'project' && !project) throw Object.assign(Error('分类项目不在授权范围'), { code: 'ROUTING_PROJECT_SCOPE' });
    const allowedStudents = t.type === 'project' ? new Set((project.studentIds || [context.studentId]).map(String))
      : new Set([String(context.studentId)]);
    if (!allowedStudents.has(t.studentId)) throw Object.assign(Error('分类建议超出学生范围'), { code: 'ROUTING_STUDENT_SCOPE' });
    if (t.categoryId && (t.type !== 'project' || !project.categories.some(p => p.categoryId === t.categoryId))) throw Error('分类目录不在授权范围');
    if (typeof c.score !== 'number' || !Number.isFinite(c.score) || c.score < 0 || c.score > 1 || typeof c.reason !== 'string' || c.reason.length > 500 || typeof c.evidence !== 'string' || c.evidence.length > 1000) throw Error('分类证据或分数无效');
    if (c.evidence && !require('./smart-inbox-content.cjs').quoteExists(text, c.evidence)) throw Object.assign(Error('分类引用并非当前正文证据'), { code: 'ROUTING_QUOTE_MISMATCH' });
    const key = JSON.stringify(t); if (seen.has(key)) throw Error('分类候选重复'); seen.add(key);
    return { ...t, score: c.score, evidence: c.evidence, reason: c.reason };
  }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id) || a.studentId.localeCompare(b.studentId));
  const assessment = validateAssessment(result.assessment, context, text);
  return { candidates, sensitive: result.sensitive, conflict: result.conflict, reason: result.reason.slice(0, 500),
    ...(assessment ? { assessment } : {}) };
}
function validateAssessment(value, context, text) {
  if (value == null) return null;
  const keys = ['kind', 'studentId', 'evidence', 'subjectEvidence', 'score', 'tags', 'checkedProjectIds', 'competingProjectIds'];
  const quoteExists = require('./smart-inbox-content.cjs').quoteExists;
  if (typeof value.studentId === 'string' && value.studentId && value.studentId !== context.studentId) throw Object.assign(Error('资料主体超出授权范围'), { code: 'ROUTING_STUDENT_SCOPE' });
  if (typeof value.evidence === 'string' && !quoteExists(text, value.evidence)
    || typeof value.subjectEvidence === 'string' && !quoteExists(text, value.subjectEvidence)) throw Object.assign(Error('资料性质或主体引用不属于正文'), { code: 'ROUTING_QUOTE_MISMATCH' });
  if (Object.keys(value).some(key => !keys.includes(key))
    || !['learning', 'project', 'internal', 'other', 'unknown'].includes(value.kind)
    || typeof value.studentId !== 'string' || value.studentId && value.studentId !== context.studentId
    || typeof value.evidence !== 'string' || !quoteExists(text, value.evidence) || value.evidence.length > 1000
    || typeof value.subjectEvidence !== 'string' || !quoteExists(text, value.subjectEvidence) || value.subjectEvidence.length > 1000
    || !Number.isFinite(value.score) || value.score < 0 || value.score > 1
    || !Array.isArray(value.tags) || value.tags.length > 8 || value.tags.some(tag => typeof tag !== 'string' || tag.length > 80)) throw Object.assign(Error('资料性质或主体证据无效'), { code: 'ROUTING_FIELDS_INVALID' });
  for (const key of ['checkedProjectIds', 'competingProjectIds']) {
    if (!Array.isArray(value[key]) || value[key].some(id => !context.projects.some(project => project.id === id))) throw Object.assign(Error('项目核验范围无效'), { code: 'ROUTING_PROJECT_SCOPE' });
  }
  return { ...value, checkedProjectIds: [...new Set(value.checkedProjectIds)], competingProjectIds: [...new Set(value.competingProjectIds)] };
}
function verifiedCoverage(assessment, projects) {
  return Boolean(assessment && assessment.score >= .85 && assessment.evidence.trim().length >= 12
    && projects.every(project => assessment.checkedProjectIds.includes(project.id)));
}
function automaticTarget({ source, item, context, text, suggestion, rules = [], routingV2Enabled = true,
  classificationAttempted = true }) {
  if (!source.automatic || item.manualLocked || item.truncated || item.extractionBlocked || item.originalMissing
    || !text.trim()) return null;
  const explicit = identifiers(text, context.projects);
  if (!routingV2Enabled && (suggestion?.conflict || explicit.length > 1)) return null;
  const projectTarget = (candidate, basis, provisional = false) => {
    const project = context.projects.find(value => value.id === candidate.id);
    if (!project) return null;
    const linkedStudentIds = [...new Set((project.studentIds || [source.studentId]).map(String).filter(Boolean))].sort();
    if (!linkedStudentIds.length) return null;
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
    if (sameContentProjects.length > 1) return null;
    const selected = [...sameContentProjects].sort((left, right) => String(left.id).localeCompare(String(right.id)))[0];
    return projectTarget({ studentId: source.studentId || selected.studentIds?.[0] || '', type: 'project',
      id: selected.id, categoryId: '', score: 1, evidence: '' },
    sameContentProjects.length === 1 ? 'same_content_history' : 'same_content_stable_tie', sameContentProjects.length > 1);
  }
  const matching = rules.filter(r => r.active && !r.suspended && r.sourceId === source.id && r.studentId === source.studentId
    && (r.scopeHash ? r.scopeHash === digest([source.id, source.studentId, source.target, source.folder]) : !r.sourceRevision || r.sourceRevision === source.revision) && learnedRuleMatches(r, item, text)
    && (!explicit.length || r.target.type !== 'project' || explicit.some(project => project.id === r.target.id)));
  if (matching.length === 1) {
    const resolved = matching[0].target.type === 'project'
      ? projectTarget({ ...matching[0].target, score: 1, evidence: '' }, 'confirmed_rule')
      : { target: target(matching[0].target), basis: 'confirmed_rule', resolutionBasis: 'confirmed_rule',
        provisional: false, policyVersion: ROUTING_POLICY_VERSION, matchedProjectId: '',
        primaryStudentId: matching[0].target.studentId, linkedStudentIds: [matching[0].target.studentId], confidence: 1, evidence: '' };
    return resolved ? { ...resolved, ruleId: matching[0].id, ruleVersion: matching[0].version } : null;
  }
  if (!source.studentId && explicit.length === 1) {
    const selected = explicit[0];
    return projectTarget({ studentId: source.studentId || selected.studentIds?.[0] || '', type: 'project',
      id: selected.id, categoryId: '', score: 1,
      evidence: selected.identifiers?.find(value => text.includes(value)) || selected.name || selected.id },
    'verified_project_identifier');
  }
  if (explicit.length > 1) {
    return null;
  }
  const [first, second] = suggestion?.candidates || [];
  const conflictResolution = suggestion?.conflict === true;
  if (conflictResolution || (second && first && first.type === 'project' && second.type === 'project' && first.score - second.score < .10)) return null;
  const configuredMinimum = confidenceThreshold(source.confidenceThreshold ?? .85);
  if (first?.type === 'student' && first.studentId === source.studentId && first.score >= configuredMinimum
    && (!second || first.score - second.score >= .10)
    && first.evidence && text.includes(first.evidence)) {
    if (suggestion.assessment && (suggestion.assessment.kind !== 'learning'
      || suggestion.assessment.competingProjectIds.length || suggestion.assessment.studentId !== source.studentId)) return null;
    return { target: target(first), basis: 'student_raw_fallback', resolutionBasis: 'student_raw_fallback',
      provisional: true, policyVersion: ROUTING_POLICY_VERSION, matchedProjectId: '',
      primaryStudentId: source.studentId, linkedStudentIds: [source.studentId],
      confidence: first.score, evidence: first.evidence };
  }
  const minimum = configuredMinimum;
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
function learnedRuleMatches(rule, item, text) {
  if (rule.identifier) return identifiers(text, [{ id: rule.identifier }]).length === 1;
  if (rule.directory && ['folder', 'download'].includes(item.sourceType)) {
    const locator = String(item.locator || '').replace(/\\/g, '/').toLocaleLowerCase();
    return locator.startsWith(`${rule.directory.toLocaleLowerCase()}/`);
  }
  return false;
}
const ASSESSMENT_SCHEMA = { type: 'object', additionalProperties: false,
  required: ['kind', 'studentId', 'evidence', 'subjectEvidence', 'score', 'tags', 'checkedProjectIds', 'competingProjectIds'], properties: {
    kind: { type: 'string', enum: ['learning', 'project', 'internal', 'other', 'unknown'] }, studentId: { type: 'string' },
    evidence: { type: 'string' }, subjectEvidence: { type: 'string' }, score: { type: 'number', minimum: 0, maximum: 1 },
    tags: { type: 'array', maxItems: 8, items: { type: 'string' } }, checkedProjectIds: { type: 'array', items: { type: 'string' } },
    competingProjectIds: { type: 'array', items: { type: 'string' } },
  } };
const ROUTING_SCHEMA = { type: 'object', additionalProperties: false, required: ['candidates', 'sensitive', 'conflict', 'reason', 'assessment'], properties: {
  assessment: { anyOf: [ASSESSMENT_SCHEMA, { type: 'null' }] },
  sensitive: { type: 'boolean' }, conflict: { type: 'boolean' }, reason: { type: 'string' }, candidates: { type: 'array', maxItems: 3, items: {
    type: 'object', additionalProperties: false, required: ['studentId', 'type', 'id', 'categoryId', 'score', 'evidence', 'reason'], properties: {
      studentId: { type: 'string' }, type: { type: 'string', enum: ['student', 'project'] }, id: { type: 'string' }, categoryId: { type: 'string' }, score: { type: 'number', minimum: 0, maximum: 1 }, evidence: { type: 'string' }, reason: { type: 'string' },
    },
  } },
} };
module.exports = { normalizeLegacyRoutingResult, learnedRuleMatches, ROUTING_POLICY_VERSION, DEFAULT_SCHEDULE, EXTRACTABLE, digest, schedule, nextRun, target, sameTarget, studentScopeMatches, identifiers, validateUserRule, matchUserRules, selectRoutingCandidates, boundedRoutingContext, validateSuggestion, validateAssessment, verifiedCoverage, automaticTarget, confidenceThreshold, ROUTING_SCHEMA };
