const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { Worker } = require('node:worker_threads');

const repoRoot = path.resolve(__dirname, '..');
const audit = require(path.join(repoRoot, 'release', 'windows', 'AI-edu-manager-console-Windows-0.17.9-build-audit.json'));
const variants = [
  { name: 'published-0.17.9-staged-runtime', root: audit.stagingRoot },
  { name: 'current-development-input', root: repoRoot },
];
const frameCount = Math.max(100, Math.min(5000, Number(process.env.EDU_CAPTURE_P1_BENCHMARK_FRAMES || 500)));

function round(value) { return Math.round(value * 100) / 100; }

function runWorker(workerPath, dataRoot, session) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    let maximumTimerDriftMs = 0;
    let nextTick = performance.now() + 10;
    const timer = setInterval(() => {
      const now = performance.now();
      maximumTimerDriftMs = Math.max(maximumTimerDriftMs, now - nextTick);
      nextTick = now + 10;
    }, 10);
    const worker = new Worker(workerPath, { workerData: { rootPath: dataRoot, session, attempt: 1 } });
    worker.on('message', (message) => {
      if (message?.type === 'completed') {
        clearInterval(timer);
        resolve({ durationMs: round(performance.now() - started), maximumTimerDriftMs: round(maximumTimerDriftMs), result: message.result });
      } else if (message?.type === 'failed') {
        clearInterval(timer);
        reject(new Error(message.error?.message || 'timeline worker failed'));
      }
    });
    worker.on('error', (error) => { clearInterval(timer); reject(error); });
  });
}

async function benchmark(variant) {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-p1-published-comparison-'));
  try {
    const start = Date.parse('2026-09-12T01:00:00.000Z');
    const items = Array.from({ length: frameCount }, (_, index) => {
      const imagePath = path.join(dataRoot, `frame-${index}.png`);
      fs.writeFileSync(imagePath, `synthetic-frame-${index % 10}`);
      return {
        id: `benchmark-event-${index}`, path: imagePath, filename: path.basename(imagePath),
        capturedAt: new Date(start + index * 60_000).toISOString(),
        difference: index % 10 === 0 ? 0.85 : 0.1,
        reason: index === 0 ? 'initial' : 'interval',
      };
    });
    const session = { id: 'benchmark-session', studentId: 'benchmark-student', studentName: '合成基准学生', sourceName: '课程窗口', courseName: '二次函数', items };
    const workerPath = path.join(variant.root, 'electron', 'capture-timeline-worker.cjs');
    const first = await runWorker(workerPath, dataRoot, session);
    const second = await runWorker(workerPath, dataRoot, session);
    const { querySegments } = require(path.join(variant.root, 'electron', 'capture-timeline-semantic.cjs'));
    const date = new Date(start).toLocaleDateString('sv-SE');
    const samples = [];
    let page = null;
    for (let index = 0; index < 50; index += 1) {
      const started = performance.now();
      page = querySegments(dataRoot, { studentId: session.studentId, date, limit: 30, query: '二次函数' });
      samples.push(performance.now() - started);
    }
    samples.sort((left, right) => left - right);
    return {
      name: variant.name,
      firstRunMs: first.durationMs,
      secondRunMs: second.durationMs,
      maximumTimerDriftMs: Math.max(first.maximumTimerDriftMs, second.maximumTimerDriftMs),
      keyFrameCount: Number(first.result.keyFrameCount || 0),
      processingWindowCount: first.result.bundle?.processingWindows?.length ?? null,
      queryP95Ms: round(samples[Math.floor(samples.length * 0.95)] || 0),
      returnedSegments: page?.segments?.length || 0,
      firstRunState: first.result.state,
    };
  } finally {
    const tempRoot = path.resolve(os.tmpdir());
    const resolved = path.resolve(dataRoot);
    if (resolved.startsWith(`${tempRoot}${path.sep}`) && path.basename(resolved).startsWith('edu-p1-published-comparison-')) {
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  }
}

(async () => {
  const results = [];
  for (const variant of variants) results.push(await benchmark(variant));
  process.stdout.write(`${JSON.stringify({ schema: 'edu-manager.p1-synthetic-comparison.v1', frameCount, results }, null, 2)}\n`);
})().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
