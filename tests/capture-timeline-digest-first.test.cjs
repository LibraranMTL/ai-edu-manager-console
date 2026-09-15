const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { processSession } = require('../electron/capture-timeline-worker.cjs');
const { deleteSemanticSession, querySegments, reconcileDigestResult } = require('../electron/capture-timeline-semantic.cjs');
const { readReports, reportRepairJobPath, writeReportRepairJob } = require('../electron/capture-timeline-reports.cjs');
const { deleteSessionEvents, localDateKey, rebuildSessionTimeline } = require('../electron/capture-timeline.cjs');
const { createAgentMemoryStore } = require('../electron/agent-memory-v1.cjs');
const { CaptureTimelineScheduler } = require('../electron/capture-timeline-scheduler.cjs');

function sessionFixture(root, count = 12) {
  const rawDir = path.join(root, 'raw');
  fs.mkdirSync(rawDir, { recursive: true });
  const start = new Date(2026, 8, 12, 10, 0, 0).getTime();
  const items = Array.from({ length: count }, (_, index) => {
    const file = path.join(root, `frame-${index}.png`);
    fs.writeFileSync(file, `frame-${index}`);
    return { id: `event-${index}`, path: file, capturedAt: new Date(start + index * 60_000).toISOString(), difference: index % 8 === 0 ? 0.9 : 0.1 };
  });
  return {
    id: 'capture-test', studentId: 'student-1', projectId: 'project-1',
    studentName: '测试学生', sourceName: '课程窗口', startedAt: items[0].capturedAt,
    endedAt: items.at(-1).capturedAt, items,
    semanticTarget: { rawDir },
    allowedEvidenceRefs: [{ sourceType: 'agent_session', sourceId: 'authorized-session', supportsReason: false }],
  };
}

test('digest-first bundle selects at most twenty frames and never performs pre-digest OCR', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-digest-first-'));
  try {
    const result = await processSession(root, sessionFixture(root, 100));
    assert.equal(result.ok, true);
    assert.ok(result.keyFrameCount <= 20);
    assert.equal(result.recognizedKeyFrameCount, 0);
    assert.ok(result.segments.every((segment) => segment.recognitionStatus === 'pending_digest' && segment.category === 'unknown'));
    assert.equal(fs.existsSync(path.join(root, 'recognition')), false);
    assert.ok(result.bundle.visionBatches.every((batch) => batch.eventIds.length <= 8));
    const markdown = fs.readFileSync(result.publishedBundlePath, 'utf8');
    for (const segment of result.segments) assert.ok(markdown.includes(segment.segmentId));
    assert.ok(markdown.includes('timelineObservations'));
    assert.ok(!markdown.includes('可选视觉复核批次'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('only finalized and authorized same-project Agent sessions become multi-source candidates', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-digest-agent-scope-'));
  try {
    const session = sessionFixture(root, 2);
    session.allowedEvidenceRefs = [];
    const agentMemoryRootPath = path.join(root, 'agent-memory');
    const store = createAgentMemoryStore({ rootDir: agentMemoryRootPath, now: () => session.startedAt });
    store.updateSettings(session.studentId, { automationEnabled: true, allowedAgents: ['codex'] });
    for (const [id, projectId, agentId] of [['allowed', 'project-1', 'codex'], ['other-project', 'project-2', 'codex'], ['other-agent', 'project-1', 'qclaw']]) {
      store.startSession({ studentId: session.studentId, projectId, agentId, sessionId: id, origin: 'authorized_agent' });
      store.appendMessages({ studentId: session.studentId, sessionId: id, messages: [{ role: 'user', content: '我正在练习二次函数。' }] });
      store.finalizeSession({ studentId: session.studentId, sessionId: id });
    }
    session.agentMemoryRootPath = agentMemoryRootPath;
    const processed = await processSession(root, session);
    assert.deepEqual(processed.bundle.allowedEvidenceRefs.filter((ref) => ref.sourceType === 'agent_session').map((ref) => ref.sourceId), ['allowed']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('unverified image claims stay candidate; authorized nonvisual evidence yields independent reports', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-digest-reports-'));
  try {
    const session = sessionFixture(root);
    const conversationFile = path.join(root, 'authorized-conversation.md');
    fs.writeFileSync(conversationFile, '我发现因为步骤漏了检查，所以重新计算。', 'utf8');
    session.allowedEvidenceRefs[0].path = conversationFile;
    session.allowedEvidenceRefs[0].supportsReason = true;
    rebuildSessionTimeline(root, session);
    const processed = await processSession(root, session);
    assert.ok(processed.segments.length >= 1);
    const segment = processed.segments[0];
    const eventId = segment.keyEventIds[0];
    const sourceHashes = { [eventId]: processed.bundle.sourceHashes[eventId] };
    const first = reconcileDigestResult(root, {
      studentId: session.studentId, sessionId: session.id, bundleId: processed.bundle.bundleId, digestBatchId: 'digest-1',
      receipt: { timelineObservations: [{
        segmentId: segment.segmentId, sourceEventIds: [eventId], sourceHashes,
        viewedEventIds: [eventId], activityType: 'practice', observedAction: '修改步骤',
        attempts: ['第一次求解'], evidenceRefs: [{ sourceType: 'capture_event', sourceId: eventId }], confidence: 0.9,
      }] },
    });
    assert.equal(first.ok, true);
    const date = localDateKey(session.startedAt);
    const candidate = querySegments(root, { studentId: session.studentId, date }).segments.find((item) => item.segmentId === segment.segmentId);
    assert.equal(candidate.observationStatus, 'candidate_unverified');
    assert.equal(candidate.visualReadStatus, 'declared_unverified');
    const second = reconcileDigestResult(root, {
      studentId: session.studentId, sessionId: session.id, bundleId: processed.bundle.bundleId, digestBatchId: 'digest-1',
      receipt: { timelineObservations: [{
        segmentId: segment.segmentId, sourceEventIds: [eventId], sourceHashes,
        activityType: 'practice', topic: '二次函数练习', observedAction: '依据已授权会话复盘解题步骤',
        attempts: ['第一次求解'], obstacle: '步骤有遗漏', difficultyOrChange: '补上检查步骤',
        observedOutcome: '完成修订', reason: '推测为时间不足',
        evidenceRefs: [{ sourceType: 'agent_session', sourceId: 'authorized-session' }],
        reasonEvidenceRefs: [{ sourceType: 'agent_session', sourceId: 'authorized-session' }], confidence: 0.9,
      }] },
    });
    assert.equal(second.ok, true);
    assert.equal(second.reports.ok, true);
    const accepted = querySegments(root, { studentId: session.studentId, date }).segments.find((item) => item.segmentId === segment.segmentId);
    assert.equal(accepted.observationStatus, 'accepted');
    assert.equal(accepted.observation.reason, null);
    const reports = readReports(root, session.studentId, date, session.id);
    assert.equal(reports.day.behaviorReport.screenshotCount, session.items.length);
    assert.equal(reports.day.behaviorReport.activitySegmentCounts.practice, 1);
    assert.equal(reports.day.behaviorReport.hours.reduce((sum, hour) => sum + hour.segmentCount, 0), processed.segments.length);
    assert.equal(reports.day.behaviorReport.durationMinutes, null);
    assert.equal(reports.day.timelineReport.observedCount, 1);
    assert.equal(reports.session.timelineReport.attempts[0].segmentId, segment.segmentId);
    assert.equal(reports.week.behaviorReport.screenshotCount, session.items.length);
    reconcileDigestResult(root, {
      studentId: session.studentId, sessionId: session.id, bundleId: processed.bundle.bundleId, digestBatchId: 'digest-1',
      receipt: { timelineObservations: [{ segmentId: segment.segmentId, sourceEventIds: [eventId], sourceHashes,
        activityType: 'practice', observedAction: '复盘步骤', reason: '步骤漏了检查',
        reasonEvidenceRefs: [{ sourceType: 'agent_session', sourceId: 'authorized-session', quote: '因为步骤漏了检查，所以重新计算' }],
        evidenceRefs: [{ sourceType: 'agent_session', sourceId: 'authorized-session' }], confidence: 0.9 }] },
    });
    assert.equal(querySegments(root, { studentId: session.studentId, date }).segments.find((item) => item.segmentId === segment.segmentId).observation.reason, '步骤漏了检查');
    reconcileDigestResult(root, {
      studentId: session.studentId, sessionId: session.id, bundleId: processed.bundle.bundleId, digestBatchId: 'digest-1',
      receipt: { timelineObservations: [{ segmentId: segment.segmentId, sourceEventIds: [eventId], sourceHashes,
        activityType: 'practice', observedAction: '复盘解题步骤', attempts: ['第一次求解'],
        evidenceRefs: [{ sourceType: 'agent_session', sourceId: 'authorized-session' }], confidence: 0.9 }] },
    });
    assert.equal(readReports(root, session.studentId, date).day.behaviorReport.screenshotCount, session.items.length);
    reconcileDigestResult(root, {
      studentId: session.studentId, sessionId: session.id, bundleId: processed.bundle.bundleId, digestBatchId: 'digest-1',
      receipt: { timelineObservations: [] },
    });
    assert.equal(querySegments(root, { studentId: session.studentId, date }).segments.find((item) => item.segmentId === segment.segmentId).observationStatus, 'accepted');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('cross-midnight facts land in separate local days and one session report', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-digest-midnight-'));
  try {
    const session = sessionFixture(root, 2);
    session.items[0].capturedAt = new Date(2026, 8, 12, 23, 59, 0).toISOString();
    session.items[1].capturedAt = new Date(2026, 8, 13, 0, 1, 0).toISOString();
    session.startedAt = session.items[0].capturedAt;
    session.endedAt = session.items[1].capturedAt;
    rebuildSessionTimeline(root, session);
    const processed = await processSession(root, session);
    reconcileDigestResult(root, { studentId: session.studentId, sessionId: session.id, bundleId: processed.bundle.bundleId, digestBatchId: 'digest-midnight', receipt: { timelineObservations: [] } });
    const first = readReports(root, session.studentId, '2026-09-12', session.id);
    const second = readReports(root, session.studentId, '2026-09-13', session.id);
    assert.equal(first.day.behaviorReport.screenshotCount, 1);
    assert.equal(second.day.behaviorReport.screenshotCount, 1);
    assert.equal(first.session.timelineReport.segmentCount, 2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('deleting a session removes its report and recomputes affected day totals', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-digest-delete-'));
  try {
    const session = sessionFixture(root, 2);
    const date = localDateKey(session.startedAt);
    rebuildSessionTimeline(root, session);
    const processed = await processSession(root, session);
    reconcileDigestResult(root, { studentId: session.studentId, sessionId: session.id, bundleId: processed.bundle.bundleId, digestBatchId: 'digest-delete', receipt: { timelineObservations: [] } });
    assert.equal(readReports(root, session.studentId, date).day.behaviorReport.screenshotCount, 2);
    deleteSessionEvents(root, session.studentId, session.id);
    deleteSemanticSession(root, session.studentId, session.id);
    assert.equal(readReports(root, session.studentId, date, session.id).session, null);
    assert.equal(readReports(root, session.studentId, date).day.behaviorReport.screenshotCount, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('report repair resumes from durable job without user action', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-report-repair-'));
  const scheduler = new CaptureTimelineScheduler({
    rootPath: root,
    getResourceSnapshot: () => ({ availableMemoryRatio: 0.5, idleSeconds: 0, onBattery: true }),
  });
  try {
    writeReportRepairJob(root, { studentId: 'student-1', sessionId: 'session-1', dates: ['2026-09-12'], state: 'retry_scheduled', attempt: 1, nextRetryAt: new Date(Date.now() - 1000).toISOString(), requiresUserAction: false });
    scheduler.start();
    const target = reportRepairJobPath(root, 'student-1', 'session-1');
    const deadline = Date.now() + 3000;
    let state = '';
    while (Date.now() < deadline) {
      state = JSON.parse(fs.readFileSync(target, 'utf8')).state;
      if (state === 'completed') break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(state, 'completed');
    assert.equal(readReports(root, 'student-1', '2026-09-12').day.behaviorReport.screenshotCount, 0);
  } finally {
    scheduler.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
