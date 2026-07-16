const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CAPTURE_POLICIES,
  captureSaveDecision,
  normalizeCaptureOptions,
  signatureDifference,
} = require('../electron/capture-protocol.cjs');

test('capture policies expose interval, change, and smart modes', () => {
  assert.deepEqual(Object.keys(CAPTURE_POLICIES).sort(), ['change', 'interval', 'smart']);
  assert.equal(normalizeCaptureOptions({ mode: 'unknown' }).mode, 'smart');
  assert.equal(normalizeCaptureOptions({ mode: 'change' }).visualChangeThreshold, 0.16);
});

test('capture options clamp duration and sampling boundaries', () => {
  const options = normalizeCaptureOptions({
    durationMinutes: 0,
    sampleIntervalMs: 100,
    minimumSaveIntervalMs: 50,
    maximumSaveIntervalMs: 10,
  });
  assert.equal(options.durationMinutes, 1);
  assert.equal(options.sampleIntervalMs, 1000);
  assert.equal(options.minimumSaveIntervalMs, 1000);
  assert.equal(options.maximumSaveIntervalMs, 1000);
});

test('identical frames are skipped after the minimum interval', () => {
  const signature = new Array(256).fill(80);
  const result = captureSaveDecision(
    { lastSavedAt: 1000, lastSavedSignature: signature },
    { now: 10000, signature, options: { mode: 'smart', minimumSaveIntervalMs: 5000 } },
  );
  assert.equal(result.save, false);
  assert.equal(result.reason, 'duplicate');
});

test('smart mode saves meaningful changes and maximum-interval frames', () => {
  const previous = new Array(256).fill(0);
  const changed = new Array(256).fill(100);
  const changeResult = captureSaveDecision(
    { lastSavedAt: 1000, lastSavedSignature: previous },
    { now: 10000, signature: changed, options: { mode: 'smart', minimumSaveIntervalMs: 5000, visualChangeThreshold: 0.12 } },
  );
  assert.equal(changeResult.save, true);
  assert.equal(changeResult.reason, 'visual_change');

  const subtle = new Array(256).fill(5);
  const maximumResult = captureSaveDecision(
    { lastSavedAt: 1000, lastSavedSignature: previous },
    { now: 100000, signature: subtle, options: { mode: 'smart', minimumSaveIntervalMs: 5000, maximumSaveIntervalMs: 90000, visualChangeThreshold: 0.12 } },
  );
  assert.equal(maximumResult.save, true);
  assert.equal(maximumResult.reason, 'maximum_interval');
});

test('manual highlight always saves and signatures are normalized', () => {
  const result = captureSaveDecision({}, { now: 1, signature: [1, 2], force: true, highlight: true });
  assert.equal(result.save, true);
  assert.equal(result.reason, 'highlight');
  assert.equal(signatureDifference([0, 255], [255, 0]), 1);
});
