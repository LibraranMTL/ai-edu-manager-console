'use strict';

const crypto = require('node:crypto');

function text(value) { return String(value ?? '').trim(); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}
function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
function isoDateInTimezone(value, timezone) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw Object.assign(new Error('报告截止时间无效。'), { code: 'as_of_invalid' });
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}
function monday(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  const weekday = value.getUTCDay();
  value.setUTCDate(value.getUTCDate() + (weekday === 0 ? -6 : 1 - weekday));
  return value.toISOString().slice(0, 10);
}

function reportCycleKey(reportType, asOf, timezone = 'Asia/Shanghai') {
  const dateKey = isoDateInTimezone(asOf, timezone);
  const type = text(reportType);
  if (type === 'weekly_action' || type === 'learning_changes') return `${type}:${monday(dateKey)}`;
  return `${type}:${dateKey.slice(0, 7)}`;
}

function evidenceLabels(state) {
  const counts = { student_self_report: 0, external_observation: 0, system_observation: 0, system_inference: 0 };
  for (const item of [...(state.checkIns || []), ...(state.evidence || []), ...(state.findings || [])]) {
    const key = text(item.sourceCategory);
    if (Object.prototype.hasOwnProperty.call(counts, key)) counts[key] += 1;
  }
  return counts;
}

function recentDimensionHistory(state) {
  return (state.checkIns || []).slice(0, 12).map((item) => ({
    occurredAt: item.occurredAt,
    kind: item.kind,
    sourceCategory: item.sourceCategory,
    dimensions: item.dimensions,
  }));
}

function buildFiveDimensionSnapshot(state, options = {}) {
  const studentId = text(state?.studentId);
  if (!studentId) throw Object.assign(new Error('五维画像缺少学生范围。'), { code: 'student_scope_missing' });
  const asOf = text(options.asOf || state.asOf);
  const cycleKey = text(options.cycleKey);
  if (!cycleKey) throw Object.assign(new Error('五维画像缺少报告周期。'), { code: 'report_cycle_missing' });
  const latestSelfReport = (state.checkIns || []).find((item) => item.sourceCategory === 'student_self_report') || null;
  const activeGoals = (state.goals || []).filter((item) => !['completed', 'withdrawn', 'cancelled'].includes(text(item.status)));
  const activeProblems = (state.problems || []).filter((item) => !['resolved', 'withdrawn', 'cancelled'].includes(text(item.status)));
  const methods = (state.methods || []).map((item) => ({
    experimentId: item.experimentId,
    title: item.title,
    status: item.status,
    sourceCategory: item.analysis?.status === 'student_reported' ? 'student_self_report' : 'system_inference',
    conclusionStatus: item.analysis?.status || 'pending',
    definitive: item.analysis?.definitive === true,
    statement: item.analysis?.statement || '',
  }));
  const dimensions = {
    goals: {
      status: activeGoals.length ? 'observed' : 'insufficient_evidence',
      items: activeGoals.map((item) => ({ goalId: item.goalId, title: item.title, successCriteria: item.successCriteria, dueAt: item.dueAt, status: item.status })),
      selfReport: latestSelfReport ? { goalClarity: latestSelfReport.dimensions?.goalClarity ?? null } : null,
    },
    mindset: {
      status: latestSelfReport ? 'self_reported' : 'insufficient_evidence',
      selfReport: latestSelfReport ? {
        confidence: latestSelfReport.dimensions?.confidence ?? null,
        recovery: latestSelfReport.dimensions?.recovery ?? null,
        workload: latestSelfReport.dimensions?.workload ?? null,
      } : null,
      privateNote: latestSelfReport?.note || '',
    },
    problems: {
      status: activeProblems.length ? 'observed' : 'insufficient_evidence',
      items: activeProblems.map((item) => ({ problemId: item.problemId, title: item.title, description: item.description, status: item.status })),
    },
    methods: { status: methods.length ? 'observed' : 'insufficient_evidence', items: methods },
    efficiency: { status: 'descriptive_only', metrics: state.efficiency || {}, noCompositeScore: true },
  };
  const nextActions = (state.actions || []).filter((item) => !['completed', 'cancelled'].includes(text(item.status))).map((item) => ({
    actionKey: item.actionKey, title: item.title, actionType: item.actionType, status: item.status, retestWindow: item.retestWindow,
  }));
  const base = {
    schema: 'edu-manager.learning-report-snapshot.v2',
    studentId, cycleKey, asOf,
    policyVersion: 'learning-state-3-v2',
    authorizationVersion: text(state.authorizationVersion),
    generation: Number(state.generation || 0),
    summary: {
      activeGoalCount: activeGoals.length,
      activeProblemCount: activeProblems.length,
      pendingActionCount: nextActions.length,
      evidenceLabels: evidenceLabels(state),
    },
    dimensions,
    nextActions,
    history: recentDimensionHistory(state),
    evidenceSummary: {
      labels: evidenceLabels(state),
      findings: (state.findings || []).map((item) => ({ findingId: item.findingId, statement: item.statement, status: item.status, confidence: item.confidence, sourceCategory: item.sourceCategory })),
    },
    governance: {
      inputEvidenceIds: (state.evidence || []).map((item) => item.evidenceId),
      actionBindingsIncluded: (state.actions || []).filter((item) => item.binding).length,
      correctionsApplied: true,
    },
    boundaries: {
      noCompositeScore: true,
      noDiagnosisOrRanking: true,
      backgroundSignalsAreContextOnly: true,
      insufficientEvidenceRemainsUnknown: true,
    },
  };
  const { asOf: _asOf, ...stableInput } = base;
  return { ...base, inputFingerprint: fingerprint(stableInput) };
}

module.exports = {
  buildFiveDimensionSnapshot,
  reportCycleKey,
};
