const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createLearningStateStore, learningStatePath } = require('./learning-state-store.cjs');

const LEARNING_EVENT_SCHEMA = 'edu-manager.learning-event.v1';
const KNOWLEDGE_STATE_SCHEMA = 'edu-manager.student-knowledge-state.v1';
const MISCONCEPTION_SCHEMA = 'edu-manager.misconception-ledger.v1';
const TAXONOMY_FILE = path.join(__dirname, 'learning-taxonomy-math.v1.json');
const SCORE_KEYS = ['conceptualUnderstanding', 'proceduralFluency', 'methodSelection', 'transfer'];

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch { return fallback; }
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(temporary, file);
  } finally {
    try { fs.rmSync(temporary, { force: true }); } catch {}
  }
  return value;
}

function safeId(value) {
  const raw = String(value || '').trim();
  const readable = raw.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return readable || crypto.createHash('sha1').update(raw).digest('hex').slice(0, 20);
}

function analyticsDir(studentRootPath) {
  return path.join(studentRootPath, '.edu-manager', 'learning-analytics');
}

function eventsPath(studentRootPath) {
  return path.join(analyticsDir(studentRootPath), 'learning-events.json');
}

function rejectionsPath(studentRootPath) {
  return path.join(analyticsDir(studentRootPath), 'rejected-events.json');
}

function readEventLedger(studentRootPath, studentId) {
  const file = eventsPath(studentRootPath);
  if (!fs.existsSync(file)) return { ok: true, events: [] };
  try {
    const document = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (document.schema !== LEARNING_EVENT_SCHEMA || !Array.isArray(document.events) || String(document.studentId) !== String(studentId)
      || document.events.some((event) => String(event.studentId) !== String(studentId))) {
      return { ok: false, code: 'event_ledger_scope_or_schema_invalid', events: [] };
    }
    return { ok: true, events: document.events };
  } catch { return { ok: false, code: 'event_ledger_unreadable', events: [] }; }
}

function syncFirstSeenProjection(studentRootPath, studentId, events) {
  let store;
  try {
    store = createLearningStateStore({ dbPath: learningStatePath(studentRootPath) });
    return store.reconcileEvents(studentId, events);
  } catch (error) {
    return { ok: false, code: error.code || 'learning_state_projection_failed', message: error.message };
  } finally {
    try { store?.close(); } catch { /* projection is rebuildable; close failures are reported on the next read */ }
  }
}

function statesPath(studentRootPath) {
  return path.join(analyticsDir(studentRootPath), 'knowledge-states.json');
}

function misconceptionsPath(studentRootPath) {
  return path.join(analyticsDir(studentRootPath), 'misconceptions.json');
}

function historyCandidatePath(studentRootPath) {
  return path.join(analyticsDir(studentRootPath), 'history-changes-candidate.md');
}

function buildHistoryCandidate(studentId, states, events) {
  const lines = ['# 历史变化候选（未发布）', '',
    `学生 ID：${studentId}`, '',
    '本页由已接纳的结构化学习事件自动投影，仅供学情报告复核引用；不是正式《历史变化》，不表示自动创建复测任务。',
    '磁盘文件是最近一次事件变更时的快照；保持度与复测优先级请以界面实时查询为准。',
    '评分和保持度是模型估计，不等于考试成绩或医学/心理诊断。', ''];
  for (const state of [...states].sort((a, b) => String(a.knowledgePoint.id).localeCompare(String(b.knowledgePoint.id)))) {
    const pointEvents = events.filter((event) => event.knowledgePoint?.id === state.knowledgePoint.id)
      .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
    lines.push(`## ${state.knowledgePoint.label} (${state.knowledgePoint.id})`, '',
      `证据 ${state.evidenceCount} 条；状态 ${state.state}；模型置信度 ${Math.round(state.confidence * 100)}%；复测优先级 ${state.reviewPriority}。`,
      state.retentionNote || '保持度结论需以后续独立复测核验。', '');
    for (const event of pointEvents) {
      const refs = (event.evidenceRefs || []).map((ref) => `${ref.sourceType}:${ref.sourceId}`).join('、');
      lines.push(`- ${event.occurredAt.slice(0, 10)} · ${event.taskType || '学习互动'} · ${event.eventId} · 来源 ${refs || '无'}`);
    }
    lines.push('', `建议复测：${state.recommendedReviewAt || '待补证据'}；仅为建议，需用户确认后进入任务中心。`, '');
  }
  if (!states.length) lines.push('暂无可投影的学习事件。', '');
  return lines.join('\n');
}

function loadTaxonomy() {
  const document = readJson(TAXONOMY_FILE, { version: 'math.v1', points: [] });
  const points = Array.isArray(document.points) ? document.points : [];
  const byId = new Map(points.filter((point) => point?.id).map((point) => [String(point.id).toUpperCase(), point]));
  const byAlias = new Map();
  for (const point of points) {
    for (const alias of [point.id, point.label, ...(point.aliases || [])]) {
      const key = String(alias || '').trim().toLocaleLowerCase('zh-CN');
      if (key) byAlias.set(key, point);
    }
  }
  return { version: String(document.version || 'math.v1'), points, byId, byAlias };
}

function canonicalKnowledgePoint(input, taxonomy = loadTaxonomy()) {
  const value = input && typeof input === 'object' ? input : { label: input };
  const requestedId = String(value.id || value.knowledgePointId || '').trim().toUpperCase();
  const requestedLabel = String(value.label || value.name || value.knowledgePoint || '').trim();
  const matched = (requestedId && taxonomy.byId.get(requestedId))
    || taxonomy.byAlias.get(requestedLabel.toLocaleLowerCase('zh-CN'));
  if (matched) return {
    id: String(matched.id),
    label: String(matched.label || matched.id),
    subject: String(matched.subject || 'Mathematics'),
    taxonomyVersion: taxonomy.version,
  };
  if (requestedId && /^[A-Z][A-Z0-9_.-]{2,120}$/.test(requestedId) && requestedLabel) return {
    id: requestedId,
    label: requestedLabel,
    subject: String(value.subject || ''),
    taxonomyVersion: String(value.taxonomyVersion || 'external.v1'),
  };
  // Knowledge tracking is intentionally open-world.  Unknown names are
  // registered immediately instead of entering a review queue.  The ID is
  // stable for a normalized subject/name pair and therefore remains safe for
  // idempotent re-imports and later taxonomy upgrades.
  if (requestedLabel) {
    const subject = String(value.subject || '通用').trim() || '通用';
    const normalizedName = requestedLabel.normalize('NFKC').trim().toLocaleLowerCase('zh-CN').replace(/\s+/gu, ' ');
    const subjectKey = subject.normalize('NFKC').trim().toUpperCase().replace(/[^A-Z0-9\u4E00-\u9FFF]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 32) || 'GENERAL';
    const hash = crypto.createHash('sha1').update(`${subject}\n${normalizedName}`, 'utf8').digest('hex').slice(0, 16).toUpperCase();
    return { id: `KNOWLEDGE.${subjectKey}.${hash}`, label: requestedLabel, subject, taxonomyVersion: 'open-world.v1' };
  }
  return null;
}

function boundedScore(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 4 ? number : null;
}

function normalizeEvidenceRefs(value) {
  const refs = Array.isArray(value) ? value : [];
  const seen = new Set();
  return refs.flatMap((ref) => {
    const sourceType = String(ref?.sourceType || ref?.type || '').trim();
    const sourceId = String(ref?.sourceId || ref?.id || '').trim();
    const key = `${sourceType}:${sourceId}`;
    if (!sourceType || !sourceId || seen.has(key)) return [];
    seen.add(key);
    return [{ sourceType, sourceId, quote: String(ref?.quote || '').slice(0, 500) }];
  });
}

function normalizeErrors(value) {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  const seen = new Set();
  return items.flatMap((item) => {
    const source = item && typeof item === 'object' ? item : { id: item };
    const id = String(source.id || source.type || source.code || '').trim()
      .toUpperCase().replace(/[^A-Z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120);
    if (!id || seen.has(id)) return [];
    seen.add(id);
    return [{ id, description: String(source.description || source.text || item || '').trim().slice(0, 500) }];
  });
}

function evidenceAllowed(refs, allowedEvidenceRefs) {
  if (!allowedEvidenceRefs) return refs.length > 0;
  const allowed = new Set((Array.isArray(allowedEvidenceRefs) ? allowedEvidenceRefs : [])
    .map((ref) => `${String(ref?.sourceType || '')}:${String(ref?.sourceId || '')}`));
  return refs.length > 0 && refs.every((ref) => allowed.has(`${ref.sourceType}:${ref.sourceId}`));
}

function normalizeLearningEvent(input, context = {}) {
  const studentId = String(context.studentId || input?.studentId || input?.student_id || '').trim();
  if (!studentId || (input?.studentId && String(input.studentId) !== studentId)) return { ok: false, code: 'student_scope_mismatch' };
  const suppliedKnowledgePoint = input?.knowledgePoint || input?.knowledge_point;
  const knowledgePoint = canonicalKnowledgePoint(suppliedKnowledgePoint && typeof suppliedKnowledgePoint === 'object'
    ? { ...suppliedKnowledgePoint, subject: suppliedKnowledgePoint.subject || input?.subject }
    : {
      id: input?.knowledgePointId || input?.knowledge_point_id,
      label: suppliedKnowledgePoint || input?.knowledgePointLabel || input?.knowledge_point_label,
      subject: input?.subject,
    }, context.taxonomy);
  if (!knowledgePoint) return { ok: false, code: 'knowledge_point_unmapped' };
  const suppliedOccurredAt = String(input?.occurredAt || input?.timestamp || input?.date || '').trim();
  const occurredAtKnown = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(suppliedOccurredAt)
    && Number.isFinite(Date.parse(suppliedOccurredAt));
  const activityType = String(input?.activityType || input?.activity_type || '').trim();
  const knowledgeActivity = ['material_exposure', 'practice', 'project_application', 'assessment', 'review', 'correction'].includes(activityType);
  if (!occurredAtKnown && !knowledgeActivity) return { ok: false, code: 'occurred_at_invalid' };
  const occurredAt = occurredAtKnown ? suppliedOccurredAt : String(context.recordedAt || input?.recordedAt || new Date().toISOString());
  const rawEvidenceRefs = input?.evidenceRefs || input?.evidence_refs || context.evidenceRefs;
  if (!Array.isArray(rawEvidenceRefs) || rawEvidenceRefs.some((ref) => !String(ref?.sourceType || ref?.type || '').trim()
    || !String(ref?.sourceId || ref?.id || '').trim())) return { ok: false, code: 'evidence_ref_invalid' };
  const evidenceRefs = normalizeEvidenceRefs(rawEvidenceRefs);
  if (!evidenceAllowed(evidenceRefs, context.allowedEvidenceRefs)) return { ok: false, code: 'evidence_ref_unauthorized' };
  if (context.requireNonVisualEvidence === true && evidenceRefs.every((ref) => ref.sourceType === 'capture_event')) {
    return { ok: false, code: 'performance_source_visual_only' };
  }
  const source = input?.performance || input?.scores || {};
  const rawScores = [source.conceptualUnderstanding ?? source.conceptual_understanding ?? source.concept,
    source.proceduralFluency ?? source.procedural_fluency ?? source.procedure,
    source.methodSelection ?? source.method_selection, source.transfer,
    source.hintLevel ?? source.hint_level ?? source.hint,
    input?.taskDifficulty ?? input?.task_difficulty ?? input?.task?.difficulty];
  if (rawScores.some((value) => value !== null && value !== undefined && value !== '' && boundedScore(value) === null)) {
    return { ok: false, code: 'performance_score_invalid' };
  }
  const performance = {
    conceptualUnderstanding: boundedScore(source.conceptualUnderstanding ?? source.conceptual_understanding ?? source.concept),
    proceduralFluency: boundedScore(source.proceduralFluency ?? source.procedural_fluency ?? source.procedure),
    methodSelection: boundedScore(source.methodSelection ?? source.method_selection),
    transfer: boundedScore(source.transfer),
    hintLevel: boundedScore(source.hintLevel ?? source.hint_level ?? source.hint),
  };
  const practiceReview = context.allowPracticeReview === true && input?.practiceReview?.episodeId && ['correct','mostly_correct','partial','needs_correction','undetermined'].includes(input?.outcome)
    ? { episodeId: String(input.practiceReview.episodeId).slice(0, 120), resultRef: String(input.practiceReview.resultRef).slice(0, 64),
      attemptId: String(input.practiceReview.attemptId).slice(0, 120), source: String(input.practiceReview.source), sequence: Number(input.practiceReview.sequence), assistance: input.practiceReview.assistance || { status: 'unknown' } } : null;
  if (SCORE_KEYS.every((key) => performance[key] === null) && !practiceReview && !knowledgeActivity) return { ok: false, code: 'performance_missing' };
  const taskType = String(input?.taskType || input?.task_type || input?.task?.type || 'unknown').trim().slice(0, 80);
  const taskId = String(input?.taskId || input?.task_id || input?.task?.id || '').trim().slice(0, 160);
  const errors = normalizeErrors(input?.errors || input?.errorTypes || input?.error_types);
  // A source without a trustworthy activity timestamp must remain idempotent when
  // it is rescanned later.  recordedAt is only a storage timestamp and must not
  // turn the same source/knowledge-point pair into a new activity on every run.
  const activityIdentityTime = occurredAtKnown ? new Date(occurredAt).toISOString() : 'time-unknown';
  const idempotencySeed = [studentId, knowledgePoint.id, activityIdentityTime, taskId, taskType, activityType,
    JSON.stringify(performance), JSON.stringify(evidenceRefs.map((ref) => `${ref.sourceType}:${ref.sourceId}`).sort())].join('|');
  const eventId = String(input?.eventId || input?.event_id || input?.idempotencyKey || input?.idempotency_key || '').trim()
    || `learning-event-${crypto.createHash('sha1').update(idempotencySeed).digest('hex').slice(0, 24)}`;
  return { ok: true, event: {
    schema: LEARNING_EVENT_SCHEMA,
    eventId: safeId(eventId),
    studentId,
    subject: String(input?.subject || knowledgePoint.subject || '').trim(),
    knowledgePoint,
    occurredAt: new Date(occurredAt).toISOString(),
    taskId,
    taskType,
    activityType: knowledgeActivity ? activityType : '',
    activityOccurredAtKnown: occurredAtKnown,
    taskDifficulty: boundedScore(input?.taskDifficulty ?? input?.task_difficulty ?? input?.task?.difficulty),
    performance,
    ...(practiceReview ? { practiceReview, outcome: input.outcome } : {}),
    errors,
    evidence: String(input?.evidence || '').trim().slice(0, 2000),
    evidenceRefs,
    recommendedNextStep: String(input?.recommendedNextStep || input?.recommended_next_step || '').trim().slice(0, 1000),
    sourceSessionId: String(context.sessionId || input?.sourceSessionId || '').trim(),
    sourceSegmentId: String(context.segmentId || input?.sourceSegmentId || '').trim(),
    extractorVersion: String(input?.extractorVersion || context.extractorVersion || 'agent-managed-protocol.v1'),
    recordedAt: String(context.recordedAt || new Date().toISOString()),
  } };
}

function scoreEvent(event) {
  const weights = { conceptualUnderstanding: 0.25, proceduralFluency: 0.20, methodSelection: 0.20, transfer: 0.20 };
  let weighted = 0;
  let used = 0;
  for (const key of SCORE_KEYS) {
    const value = event.performance?.[key];
    if (value === null || value === undefined) continue;
    weighted += (Number(value) / 4) * weights[key];
    used += weights[key];
  }
  if (!used) return null;
  const evidenceScore = used ? weighted / used : 0;
  const hintPenalty = Number(event.performance?.hintLevel ?? 0) * 0.04;
  return Math.max(0, Math.min(1, evidenceScore - hintPenalty));
}

function retentionConfidence(days) {
  if (days <= 7) return 1;
  if (days <= 30) return 1 - ((days - 7) / 23) * 0.2;
  if (days <= 90) return 0.8 - ((days - 30) / 60) * 0.25;
  return Math.max(0.35, 0.55 - ((days - 90) / 275) * 0.2);
}

function effectiveLearningEvents(events) {
  const episodes = new Map();
  for (const event of events) if (event.practiceReview) {
    const key = `${event.studentId}:${event.practiceReview.episodeId}`;
    if (!episodes.has(key) || event.practiceReview.sequence > episodes.get(key).practiceReview.sequence) episodes.set(key, event);
  }
  return events.filter(event => !event.practiceReview || episodes.get(`${event.studentId}:${event.practiceReview.episodeId}`) === event);
}
function computeKnowledgeState(studentId, knowledgePoint, events, options = {}) {
  const ordered = effectiveLearningEvents(events).sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt));
  const asOf = Number.isFinite(Date.parse(options.asOf || '')) ? new Date(options.asOf) : new Date();
  const recent = ordered.filter(event => scoreEvent(event) !== null).slice(-8);
  let totalWeight = 0;
  let masteryTotal = 0;
  for (let index = 0; index < recent.length; index += 1) {
    const weight = index + 1;
    totalWeight += weight;
    masteryTotal += scoreEvent(recent[index]) * weight;
  }
  const evidenceMastery = totalWeight ? masteryTotal / totalWeight : 0;
  const dimensionScores = Object.fromEntries(SCORE_KEYS.map((key) => {
    let weighted = 0;
    let observedWeight = 0;
    for (let index = 0; index < recent.length; index += 1) {
      const value = recent[index].performance?.[key];
      if (value == null) continue;
      const weight = index + 1;
      weighted += (Number(value) / 4) * weight;
      observedWeight += weight;
    }
    return [key, observedWeight ? Number((weighted / observedWeight).toFixed(4)) : null];
  }));
  const latest = ordered.at(-1);
  const daysSinceLastEvidence = latest ? Math.max(0, (asOf.getTime() - Date.parse(latest.occurredAt)) / 86_400_000) : null;
  const retention = daysSinceLastEvidence === null ? 0 : retentionConfidence(daysSinceLastEvidence);
  const currentMastery = evidenceMastery * (0.7 + 0.3 * retention);
  const errorCounts = new Map();
  for (const event of ordered) for (const error of event.errors || []) {
    const current = errorCounts.get(error.id) || { id: error.id, description: error.description, count: 0, firstSeen: event.occurredAt, lastSeen: event.occurredAt };
    current.count += 1;
    current.lastSeen = event.occurredAt;
    if (!current.description && error.description) current.description = error.description;
    errorCounts.set(error.id, current);
  }
  const errorPatterns = [...errorCounts.values()].sort((a, b) => b.count - a.count);
  const recurringErrors = errorPatterns.filter((error) => error.count >= 2);
  const independentStrong = ordered.filter((event) => event.performance?.hintLevel != null && Number(event.performance.hintLevel) <= 1 && scoreEvent(event) >= 0.72);
  const transferStrong = ordered.filter((event) => event.performance?.transfer != null && Number(event.performance.transfer) >= 3
    && event.performance?.hintLevel != null && Number(event.performance.hintLevel) <= 1);
  const scoreSpread = recent.length >= 2 ? Math.max(...recent.map(scoreEvent)) - Math.min(...recent.map(scoreEvent)) : 0;
  let state = 'introduced';
  if (ordered.length && !recent.length) state = 'introduced';
  if (currentMastery >= 0.84 && independentStrong.length >= 2 && transferStrong.length >= 1) state = 'mastered';
  else if (currentMastery >= 0.72) state = 'mostly_mastered';
  else if (currentMastery >= 0.52) state = 'practiced';
  else if (currentMastery >= 0.28) state = 'developing';
  if (scoreSpread >= 0.5 && recent.length >= 3) state = 'unstable';
  if (retention < 0.55 && recent.length) state = 'needs_review';
  const completeness = recent.length ? recent.reduce((sum, event) => sum + SCORE_KEYS.filter((key) => event.performance?.[key] != null).length / SCORE_KEYS.length, 0) / recent.length : 0;
  const confidence = Math.max(0, Math.min(1, (1 - Math.exp(-ordered.length / 3)) * completeness * (0.7 + 0.3 * retention)));
  const reviewPriority = retention < 0.55 || recurringErrors.length >= 2 ? 'high'
    : retention < 0.8 || recurringErrors.length ? 'medium' : 'low';
  const reviewDelayDays = state === 'mastered' ? 30 : state === 'mostly_mastered' ? 21
    : state === 'practiced' ? 14 : state === 'needs_review' || state === 'unstable' ? 0 : 7;
  const recommendedReviewAt = latest
    ? new Date(Math.max(asOf.getTime(), Date.parse(latest.occurredAt) + reviewDelayDays * 86_400_000)).toISOString()
    : '';
  return {
    schema: KNOWLEDGE_STATE_SCHEMA,
    studentId: String(studentId),
    knowledgePoint,
    state,
    scores: {
      ...dimensionScores,
      masteryEvidence: recent.length ? Number(evidenceMastery.toFixed(4)) : null,
      currentMastery: recent.length ? Number(currentMastery.toFixed(4)) : null,
      retentionConfidence: Number(retention.toFixed(4)),
    },
    confidence: Number(confidence.toFixed(4)),
    evidenceCount: ordered.length,
    independentStrongEvidenceCount: independentStrong.length,
    transferEvidenceCount: transferStrong.length,
    lastPracticedAt: latest?.occurredAt || '',
    daysSinceLastEvidence: daysSinceLastEvidence === null ? null : Number(daysSinceLastEvidence.toFixed(2)),
    errorPatterns,
    recurringErrors,
    reviewPriority,
    recommendedReviewAt,
    reviewPlanStatus: 'recommendation_only',
    retentionNote: retention < 0.8 ? '距离最近证据时间较长，系统对当前仍保持该水平的置信度下降；这不等于已确认遗忘。' : '',
    updatedAt: asOf.toISOString(),
    engineVersion: 'deterministic-mastery.v1',
  };
}

function buildLearningReportCandidateContext(studentRootPath, input = {}) {
  const studentId = String(input.studentId || '').trim();
  const periodStart = String(input.periodStart || '');
  const periodEnd = String(input.periodEnd || '');
  const start = Date.parse(`${periodStart}T00:00:00+08:00`);
  const endExclusive = Date.parse(`${periodEnd}T00:00:00+08:00`) + 86_400_000;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)
    || !Number.isFinite(start) || !Number.isFinite(endExclusive) || periodStart > periodEnd) {
    return { schema: 'edu-manager.learning-report-candidate.v1', status: 'unavailable', code: 'period_invalid', points: [] };
  }
  const trajectory = queryLearningTrajectory(studentRootPath, { studentId });
  if (!trajectory.ok) return { schema: 'edu-manager.learning-report-candidate.v1', status: 'unavailable', code: trajectory.code, points: [] };
  const periodEvents = trajectory.events.filter((event) => {
    const occurredAt = Date.parse(event.occurredAt);
    return occurredAt >= start && occurredAt < endExclusive;
  });
  const pointIds = [...new Set(periodEvents.slice().reverse().map((event) => event.knowledgePoint.id))].slice(0, 8);
  return {
    schema: 'edu-manager.learning-report-candidate.v1',
    status: 'candidate_only',
    studentId,
    periodStart,
    periodEnd,
    points: pointIds.map((id) => {
      const state = trajectory.states.find((item) => item.knowledgePoint.id === id);
      const evidence = periodEvents.filter((event) => event.knowledgePoint.id === id).slice(-3);
      return {
        knowledgePoint: state.knowledgePoint,
        state: state.state,
        scores: state.scores,
        confidence: state.confidence,
        reviewPriority: state.reviewPriority,
        evidenceCount: state.evidenceCount,
        periodEvidence: evidence.map((event) => ({ eventId: event.eventId, occurredAt: event.occurredAt,
          hintLevel: event.performance?.hintLevel ?? null,
          evidenceRefs: (event.evidenceRefs || []).slice(0, 3).map((ref) => ({ sourceType: ref.sourceType, sourceId: ref.sourceId })) })),
      };
    }),
  };
}

function cachedKnowledgeStates(studentRootPath, studentId, groups, options = {}) {
  const previous = readJson(statesPath(studentRootPath), { states: [] });
  const cache = new Map((previous.studentId === String(studentId) ? previous.states || [] : []).map(state => [state.knowledgePoint.id, state]));
  const asOf = Number.isFinite(Date.parse(options.asOf || '')) ? options.asOf : new Date().toISOString();
  // Event versions and the evaluation day invalidate derived state. Only changed
  // points are recomputed on writes; daily reads retain time-decay semantics.
  return [...groups.values()].map(events => {
    const version = crypto.createHash('sha256').update(JSON.stringify(events)).digest('hex');
    const old = cache.get(events[0].knowledgePoint.id);
    if (old?.projectionVersion === 2 && old.inputVersion === version && old.updatedAt.slice(0, 10) === asOf.slice(0, 10) && !options.asOf) return old;
    return { ...computeKnowledgeState(studentId, events[0].knowledgePoint, events, { ...options, asOf }), inputVersion: version, projectionVersion: 2 };
  });
}
function rebuildDerived(studentRootPath, studentId, allEvents, options = {}) {
  allEvents = effectiveLearningEvents(allEvents);
  const byKnowledgePoint = new Map();
  for (const event of allEvents.filter((item) => String(item.studentId) === String(studentId))) {
    const id = String(event.knowledgePoint?.id || '');
    if (id) (byKnowledgePoint.get(id) || byKnowledgePoint.set(id, []).get(id)).push(event);
  }
  const states = cachedKnowledgeStates(studentRootPath, studentId, byKnowledgePoint, options);
  const misconceptions = states.flatMap((state) => state.errorPatterns.map((error) => ({
    misconceptionId: `${state.knowledgePoint.id}.${error.id}`,
    studentId: String(studentId),
    knowledgePointId: state.knowledgePoint.id,
    errorId: error.id,
    description: error.description,
    occurrences: error.count,
    firstSeen: error.firstSeen,
    lastSeen: error.lastSeen,
    status: error.count >= 2 ? 'recurring' : 'unverified',
  })));
  atomicWriteJson(statesPath(studentRootPath), { schema: KNOWLEDGE_STATE_SCHEMA, studentId: String(studentId), states, updatedAt: new Date().toISOString() });
  atomicWriteJson(misconceptionsPath(studentRootPath), { schema: MISCONCEPTION_SCHEMA, studentId: String(studentId), misconceptions, updatedAt: new Date().toISOString() });
  const reportFile = historyCandidatePath(studentRootPath);
  const temporary = `${reportFile}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, buildHistoryCandidate(studentId, states, allEvents), 'utf8');
    fs.renameSync(temporary, reportFile);
  } finally { try { fs.rmSync(temporary, { force: true }); } catch {} }
  return { states, misconceptions };
}

function appendLearningEvents(studentRootPath, input = {}) {
  const studentId = String(input.studentId || '').trim();
  if (!studentRootPath || !studentId) return { ok: false, code: 'scope_missing', accepted: 0, rejected: [] };
  const taxonomy = loadTaxonomy();
  const rawEvents = Array.isArray(input.events) ? input.events : [];
  const normalized = rawEvents.map((event) => normalizeLearningEvent(event, { ...input, studentId, taxonomy }));
  const accepted = normalized.filter((result) => result.ok).map((result) => result.event);
  const rejected = normalized.flatMap((result, index) => result.ok ? [] : [{ index, code: result.code }]);
  const current = readEventLedger(studentRootPath, studentId);
  if (!current.ok) return { ok: false, code: current.code, accepted: 0, rejected, message: '学习事件账本异常，已停止写入，避免覆盖旧记录。' };
  const byId = new Map((current.events || []).filter((event) => String(event.studentId) === studentId).map((event) => [String(event.eventId), event]));
  let newlyAccepted = 0;
  for (const event of accepted) {
    const existing = byId.get(event.eventId);
    if (existing) {
      const sameActivityTime = existing.activityOccurredAtKnown === false && event.activityOccurredAtKnown === false
        ? true
        : existing.occurredAt === event.occurredAt;
      const sameOrigin = existing.studentId === event.studentId
        && existing.knowledgePoint?.id === event.knowledgePoint.id
        && sameActivityTime
        && String(existing.activityType || '') === String(event.activityType || '')
        && JSON.stringify(existing.evidenceRefs) === JSON.stringify(event.evidenceRefs)
        && JSON.stringify(existing.performance) === JSON.stringify(event.performance)
        && JSON.stringify(existing.practiceReview) === JSON.stringify(event.practiceReview)
        && existing.outcome === event.outcome
        && JSON.stringify(existing.errors) === JSON.stringify(event.errors);
      if (!sameOrigin) {
        rejected.push({ index: rawEvents.findIndex((item) => String(item?.eventId || item?.event_id || item?.idempotencyKey || item?.idempotency_key) === event.eventId), code: 'event_id_conflict' });
        continue;
      }
      continue;
    }
    byId.set(event.eventId, event);
    newlyAccepted += 1;
  }
  const events = [...byId.values()].sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt));
  atomicWriteJson(eventsPath(studentRootPath), { schema: LEARNING_EVENT_SCHEMA, studentId, events, updatedAt: new Date().toISOString() });
  const firstSeenProjection = syncFirstSeenProjection(studentRootPath, studentId, events);
  if (rejected.length) {
    const currentRejections = readJson(rejectionsPath(studentRootPath), { records: [] });
    const records = [...(Array.isArray(currentRejections.records) ? currentRejections.records : []),
      ...rejected.map((item) => ({ at: new Date().toISOString(), code: item.code, index: item.index,
        batchId: String(input.batchId || input.sessionId || '').slice(0, 160) }))].slice(-100);
    atomicWriteJson(rejectionsPath(studentRootPath), { schema: 'edu-manager.learning-event-rejections.v1', studentId, records });
  }
  const derived = rebuildDerived(studentRootPath, studentId, events, input);
  return { ok: true, accepted: newlyAccepted, rejected, deduplicatedTotal: events.length, firstSeenProjection, ...derived };
}

function applyPracticeLearningReview(studentRootPath, studentId, { attempt, result, point }) {
  if (attempt.studentId !== studentId || (!result.qualityPassed && result.source !== 'human') || !attempt.reviewRef) return { ok: false, message: '评阅归属或质量不符合学习事件写入条件' };
  const current = readEventLedger(studentRootPath, studentId);
  if (!current.ok) return current;
  const eventId = `card-${crypto.createHash('sha256').update(`${studentId}:${attempt.rootAttemptId}:${attempt.reviewRef}`).digest('hex')}`;
  if (current.events.some(event => event.eventId === eventId)) return { ok: true, duplicate: true };
  const backup = path.join(analyticsDir(studentRootPath), 'before-learning-cards-0.20.1');
  fs.mkdirSync(backup, { recursive: true });
  if (fs.lstatSync(backup).isSymbolicLink()) return {ok:false,message:'学习事件备份目录不能使用链接'};
  if (!fs.existsSync(path.join(backup,'manifest.json'))) {
    const copied=[];
    for(const source of [eventsPath(studentRootPath),statesPath(studentRootPath),misconceptionsPath(studentRootPath),historyCandidatePath(studentRootPath)]) {
      if(!fs.existsSync(source))continue;
      if(fs.lstatSync(source).isSymbolicLink())return {ok:false,message:'学习事件文件不能使用链接'};
      try{fs.copyFileSync(source,path.join(backup,path.basename(source)),fs.constants.COPYFILE_EXCL);}catch(error){if(error.code!=='EEXIST')throw error;}
      copied.push(path.basename(source));
    }
    atomicWriteJson(path.join(backup,'manifest.json'),{studentId,createdAt:new Date().toISOString(),files:copied});
  }
  const sequence = Math.max(0, ...current.events.filter(event => event.practiceReview?.episodeId === attempt.rootAttemptId).map(event => event.practiceReview.sequence || 0)) + 1;
  const outcome = result.judgement;
  const event = { eventId, studentId, knowledgePoint: point, subject: point.subject, occurredAt: attempt.submittedAt,
    taskId: attempt.rootAttemptId, taskType: 'learning_card', performance: {}, outcome,
    practiceReview: { episodeId: attempt.rootAttemptId, resultRef: attempt.reviewRef, attemptId: attempt.attemptId, source: result.source, sequence, assistance: attempt.assistance },
    evidenceRefs: [{ sourceType: 'practice_attempt', sourceId: attempt.attemptId }],
    recommendedNextStep: result.suggestions.join('\n'), evidence: result.summary };
  const receipt = appendLearningEvents(studentRootPath, { studentId, events: [event], allowPracticeReview: true });
  return { ...receipt, ok: receipt.ok && receipt.rejected.length === 0 };
}

function removeLearningEventsBySource(studentRootPath, input = {}) {
  const studentId = String(input.studentId || '').trim();
  if (!studentRootPath || !studentId) return { ok: false, code: 'scope_missing', removed: 0 };
  const current = readEventLedger(studentRootPath, studentId);
  if (!current.ok) return { ok: false, code: current.code, removed: 0 };
  const before = (current.events || []).filter((event) => String(event.studentId) === studentId);
  const retained = before.filter((event) => {
    if (input.sessionId && String(event.sourceSessionId || '') === String(input.sessionId)) return false;
    if (input.segmentId && String(event.sourceSegmentId || '') === String(input.segmentId)) return false;
    if (input.sourceType && input.sourceId && (event.evidenceRefs || []).some((ref) => String(ref.sourceType) === String(input.sourceType) && String(ref.sourceId) === String(input.sourceId))) return false;
    return true;
  });
  atomicWriteJson(eventsPath(studentRootPath), { schema: LEARNING_EVENT_SCHEMA, studentId, events: retained, updatedAt: new Date().toISOString() });
  const firstSeenProjection = syncFirstSeenProjection(studentRootPath, studentId, retained);
  const derived = rebuildDerived(studentRootPath, studentId, retained, input);
  return { ok: true, removed: before.length - retained.length, firstSeenProjection, ...derived };
}

function queryLearningTrajectory(studentRootPath, input = {}) {
  const studentId = String(input.studentId || '').trim();
  if (!studentRootPath || !studentId) return { ok: false, code: 'scope_missing', events: [], states: [] };
  const taxonomy = loadTaxonomy();
  const point = input.knowledgePointId || input.knowledgePoint
    ? canonicalKnowledgePoint({ id: input.knowledgePointId, label: input.knowledgePoint, subject: input.subject }, taxonomy) : null;
  if ((input.knowledgePointId || input.knowledgePoint) && !point) return { ok: false, code: 'knowledge_point_unmapped', events: [], states: [] };
  const document = readEventLedger(studentRootPath, studentId);
  if (!document.ok) return { ok: false, code: document.code, events: [], states: [], misconceptions: [], message: '学习事件账本异常，未返回可能不完整的轨迹。' };
  let events = effectiveLearningEvents((document.events || []).filter((event) => String(event.studentId) === studentId));
  if (input.subject) events = events.filter((event) => String(event.subject).toLocaleLowerCase('zh-CN') === String(input.subject).toLocaleLowerCase('zh-CN'));
  if (point) events = events.filter((event) => String(event.knowledgePoint?.id) === point.id);
  if (input.from) events = events.filter((event) => Date.parse(event.occurredAt) >= Date.parse(input.from));
  if (input.to) events = events.filter((event) => Date.parse(event.occurredAt) <= Date.parse(input.to));
  events.sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt));
  const allEvents = effectiveLearningEvents((document.events || []).filter((event) => String(event.studentId) === studentId));
  const pointEvents = new Map();
  for (const event of allEvents) {
    const id = String(event.knowledgePoint?.id || '');
    if (id && (!point || point.id === id)) (pointEvents.get(id) || pointEvents.set(id, []).get(id)).push(event);
  }
  const states = cachedKnowledgeStates(studentRootPath, studentId, pointEvents, { asOf: input.asOf });
  const misconceptions = states.flatMap((state) => state.errorPatterns.map((error) => ({
    misconceptionId: `${state.knowledgePoint.id}.${error.id}`, studentId,
    knowledgePointId: state.knowledgePoint.id, errorId: error.id, description: error.description,
    occurrences: error.count, firstSeen: error.firstSeen, lastSeen: error.lastSeen,
    status: error.count >= 2 ? 'recurring' : 'unverified',
  })));
  events = effectiveLearningEvents(events);
  return { ok: true, studentId, order: 'occurredAt ASC', events, states, misconceptions,
    rejections: readJson(rejectionsPath(studentRootPath), { records: [] }).records || [],
    historyCandidatePath: historyCandidatePath(studentRootPath),
    historyMarkdown: buildHistoryCandidate(studentId, states, allEvents), taxonomyVersion: taxonomy.version };
}

function knowledgeActivityType(event = {}) {
  const explicit = String(event.activityType || '');
  if (explicit) return explicit;
  const type = String(event.taskType || '').toLocaleLowerCase('zh-CN');
  if (/correct|订正/.test(type)) return 'correction';
  if (/review|复习/.test(type)) return 'review';
  if (/exam|assessment|quiz|test|测验|成果/.test(type)) return 'assessment';
  if (/project|项目/.test(type)) return 'project_application';
  if (/practice|card|exercise|练习|作业/.test(type)) return 'practice';
  return 'material_exposure';
}

function knowledgeActivityProjection(studentRootPath, input = {}) {
  const trajectory = queryLearningTrajectory(studentRootPath, input);
  if (!trajectory.ok) return trajectory;
  const rangeDays = Math.max(1, Math.min(366, Number(input.rangeDays || input.range || 7)));
  const asOfMs = Number.isFinite(Date.parse(input.asOf || '')) ? Date.parse(input.asOf) : Date.now();
  const fromMs = asOfMs - rangeDays * 86_400_000;
  const allowedTypes = new Set((Array.isArray(input.activityTypes) ? input.activityTypes : []).map(String));
  const events = trajectory.events.filter((event) => event.activityOccurredAtKnown !== false
    && Number.isFinite(Date.parse(event.occurredAt))
    && Date.parse(event.occurredAt) >= fromMs && Date.parse(event.occurredAt) <= asOfMs
    && (!allowedTypes.size || allowedTypes.has(knowledgeActivityType(event))));
  const days = new Map();
  for (const event of events) {
    const day = new Date(event.occurredAt).toISOString().slice(0, 10);
    const current = days.get(day) || { date: day, total: 0, materialExposure: 0, studentActivity: 0, types: {} };
    const type = knowledgeActivityType(event);
    current.total += 1;
    current.types[type] = Number(current.types[type] || 0) + 1;
    if (type === 'material_exposure') current.materialExposure += 1;
    else current.studentActivity += 1;
    days.set(day, current);
  }
  const byPoint = new Map();
  for (const event of events) {
    const id = String(event.knowledgePoint?.id || '');
    if (!id) continue;
    const current = byPoint.get(id) || { knowledgePoint: event.knowledgePoint, activityCount: 0, activeDays: new Set(), materialExposureCount: 0, studentActivityCount: 0 };
    const type = knowledgeActivityType(event);
    current.activityCount += 1;
    current.activeDays.add(new Date(event.occurredAt).toISOString().slice(0, 10));
    if (type === 'material_exposure') current.materialExposureCount += 1;
    else current.studentActivityCount += 1;
    byPoint.set(id, current);
  }
  return {
    ok: true,
    studentId: trajectory.studentId,
    rangeDays,
    activityCount: events.length,
    activeDays: new Set(events.map((event) => new Date(event.occurredAt).toISOString().slice(0, 10))).size,
    materialExposureCount: events.filter((event) => knowledgeActivityType(event) === 'material_exposure').length,
    studentActivityCount: events.filter((event) => knowledgeActivityType(event) !== 'material_exposure').length,
    trend: [...days.values()].sort((left, right) => left.date.localeCompare(right.date)),
    points: [...byPoint.values()].map((item) => ({ ...item, activeDays: item.activeDays.size }))
      .sort((left, right) => right.activityCount - left.activityCount || String(left.knowledgePoint.label).localeCompare(String(right.knowledgePoint.label), 'zh-CN')),
  };
}

function listStudentKnowledgePoints(studentRootPath, input = {}) {
  const trajectory = queryLearningTrajectory(studentRootPath, input);
  if (!trajectory.ok) return trajectory;
  const activity = knowledgeActivityProjection(studentRootPath, { ...input, rangeDays: input.rangeDays || 7 });
  const activityById = new Map((activity.points || []).map((item) => [item.knowledgePoint.id, item]));
  const keyword = String(input.keyword || '').trim().toLocaleLowerCase('zh-CN');
  const limit = Math.max(1, Math.min(100, Number(input.limit || 50)));
  const offset = Math.max(0, Number(input.offset || 0));
  const all = trajectory.states.map((state) => ({ ...state, activity: activityById.get(state.knowledgePoint.id) || {
    activityCount: 0, activeDays: 0, materialExposureCount: 0, studentActivityCount: 0,
  } })).filter((state) => !keyword || `${state.knowledgePoint.label} ${state.knowledgePoint.id} ${state.knowledgePoint.subject}`.toLocaleLowerCase('zh-CN').includes(keyword));
  return { ok: true, studentId: trajectory.studentId, total: all.length, items: all.slice(offset, offset + limit), nextOffset: offset + limit < all.length ? offset + limit : null };
}

function rebuildKnowledgeProjection(studentRootPath, input = {}) {
  const studentId = String(input.studentId || '').trim();
  const current = readEventLedger(studentRootPath, studentId);
  if (!current.ok) return { ok: false, code: current.code, studentId };
  const total = current.events.length;
  const cursor = Math.max(0, Math.min(total, Number(input.cursor || 0)));
  const processed = Math.min(total, cursor + Math.max(1, Math.min(250, Number(input.limit || 250))));
  if (processed < total) return { ok: true, studentId, processed, total, nextCursor: processed, complete: false };
  const firstSeenProjection = syncFirstSeenProjection(studentRootPath, studentId, current.events);
  const derived = rebuildDerived(studentRootPath, studentId, current.events, input);
  return { ok: true, studentId, processed: total, total, nextCursor: null, complete: true,
    firstSeenProjection, knowledgePointCount: derived.states.length, misconceptionCount: derived.misconceptions.length };
}

function buildLearningConsultContext(studentRootPath, input = {}) {
  const question = String(input.question || '').trim();
  const taxonomy = loadTaxonomy();
  const matched = taxonomy.points.filter((point) => [point.label, ...(point.aliases || [])]
    .some((alias) => String(alias).length >= 2 && question.toLocaleLowerCase('zh-CN').includes(String(alias).toLocaleLowerCase('zh-CN'))));
  const result = queryLearningTrajectory(studentRootPath, { studentId: input.studentId });
  if (!result.ok || !result.events.length) return '';
  const selected = matched.length ? result.states.filter((state) => matched.some((point) => point.id === state.knowledgePoint.id))
    : /薄弱|复习|变化|进步|掌握|知识点/.test(question) ? result.states.filter((state) => state.reviewPriority !== 'low') : [];
  if (!selected.length) return '';
  const lines = ['当前学生的本机纵向学习候选上下文（仅供咨询核对，不能单独作为正式报告）：'];
  for (const state of selected.slice(0, 4)) {
    const evidence = result.events.filter((event) => event.knowledgePoint?.id === state.knowledgePoint.id).slice(-4);
    lines.push(`${state.knowledgePoint.label} [${state.knowledgePoint.id}]：${state.state}，证据 ${state.evidenceCount} 条，置信度 ${state.confidence}，复测优先级 ${state.reviewPriority}。`);
    for (const event of evidence) lines.push(`- ${event.occurredAt}；提示 ${event.performance?.hintLevel ?? '未知'}；表现 ${JSON.stringify(event.performance)}；来源 ${(event.evidenceRefs || []).map((ref) => `${ref.sourceType}:${ref.sourceId}`).join('、')}`);
  }
  lines.push('请按时间比较，回查来源；缺失分数与提示均视为未知。保持度下降只是复测建议，不可断言遗忘。');
  return lines.join('\n').slice(0, 6000);
}

function collectLearningEvents(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 6) return [];
  if (Array.isArray(value)) return value.flatMap((item) => collectLearningEvents(item, depth + 1));
  const direct = Array.isArray(value.learningEvents) ? value.learningEvents
    : Array.isArray(value.learning_events) ? value.learning_events : [];
  return [...direct, ...Object.entries(value).filter(([key]) => !['learningEvents', 'learning_events'].includes(key))
    .flatMap(([, item]) => collectLearningEvents(item, depth + 1))];
}

module.exports = {
  effectiveLearningEvents,
  applyPracticeLearningReview,
  KNOWLEDGE_STATE_SCHEMA,
  LEARNING_EVENT_SCHEMA,
  MISCONCEPTION_SCHEMA,
  analyticsDir,
  appendLearningEvents,
  buildLearningReportCandidateContext,
  buildLearningConsultContext,
  buildHistoryCandidate,
  canonicalKnowledgePoint,
  collectLearningEvents,
  computeKnowledgeState,
  eventsPath,
  rejectionsPath,
  historyCandidatePath,
  knowledgeActivityProjection,
  knowledgeActivityType,
  listStudentKnowledgePoints,
  loadTaxonomy,
  misconceptionsPath,
  normalizeLearningEvent,
  queryLearningTrajectory,
  rebuildKnowledgeProjection,
  removeLearningEventsBySource,
  retentionConfidence,
  scoreEvent,
  statesPath,
};
