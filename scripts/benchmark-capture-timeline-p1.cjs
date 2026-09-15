const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { Worker } = require('node:worker_threads');
const {
  querySegments,
} = require('../electron/capture-timeline-semantic.cjs');

const FRAME_COUNT = Math.max(100, Number(process.env.EDU_CAPTURE_P1_BENCHMARK_FRAMES || 100));

function round(value) {
  return Math.round(value * 100) / 100;
}

async function runWorker(workerPath, rootPath, session) {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    let maximumTimerDriftMs = 0;
    let expectedAt = performance.now() + 10;
    const timer = setInterval(() => {
      const now = performance.now();
      maximumTimerDriftMs = Math.max(maximumTimerDriftMs, now - expectedAt);
      expectedAt = now + 10;
    }, 10);
    const worker = new Worker(workerPath, { workerData: { rootPath, session, attempt: 1 } });
    worker.on('message', (message) => {
      if (message?.type === 'completed') {
        clearInterval(timer);
        resolve({ durationMs: performance.now() - startedAt, maximumTimerDriftMs, result: message.result });
      } else if (message?.type === 'failed') {
        clearInterval(timer);
        reject(new Error(message.error?.message || 'timeline worker failed'));
      }
    });
    worker.on('error', (error) => {
      clearInterval(timer);
      reject(error);
    });
  });
}

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-capture-p1-benchmark-'));
  try {
    const startedAt = Date.parse('2026-09-12T01:00:00.000Z');
    const items = [];
    for (let index = 0; index < FRAME_COUNT; index += 1) {
      const content = `cached-frame-${index % 10}`;
      const file = path.join(root, `frame-${index}.png`);
      fs.writeFileSync(file, content);
      const eventId = `benchmark-event-${index}`;
      items.push({
        id: eventId,
        path: file,
        filename: path.basename(file),
        capturedAt: new Date(startedAt + index * 60_000).toISOString(),
        difference: index % 10 === 0 ? 0.85 : 0.1,
        reason: index === 0 ? 'initial' : 'interval',
      });
    }
    const session = { id: 'benchmark-session', studentId: 'benchmark-student', studentName: '性能测试学生', sourceName: '课程窗口', courseName: '二次函数', items };
    const workerPath = path.join(__dirname, '..', 'electron', 'capture-timeline-worker.cjs');
    const first = await runWorker(workerPath, root, session);
    const second = await runWorker(workerPath, root, session);
    const date = new Date(startedAt).toLocaleDateString('sv-SE');
    const queryMs = [];
    let page = null;
    for (let index = 0; index < 50; index += 1) {
      const queryStartedAt = performance.now();
      page = querySegments(root, { studentId: session.studentId, date, limit: 30, query: '二次函数' });
      queryMs.push(performance.now() - queryStartedAt);
    }
    queryMs.sort((left, right) => left - right);
    const p95QueryMs = queryMs[Math.floor(queryMs.length * 0.95)] || 0;
    const checks = {
      workerOutsideMainKeepsTimerDriftUnder100Ms: Math.max(first.maximumTimerDriftMs, second.maximumTimerDriftMs) < 100,
      oneHundredFramesUseAtMostTwentyKeyframes: Number(first.result.keyFrameCount || 0) <= 20,
      preDigestDoesNotRunOcr: Number(first.result.recognizedKeyFrameCount || 0) === 0 && !fs.existsSync(path.join(root, 'recognition')),
      repeatRunRetainsBundleIdentity: first.result.bundle.bundleId === second.result.bundle.bundleId
        && JSON.stringify(first.result.bundle.sourceHashes) === JSON.stringify(second.result.bundle.sourceHashes),
      semanticQueryP95Under100Ms: p95QueryMs < 100,
      rendererReceivesAtMostOnePage: Number(page?.segments?.length || 0) <= 30,
    };
    process.stdout.write(`${JSON.stringify({
      ok: Object.values(checks).every(Boolean),
      checks,
      metrics: {
        frameCount: FRAME_COUNT,
        firstRunMs: round(first.durationMs),
        secondRunMs: round(second.durationMs),
        maximumTimerDriftMs: round(Math.max(first.maximumTimerDriftMs, second.maximumTimerDriftMs)),
        keyFrameCount: Number(first.result.keyFrameCount || 0),
        preDigestRecognitionCount: Number(first.result.recognizedKeyFrameCount || 0),
        semanticQueryP95Ms: round(p95QueryMs),
        returnedSegments: Number(page?.segments?.length || 0),
      },
    }, null, 2)}\n`);
    if (!Object.values(checks).every(Boolean)) process.exitCode = 1;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
