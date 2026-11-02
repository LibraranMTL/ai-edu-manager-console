'use strict';

const crypto = require('node:crypto');
const { stableActionKey } = require('./learning-state-store.cjs');
const { retestWindow } = require('./learning-state-analysis.cjs');

const METHOD_POLICY_VERSION = 'learning-methods-v1';

function text(value) { return String(value ?? '').trim(); }
function comparableValue(left, right) {
  const normalized = text(left).toLocaleLowerCase('en-US');
  return normalized && !['unknown', 'unset', 'unrecorded'].includes(normalized) && normalized === text(right).toLocaleLowerCase('en-US');
}

function taskMatchesConditions(signal, conditions = {}) {
  return (!text(conditions.subject) || text(signal.subject) === text(conditions.subject))
    && (!text(conditions.taskType) || text(signal.taskType) === text(conditions.taskType))
    && (!text(conditions.targetKey) || text(signal.targetKey) === text(conditions.targetKey));
}

function analyzeMethodExperiment(experiment = {}, signals = []) {
  const studentReportedHelpful = experiment.studentReport?.helpful === true;
  const studentReported = studentReportedHelpful || Boolean(text(experiment.studentReport?.note));
  const studentReportStatement = studentReportedHelpful ? '学生认为该方法有帮助' : '学生已提供方法使用自述';
  const eligible = (Array.isArray(signals) ? signals : [])
    .filter((signal) => signal.signalType !== 'background_activity' && signal.evaluable === true
      && taskMatchesConditions(signal, experiment.conditions))
    .sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt)
      || text(left.signalId).localeCompare(text(right.signalId)));
  const roots = [];
  const seenRoots = new Set();
  for (const signal of eligible) {
    const root = text(signal.rootAttemptId || signal.taskId);
    if (!root || seenRoots.has(root)) continue;
    seenRoots.add(root);
    roots.push(signal);
  }
  if (roots.length < 2) {
    return {
      policyVersion: METHOD_POLICY_VERSION,
      status: studentReported ? 'student_reported' : 'pending', definitive: false, sampleSize: roots.length,
      statement: studentReported ? `${studentReportStatement}；目前缺少可比的系统证据。` : '系统证据不足，暂不判断方法效果。',
      evidenceSignalIds: roots.map((item) => item.signalId),
    };
  }
  const boundary = Date.parse(text(experiment.createdAt));
  const before = Number.isFinite(boundary) ? roots.filter((signal) => Date.parse(signal.occurredAt) < boundary).at(-1) : roots[0];
  const after = Number.isFinite(boundary) ? roots.find((signal) => Date.parse(signal.occurredAt) >= boundary) : roots.at(-1);
  if (!before || !after) {
    return {
      policyVersion: METHOD_POLICY_VERSION,
      status: studentReported ? 'student_reported' : 'pending', definitive: false, sampleSize: roots.length,
      statement: studentReported ? `${studentReportStatement}；方法实施前后尚缺少可比的系统证据。` : '方法实施前后证据不足，暂不判断方法效果。',
      evidenceSignalIds: roots.map((item) => item.signalId),
    };
  }
  const comparable = comparableValue(before.difficultyBand, after.difficultyBand)
    && comparableValue(before.assistance, after.assistance)
    && comparableValue(before.subject, after.subject)
    && comparableValue(before.taskType, after.taskType)
    && comparableValue(before.targetKey, after.targetKey);
  if (!comparable) {
    return {
      policyVersion: METHOD_POLICY_VERSION,
      status: 'incomparable', definitive: false, sampleSize: roots.length,
      statement: '前后任务的难度、目标或提示条件不可比，不能形成确定的方法效果结论。',
      evidenceSignalIds: [before.signalId, after.signalId],
    };
  }
  const outcomeChanged = Boolean(before.correct) !== Boolean(after.correct);
  const effortChanged = Number.isFinite(Number(before.effortMinutes)) && Number.isFinite(Number(after.effortMinutes))
    && Number(before.effortMinutes) !== Number(after.effortMinutes);
  const changed = outcomeChanged || effortChanged;
  return {
    policyVersion: METHOD_POLICY_VERSION,
    status: changed ? 'observed_difference' : 'observed_no_difference', definitive: false, sampleSize: roots.length,
    statement: changed
      ? '可比任务中观察到表现变化；该方法可能有帮助，仍需延迟复测确认。'
      : '可比任务中暂未观察到明确变化，继续收集新任务证据。',
    evidenceSignalIds: [before.signalId, after.signalId],
    comparison: {
      before: { correct: Boolean(before.correct), effortMinutes: Number(before.effortMinutes) || null },
      after: { correct: Boolean(after.correct), effortMinutes: Number(after.effortMinutes) || null },
      conditions: { subject: before.subject, taskType: before.taskType, targetKey: before.targetKey,
        difficultyBand: before.difficultyBand, assistance: before.assistance },
    },
  };
}

function evidenceFingerprint(experiment, analysis, signals) {
  const revisions = new Map((Array.isArray(signals) ? signals : []).map((signal) => [signal.signalId, Number(signal.revision || 1)]));
  return crypto.createHash('sha256').update(JSON.stringify({
    experimentId: experiment.experimentId, revision: experiment.revision,
    evidence: analysis.evidenceSignalIds.map((signalId) => [signalId, revisions.get(signalId) || 1]),
    policyVersion: METHOD_POLICY_VERSION,
  })).digest('hex');
}

function createLearningMethodService({ store, dispatchAction, now = Date.now, timezone = 'Asia/Shanghai' } = {}) {
  if (!store) throw new Error('Learning state store is required');
  async function reconcile(scope, asOf = new Date(now()).toISOString()) {
    const studentId = text(scope?.studentId);
    const projection = store.getLearningState({ role: 'admin', studentId }, studentId, asOf);
    const signals = store.listProcessSignals(studentId, asOf);
    const methods = [];
    const actions = [];
    for (const experiment of projection.methods) {
      const analysis = analyzeMethodExperiment(experiment, signals);
      methods.push({ experimentId: experiment.experimentId, analysis });
      if (analysis.status !== 'observed_difference') continue;
      const fingerprint = evidenceFingerprint(experiment, analysis, signals);
      const action = {
        studentId, subjectType: 'problem', subjectId: `method:${experiment.experimentId}`,
        subjectRevision: experiment.revision, actionType: 'targeted_practice', retestWindow: retestWindow(asOf, timezone),
        title: `${experiment.title || experiment.methodKey} · 延迟复测`,
        payload: {
          sourceType: 'method_experiment', experimentId: experiment.experimentId, methodKey: experiment.methodKey,
          evidenceFingerprint: fingerprint, evidenceSignalIds: analysis.evidenceSignalIds,
          analysisPolicyVersion: METHOD_POLICY_VERSION, focus: experiment.hypothesis || experiment.title,
          subject: text(experiment.conditions?.subject) || '自动',
        },
      };
      const key = stableActionKey(action);
      const existing = projection.actions.find((item) => item.actionKey === key);
      if (existing) { actions.push(existing); continue; }
      if (typeof dispatchAction === 'function') actions.push(await dispatchAction(scope, action));
    }
    return { studentId, asOf, policyVersion: METHOD_POLICY_VERSION, methods, actions };
  }
  return { reconcile };
}

module.exports = { METHOD_POLICY_VERSION, analyzeMethodExperiment, createLearningMethodService };
