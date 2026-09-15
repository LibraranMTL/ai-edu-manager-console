const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { runBundleVision, visionResultPath } = require('../electron/capture-timeline-vision.cjs');

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
