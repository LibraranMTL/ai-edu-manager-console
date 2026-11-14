'use strict';

const crypto = require('node:crypto');
const { stableActionKey } = require('./learning-state-store.cjs');

const ANALYSIS_POLICY = Object.freeze({
  version: 'learning-problem-rules-v1',
  windowDays: 14,
  independentRootThreshold: 2,
  negativeOutcomes: Object.freeze(['partial', 'needs_correction']),
});

function text(value) { return String(value ?? '').trim(); }

function reliableTime(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function localDateKey(value, timezone = 'Asia/Shanghai') {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function retestWindow(asOf, timezone = 'Asia/Shanghai') {
  const start = localDateKey(asOf, timezone);
  return `${start}/${addDays(start, 6)}`;
}

function analysisGroup(event) {
  const pointId = text(event?.knowledgePoint?.id).toUpperCase();
  if (!pointId) return null;
  const errorKey = text(event?.misconceptionId || event?.errorId || event?.practiceReview?.errorId) || 'general';
  return { key: `${pointId}\n${errorKey}`, pointId, errorKey };
}

function rootIdentity(event) {
  return text(event?.practiceReview?.episodeId || event?.rootAttemptId || event?.taskId);
}

function laterEvent(left, right) {
  const leftSequence = Number(left?.practiceReview?.sequence || left?.revision || 0);
  const rightSequence = Number(right?.practiceReview?.sequence || right?.revision || 0);
  if (leftSequence !== rightSequence) return leftSequence > rightSequence ? left : right;
  const leftTime = reliableTime(left?.occurredAt);
  const rightTime = reliableTime(right?.occurredAt);
  if (leftTime !== rightTime) return leftTime > rightTime ? left : right;
  return text(left?.eventId).localeCompare(text(right?.eventId)) >= 0 ? left : right;
}

function analyzeLearningProblemCandidates({ studentId, events = [], asOf = new Date().toISOString(), policy = ANALYSIS_POLICY, timezone = 'Asia/Shanghai' } = {}) {
  studentId = text(studentId);
  if (!studentId || studentId === 'all') throw Object.assign(new Error('单学生范围缺失。'), { code: 'student_scope_missing' });
  const asOfMs = reliableTime(asOf);
  if (!Number.isFinite(asOfMs)) throw Object.assign(new Error('分析截止时间无效。'), { code: 'as_of_invalid' });
  const windowStart = asOfMs - Math.max(1, Number(policy.windowDays || 14)) * 86_400_000;
  const latestByRoot = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    if (text(event?.studentId) !== studentId) continue;
    const group = analysisGroup(event);
    const root = rootIdentity(event);
    const occurredAt = reliableTime(event?.occurredAt);
    if (!group || !root || !Number.isFinite(occurredAt) || occurredAt < windowStart || occurredAt > asOfMs) continue;
    const key = `${group.key}\n${root}`;
    latestByRoot.set(key, latestByRoot.has(key) ? laterEvent(latestByRoot.get(key), event) : event);
  }

  const grouped = new Map();
  for (const event of latestByRoot.values()) {
    const group = analysisGroup(event);
    const negative = policy.negativeOutcomes.includes(text(event.outcome));
    const explicitRetest = event.retestRequired === true || event.practiceReview?.retestRequired === true;
    if (!negative && !explicitRetest) continue;
    if (!grouped.has(group.key)) grouped.set(group.key, { ...group, events: [], explicitRetest: false });
    const target = grouped.get(group.key);
    target.events.push(event);
    target.explicitRetest ||= explicitRetest;
  }

  return [...grouped.values()].map((group) => {
    group.events.sort((left, right) => reliableTime(left.occurredAt) - reliableTime(right.occurredAt) || text(left.eventId).localeCompare(text(right.eventId)));
    const latest = group.events.at(-1);
    const count = group.events.length;
    const status = group.explicitRetest || count >= Number(policy.independentRootThreshold || 2) ? 'action_required' : 'watching';
    const problemId = `problem-analysis-${crypto.createHash('sha256').update(`${studentId}\n${group.key}`).digest('hex').slice(0, 24)}`;
    return {
      studentId, problemId, category: 'knowledge', status,
      title: `${text(latest.knowledgePoint?.label) || group.pointId}需要继续复测`,
      description: status === 'action_required'
        ? `最近 ${policy.windowDays} 天出现 ${count} 个独立作答根的有效观察，安排一次专项复测。`
        : '当前只有一次有效观察，先保留为待观察问题。',
      knowledgePointId: group.pointId, errorKey: group.errorKey,
      subject: text(latest.knowledgePoint?.subject || latest.subject),
      independentRootCount: count, evidenceIds: group.events.map((event) => text(event.eventId)),
      explicitRetest: group.explicitRetest, retestWindow: retestWindow(asOf, timezone),
      lastObservedAt: new Date(Math.max(...group.events.map((event) => reliableTime(event.occurredAt)))).toISOString(),
      analysisPolicyVersion: policy.version, automaticallyDerived: true,
    };
  }).sort((left, right) => left.problemId.localeCompare(right.problemId));
}

function problemPayload(candidate) {
  return Object.fromEntries(['analysisPolicyVersion', 'automaticallyDerived', 'knowledgePointId', 'errorKey', 'subject',
    'independentRootCount', 'evidenceIds', 'explicitRetest', 'retestWindow', 'lastObservedAt']
    .map((key) => [key, candidate[key]]));
}

function sameProblemProjection(current, candidate) {
  if (!current) return false;
  if (current.status !== candidate.status || current.title !== candidate.title || current.description !== candidate.description) return false;
  return JSON.stringify(problemPayload(current)) === JSON.stringify(problemPayload(candidate));
}

function createLearningStateAnalysisService({ store, dispatchAction, now = Date.now, policy = ANALYSIS_POLICY, timezone = 'Asia/Shanghai' } = {}) {
  if (!store) throw new Error('Learning state store is required');
  async function reconcile(scope, events, asOf = new Date(now()).toISOString()) {
    const studentId = text(scope?.studentId);
    const candidates = analyzeLearningProblemCandidates({ studentId, events, asOf, policy, timezone });
    let projection = store.getLearningState({ role: 'admin', studentId }, studentId, asOf);
    const currentById = new Map(projection.problems.map((problem) => [problem.problemId, problem]));
    const problems = [];
    const actions = [];
    for (const candidate of candidates) {
      let current = currentById.get(candidate.problemId);
      if (!current) {
        current = store.upsertProblem(scope, { ...candidate, ...problemPayload(candidate) }, 0);
      } else if (current.status === 'watching' && candidate.status === 'action_required') {
        current = store.upsertProblem(scope, { ...candidate, ...problemPayload(candidate) }, current.revision);
      } else if (current.status === 'watching' && candidate.status === 'watching' && !sameProblemProjection(current, candidate)) {
        current = store.upsertProblem(scope, { ...candidate, ...problemPayload(candidate) }, current.revision);
      }
      problems.push(current);
      if (current.status !== 'action_required') continue;
      const action = {
        studentId, subjectType: 'problem', subjectId: current.problemId, subjectRevision: current.revision,
        actionType: 'targeted_practice', retestWindow: text(current.retestWindow) || candidate.retestWindow,
        title: `${current.title} · 专项复测`,
        payload: { subject: text(current.subject) || candidate.subject || '自动', focus: current.title,
          knowledgePointId: text(current.knowledgePointId) || candidate.knowledgePointId,
          evidenceIds: Array.isArray(current.evidenceIds) ? current.evidenceIds : candidate.evidenceIds,
          analysisPolicyVersion: policy.version },
      };
      const actionKey = stableActionKey(action);
      projection = store.getLearningState({ role: 'admin', studentId }, studentId, asOf);
      const existing = projection.actions.find((item) => item.actionKey === actionKey);
      if (existing && ['dispatching', 'unknown', 'dispatched', 'completed'].includes(existing.binding?.status || existing.status)) {
        actions.push(existing); continue;
      }
      if (typeof dispatchAction === 'function') actions.push(await dispatchAction(scope, action));
    }
    return { studentId, asOf, policyVersion: policy.version, problems, actions };
  }
  return { reconcile };
}

function recordPracticeActionFeedback({ store, scope, attempt = {}, result = {} } = {}) {
  const actionKey = text(attempt.businessActionKey);
  if (!actionKey) return null;
  const intent = store.getActionIntent(scope, actionKey);
  if (text(attempt.studentId) !== text(scope?.studentId)) {
    throw Object.assign(new Error('作答与可信学生范围不一致。'), { code: 'student_scope_mismatch' });
  }
  const feedbackId = `practice:${text(attempt.attemptId)}:review:${Math.max(1, Number(attempt.reviewVersion || result.reviewVersion || 1))}`;
  const feedback = store.recordActionFeedback(scope, actionKey, {
    round: intent.currentRound, feedbackId, outcome: 'completed', occurredAt: attempt.submittedAt,
    payload: {
      sourceType: 'practice_attempt', sourceId: text(attempt.attemptId), rootAttemptId: text(attempt.rootAttemptId),
      judgement: text(result.judgement), summary: text(result.summary), reviewSource: text(result.source),
      qualityPassed: result.qualityPassed === true, masteryConclusion: null,
    },
  });
  const asOf = new Date(Math.max(Date.now(), reliableTime(attempt.submittedAt) || 0)).toISOString();
  const projection = store.getLearningState({ role: 'admin', studentId: text(scope?.studentId) }, text(scope?.studentId), asOf);
  const problem = intent.subjectType === 'problem' ? projection.problems.find((item) => item.problemId === intent.subjectId) : null;
  if (problem && problem.revision === intent.subjectRevision && problem.status === 'action_required') {
    store.upsertProblem(scope, {
      ...problem, status: 'awaiting_retest',
      description: `${problem.description || problem.title}；专项行动已完成，等待后续独立复测。`,
    }, problem.revision);
  }
  return feedback;
}

module.exports = {
  ANALYSIS_POLICY,
  analyzeLearningProblemCandidates,
  createLearningStateAnalysisService,
  recordPracticeActionFeedback,
  retestWindow,
};
