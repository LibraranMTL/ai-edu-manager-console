const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  appendLearningEvents,
  buildLearningConsultContext,
  buildLearningReportCandidateContext,
  canonicalKnowledgePoint,
  collectLearningEvents,
  computeKnowledgeState,
  queryLearningTrajectory,
  historyCandidatePath,
  knowledgeActivityProjection,
  listStudentKnowledgePoints,
  rebuildKnowledgeProjection,
  removeLearningEventsBySource,
} = require('../electron/learning-analytics.cjs');
const {
  buildMemory,
  buildSegments,
  persistSemanticResult,
  preSegmentEvents,
  reconcileDigestResult,
  selectKeyFrames,
} = require('../electron/capture-timeline-semantic.cjs');
const { captureEventFromSessionItem } = require('../electron/capture-timeline.cjs');

function event(overrides = {}) {
  return {
    studentId: 'student-1',
    subject: 'Mathematics',
    knowledgePoint: 'stationary point',
    occurredAt: '2026-01-14T10:00:00.000Z',
    taskType: 'concept_question',
    performance: { conceptualUnderstanding: 1, proceduralFluency: 2, methodSelection: 1, transfer: 0, hintLevel: 3 },
    errors: [{ id: 'why_derivative_equals_zero', description: 'Confuses f(x)=0 with f prime(x)=0.' }],
    evidenceRefs: [{ sourceType: 'digest_material', sourceId: 'material-1' }],
    ...overrides,
  };
}

test('maps aliases to stable canonical knowledge point IDs', () => {
  assert.equal(canonicalKnowledgePoint('stationary points').id, 'MATH.CALC.DIFF.STATIONARY_POINT');
  assert.equal(canonicalKnowledgePoint('驻点').id, 'MATH.CALC.DIFF.STATIONARY_POINT');
  assert.equal(canonicalKnowledgePoint({ id: 'MATH.CUSTOM.VECTOR', label: 'Vectors' }).id, 'MATH.CUSTOM.VECTOR');
});

test('registers open-world knowledge immediately and builds a deduplicated seven-day activity trend', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-open-knowledge-'));
  try {
    const base = { studentId: 'student-1', subject: '空间设计', knowledgePoint: '人机协同办公布局',
      activityType: 'project_application', occurredAt: '2026-10-22T10:00:00.000Z',
      evidenceRefs: [{ sourceType: 'project_material', sourceId: 'm1' }] };
    const accepted = appendLearningEvents(root, { studentId: 'student-1', allowedEvidenceRefs: base.evidenceRefs,
      asOf: '2026-10-23T00:00:00.000Z', events: [base, base] });
    assert.equal(accepted.accepted, 1);
    assert.match(accepted.states[0].knowledgePoint.id, /^KNOWLEDGE\./);
    assert.equal(accepted.states[0].state, 'introduced');
    assert.equal(accepted.states[0].scores.currentMastery, null);
    const trend = knowledgeActivityProjection(root, { studentId: 'student-1', asOf: '2026-10-23T00:00:00.000Z', rangeDays: 7 });
    assert.equal(trend.activityCount, 1);
    assert.equal(trend.activeDays, 1);
    assert.equal(trend.studentActivityCount, 1);
    assert.equal(listStudentKnowledgePoints(root, { studentId: 'student-1', asOf: '2026-10-23T00:00:00.000Z' }).items[0].activity.activityCount, 1);
    assert.equal(rebuildKnowledgeProjection(root, { studentId: 'student-1', cursor: 0 }).complete, true);
    const timeless = { studentId: 'student-1', subject: '空间设计', knowledgePoint: '自然采光分析',
      activityType: 'material_exposure', evidenceRefs: [{ sourceType: 'project_material', sourceId: 'm2' }] };
    assert.equal(appendLearningEvents(root, { studentId: 'student-1', recordedAt: '2026-10-22T11:00:00.000Z',
      allowedEvidenceRefs: timeless.evidenceRefs, events: [timeless] }).accepted, 1);
    assert.equal(appendLearningEvents(root, { studentId: 'student-1', recordedAt: '2026-10-23T11:00:00.000Z',
      allowedEvidenceRefs: timeless.evidenceRefs, events: [timeless] }).accepted, 0);
    const afterTimeless = knowledgeActivityProjection(root, { studentId: 'student-1', asOf: '2026-10-23T12:00:00.000Z', rangeDays: 7 });
    assert.equal(afterTimeless.activityCount, 1, 'unknown source time must not create an import-day activity spike');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('dimension scores use observed recent evidence and keep unknown dimensions unknown', () => {
  const point = canonicalKnowledgePoint('驻点');
  const events = [
    event({ occurredAt: '2026-01-01T00:00:00.000Z', performance: { conceptualUnderstanding: 0, proceduralFluency: null, methodSelection: null, transfer: null, hintLevel: 0 } }),
    event({ occurredAt: '2026-01-02T00:00:00.000Z', performance: { conceptualUnderstanding: 4, proceduralFluency: 2, methodSelection: null, transfer: null, hintLevel: 0 } }),
  ];
  const state = computeKnowledgeState('student-1', point, events, { asOf: '2026-01-03T00:00:00.000Z' });
  assert.equal(state.scores.conceptualUnderstanding, 0.6667);
  assert.equal(state.scores.proceduralFluency, 0.5);
  assert.equal(state.scores.methodSelection, null);
  assert.equal(state.scores.transfer, null);
  assert.ok(state.confidence < 0.4);
});

test('report candidate is student-scoped, period-bounded and separate from formal evidence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-learning-report-candidate-'));
  try {
    const stored = appendLearningEvents(root, { studentId: 'student-1',
      allowedEvidenceRefs: [{ sourceType: 'digest_material', sourceId: 'material-1' }, { sourceType: 'digest_material', sourceId: 'material-2' }],
      events: [event(), event({ occurredAt: '2026-04-29T10:00:00.000Z', evidenceRefs: [{ sourceType: 'digest_material', sourceId: 'material-2' }] })] });
    assert.equal(stored.accepted, 2);
    const candidate = buildLearningReportCandidateContext(root, { studentId: 'student-1', periodStart: '2026-04-01', periodEnd: '2026-04-30' });
    assert.equal(candidate.status, 'candidate_only');
    assert.equal(candidate.studentId, 'student-1');
    assert.equal(candidate.points.length, 1);
    assert.equal(candidate.points[0].periodEvidence.length, 1);
    assert.equal(candidate.points[0].periodEvidence[0].evidenceRefs[0].sourceId, 'material-2');
    assert.equal(Object.hasOwn(candidate, 'eligibleEvidence'), false);
    assert.deepEqual(buildLearningReportCandidateContext(root, { studentId: 'student-2', periodStart: '2026-04-01', periodEnd: '2026-04-30' }).points, []);
    assert.equal(buildLearningReportCandidateContext(root, { studentId: 'student-1', periodStart: 'bad', periodEnd: '2026-04-30' }).status, 'unavailable');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('persists scoped learning events idempotently and queries a chronological trajectory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-learning-analytics-'));
  try {
    const allowedEvidenceRefs = [
      { sourceType: 'digest_material', sourceId: 'material-1' },
      { sourceType: 'digest_material', sourceId: 'material-2' },
    ];
    const result = appendLearningEvents(root, {
      studentId: 'student-1',
      allowedEvidenceRefs,
      asOf: '2026-05-01T00:00:00.000Z',
      events: [
        event(),
        event({
          occurredAt: '2026-04-29T10:00:00.000Z',
          performance: { conceptualUnderstanding: 3, proceduralFluency: 3, methodSelection: 3, transfer: 3, hintLevel: 0 },
          evidenceRefs: [{ sourceType: 'digest_material', sourceId: 'material-2' }],
        }),
      ],
    });
    assert.equal(result.ok, true);
    assert.equal(result.accepted, 2);
    assert.equal(result.states[0].knowledgePoint.id, 'MATH.CALC.DIFF.STATIONARY_POINT');
    assert.ok(['practiced', 'mostly_mastered'].includes(result.states[0].state));
    const repeated = appendLearningEvents(root, { studentId: 'student-1', allowedEvidenceRefs, events: [event()] });
    assert.equal(repeated.deduplicatedTotal, 2);
    const trajectory = queryLearningTrajectory(root, { studentId: 'student-1', knowledgePoint: '驻点' });
    assert.equal(trajectory.ok, true);
    assert.equal(trajectory.order, 'occurredAt ASC');
    assert.equal(trajectory.events.length, 2);
    assert.ok(Date.parse(trajectory.events[0].occurredAt) < Date.parse(trajectory.events[1].occurredAt));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects cross-student and unauthorized evidence instead of silently writing it', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-learning-scope-'));
  try {
    const result = appendLearningEvents(root, {
      studentId: 'student-1',
      allowedEvidenceRefs: [{ sourceType: 'digest_material', sourceId: 'material-1' }],
      events: [
        event({ studentId: 'student-2' }),
        event({ evidenceRefs: [{ sourceType: 'digest_material', sourceId: 'other-material' }] }),
      ],
    });
    assert.equal(result.accepted, 0);
    assert.deepEqual(result.rejected.map((item) => item.code), ['student_scope_mismatch', 'evidence_ref_unauthorized']);
    assert.equal(queryLearningTrajectory(root, { studentId: 'student-1' }).events.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('time decay lowers retention confidence without asserting confirmed forgetting', () => {
  const normalized = {
    ...event(),
    schema: 'edu-manager.learning-event.v1',
    eventId: 'event-1',
    knowledgePoint: canonicalKnowledgePoint('stationary point'),
    performance: { conceptualUnderstanding: 4, proceduralFluency: 4, methodSelection: 4, transfer: 4, hintLevel: 0 },
    errors: [],
  };
  const state = computeKnowledgeState('student-1', normalized.knowledgePoint, [normalized], { asOf: '2026-09-14T10:00:00.000Z' });
  assert.equal(state.state, 'needs_review');
  assert.ok(state.scores.retentionConfidence < 0.55);
  assert.equal(state.reviewPlanStatus, 'recommendation_only');
  assert.equal(state.recommendedReviewAt, '2026-09-14T10:00:00.000Z');
  assert.match(state.retentionNote, /不等于已确认遗忘/);
});

test('tracks recurring misconceptions and removes derived state when source is revoked', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-learning-remove-'));
  try {
    appendLearningEvents(root, {
      studentId: 'student-1',
      sessionId: 'session-1',
      allowedEvidenceRefs: [{ sourceType: 'capture_event', sourceId: 'frame-1' }, { sourceType: 'capture_event', sourceId: 'frame-2' }],
      events: [
        event({ evidenceRefs: [{ sourceType: 'capture_event', sourceId: 'frame-1' }] }),
        event({ occurredAt: '2026-02-14T10:00:00.000Z', evidenceRefs: [{ sourceType: 'capture_event', sourceId: 'frame-2' }] }),
      ],
    });
    const before = queryLearningTrajectory(root, { studentId: 'student-1' });
    assert.equal(before.misconceptions[0].status, 'recurring');
    const removed = removeLearningEventsBySource(root, { studentId: 'student-1', sessionId: 'session-1' });
    assert.equal(removed.removed, 2);
    assert.equal(queryLearningTrajectory(root, { studentId: 'student-1' }).events.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('collects learning events from nested digest receipts', () => {
  const nested = { processed: [{ materialId: 'm1', result: { learningEvents: [event()] } }] };
  assert.equal(collectLearningEvents(nested).length, 1);
});

test('validated timeline digest writes learning events into the student analytics layer', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-learning-timeline-'));
  const studentRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-learning-student-'));
  try {
    const session = { id: 'session-1', studentId: 'student-1', studentName: '测试学生', sourceName: '数学课程' };
    const timelineEvents = [
      captureEventFromSessionItem(session, { id: 'frame-1', capturedAt: '2026-01-14T10:00:00.000Z' }),
      captureEventFromSessionItem(session, { id: 'frame-2', capturedAt: '2026-01-14T10:01:00.000Z' }),
    ];
    const groups = preSegmentEvents(timelineEvents).map((items) => ({ events: items, keyFrames: selectKeyFrames(items) }));
    const segments = buildSegments(session, groups, new Map(), { factualOnly: true });
    const date = segments[0].date;
    persistSemanticResult(root, session, { [date]: segments }, { [date]: buildMemory(session, date, segments) }, {
      schema: 'edu-manager.capture-session-material-bundle.v1',
      bundleId: 'bundle-1',
      studentId: session.studentId,
      sourceSessionId: session.id,
      sourceEventIds: timelineEvents.map((item) => item.id),
      sourceHashes: {},
      keyFrames: [],
      allowedEvidenceRefs: [{ sourceType: 'digest_material', sourceId: 'material-1' }],
      segmentIds: segments.map((item) => item.segmentId),
      segmentRefs: segments.map((item) => ({ date, segmentId: item.segmentId })),
      status: 'pending_digest',
    });
    const segment = segments[0];
    const result = reconcileDigestResult(root, {
      studentId: session.studentId,
      sessionId: session.id,
      bundleId: 'bundle-1',
      digestBatchId: 'digest-1',
      learningAnalyticsRoot: studentRoot,
      receipt: { timelineResults: [{
        segmentId: segment.segmentId,
        sourceEventIds: segment.sourceEventIds,
        evidenceRefs: [{ sourceType: 'digest_material', sourceId: 'material-1' }],
        formalSummary: '学生在提示下完成驻点概念题。',
        learningEvents: [event({
          evidenceRefs: [{ sourceType: 'capture_event', sourceId: segment.sourceEventIds[0] }, { sourceType: 'digest_material', sourceId: 'material-1' }],
        })],
      }] },
    });
    assert.equal(result.ok, true);
    assert.equal(result.learningAnalytics.accepted, 1);
    assert.equal(queryLearningTrajectory(studentRoot, { studentId: session.studentId }).events.length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(studentRoot, { recursive: true, force: true });
  }
});

test('screen-only evidence cannot create a scored learning event', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-learning-visual-only-'));
  try {
    const result = appendLearningEvents(root, { studentId: 'student-1', requireNonVisualEvidence: true,
      allowedEvidenceRefs: [{ sourceType: 'capture_event', sourceId: 'frame-1' }],
      events: [event({ evidenceRefs: [{ sourceType: 'capture_event', sourceId: 'frame-1' }] })] });
    assert.equal(result.accepted, 0);
    assert.deepEqual(result.rejected.map((item) => item.code), ['performance_source_visual_only']);
    assert.equal(queryLearningTrajectory(root, { studentId: 'student-1' }).events.length, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('rejects invalid scores and hint-only observations without silently clamping', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-learning-scores-'));
  try {
    const result = appendLearningEvents(root, { studentId: 'student-1', events: [
      event({ performance: { conceptualUnderstanding: 5 } }),
      event({ performance: { hintLevel: 0 } }),
      event({ occurredAt: '2026-01-14' }),
      event({ evidenceRefs: [{ sourceType: 'digest_material', sourceId: 'material-1' }, { sourceType: 'digest_material' }] }),
    ] });
    assert.equal(result.accepted, 0);
    assert.deepEqual(result.rejected.map((item) => item.code), ['performance_score_invalid', 'performance_missing', 'occurred_at_invalid', 'evidence_ref_invalid']);
    assert.equal(queryLearningTrajectory(root, { studentId: 'student-1' }).rejections.length, 4);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('unknown hint level never proves independent mastery and report is explicitly unpublished', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-learning-report-'));
  try {
    const strong = (at, ref) => event({ occurredAt: at,
      performance: { conceptualUnderstanding: 4, proceduralFluency: 4, methodSelection: 4, transfer: 4, hintLevel: null },
      evidenceRefs: [{ sourceType: 'digest_material', sourceId: ref }], errors: [] });
    appendLearningEvents(root, { studentId: 'student-1', events: [
      strong('2026-09-18T10:00:00Z', 'm1'), strong('2026-09-19T10:00:00Z', 'm2'),
    ] });
    const result = queryLearningTrajectory(root, { studentId: 'student-1' });
    assert.equal(result.states[0].independentStrongEvidenceCount, 0);
    assert.notEqual(result.states[0].state, 'mastered');
    assert.match(result.historyMarkdown, /未发布/);
    assert.equal(fs.readFileSync(historyCandidatePath(root), 'utf8'), result.historyMarkdown);
    assert.match(buildLearningConsultContext(root, { studentId: 'student-1', question: '驻点掌握了吗？' }), /提示 未知/);
    assert.equal(buildLearningConsultContext(root, { studentId: 'other', question: '驻点掌握了吗？' }), '');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('never overwrites a conflicting event ID or corrupt ledger', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-learning-conflict-'));
  try {
    assert.equal(appendLearningEvents(root, { studentId: 'student-1', events: [event({ eventId: 'fixed' })] }).accepted, 1);
    const conflict = appendLearningEvents(root, { studentId: 'student-1', events: [event({ eventId: 'fixed', evidenceRefs: [{ sourceType: 'digest_material', sourceId: 'material-2' }] })] });
    assert.equal(conflict.accepted, 0);
    assert.equal(conflict.rejected[0].code, 'event_id_conflict');
    const first = queryLearningTrajectory(root, { studentId: 'student-1' });
    assert.equal(first.events.length, 1);
    assert.equal(first.events[0].evidenceRefs[0].sourceId, 'material-1');
    const ledger = path.join(root, '.edu-manager', 'learning-analytics', 'learning-events.json');
    fs.writeFileSync(ledger, '{broken', 'utf8');
    assert.equal(appendLearningEvents(root, { studentId: 'student-1', events: [event()] }).code, 'event_ledger_unreadable');
    assert.equal(fs.readFileSync(ledger, 'utf8'), '{broken');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
