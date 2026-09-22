const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  STRATEGY_VERSION,
  atomicWriteJson,
  buildMemory,
  buildSegments,
  bundleMarkdown,
  captureEvidenceRoot,
  findKnowledgeLinks,
  persistSemanticResult,
  preSegmentEvents,
  pruneRecognitionCache,
  querySegments,
  readProcessingJob,
  reconcileDigestResult,
  recognitionPath,
  refineSegmentGroups,
  selectKeyFrames,
} = require('../electron/capture-timeline-semantic.cjs');
const { CaptureTimelineScheduler, adaptiveConcurrency } = require('../electron/capture-timeline-scheduler.cjs');
const { processSession } = require('../electron/capture-timeline-worker.cjs');
const { captureEventFromSessionItem } = require('../electron/capture-timeline.cjs');

function fixtureSession(root) {
  const started = Date.parse('2026-09-12T01:00:00.000Z');
  const items = Array.from({ length: 12 }, (_, index) => {
    const file = path.join(root, `frame-${index}.png`);
    fs.writeFileSync(file, `synthetic-frame-${index}`);
    return {
      id: `event-${index}`,
      path: file,
      filename: path.basename(file),
      capturedAt: new Date(started + index * 60_000).toISOString(),
      difference: index === 6 ? 0.9 : 0.2,
      reason: index === 0 ? 'initial' : 'interval',
      isHighlighted: index === 4,
    };
  });
  return { id: 'session-semantic', studentId: 'student-1', studentName: '测试学生', sourceName: '数学课程', courseName: '二次函数', archiveStatus: 'candidate', items };
}

test('timeline digest requests learning events in the existing segment receipt only with verified performance evidence', () => {
  const markdown = bundleMarkdown({ studentName: '测试学生' }, {
    bundleId: 'bundle-1', studentId: 'student-1', sourceSessionId: 'session-1', createdAt: '2026-09-21T00:00:00.000Z',
    keyFrames: [], sourceHashes: {}, processingWindows: [], allowedEvidenceRefs: [],
  }, [{ segmentId: 'segment-1', startedAt: '2026-09-21T00:00:00.000Z', endedAt: '2026-09-21T00:01:00.000Z', sourceEventIds: ['event-1'], keyEventIds: [] }]);
  assert.match(markdown, /"learningEvents": \[\]/);
  assert.match(markdown, /仅当本活动段有已核验的题目、提交结果、教师反馈或同范围授权对话/);
  assert.match(markdown, /仅看见题目、网页、操作界面、提交按钮或截图变化时，保持 learningEvents 为空/);
  assert.match(markdown, /不得引用本次系统消化任务会话/);
});

test('two-stage segmentation selects bounded keyframes and builds semantic segments', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-semantic-unit-'));
  try {
    const session = fixtureSession(root);
    const events = session.items.map((item) => captureEventFromSessionItem(session, item));
    const groups = preSegmentEvents(events);
    assert.ok(groups.length >= 1);
    assert.ok(groups.every((group) => selectKeyFrames(group).length <= 3));
    const recognition = new Map(events.map((event) => [event.id, { status: 'completed', ocrText: event.id === 'event-4' ? '二次函数练习与订正' : '阅读二次函数课程' }]));
    const refined = refineSegmentGroups(groups.map((group) => ({ events: group, keyFrames: selectKeyFrames(group) })), recognition);
    const segments = buildSegments(session, refined, recognition);
    assert.ok(segments.length >= 1);
    assert.ok(segments.every((segment) => segment.keyEventIds.length <= 3));
    assert.ok(segments.some((segment) => /二次函数/.test(segment.candidateSummary)));
    const memory = buildMemory(session, events[0].date, segments);
    assert.equal(memory.segmentCount, segments.length);
    assert.match(memory.candidateSummary, /活动段/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('T0 marks long unobserved intervals and substitute timestamps without inventing learning duration', () => {
  const session = { id: 'time-gap', studentId: 'student-gap' };
  const first = captureEventFromSessionItem(session, { id: 'a', capturedAt: '2026-09-10T01:00:00.000Z' });
  const second = captureEventFromSessionItem(session, { id: 'b', capturedAt: '2026-09-10T01:10:00.000Z' });
  const groups = preSegmentEvents([first, second]).map((events) => ({ events, keyFrames: selectKeyFrames(events) }));
  const segments = buildSegments(session, groups, new Map(), { factualOnly: true });
  assert.equal(segments.length, 2);
  assert.equal(segments[1].gapBeforeMs, 10 * 60_000);
  assert.equal(segments[1].gapBeforeStatus, 'unobserved_interval');
  const uploaded = captureEventFromSessionItem(session, { id: 'b', uploadedAt: '2026-09-10T01:10:00.000Z' });
  const uncertainGroups = preSegmentEvents([first, uploaded]).map((events) => ({ events, keyFrames: selectKeyFrames(events) }));
  const uncertainSegments = buildSegments(session, uncertainGroups, new Map(), { factualOnly: true });
  assert.equal(uncertainSegments[1].gapBeforeStatus, 'time_uncertain');
  assert.equal(uncertainSegments[1].uncertainTimeEventCount, 1);
  const future = captureEventFromSessionItem(session, { id: 'c', capturedAt: '2026-09-10T01:20:00.000Z', uploadedAt: '2026-09-10T01:11:00.000Z' });
  assert.equal(future.clockStatus, 'suspected_future_capture');
  const skewedGroups = preSegmentEvents([first, future]).map((events) => ({ events, keyFrames: selectKeyFrames(events) }));
  const skewedSegments = buildSegments(session, skewedGroups, new Map(), { factualOnly: true });
  assert.equal(skewedSegments[1].gapBeforeStatus, 'time_uncertain');
  assert.equal(skewedSegments[1].uncertainTimeEventCount, 1);
});

test('semantic persistence queries activity segments instead of screenshot rows', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-semantic-query-'));
  try {
    const session = fixtureSession(root);
    const events = session.items.map((item) => captureEventFromSessionItem(session, item));
    const date = events[0].date;
    const recognition = new Map(events.map((event) => [event.id, { status: 'completed', ocrText: '二次函数练习' }]));
    const groups = preSegmentEvents(events).map((group) => ({ events: group, keyFrames: selectKeyFrames(group) }));
    const segments = buildSegments(session, groups, recognition);
    const memory = buildMemory(session, date, segments);
    persistSemanticResult(root, session, { [date]: segments }, { [date]: memory }, {
      schema: 'edu-manager.capture-session-material-bundle.v1', bundleId: 'bundle-1', studentId: session.studentId, sourceSessionId: session.id, keyFrames: [], segmentIds: segments.map((item) => item.segmentId), status: 'pending_digest', candidateSummary: memory.candidateSummary,
    });
    const page = querySegments(root, { studentId: session.studentId, date, query: '二次函数', limit: 1 });
    assert.equal(page.ok, true);
    assert.equal(page.segments.length, 1);
    assert.ok(page.memory.candidateSummary.includes('活动段'));
    assert.equal('originalPath' in page.segments[0], false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('worker promotes without OCR and locally degrades a missing frame', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-semantic-worker-'));
  try {
    const session = fixtureSession(root);
    for (const item of session.items) {
      const content = fs.readFileSync(item.path);
      const hash = crypto.createHash('sha1').update(content).digest('hex');
      atomicWriteJson(recognitionPath(root, session.studentId, 'sha1', hash, STRATEGY_VERSION), {
        schema: 'edu-manager.timeline-recognition.v1', studentId: session.studentId, sourceEventId: item.id, hashAlgorithm: 'sha1', contentHash: hash, recognitionStrategyVersion: STRATEGY_VERSION, status: 'completed', ocrText: '二次函数练习与订正', createdAt: new Date().toISOString(), lastAccessedAt: new Date().toISOString(), referenceCount: 1,
      });
    }
    fs.rmSync(session.items[4].path, { force: true });
    const result = await processSession(root, session);
    assert.equal(result.ok, true);
    assert.ok(result.segmentCount >= 1);
    assert.ok(result.keyFrameCount <= 20);
    assert.equal(result.cacheHits, 0);
    assert.equal(result.recognizedKeyFrameCount, 0);
    assert.ok(result.segments.every((segment) => segment.recognitionStatus === 'pending_digest'));
    assert.ok(['partial_completed', 'completed'].includes(result.state));
    const job = readProcessingJob(root, session.studentId, session.id);
    assert.equal(job.requiresUserAction, false);
    assert.ok(job.unitCounts.completed >= 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('validated digest results enrich valid segments while isolating one invalid link', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-semantic-reconcile-'));
  try {
    const session = fixtureSession(root);
    const events = session.items.map((item) => captureEventFromSessionItem(session, item));
    const date = events[0].date;
    const recognition = new Map(events.map((event) => [event.id, { status: 'completed', ocrText: '二次函数练习与订正' }]));
    const groups = preSegmentEvents(events).map((group) => ({ events: group, keyFrames: selectKeyFrames(group) }));
    const segments = buildSegments(session, groups, recognition);
    assert.ok(segments.length >= 2, 'fixture should create at least two segments');
    const memory = buildMemory(session, date, segments);
    persistSemanticResult(root, session, { [date]: segments }, { [date]: memory }, {
      schema: 'edu-manager.capture-session-material-bundle.v1', bundleId: 'bundle-reconcile', studentId: session.studentId, sourceSessionId: session.id, sourceEventIds: events.map((event) => event.id), keyFrames: [], segmentIds: segments.map((item) => item.segmentId), status: 'pending_digest', candidateSummary: memory.candidateSummary,
    });
    const result = reconcileDigestResult(root, {
      studentId: session.studentId,
      sessionId: session.id,
      bundleId: 'bundle-reconcile',
      digestBatchId: 'digest-1',
      knowledgeTargets: [{ targetId: 'knowledge-1', title: '二次函数知识卡', path: path.join(root, 'knowledge.md') }],
      receipt: {
        timelineResults: [
          { segmentId: segments[0].segmentId, sourceEventIds: [segments[0].sourceEventIds[0]], formalSummary: '完成二次函数练习并形成订正记录。', knowledgeAssetIds: ['knowledge-1'], guidanceResponses: ['继续复习错题。'] },
          { segmentId: segments[1].segmentId, studentId: 'other-student', sourceEventIds: [segments[1].sourceEventIds[0]], formalSummary: '不得写入。' },
        ],
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.isolatedFailures, 1);
    const page = querySegments(root, { studentId: session.studentId, date });
    const accepted = page.segments.find((segment) => segment.segmentId === segments[0].segmentId);
    const isolated = page.segments.find((segment) => segment.segmentId === segments[1].segmentId);
    assert.equal(accepted.knowledgeState, 'formal_knowledge_linked');
    assert.equal(accepted.guidanceResponses[0].text, '继续复习错题。');
    assert.equal(isolated.digestStatus, 'link_isolated');
    assert.equal(isolated.formalSummary, '');
    assert.equal(page.memory.formalKnowledgeCount, 1);
    assert.equal(findKnowledgeLinks(root, { studentId: session.studentId, targetId: 'knowledge-1' })[0].segmentId, segments[0].segmentId);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('digest reconciliation isolates a mismatched source hash without rolling back valid segments', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-semantic-hash-'));
  try {
    const session = fixtureSession(root);
    const events = session.items.map((item) => captureEventFromSessionItem(session, item));
    const date = events[0].date;
    const recognition = new Map(events.map((event) => [event.id, { status: 'completed', ocrText: '哈希校验学习记录' }]));
    const groups = preSegmentEvents(events).map((group) => ({ events: group, keyFrames: selectKeyFrames(group) }));
    const segments = buildSegments(session, groups, recognition);
    const memory = buildMemory(session, date, segments);
    const firstEventId = segments[0].sourceEventIds[0];
    persistSemanticResult(root, session, { [date]: segments }, { [date]: memory }, {
      schema: 'edu-manager.capture-session-material-bundle.v1', bundleId: 'bundle-hash', studentId: session.studentId, sourceSessionId: session.id,
      sourceEventIds: events.map((event) => event.id), sourceHashes: { [firstEventId]: 'expected-sha1' }, keyFrames: [], segmentIds: segments.map((item) => item.segmentId), status: 'pending_digest', candidateSummary: memory.candidateSummary,
    });
    const result = reconcileDigestResult(root, {
      studentId: session.studentId,
      sessionId: session.id,
      bundleId: 'bundle-hash',
      digestBatchId: 'digest-hash',
      receipt: { timelineResults: [{ segmentId: segments[0].segmentId, sourceEventIds: [firstEventId], sourceHashes: { [firstEventId]: 'wrong-sha1' }, formalSummary: '不得写入。' }] },
    });
    assert.ok(result.updatedSegments >= 1);
    assert.ok(result.isolatedFailures >= 1);
    const isolated = querySegments(root, { studentId: session.studentId, date }).segments.find((segment) => segment.segmentId === segments[0].segmentId);
    assert.equal(isolated.digestStatus, 'link_isolated');
    assert.ok(isolated.linkErrors.includes('source_hash_mismatch'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('v3 accepts only system-delivered visual claims and keeps valid claims when a comparison fails', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-semantic-v3-'));
  try {
    const session = fixtureSession(root);
    const events = session.items.map((item) => captureEventFromSessionItem(session, item));
    const date = events[0].date;
    const groups = preSegmentEvents(events).map((group) => ({ events: group, keyFrames: selectKeyFrames(group) }));
    const segments = buildSegments(session, groups, new Map(), { factualOnly: true });
    const segment = segments[0];
    const [firstId, secondId] = segment.keyEventIds.slice(0, 2);
    assert.ok(firstId && secondId);
    const hashes = { [firstId]: 'hash-first', [secondId]: 'hash-second' };
    persistSemanticResult(root, session, { [date]: segments }, { [date]: buildMemory(session, date, segments) }, {
      schema: 'edu-manager.capture-session-material-bundle.v1', bundleId: 'bundle-v3', studentId: session.studentId,
      sourceSessionId: session.id, sourceEventIds: events.map((event) => event.id), sourceHashes: hashes,
      visionBatches: [{ batchId: 'vision-1', eventIds: [firstId, secondId] }], keyFrames: [],
      segmentIds: segments.map((item) => item.segmentId), status: 'pending_digest',
    });
    const receipt = {
      schema: 'edu-manager.capture-digest-observation.v3',
      timelineObservations: [{
        segmentId: segment.segmentId, sourceEventIds: [firstId, secondId], sourceHashes: hashes,
        claims: [
          { kind: 'observed_action', text: '查看一道练习题', evidenceRefs: [{ sourceType: 'capture_event', sourceId: firstId }] },
          { kind: 'observed_change', text: '步骤有所修改', evidenceRefs: [{ sourceType: 'capture_event', sourceId: firstId }, { sourceType: 'capture_event', sourceId: secondId }] },
        ],
        guidanceResponses: [{ text: '复查订正步骤', evidenceRefs: [{ sourceType: 'capture_event', sourceId: firstId }] }],
      }],
      behaviorLabels: [{ segmentId: segment.segmentId, activityType: 'practice', evidenceRefs: [{ sourceType: 'capture_event', sourceId: firstId }] }],
    };
    const result = reconcileDigestResult(root, {
      studentId: session.studentId, sessionId: session.id, bundleId: 'bundle-v3', digestBatchId: 'digest-v3', receipt,
      deliveryRecords: [
        { eventId: firstId, contentHash: hashes[firstId], status: 'cli_completed_with_attachment', readOnly: true, requestId: 'request-1' },
        { eventId: secondId, contentHash: hashes[secondId], status: 'cli_completed_with_attachment', readOnly: true, requestId: 'request-2' },
      ],
    });
    assert.equal(result.ok, true);
    const updated = querySegments(root, { studentId: session.studentId, date }).segments.find((item) => item.segmentId === segment.segmentId);
    assert.equal(updated.observationStatus, 'accepted');
    assert.equal(updated.observation.observedAction, '查看一道练习题');
    assert.equal(updated.observation.difficultyOrChange, '');
    assert.equal(updated.observation.activityType, 'practice');
    assert.equal(updated.guidanceResponses[0].evidenceRefs[0].sourceId, firstId);
    assert.equal(result.reports.ok, true);
    assert.equal(querySegments(root, { studentId: session.studentId, date }).reports.day.timelineReport.guidance[0].segmentId, segment.segmentId);
    assert.ok(updated.linkErrors.includes('comparison_request_missing'));
    assert.equal(updated.visualReadStatus, 'delivery_recorded');
    const visionOnly = reconcileDigestResult(root, {
      studentId: session.studentId, sessionId: session.id, bundleId: 'bundle-v3', digestBatchId: 'vision-only', receipt,
      visionOnly: true,
      deliveryRecords: [{ eventId: firstId, contentHash: hashes[firstId], status: 'cli_completed_with_attachment', readOnly: true, requestId: 'request-1' }],
    });
    assert.equal(visionOnly.ok, true);
    const afterVision = querySegments(root, { studentId: session.studentId, date }).segments.find((item) => item.segmentId === segment.segmentId);
    assert.equal(afterVision.digestBatchId, 'digest-v3', 'visual reconciliation does not replace the formal digest batch');
    assert.equal(afterVision.knowledgeState, updated.knowledgeState, 'visual reconciliation does not replace formal knowledge state');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('recognition cache pruning retains referenced artifacts and removes cache-only artifacts first', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-semantic-prune-'));
  try {
    const referenced = recognitionPath(root, 'student-1', 'sha1', 'referenced', STRATEGY_VERSION);
    atomicWriteJson(referenced, { status: 'completed', referenceCount: 1, retentionState: 'referenced', createdAt: '2026-01-01T00:00:00.000Z' });
    for (let index = 0; index < 501; index += 1) {
      atomicWriteJson(recognitionPath(root, 'student-1', 'sha1', `cache-${index}`, STRATEGY_VERSION), { status: 'completed', referenceCount: 0, retentionState: 'cache_only', createdAt: new Date(Date.parse('2026-01-02T00:00:00.000Z') + index).toISOString() });
    }
    const result = pruneRecognitionCache(root, 'student-1', 500);
    assert.equal(result.removed, 2);
    assert.equal(fs.existsSync(referenced), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('worker creates vision batches of at most eight and isolates evidence from formal raw storage', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-semantic-batches-'));
  try {
    const rawDir = path.join(root, 'raw');
    fs.mkdirSync(rawDir, { recursive: true });
    const session = fixtureSession(rawDir);
    session.semanticTarget = { rawDir, targetMode: 'student_raw', targetId: session.studentId };
    for (const item of session.items) {
      const hash = crypto.createHash('sha1').update(fs.readFileSync(item.path)).digest('hex');
      item.hashAlgorithm = 'sha1';
      item.contentHash = hash;
      atomicWriteJson(recognitionPath(root, session.studentId, 'sha1', hash, STRATEGY_VERSION), {
        status: 'completed', hashAlgorithm: 'sha1', contentHash: hash, recognitionStrategyVersion: STRATEGY_VERSION,
        ocrText: `学习页面 ${item.id}`, referenceCount: 0, retentionState: 'cache_only', createdAt: new Date().toISOString(), lastAccessedAt: new Date().toISOString(),
      });
    }
    const result = await processSession(root, session);
    assert.ok(result.bundle.visionBatches.every((batch) => batch.eventIds.length <= 8));
    assert.equal(result.bundle.sourceHashes[result.bundle.keyFrames[0].eventId], result.bundle.keyFrames[0].contentHash);
    assert.ok(result.publishedEvidencePaths.every((evidencePath) => evidencePath.startsWith(captureEvidenceRoot(root, session.studentId, session.id))));
    assert.ok(result.publishedEvidencePaths.every((evidencePath) => fs.existsSync(evidencePath)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('reprocessing the same session is idempotent and does not duplicate semantic output', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-semantic-idempotent-'));
  try {
    const rawDir = path.join(root, 'raw');
    fs.mkdirSync(rawDir, { recursive: true });
    const session = fixtureSession(rawDir);
    session.semanticTarget = { rawDir, targetMode: 'student_raw', targetId: session.studentId };
    const first = await processSession(root, session);
    const firstPage = querySegments(root, { studentId: session.studentId, date: '2026-09-12', limit: 100 });
    const second = await processSession(root, session);
    const secondPage = querySegments(root, { studentId: session.studentId, date: '2026-09-12', limit: 100 });
    assert.equal(second.bundle.bundleId, first.bundle.bundleId);
    assert.deepEqual(second.bundle.segmentIds, first.bundle.segmentIds);
    assert.equal(secondPage.total, firstPage.total);
    assert.equal(new Set(secondPage.segments.map((segment) => segment.segmentId)).size, secondPage.segments.length);
    assert.equal(second.cacheHits, 0);
    assert.deepEqual(second.bundle.sourceHashes, first.bundle.sourceHashes);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('capture events retain local calendar ordering across midnight', () => {
  const session = { id: 'session-midnight', studentId: 'student-1', studentName: '测试学生', sourceName: '课程窗口' };
  const beforeMidnight = new Date(2026, 8, 12, 23, 59, 59).toISOString();
  const afterMidnight = new Date(2026, 8, 13, 0, 0, 1).toISOString();
  const first = captureEventFromSessionItem(session, { id: 'before', capturedAt: beforeMidnight });
  const second = captureEventFromSessionItem(session, { id: 'after', capturedAt: afterMidnight });
  assert.equal(first.date, '2026-09-12');
  assert.equal(second.date, '2026-09-13');
  assert.ok(Date.parse(first.occurredAt) < Date.parse(second.occurredAt));
});

test('adaptive concurrency needs no user setting and moves between zero, one and two', () => {
  assert.equal(adaptiveConcurrency({ captureActive: true, idleSeconds: 500, availableMemoryRatio: 0.8 }), 0);
  assert.equal(adaptiveConcurrency({ onBattery: true, idleSeconds: 500, availableMemoryRatio: 0.8 }), 1);
  assert.equal(adaptiveConcurrency({ idleSeconds: 20, availableMemoryRatio: 0.8 }), 1);
  assert.equal(adaptiveConcurrency({ idleSeconds: 120, availableMemoryRatio: 0.8 }), 2);
  assert.equal(adaptiveConcurrency({ idleSeconds: 120, availableMemoryRatio: 0.1 }), 0);
  assert.equal(adaptiveConcurrency({ externalHeavyWorkActive: true, idleSeconds: 120, availableMemoryRatio: 0.8 }), 0);
  assert.equal(adaptiveConcurrency({ cpuPressure: true, idleSeconds: 120, availableMemoryRatio: 0.8 }), 0);
});

test('capture yield is cooperative and sent once without terminating the active worker', () => {
  const scheduler = new CaptureTimelineScheduler({ rootPath: os.tmpdir() });
  let requests = 0;
  let terminated = 0;
  scheduler.running.set('session-1', {
    session: { id: 'session-1', studentId: 'student-1' },
    worker: { postMessage: (message) => { assert.equal(message.type, 'yield_for_capture'); requests += 1; }, terminate: () => { terminated += 1; } },
  });
  scheduler.yieldForCapture();
  scheduler.yieldForCapture();
  assert.equal(requests, 1);
  assert.equal(terminated, 0);
  assert.equal(scheduler.running.size, 1);
});

test('persistent scheduler restores unfinished work and falls back to recovery without user action', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-semantic-scheduler-'));
  try {
    const session = { id: 'restore-session', studentId: 'student-1', items: [] };
    const scheduler = new CaptureTimelineScheduler({ rootPath: root, loadSession: (sessionId) => sessionId === session.id ? session : null });
    scheduler.enqueue(session, { delayMs: 60_000, state: 'retry_scheduled', attempt: 2 });
    const restored = new CaptureTimelineScheduler({ rootPath: root, loadSession: (sessionId) => sessionId === session.id ? session : null });
    restored.restorePendingJobs();
    assert.equal(restored.state().queued[0].sessionId, session.id);
    restored.fail({ session, attempt: 4, enqueuedAt: Date.now() }, 'dependency unavailable');
    const job = readProcessingJob(root, session.studentId, session.id);
    assert.equal(job.state, 'recovery_scheduled');
    assert.equal(job.requiresUserAction, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('PowerShell OCR worker contract is non-interactive and returns structured fallback', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'electron', 'capture-timeline-ocr.ps1'), 'utf8');
  assert.match(script, /ConvertTo-Json/);
  assert.match(script, /OcrEngine/);
  assert.match(script, /thumbnailAvailable/);
  assert.doesNotMatch(script, /Read-Host|Out-GridView/);
});
