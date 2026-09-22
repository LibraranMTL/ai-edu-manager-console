const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { runBundleVision, visionResultPath } = require('../electron/capture-timeline-vision.cjs');
const { processSession } = require('../electron/capture-timeline-worker.cjs');
const { captureEvidenceRoot, visionManifestPath } = require('../electron/capture-timeline-semantic.cjs');

function fixture(root) {
  const rawDir = path.join(root, 'student-raw');
  fs.mkdirSync(rawDir, { recursive: true });
  const frames = ['event-a', 'event-b'].map((eventId, index) => {
    const evidencePath = path.join(rawDir, `${eventId}.png`);
    fs.writeFileSync(evidencePath, Buffer.alloc(64, index + 1));
    const contentHash = crypto.createHash('sha1').update(fs.readFileSync(evidencePath)).digest('hex');
    return { eventId, evidencePath, contentHash, capturedAt: `2026-09-14T09:0${index}:00.000Z` };
  });
  const bundle = {
    bundleId: 'bundle-test', studentId: 'student-1', projectId: '', sourceSessionId: 'session-1',
    keyFrames: frames.map(({ eventId, contentHash, capturedAt }) => ({ eventId, contentHash, capturedAt })),
    sourceHashes: Object.fromEntries(frames.map(({ eventId, contentHash }) => [eventId, contentHash])),
    visionBatches: [{ batchId: 'vision-1', eventIds: frames.map((frame) => frame.eventId) }],
    segmentRefs: [{ segmentId: 'segment-1', sourceEventIds: frames.map((frame) => frame.eventId) }],
  };
  const manifest = { ...bundle, keyFrames: frames };
  return { rawDir, bundle, manifest, frames };
}

test('newly promoted capture delivers images only from separated capture evidence storage', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-vision-separated-'));
  try {
    const rawDir = path.join(root, 'student-raw');
    const items = ['a', 'b'].map((label, index) => {
      const file = path.join(root, `source-${label}.png`);
      fs.writeFileSync(file, Buffer.alloc(64, index + 1));
      return { id: `event-${label}`, path: file, capturedAt: `2026-09-14T09:0${index}:00.000Z` };
    });
    const session = { id: 'separated-session', studentId: 'student-1', studentName: '测试学生',
      sourceName: '学习窗口', startedAt: items[0].capturedAt, endedAt: items.at(-1).capturedAt,
      items, semanticTarget: { rawDir } };
    const processed = await processSession(root, session);
    const manifest = JSON.parse(fs.readFileSync(visionManifestPath(root, session.studentId, session.id), 'utf8'));
    const evidenceRoot = captureEvidenceRoot(root, session.studentId, session.id);
    let sent = 0;
    const vision = await runBundleVision({ rootPath: root, rawDir: evidenceRoot,
      bundle: processed.bundle, manifest, consentEpoch: 'separated-consent', isAuthorized: () => true,
      execute: async ({ imagePaths }) => {
        sent += imagePaths.length;
        assert.ok(imagePaths.every((file) => file.startsWith(evidenceRoot)));
        return { ok: true, output: '{"timelineObservations":[],"behaviorLabels":[]}' };
      } });
    assert.equal(vision.ok, true);
    assert.ok(sent > 0);
    assert.ok(fs.readdirSync(path.join(rawDir, '屏幕学习会话')).every((name) => name.endsWith('.md')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Codex image delivery is system-recorded and visual claims retain exact event evidence', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-vision-test-'));
  try {
    const { rawDir, bundle, manifest, frames } = fixture(root);
    let calls = 0;
    const execute = async ({ imagePaths, prompt, requestId }) => {
      calls += 1;
      assert.deepEqual(imagePaths, frames.map((frame) => frame.evidencePath));
      assert.match(prompt, /event-a/);
      assert.match(requestId, /^vision-/);
      return { ok: true, output: JSON.stringify({
        timelineObservations: [{ segmentId: 'segment-1', claims: [
          { kind: 'observed_action', text: '打开练习页面', evidenceRefs: [{ sourceType: 'capture_event', sourceId: 'event-a' }] },
          { kind: 'observed_change', text: '页面出现订正结果', evidenceRefs: [
            { sourceType: 'capture_event', sourceId: 'event-a' }, { sourceType: 'capture_event', sourceId: 'event-b' },
          ] },
          { kind: 'observed_outcome', text: '越权引用', evidenceRefs: [{ sourceType: 'capture_event', sourceId: 'other-student' }] },
        ] }],
        behaviorLabels: [{ segmentId: 'segment-1', activityType: 'practice', evidenceRefs: [{ sourceType: 'capture_event', sourceId: 'event-a' }] }],
      }) };
    };
    const options = { rootPath: root, rawDir, bundle, manifest, executable: 'mock-codex', execute, isAuthorized: () => true, consentEpoch: 'consent-1' };
    const result = await runBundleVision(options);
    assert.equal(result.ok, true);
    assert.equal(calls, 1);
    assert.equal(result.state.deliveryRecords.length, 2);
    assert.ok(result.state.deliveryRecords.every((record) => record.status === 'cli_completed_with_attachment' && record.readOnly));
    assert.equal(result.state.timelineObservations.length, 1);
    assert.equal(result.state.timelineObservations[0].claims.length, 2);
    assert.deepEqual(result.state.timelineObservations[0].sourceEventIds, ['event-a', 'event-b']);
    assert.equal(fs.existsSync(visionResultPath(root, bundle.studentId, bundle.sourceSessionId)), true);
    await runBundleVision(options);
    assert.equal(calls, 1, 'completed batch is idempotent');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('revoked consent and changed source bytes never invoke Codex', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-vision-guard-'));
  try {
    const { rawDir, bundle, manifest, frames } = fixture(root);
    let calls = 0;
    const execute = async () => { calls += 1; return { ok: true, output: '{"timelineObservations":[]}' }; };
    const revoked = await runBundleVision({ rootPath: root, rawDir, bundle, manifest, executable: 'mock', execute, isAuthorized: () => false, consentEpoch: 'first' });
    assert.equal(revoked.reason, 'authorization_missing');
    fs.writeFileSync(frames[0].evidencePath, Buffer.alloc(64, 9));
    fs.writeFileSync(frames[1].evidencePath, Buffer.alloc(64, 9));
    const changed = await runBundleVision({ rootPath: root, rawDir, bundle, manifest, executable: 'mock', execute, isAuthorized: () => true, consentEpoch: 'first' });
    assert.equal(changed.ok, true);
    assert.equal(calls, 0);
    assert.equal(changed.state.deliveryRecords.length, 0);
    assert.equal(changed.state.failures[0].code, 'image_missing_or_changed');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('capture starting between visual batches yields at a durable boundary without resending completed images', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-vision-yield-'));
  try {
    const { rawDir, bundle, manifest } = fixture(root);
    bundle.visionBatches = [
      { batchId: 'vision-1', eventIds: ['event-a'] },
      { batchId: 'vision-2', eventIds: ['event-b'] },
    ];
    manifest.visionBatches = bundle.visionBatches;
    let captureActive = false;
    const sent = [];
    const options = {
      rootPath: root, rawDir, bundle, manifest, consentEpoch: 'yield-consent', isAuthorized: () => true,
      shouldYield: () => captureActive,
      execute: async ({ imagePaths }) => {
        sent.push(imagePaths.map((item) => path.basename(item)));
        captureActive = true;
        return { ok: true, output: '{"timelineObservations":[],"behaviorLabels":[]}' };
      },
    };
    const yielded = await runBundleVision(options);
    assert.equal(yielded.reason, 'resource_yield');
    assert.deepEqual(yielded.state.completedBatchIds, ['vision-1']);
    assert.equal(yielded.state.status, 'waiting_resource');
    captureActive = false;
    const resumed = await runBundleVision(options);
    assert.equal(resumed.ok, true);
    assert.deepEqual(sent, [['event-a.png'], ['event-b.png']]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('non-Codex visual routes require fresh provider-specific safety proof before any image executor runs', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-vision-provider-guard-'));
  try {
    const { rawDir, bundle, manifest } = fixture(root);
    let calls = 0;
    const base = { rootPath: root, rawDir, bundle, manifest, providerId: 'workbuddy', processingLocation: 'unknown',
      consentEpoch: 'provider-consent', isAuthorized: () => true,
      execute: async () => { calls += 1; return { ok: true, output: '{"timelineObservations":[],"behaviorLabels":[]}' }; } };
    await assert.rejects(runBundleVision(base), /vision_provider_safety_not_verified/);
    assert.equal(calls, 0);
    const mockVerified = await runBundleVision({ ...base, providerId: 'qclaw', processingLocation: 'local_ollama',
      providerCapability: { providerId: 'qclaw', status: 'passed', readOnlyIsolation: 'verified',
        processingLocation: 'local_ollama', verifiedAt: new Date().toISOString() } });
    assert.equal(mockVerified.ok, true);
    assert.equal(calls, 1);
    assert.ok(mockVerified.state.deliveryRecords.every((record) => record.provider === 'qclaw' && record.processingLocation === 'local_ollama'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('invalid visual responses are retried at most three times without accepting claims', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-vision-retry-'));
  try {
    const { rawDir, bundle, manifest } = fixture(root);
    let calls = 0;
    const options = {
      rootPath: root, rawDir, bundle, manifest, executable: 'mock', consentEpoch: 'once', isAuthorized: () => true,
      execute: async () => { calls += 1; return { ok: true, output: '{invalid-json' }; },
    };
    for (let index = 0; index < 4; index += 1) await runBundleVision(options);
    const result = await runBundleVision(options);
    assert.equal(calls, 3);
    assert.equal(result.state.status, 'degraded');
    assert.equal(result.state.timelineObservations.length, 0);
    assert.equal(result.state.failedBatchIds.length, 1);
    assert.equal(result.state.deliveryRecords.length, 2, 'CLI completion remains audited even when result parsing fails');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('bounded Codex failure can retain local OCR text without upgrading it to visual understanding', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-vision-ocr-'));
  try {
    const { rawDir, bundle, manifest } = fixture(root);
    const options = {
      rootPath: root, rawDir, bundle, manifest, executable: 'mock', consentEpoch: 'once', isAuthorized: () => true,
      execute: async () => ({ ok: false, code: 'codex_execution_failed' }),
      ocrFallback: async (frames) => [{ eventId: frames[0].eventId, contentHash: frames[0].expected, text: '  二次函数 练习题 ' }],
    };
    for (let index = 0; index < 3; index += 1) await runBundleVision(options);
    const result = await runBundleVision(options);
    assert.equal(result.state.status, 'degraded');
    assert.equal(result.state.timelineObservations[0].claims[0].kind, 'observed_text');
    assert.ok(result.state.deliveryRecords.some((record) => record.status === 'local_ocr'));
    assert.ok(result.state.deliveryRecords.some((record) => record.status === 'unknown'));
    assert.equal(result.state.timelineObservations[0].claims.some((claim) => claim.kind === 'observed_action'), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('unavailable visual CLI falls back to bounded local OCR once and resumes vision when capability returns', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-vision-capability-'));
  try {
    const { rawDir, bundle, manifest } = fixture(root);
    let ocrCalls = 0;
    let visionCalls = 0;
    const base = {
      rootPath: root, rawDir, bundle, manifest, consentEpoch: 'same-consent', isAuthorized: () => true,
      ocrFallback: async (frames) => {
        ocrCalls += 1;
        return [{ eventId: frames[0].eventId, contentHash: frames[0].expected, text: '本机识别的题干' }];
      },
      execute: async () => { visionCalls += 1; return { ok: true, output: '{"timelineObservations":[],"behaviorLabels":[]}' }; },
    };
    const fallback = await runBundleVision({ ...base, localOcrOnly: true });
    assert.equal(fallback.state.status, 'waiting_visual_capability');
    assert.equal(ocrCalls, 1);
    assert.equal(visionCalls, 0, 'CLI 不可用时不得尝试向外部服务传图');
    assert.ok(fallback.state.deliveryRecords.some((record) => record.status === 'local_ocr'));
    await runBundleVision({ ...base, localOcrOnly: true });
    assert.equal(ocrCalls, 1, '等待能力恢复时不得重复 OCR 或重复收费');
    const recovered = await runBundleVision(base);
    assert.equal(recovered.state.status, 'completed');
    assert.equal(visionCalls, 1);
    assert.ok(recovered.state.deliveryRecords.some((record) => record.status === 'cli_completed_with_attachment'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('one missing image does not repeat a successfully delivered sibling on recovery', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-vision-partial-'));
  try {
    const { rawDir, bundle, manifest, frames } = fixture(root);
    fs.unlinkSync(frames[1].evidencePath);
    const submissions = [];
    const options = {
      rootPath: root, rawDir, bundle, manifest, consentEpoch: 'partial-consent', isAuthorized: () => true,
      execute: async ({ imagePaths }) => {
        submissions.push(imagePaths);
        return { ok: true, output: '{"timelineObservations":[],"behaviorLabels":[]}' };
      },
    };
    const partial = await runBundleVision(options);
    assert.equal(partial.state.status, 'retry_scheduled');
    assert.deepEqual(submissions[0], [frames[0].evidencePath]);
    assert.deepEqual(partial.state.visualCompletedEventIds, ['event-a']);
    fs.writeFileSync(frames[1].evidencePath, Buffer.alloc(64, 2));
    const recovered = await runBundleVision(options);
    assert.equal(recovered.state.status, 'completed');
    assert.deepEqual(submissions[1], [frames[1].evidencePath]);
    assert.equal(recovered.state.deliveryRecords.length, 2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a changed frozen source hash invalidates same-session visual cache', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-vision-revision-'));
  try {
    const { rawDir, bundle, manifest, frames } = fixture(root);
    let calls = 0;
    const options = { rootPath: root, rawDir, bundle, manifest, consentEpoch: 'same-epoch', isAuthorized: () => true,
      execute: async () => { calls += 1; return { ok: true, output: '{"timelineObservations":[],"behaviorLabels":[]}' }; } };
    await runBundleVision(options);
    fs.writeFileSync(frames[0].evidencePath, Buffer.alloc(64, 7));
    const changedHash = crypto.createHash('sha1').update(fs.readFileSync(frames[0].evidencePath)).digest('hex');
    bundle.sourceHashes['event-a'] = changedHash;
    bundle.keyFrames[0].contentHash = changedHash;
    manifest.keyFrames[0].contentHash = changedHash;
    const revised = await runBundleVision(options);
    assert.equal(calls, 2);
    assert.equal(revised.state.deliveryRecords.length, 2, '旧来源回执不得冒用到新版冻结清单');
    assert.equal(revised.state.deliveryRecords.find((record) => record.eventId === 'event-a').contentHash, changedHash);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
