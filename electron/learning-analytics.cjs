const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

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
  const knowledgePoint = canonicalKnowledgePoint(input?.knowledgePoint || input?.knowledge_point || {
    id: input?.knowledgePointId || input?.knowledge_point_id,
    label: input?.knowledgePointLabel || input?.knowledge_point_label,
    subject: input?.subject,
  }, context.taxonomy);
  if (!knowledgePoint) return { ok: false, code: 'knowledge_point_unmapped' };
  const occurredAt = String(input?.occurredAt || input?.timestamp || input?.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(occurredAt)
    || !Number.isFinite(Date.parse(occurredAt))) return { ok: false, code: 'occurred_at_invalid' };
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
  if (SCORE_KEYS.every((key) => performance[key] === null)) return { ok: false, code: 'performance_missing' };
  const taskType = String(input?.taskType || input?.task_type || input?.task?.type || 'unknown').trim().slice(0, 80);
  const taskId = String(input?.taskId || input?.task_id || input?.task?.id || '').trim().slice(0, 160);
  const errors = normalizeErrors(input?.errors || input?.errorTypes || input?.error_types);
  const idempotencySeed = [studentId, knowledgePoint.id, new Date(occurredAt).toISOString(), taskId, taskType,
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
    taskDifficulty: boundedScore(input?.taskDifficulty ?? input?.task_difficulty ?? input?.task?.difficulty),
    performance,
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

function computeKnowledgeState(studentId, knowledgePoint, events, options = {}) {
  const ordered = [...events].sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt));
  const asOf = Number.isFinite(Date.parse(options.asOf || '')) ? new Date(options.asOf) : new Date();
  const recent = ordered.slice(-8);
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
  if (currentMastery >= 0.84 && independentStrong.length >= 2 && transferStrong.length >= 1) state = 'mastered';
  else if (currentMastery >= 0.72) state = 'mostly_mastered';
  else if (currentMastery >= 0.52) state = 'practiced';
  else if (currentMastery >= 0.28) state = 'developing';
  if (scoreSpread >= 0.5 && recent.length >= 3) state = 'unstable';
  if (retention < 0.55 && ordered.length) state = 'needs_review';
  const completeness = ordered.length ? recent.reduce((sum, event) => sum + SCORE_KEYS.filter((key) => event.performance?.[key] != null).length / SCORE_KEYS.length, 0) / recent.length : 0;
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
      masteryEvidence: Number(evidenceMastery.toFixed(4)),
      currentMastery: Number(currentMastery.toFixed(4)),
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

function rebuildDerived(studentRootPath, studentId, allEvents, options = {}) {
  const byKnowledgePoint = new Map();
  for (const event of allEvents.filter((item) => String(item.studentId) === String(studentId))) {
    const id = String(event.knowledgePoint?.id || '');
    if (id) (byKnowledgePoint.get(id) || byKnowledgePoint.set(id, []).get(id)).push(event);
  }
  const states = [...byKnowledgePoint.entries()].map(([, events]) => computeKnowledgeState(studentId, events[0].knowledgePoint, events, options));
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
      const sameOrigin = existing.studentId === event.studentId
        && existing.knowledgePoint?.id === event.knowledgePoint.id
        && existing.occurredAt === event.occurredAt
        && JSON.stringify(existing.evidenceRefs) === JSON.stringify(event.evidenceRefs)
        && JSON.stringify(existing.performance) === JSON.stringify(event.performance)
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
  if (rejected.length) {
    const currentRejections = readJson(rejectionsPath(studentRootPath), { records: [] });
    const records = [...(Array.isArray(currentRejections.records) ? currentRejections.records : []),
      ...rejected.map((item) => ({ at: new Date().toISOString(), code: item.code, index: item.index,
        batchId: String(input.batchId || input.sessionId || '').slice(0, 160) }))].slice(-100);
    atomicWriteJson(rejectionsPath(studentRootPath), { schema: 'edu-manager.learning-event-rejections.v1', studentId, records });
  }
  const derived = rebuildDerived(studentRootPath, studentId, events, input);
  return { ok: true, accepted: newlyAccepted, rejected, deduplicatedTotal: events.length, ...derived };
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
  const derived = rebuildDerived(studentRootPath, studentId, retained, input);
  return { ok: true, removed: before.length - retained.length, ...derived };
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
  let events = (document.events || []).filter((event) => String(event.studentId) === studentId);
  if (input.subject) events = events.filter((event) => String(event.subject).toLocaleLowerCase('zh-CN') === String(input.subject).toLocaleLowerCase('zh-CN'));
  if (point) events = events.filter((event) => String(event.knowledgePoint?.id) === point.id);
  if (input.from) events = events.filter((event) => Date.parse(event.occurredAt) >= Date.parse(input.from));
  if (input.to) events = events.filter((event) => Date.parse(event.occurredAt) <= Date.parse(input.to));
  events.sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt));
  const allEvents = (document.events || []).filter((event) => String(event.studentId) === studentId);
  const pointEvents = new Map();
  for (const event of allEvents) {
    const id = String(event.knowledgePoint?.id || '');
    if (id && (!point || point.id === id)) (pointEvents.get(id) || pointEvents.set(id, []).get(id)).push(event);
  }
  const states = [...pointEvents.values()].map((items) => computeKnowledgeState(studentId, items[0].knowledgePoint, items, { asOf: input.asOf }));
  const misconceptions = states.flatMap((state) => state.errorPatterns.map((error) => ({
    misconceptionId: `${state.knowledgePoint.id}.${error.id}`, studentId,
    knowledgePointId: state.knowledgePoint.id, errorId: error.id, description: error.description,
    occurrences: error.count, firstSeen: error.firstSeen, lastSeen: error.lastSeen,
    status: error.count >= 2 ? 'recurring' : 'unverified',
  })));
  return { ok: true, studentId, order: 'occurredAt ASC', events, states, misconceptions,
    rejections: readJson(rejectionsPath(studentRootPath), { records: [] }).records || [],
    historyCandidatePath: historyCandidatePath(studentRootPath),
    historyMarkdown: buildHistoryCandidate(studentId, states, allEvents), taxonomyVersion: taxonomy.version };
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
  loadTaxonomy,
  misconceptionsPath,
  normalizeLearningEvent,
  queryLearningTrajectory,
  removeLearningEventsBySource,
  retentionConfidence,
  scoreEvent,
  statesPath,
};
