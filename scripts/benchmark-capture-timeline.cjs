const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const {
  appendCaptureItem,
  listDates,
  queryTimeline,
  rebuildSessionTimeline,
} = require('../electron/capture-timeline.cjs');

const EVENT_COUNT = Math.max(1000, Number(process.env.EDU_CAPTURE_BENCHMARK_EVENTS || 5000));
const PAGE_LIMIT = 30;

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] || 0;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value), 'utf8');
  fs.renameSync(temporary, filePath);
}

function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-capture-benchmark-'));
  const session = {
    id: 'benchmark-session',
    studentId: 'benchmark-student',
    studentName: '性能测试学生',
    sourceName: '性能测试窗口',
    platform: 'windows',
  };
  const appendMs = [];
  const startedAt = Date.parse('2026-09-10T01:00:00.000Z');
  if (typeof global.gc === 'function') global.gc();
  const heapBefore = process.memoryUsage().heapUsed;
  const sessionItemsPath = path.join(root, 'sessions', `${session.id}.items.jsonl`);
  const sessionMetaPath = path.join(root, 'sessions', `${session.id}.json`);
  const sessionIndexPath = path.join(root, 'capture-sessions.json');
  fs.mkdirSync(path.dirname(sessionItemsPath), { recursive: true });
  const appendStartedAt = performance.now();
  for (let index = 0; index < EVENT_COUNT; index += 1) {
    const item = {
      id: `benchmark-item-${index}`,
      filename: `capture-${index}.png`,
      path: path.join(root, 'inbox', session.id, `capture-${index}.png`),
      capturedAt: new Date(startedAt + (index * 1000)).toISOString(),
      reason: index % 20 === 0 ? 'visual_change' : 'interval',
      difference: index % 20 === 0 ? 0.21 : 0.02,
      archiveStatus: 'candidate',
    };
    const itemStartedAt = performance.now();
    fs.appendFileSync(sessionItemsPath, `${JSON.stringify(item)}\n`, 'utf8');
    appendCaptureItem(root, session, item);
    writeJsonAtomic(sessionMetaPath, { ...session, screenshotCount: index + 1, updatedAt: item.capturedAt });
    writeJsonAtomic(sessionIndexPath, { version: 1, sessions: [{ ...session, screenshotCount: index + 1 }] });
    appendMs.push(performance.now() - itemStartedAt);
  }
  const appendTotalMs = performance.now() - appendStartedAt;
  const date = listDates(root, session.studentId)[0]?.date || '';
  const queryMs = [];
  let page = null;
  for (let index = 0; index < 60; index += 1) {
    const queryStartedAt = performance.now();
    page = queryTimeline(root, { studentId: session.studentId, date, limit: PAGE_LIMIT });
    queryMs.push(performance.now() - queryStartedAt);
  }
  if (typeof global.gc === 'function') global.gc();
  const heapAfter = process.memoryUsage().heapUsed;
  const migrationRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-capture-migration-benchmark-'));
  const legacySession = {
    ...session,
    id: 'legacy-benchmark-session',
    items: Array.from({ length: EVENT_COUNT }, (_, index) => ({
      id: `legacy-item-${index}`,
      filename: `legacy-${index}.png`,
      path: path.join(migrationRoot, 'inbox', `legacy-${index}.png`),
      capturedAt: new Date(startedAt + (index * 1000)).toISOString(),
      reason: 'interval',
    })),
  };
  const migrationStartedAt = performance.now();
  const migrationResult = rebuildSessionTimeline(migrationRoot, legacySession);
  const migrationMs = performance.now() - migrationStartedAt;
  const pageBytes = Buffer.byteLength(JSON.stringify(page), 'utf8');
  const oldFullStateBytes = Buffer.byteLength(JSON.stringify({ ...session, items: Array.from({ length: EVENT_COUNT }, (_, index) => ({ id: `benchmark-item-${index}`, path: `capture-${index}.png` })) }), 'utf8');
  const metrics = {
    eventCount: EVENT_COUNT,
    pageLimit: PAGE_LIMIT,
    append: {
      totalMs: round(appendTotalMs),
      averageMs: round(appendTotalMs / EVENT_COUNT),
      p50Ms: round(percentile(appendMs, 0.5)),
      p95Ms: round(percentile(appendMs, 0.95)),
      p99Ms: round(percentile(appendMs, 0.99)),
      maxMs: round(Math.max(...appendMs)),
    },
    query: {
      p50Ms: round(percentile(queryMs, 0.5)),
      p95Ms: round(percentile(queryMs, 0.95)),
      maxMs: round(Math.max(...queryMs)),
      returned: page?.events?.length || 0,
      total: page?.total || 0,
    },
    legacyMigration: {
      totalMs: round(migrationMs),
      migrated: migrationResult.appended,
    },
    rendererPayload: {
      pageBytes,
      estimatedLegacyFullStateBytes: oldFullStateBytes,
      reductionPercent: round((1 - (pageBytes / oldFullStateBytes)) * 100),
    },
    heapDeltaMb: round(Math.max(0, heapAfter - heapBefore) / 1024 / 1024),
  };
  const checks = {
    appendP95Under25Ms: metrics.append.p95Ms < 25,
    appendMaxUnder150Ms: metrics.append.maxMs < 150,
    queryP95Under100Ms: metrics.query.p95Ms < 100,
    legacyMigrationUnder500Ms: metrics.legacyMigration.totalMs < 500 && metrics.legacyMigration.migrated === EVENT_COUNT,
    rendererReceivesOnePage: metrics.query.returned === PAGE_LIMIT && metrics.query.total === EVENT_COUNT,
    rendererPayloadUnder256Kb: pageBytes < 256 * 1024,
    heapDeltaUnder96Mb: metrics.heapDeltaMb < 96,
  };
  const result = { ok: Object.values(checks).every(Boolean), thresholds: checks, metrics };
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(migrationRoot, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

run();
