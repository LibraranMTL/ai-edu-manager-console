const assert = require('node:assert/strict');
const test = require('node:test');
const { aggregateCoverage, attachEventCoverage, eventCoverage } = require('../electron/capture-timeline-duration.cjs');
const { buildCoverageReport } = require('../electron/capture-timeline-reports.cjs');
const { inferCategory } = require('../electron/capture-timeline-semantic.cjs');

const at = (minute) => new Date(Date.UTC(2026, 9, 25, 10, minute, 0)).toISOString();

test('duplicate samples extend one saved frame without creating duplicate duration', () => {
  const events = [{ id: 'a', occurredAt: at(0) }, { id: 'b', occurredAt: at(5) }];
  const session = {
    startedAt: at(0), endedAt: at(6),
    capturePolicy: { maximumSaveIntervalMs: 60_000 },
    captureSamples: [
      { sampledAt: at(0), decision: 'initial', captureItemId: 'a' },
      { sampledAt: at(1), decision: 'duplicate' },
      { sampledAt: at(2), decision: 'duplicate' },
      { sampledAt: at(3), decision: 'duplicate' },
      { sampledAt: at(4), decision: 'duplicate' },
      { sampledAt: at(5), decision: 'saved', captureItemId: 'b' },
    ],
  };
  const coverage = eventCoverage(events, session);
  assert.equal(coverage.length, 2);
  assert.equal(coverage[0].durationMs, 5 * 60_000);
  assert.equal(coverage[0].duplicateSampleCount, 4);
  assert.equal(coverage[1].durationBasis, 'session_end_inferred');
  assert.equal(coverage[1].durationMs, 60_000);
  assert.equal(aggregateCoverage(events, session).durationMs, 6 * 60_000);
});

test('initial frame can cover from the session start while raw evidence time stays unchanged', () => {
  const events = [{ id: 'a', occurredAt: at(2) }];
  const session = {
    startedAt: at(0), endedAt: at(3), capturePolicy: { maximumSaveIntervalMs: 5 * 60_000 },
    captureSamples: [{ sampledAt: at(2), decision: 'initial', captureItemId: 'a' }],
  };
  const coverage = eventCoverage(events, session)[0];
  assert.equal(coverage.coverageStartAt, at(0));
  assert.equal(coverage.durationMs, 3 * 60_000);
});

test('long sample gaps are capped and reported as unobserved', () => {
  const events = [{ id: 'a', occurredAt: at(0) }, { id: 'b', occurredAt: at(5) }];
  const session = {
    endedAt: at(5), capturePolicy: { maximumSaveIntervalMs: 60_000 },
    captureSamples: [{ sampledAt: at(0), decision: 'initial', captureItemId: 'a' }],
  };
  const coverage = eventCoverage(events, session);
  assert.equal(coverage[0].durationMs, 60_000);
  assert.equal(coverage[0].durationBasis, 'unobserved_capped');
  assert.equal(coverage[0].unobservedDurationMs, 4 * 60_000);
});

test('historical sessions are reconstructed with low confidence', () => {
  const events = [{ id: 'a', occurredAt: at(0) }, { id: 'b', occurredAt: at(2) }];
  const session = { endedAt: at(3), options: { maximumSaveIntervalMs: 60_000 } };
  const coverage = aggregateCoverage(events, session);
  assert.equal(coverage.durationConfidence, 'historical_low');
  assert.equal(coverage.durationBasis, 'historical_reconstruction');
  assert.equal(coverage.historicalReconstruction, true);
  assert.equal(coverage.unobservedDurationMs, 60_000);
});

test('paused sample interval does not contribute to covered duration', () => {
  const events = [{ id: 'a', occurredAt: at(0) }, { id: 'b', occurredAt: at(5) }];
  const session = {
    endedAt: at(5), capturePolicy: { maximumSaveIntervalMs: 10 * 60_000 },
    captureSamples: [
      { sampledAt: at(0), decision: 'initial', captureItemId: 'a' },
      { sampledAt: at(1), decision: 'paused', paused: true },
      { sampledAt: at(3), decision: 'resumed', paused: false },
      { sampledAt: at(5), decision: 'saved', captureItemId: 'b' },
    ],
  };
  const coverage = eventCoverage(events, session);
  assert.equal(coverage[0].durationMs, 3 * 60_000);
  assert.equal(coverage[0].pausedDurationMs, 2 * 60_000);
});

test('activity share denominator is covered duration and unknown remains visible', () => {
  const report = buildCoverageReport([
    { segmentId: 'reading-1', activityType: 'reading', durationMs: 6 * 60_000, observedDurationMs: 5 * 60_000, inferredDurationMs: 60_000, durationConfidence: 'estimated', durationBasis: 'duplicate_covered' },
    { segmentId: 'unknown-1', activityType: 'unknown', durationMs: 4 * 60_000, observedDurationMs: 4 * 60_000, inferredDurationMs: 0, durationConfidence: 'estimated', durationBasis: 'duplicate_covered' },
  ]);
  assert.equal(report.durationEstimate.coveredMinutes, 10);
  assert.equal(report.activityShares.find((item) => item.activityType === 'unknown').share, 0.4);
  assert.equal(report.activityShares.reduce((sum, item) => sum + item.share, 0), 1);
  assert.equal(report.timelineActivities.length, 2);
});

test('untrusted capture timestamps do not produce coverage duration', () => {
  const coverage = eventCoverage([{ id: 'bad', occurredAt: at(0), timeSource: 'received_at' }], {
    startedAt: at(0), endedAt: at(2), captureSamples: [{ sampledAt: at(0), decision: 'initial' }],
  });
  assert.equal(coverage.length, 0);
});

test('overlapping retained frames are merged before activity duration is totaled', () => {
  const events = [
    { id: 'same-a', occurredAt: at(0) },
    { id: 'same-b', occurredAt: at(0) },
    { id: 'next', occurredAt: at(1) },
  ];
  const coverage = aggregateCoverage(events, {
    startedAt: at(0), endedAt: at(2), capturePolicy: { maximumSaveIntervalMs: 5 * 60_000 },
  });
  assert.equal(coverage.durationMs, 2 * 60_000, '同一覆盖区间只能累计一次');
  assert.equal(coverage.inferredDurationMs, 2 * 60_000);
});

test('last retained frame is capped by the last trusted sample plus the maximum interval', () => {
  const coverage = eventCoverage([{ id: 'last', occurredAt: at(0) }], {
    startedAt: at(0), endedAt: at(5), capturePolicy: { maximumSaveIntervalMs: 60_000 },
    captureSamples: [
      { sampledAt: at(0), decision: 'initial', captureItemId: 'last' },
      { sampledAt: at(1), decision: 'duplicate' },
    ],
  })[0];
  assert.equal(coverage.coverageEndAt, at(2));
  assert.equal(coverage.durationMs, 2 * 60_000);
  assert.equal(coverage.unobservedDurationMs, 3 * 60_000);
});

test('per-frame coverage stays attached to the original event order', () => {
  const events = [{ id: 'later', occurredAt: at(2) }, { id: 'earlier', occurredAt: at(0) }];
  const attached = attachEventCoverage(events, {
    startedAt: at(0), endedAt: at(3), capturePolicy: { maximumSaveIntervalMs: 5 * 60_000 },
  });
  assert.equal(attached[0].id, 'later');
  assert.equal(attached[0].coverageStartAt, at(2));
  assert.equal(attached[1].id, 'earlier');
  assert.equal(attached[1].coverageStartAt, at(0));
  assert.equal(attached[1].coverageEndAt, at(2));
});

test('classification keeps unsupported context unknown and separates visible non-learning activity', () => {
  assert.equal(inferCategory('', '普通窗口'), 'unknown');
  assert.equal(inferCategory('正在查看课程讲义'), 'reading');
  assert.equal(inferCategory('打开音乐和聊天窗口'), 'other');
});
