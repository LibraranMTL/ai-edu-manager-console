'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLearningStateStore } = require('../electron/learning-state-store.cjs');
const {
  ANALYSIS_POLICY,
  analyzeLearningProblemCandidates,
  createLearningStateAnalysisService,
  recordPracticeActionFeedback,
} = require('../electron/learning-state-analysis.cjs');

const NOW = '2026-11-16T08:00:00.000Z';

function scope(studentId = 'student-a') {
  return { studentId, actorRole: 'system', actorId: 'learning-analysis' };
}

function event(rootAttemptId, overrides = {}) {
  const sequence = Number(overrides.sequence || 1);
  return {
    eventId: overrides.eventId || `event-${rootAttemptId}-${sequence}`,
    studentId: overrides.studentId || 'student-a',
    knowledgePoint: { id: overrides.knowledgePointId || 'MATH.FUNCTION.TRANSFER', label: overrides.label || '函数迁移', subject: '数学' },
    occurredAt: overrides.occurredAt || '2026-11-15T08:00:00.000Z',
    taskId: rootAttemptId,
    outcome: overrides.outcome || 'needs_correction',
    practiceReview: { episodeId: rootAttemptId, sequence, attemptId: overrides.attemptId || `${rootAttemptId}-attempt-${sequence}` },
    evidenceRefs: [{ sourceType: 'practice_attempt', sourceId: overrides.attemptId || `${rootAttemptId}-attempt-${sequence}` }],
    evidence: overrides.evidence || '函数关系迁移时需要继续核对。',
    recommendedNextStep: '安排一次独立复测。',
    ...(overrides.retestRequired ? { retestRequired: true } : {}),
  };
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-learning-analysis-'));
  const dbPath = path.join(root, 'learning-state.sqlite3');
  const store = createLearningStateStore({ dbPath, now: () => Date.parse(NOW) });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, store };
}

test('two negative independent roots within 14 days qualify one priority problem', () => {
  const one = analyzeLearningProblemCandidates({ studentId: 'student-a', events: [event('root-1')], asOf: NOW });
  assert.equal(one.length, 1);
  assert.equal(one[0].status, 'watching');
  assert.equal(one[0].independentRootCount, 1);

  const replayAndSecond = analyzeLearningProblemCandidates({
    studentId: 'student-a',
    events: [event('root-1'), event('root-1', { eventId: 'replay', sequence: 1 }), event('root-2')], asOf: NOW,
  });
  assert.equal(replayAndSecond.length, 1);
  assert.equal(replayAndSecond[0].status, 'action_required');
  assert.equal(replayAndSecond[0].independentRootCount, 2);
  assert.equal(replayAndSecond[0].evidenceIds.length, 2);
  assert.equal(ANALYSIS_POLICY.independentRootThreshold, 2);
  assert.equal(ANALYSIS_POLICY.windowDays, 14);
});

test('latest revision of the same root replaces rather than adds evidence', () => {
  const candidates = analyzeLearningProblemCandidates({
    studentId: 'student-a',
    events: [
      event('root-1', { sequence: 1, outcome: 'needs_correction', occurredAt: '2026-11-14T08:00:00.000Z' }),
      event('root-1', { sequence: 2, outcome: 'correct', occurredAt: '2026-11-15T08:00:00.000Z' }),
      event('root-2'),
      event('root-old', { occurredAt: '2026-10-01T08:00:00.000Z' }),
    ], asOf: NOW,
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].independentRootCount, 1, 'a correction and an expired root do not satisfy the threshold');
  assert.equal(candidates[0].status, 'watching');
});

test('an explicit reliable retest requirement can qualify from one independent root', () => {
  const [candidate] = analyzeLearningProblemCandidates({ studentId: 'student-a', events: [event('root-1', { retestRequired: true })], asOf: NOW });
  assert.equal(candidate.status, 'action_required');
  assert.equal(candidate.explicitRetest, true);
});

test('reconciliation creates watching then one action-required revision and reuses one action', async (t) => {
  const { store } = fixture(t);
  const dispatches = [];
  const service = createLearningStateAnalysisService({
    store, now: () => Date.parse(NOW),
    dispatchAction: async (actor, action) => {
      dispatches.push(action);
      const intent = store.ensureActionIntent(actor, action, `auto-intent-${action.subjectRevision}`);
      if (!intent.binding) {
        store.beginActionDispatch(actor, intent.actionKey, { entityType: 'practice_card', round: 1, commitKey: `auto-begin-${action.subjectRevision}` });
        store.settleActionDispatch(actor, intent.actionKey, { round: 1, status: 'dispatched', entityId: 'card-auto-1', commitKey: `auto-settle-${action.subjectRevision}` });
      }
      return store.getActionIntent(actor, intent.actionKey);
    },
  });

  const first = await service.reconcile(scope(), [event('root-1')], NOW);
  assert.equal(first.problems[0].status, 'watching');
  assert.equal(dispatches.length, 0);

  const second = await service.reconcile(scope(), [event('root-1'), event('root-2')], NOW);
  assert.equal(second.problems[0].status, 'action_required');
  assert.equal(second.problems[0].revision, 2);
  assert.equal(dispatches.length, 1);
  assert.equal(second.actions[0].status, 'dispatched');

  const generation = store.state().generation;
  await service.reconcile(scope(), [event('root-1'), event('root-2'), event('root-2', { eventId: 'replay' })], NOW);
  assert.equal(dispatches.length, 1);
  assert.equal(store.state().generation, generation, 'replaying old evidence is a zero-write operation');
});

test('practice action feedback records completion without claiming mastery and is idempotent', (t) => {
  const { store } = fixture(t);
  const problem = store.upsertProblem(scope(), {
    problemId: 'problem-auto', category: 'knowledge', title: '函数迁移需要复测', status: 'action_required',
  }, 0);
  const action = {
    studentId: 'student-a', subjectType: 'problem', subjectId: problem.problemId, subjectRevision: problem.revision,
    actionType: 'targeted_practice', retestWindow: '2026-11-16/2026-11-22', title: '函数迁移专项复测', payload: {},
  };
  const intent = store.ensureActionIntent(scope(), action, 'feedback-intent');
  store.beginActionDispatch(scope(), intent.actionKey, { entityType: 'practice_card', round: 1, commitKey: 'feedback-begin' });
  store.settleActionDispatch(scope(), intent.actionKey, { round: 1, status: 'dispatched', entityId: 'card-1', commitKey: 'feedback-bind' });
  const input = {
    attempt: { studentId: 'student-a', attemptId: 'attempt-1', rootAttemptId: 'root-1', reviewVersion: 3, businessActionKey: intent.actionKey, submittedAt: NOW },
    result: { judgement: 'needs_correction', summary: '本次仍需订正。', qualityPassed: true, source: 'agent' },
  };
  const feedback = recordPracticeActionFeedback({ store, scope: scope(), ...input });
  const generation = store.state().generation;
  const replay = recordPracticeActionFeedback({ store, scope: scope(), ...input });
  assert.equal(feedback.outcome, 'completed');
  assert.equal(replay.feedbackId, feedback.feedbackId);
  assert.equal(store.state().generation, generation);
  const current = store.getActionIntent(scope(), intent.actionKey);
  assert.equal(current.status, 'completed');
  assert.equal(store.getLearningState({ role: 'admin', studentId: 'student-a' }, 'student-a', '2026-11-17T00:00:00.000Z').problems[0].status, 'awaiting_retest');
  assert.equal(store.history('student-a').feedback[0].payload.judgement, 'needs_correction');
  assert.equal(store.history('student-a').feedback[0].payload.masteryConclusion, null);
});
