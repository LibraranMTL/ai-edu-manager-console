'use strict';
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
const materialApi = require('../electron/project-materials.cjs');
let contentHashCalls = 0;
const originalHash = materialApi.hashStableFile;
materialApi.hashStableFile = (...args) => { contentHashCalls++; return originalHash(...args); };
const { createSmartInbox, identity } = require('../electron/smart-inbox.cjs');
const { digest } = require('../electron/smart-inbox-policy.cjs');
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-intake-bench-')), source = path.join(root, 'source');
  await fs.mkdir(source);
  const simulatedNow = Date.now() + 40 * 86400000;
  const counters = { extracted: 0, classified: 0, delivered: 0 };
  const host = { directory: path.join(root, 'state'), now: () => simulatedNow, stableAgeMs: 0, forbiddenRoots: () => [], automaticAllowed: () => true,
    context: async () => ({ studentId: 'synthetic', projects: [] }), validateTarget: async () => ({}), acquire: () => () => {},
    extract: async item => { counters.extracted++; return { text: await fs.readFile(item.snapshotPath, 'utf8') }; },
    classify: async () => { counters.classified++; return { candidates: [], sensitive: false, conflict: false, reason: '合成性能样本，等待人工确认' }; }, events: async () => [],
  };
  let engine = createSmartInbox(host);
  try {
    for (let start = 0; start < 10000; start += 100) await Promise.all(Array.from({ length: 100 }, (_, i) => fs.writeFile(path.join(source, `old-${start + i}.txt`), '旧资料，不在首次时间范围')));
    const registered = await engine.updateSource({ folder: source, studentId: 'synthetic', enabled: true, automatic: false });
    // Synthetic completed metadata, not model decisions or accuracy evidence.
    // Include 10k retained rows so list/memory measurements exercise a populated inbox.
    await engine.close();
    for (let start = 0; start < 10000; start += 100) await Promise.all(Array.from({ length: 100 }, async (_, i) => {
      const name = `old-${start + i}.txt`, stat = await fs.stat(path.join(source, name));
      const id = digest([registered.id, name, identity(stat)]);
      await fs.writeFile(path.join(host.directory, 'items', `${id}.json`), JSON.stringify({ id, sourceId: registered.id, sourceType: 'folder',
        studentId: 'synthetic', identity: identity(stat), name, locator: name, size: stat.size, revision: 1, status: 'review',
        createdAt: new Date(simulatedNow - 86400000).toISOString(), message: '合成已处理元数据，不作为准确率样本' }));
    }));
    const coldRss = process.memoryUsage().rss;
    engine = createSmartInbox(host); await engine.init();
    const scan = async () => { const start = performance.now(); await engine.requestScan(registered.id); await engine.tick(); return performance.now() - start; };
    await scan();
    const delay = monitorEventLoopDelay({ resolution: 10 }); delay.enable();
    const before = process.memoryUsage().rss, unchanged = [], queries = [];
    for (let i = 0; i < 3; i++) unchanged.push(await scan());
    const unchangedCounters = { ...counters, contentHashCalls };
    for (let i = 0; i < 10; i++) { const file = path.join(source, `new-${i}.txt`); await fs.writeFile(file, `第${i}份新教育资料`); await fs.utimes(file, simulatedNow / 1000, simulatedNow / 1000); }
    const addedMs = await scan();
    for (let i = 0; i < 60; i++) { const start = performance.now(); await engine.list({ page: 1 }); queries.push(performance.now() - start); }
    queries.sort((a, b) => a - b);
    const concurrentQueries = [];
    for (let round = 0; round < 3; round++) {
      let scanning = true; const work = scan().finally(() => { scanning = false; });
      while (scanning) { const start = performance.now(); await engine.list({ page: 1 + round, studentId: 'synthetic' });
        concurrentQueries.push(performance.now() - start); await new Promise(resolve => setTimeout(resolve, 10)); }
      await work;
    }
    concurrentQueries.sort((a, b) => a - b);
    delay.disable();
    const report = { kind: 'synthetic-local-performance-not-user-acceptance', machine: { cpus: os.cpus().length, memoryGiB: os.totalmem() / 2 ** 30, node: process.version },
      fixture: '10000 historical files and 10000 synthetic completed metadata rows; then 10 new files; simulated clock only', unchangedScanMs: unchanged, unchangedCounters,
      added10ScanMs: addedMs, totals: counters, queryP95Ms: queries[Math.floor(queries.length * .95)], mainEventLoopMaxMs: delay.max / 1e6,
      concurrentQueryCount: concurrentQueries.length, concurrentQueryP95Ms: concurrentQueries[Math.floor(concurrentQueries.length * .95)],
      rssDeltaMiB: (process.memoryUsage().rss - before) / 2 ** 20, loadAndScanRssDeltaMiB: (process.memoryUsage().rss - coldRss) / 2 ** 20,
      retainedRows: (await engine.list()).total, stats: (await engine.sources()).statistics };
    if (Object.values(unchangedCounters).some(n => n !== 0) || counters.extracted !== 10 || counters.classified !== 10) throw Error('增量性能合同未通过');
    const soakArg = process.argv.indexOf('--soak-minutes');
    const minutes = soakArg >= 0 ? Number(process.argv[soakArg + 1]) : 0;
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > 240) throw Error('Invalid bounded soak duration');
    if (minutes) {
      const start = performance.now(), initialCpu = process.cpuUsage();
      const baseline = { ...counters, contentHashCalls };
      const resources = () => ({ rssMiB: process.memoryUsage().rss / 2 ** 20, heapMiB: process.memoryUsage().heapUsed / 2 ** 20,
        activeResources: process.getActiveResourcesInfo().reduce((out, k) => { out[k] = (out[k] || 0) + 1; return out; }, {}) });
      report.soak = { scope: 'Real elapsed time, synthetic host only; no real OCR or external Agent in this process',
        requestedMinutes: minutes, startedAt: new Date().toISOString(), baseline: resources(), samples: [], cycles: 0, passed: false };
      if (process.argv[2]) await fs.writeFile(path.resolve(process.argv[2]), JSON.stringify(report, null, 2));
      while (performance.now() - start < minutes * 60000) {
        const cycleStart = performance.now();
        await scan();
        const settled = JSON.stringify((await engine.sources()).statistics);
        // Idle maintenance must not start a scan or invoke the extractor/Agent.
        for (let i = 0; i < 50; i++) await engine.tick();
        if (JSON.stringify((await engine.sources()).statistics) !== settled || engine.hasPendingWork()) throw Error('Idle processing did not settle');
        if (JSON.stringify({ ...counters, contentHashCalls }) !== JSON.stringify(baseline)) throw Error('Unchanged files were reprocessed');
        report.soak.samples.push({ elapsedMs: performance.now() - start, ...resources() }); report.soak.cycles++;
        if (process.argv[2]) await fs.writeFile(path.resolve(process.argv[2]), JSON.stringify(report, null, 2));
        await new Promise(resolve => setTimeout(resolve, Math.max(0, Math.min(15000 - (performance.now() - cycleStart), minutes * 60000 - (performance.now() - start)))));
      }
      const cpu = process.cpuUsage(initialCpu);
      report.soak.elapsedMs = performance.now() - start; report.soak.finishedAt = new Date().toISOString();
      report.soak.cpuMs = (cpu.user + cpu.system) / 1000; report.soak.final = resources();
      report.soak.passed = report.soak.elapsedMs >= minutes * 60000 && !engine.hasPendingWork();
    }
    if (process.argv[2]) await fs.writeFile(path.resolve(process.argv[2]), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await engine.close();
    if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('edu-intake-bench-')) throw Error('Unsafe benchmark cleanup target');
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
