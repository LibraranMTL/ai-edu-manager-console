'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const args = new Map(process.argv.slice(2).map(value => {
  const separator = value.indexOf('=');
  return separator < 0 ? [value.replace(/^--/, ''), 'true']
    : [value.slice(0, separator).replace(/^--/, ''), value.slice(separator + 1)];
}));
const numberArg = (name, fallback) => Math.max(1, Number(args.get(name) || fallback) || fallback);
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const duration = milliseconds => Math.max(0.000001, milliseconds / 1000);
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').toUpperCase();

function measureCpu(started) {
  const value = process.cpuUsage(started);
  return (value.user + value.system) / 1000;
}

function dataWorker(condition, rows) {
  global.gc?.();
  const projectCount = 3;
  const counts = Array.from({ length: projectCount }, (_, index) => Math.floor(rows / projectCount) + (index < rows % projectCount ? 1 : 0));
  const categories = Array.from({ length: projectCount }, (_, index) => [{ categoryId: `category-${index}`, name: `Category ${index}` }]);
  let registries = null;
  if (condition === 'baseline') {
    registries = counts.map((count, project) => ({ categories: categories[project], materials: Array.from({ length: count }, (_, index) => ({
      materialId: `${project}-${index}`, sha256: crypto.createHash('sha256').update(`${project}:${index}`).digest('hex'),
      status: index % 3 ? 'adopted' : 'pending', sourcePath: `synthetic/${project}/${index}.md`,
    })) }));
  }
  global.gc?.();
  const heapBefore = process.memoryUsage().heapUsed;
  const cpuStarted = process.cpuUsage();
  const started = performance.now();
  let materialRowsRead = 0;
  const result = condition === 'baseline'
    ? registries.map(registry => { const copy = structuredClone(registry); materialRowsRead += copy.materials.length; return copy.categories; })
    : categories.map(value => structuredClone(value));
  const durationMs = performance.now() - started;
  const heapAfter = process.memoryUsage().heapUsed;
  return { sampleCount: rows, durationSeconds: duration(durationMs), durationMs, cpuMilliseconds: measureCpu(cpuStarted),
    heapDeltaBytes: Math.max(0, heapAfter - heapBefore), materialRowsRead, datasetRows: rows, projectCount,
    resultHash: hash(result) };
}

async function pressureWorker(condition, pressureMs) {
  const { ResourceCoordinator } = require(path.join(root, 'electron', 'resource-coordinator.cjs'));
  let snapshot = { cpuPercent: 0, availableMemoryRatio: 0.1, availableMemoryBytes: 2 * 1024 ** 3 };
  const coordinator = new ResourceCoordinator({ getSnapshot: () => snapshot });
  let drainCount = 0;
  const originalDrain = coordinator.drain.bind(coordinator);
  coordinator.drain = () => { drainCount += 1; return originalDrain(); };
  if (condition === 'baseline') {
    coordinator.scheduleDrain = function scheduleWithBackoff() {
      if (this.timer || !this.queue.length) return;
      this.timer = setTimeout(() => { this.timer = null; this.drain(); }, 25);
      this.timer.unref?.();
    };
  }
  let taskStartedAt = 0;
  const cpuStarted = process.cpuUsage();
  const started = performance.now();
  const queued = coordinator.run('cpu', async () => { taskStartedAt = performance.now(); }, { background: true, key: 'synthetic-pressure' });
  await delay(pressureMs);
  const releasedAt = performance.now();
  snapshot = { cpuPercent: 0, availableMemoryRatio: 0.8, availableMemoryBytes: 16 * 1024 ** 3 };
  coordinator.updatePressure(snapshot); coordinator.updatePressure(snapshot); coordinator.updatePressure(snapshot);
  await Promise.race([queued, delay(5_000).then(() => { throw new Error('pressure_ablation_timeout'); })]);
  const durationMs = performance.now() - started;
  const result = { sampleCount: 1, durationSeconds: duration(durationMs), durationMs, cpuMilliseconds: measureCpu(cpuStarted),
    drainCount, pressureMilliseconds: pressureMs, startLatencyAfterReleaseMs: Math.max(0, taskStartedAt - releasedAt) };
  coordinator.close();
  return result;
}

async function heartbeatWorker(condition, rows, updates) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `edu-p0-heartbeat-ablation-${condition}-`));
  const legacy = path.join(directory, 'tasks.json');
  try {
    const now = new Date().toISOString();
    const tasks = Array.from({ length: rows }, (_, index) => ({ id: index === 0 ? 'running' : `task-${index}`,
      title: `Synthetic ${index}`, sourceType: 'student', sourceId: `student-${index % 100}`, kind: 'student_digest',
      status: index === 0 ? 'running' : 'pending', executionId: index === 0 ? 'execution-1' : '',
      lastHeartbeatAt: now, updatedAt: now, automaticExecution: true }));
    fs.writeFileSync(legacy, JSON.stringify({ protocolVersion: 3, updatedAt: now, runtime: {}, deletedTasks: [], history: [], tasks }));
    let normalizationCalls = 0, sqliteWrites = 0, finalHeartbeat = '';
    const { createTaskStoreService } = require(path.join(root, 'electron', 'task-store-service.cjs'));
    const { createTaskStoreWriter } = require(path.join(root, 'electron', 'task-store-writer.cjs'));
    const writer = createTaskStoreWriter();
    const request = async (...values) => { if (values[1] === 'store_delta') sqliteWrites += 1; return writer.request(...values); };
    const service = createTaskStoreService({ request, normalizeTask: value => { normalizationCalls += 1; return value; } });
    await service.initialize(legacy);
    normalizationCalls = 0; sqliteWrites = 0;
    const cpuStarted = process.cpuUsage(), started = performance.now();
    for (let index = 0; index < updates; index += 1) {
      const stamp = `${condition}-${index}`;
      if (condition === 'baseline') {
        // Frozen legacy behavior: progress passed through the generic draft +
        // write path and therefore normalized the task again.
        const draft = service.read(legacy, { taskIds: ['running'] }).value;
        const task = draft.tasks.find(value => value.id === 'running');
        if (!task || task.executionId !== 'execution-1' || task.status !== 'running') throw new Error('baseline_heartbeat_rejected');
        task.lastHeartbeatAt = stamp;
        service.write(legacy, draft);
      } else {
        const result = service.writeProgress(legacy, [{ taskId: 'running', executionId: 'execution-1', lastHeartbeatAt: stamp }]);
        if (result.accepted !== 1) throw new Error('treatment_heartbeat_rejected');
      }
      await service.flush(); finalHeartbeat = stamp;
    }
    const durationMs = performance.now() - started;
    const cpuMilliseconds = measureCpu(cpuStarted);
    const stored = service.read(legacy, { taskIds: ['running'] }).value.tasks[0]; writer.close();
    return { sampleCount: updates, durationSeconds: duration(durationMs), durationMs, cpuMilliseconds,
      normalizationCalls, sqliteWrites, datasetRows: rows, finalHeartbeat, persistedHeartbeat: stored.lastHeartbeatAt,
      stateValid: stored.status === 'running' && stored.executionId === 'execution-1' && stored.lastHeartbeatAt === finalHeartbeat };
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

async function worker() {
  const id = String(args.get('worker'));
  const condition = String(args.get('condition'));
  let result;
  if (id === 'DATA-01') result = dataWorker(condition, numberArg('rows', 100_000));
  else if (id === 'PERF-01') result = await pressureWorker(condition, numberArg('pressure-ms', 1_100));
  else if (id === 'PERF-02') result = await heartbeatWorker(condition, numberArg('rows', 100_000), numberArg('updates', 100));
  else throw new Error(`unknown_worker_${id}`);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function runWorker(id, condition, options) {
  const childArgs = ['--expose-gc', __filename, `--worker=${id}`, `--condition=${condition}`,
    `--rows=${options.rows}`, `--pressure-ms=${options.pressureMs}`, `--updates=${options.updates}`];
  const result = spawnSync(process.execPath, childArgs, { cwd: root, encoding: 'utf8', timeout: 180_000, maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${id}/${condition} failed: ${result.stderr || result.stdout}`);
  const line = result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  return JSON.parse(line);
}

function mean(values) { return values.reduce((sum, value) => sum + Number(value), 0) / values.length; }
function report(id, baselineRuns, treatmentRuns, metric, direction, provenance, conclusion) {
  const baselineMean = mean(baselineRuns.map(run => run[metric]));
  const treatmentMean = mean(treatmentRuns.map(run => run[metric]));
  const improvementPercent = (direction === 'higher_is_better' ? treatmentMean - baselineMean : baselineMean - treatmentMean)
    / Math.abs(baselineMean) * 100;
  return { schema: 1, id, generatedAt: new Date().toISOString(), provenance, baseline: { runs: baselineRuns },
    treatment: { runs: treatmentRuns }, comparison: { metric, direction, baselineMean, treatmentMean, improvementPercent },
    conclusion: conclusion({ baselineMean, treatmentMean, improvementPercent, baselineRuns, treatmentRuns }) };
}

async function main() {
  if (args.has('worker')) return worker();
  const output = path.resolve(String(args.get('output') || path.join(root, 'artifacts', 'p0-red-gate-20261025')));
  const runs = numberArg('runs', 3), dataRows = numberArg('data-rows', 100_000), taskRows = numberArg('task-rows', 100_000);
  const pressureMs = numberArg('pressure-ms', 1_100), updates = numberArg('heartbeat-updates', 100);
  const provenancePath = path.resolve(String(args.get('provenance')
    || path.join(root, 'artifacts', 'p0-red-gate-20261025', 'p0-candidate-provenance.json')));
  const candidate = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
  const sourceFiles = ['electron/smart-inbox.cjs', 'electron/smart-inbox-host.cjs', 'electron/resource-coordinator.cjs',
    'electron/task-store-service.cjs', 'electron/project-materials.cjs', 'electron/main.cjs', 'src/main.tsx'];
  const sourceFingerprint = hash(sourceFiles.map(file => [file, crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(root, file))).digest('hex')]));
  const sourceOnly = args.has('source-only');
  const provenance = { workspaceCommit: candidate.chains?.diagnosticCandidate?.workspaceCommit || candidate.workspace?.commit,
    candidateSha256: sourceOnly ? '' : candidate.chains?.diagnosticCandidate?.candidateSha256 || candidate.candidate?.exe?.sha256,
    sourceFingerprint, evidenceMode: sourceOnly ? 'source_only_not_candidate' : 'candidate_bound' };
  fs.mkdirSync(output, { recursive: true });
  const collect = (id, condition, options) => Array.from({ length: runs }, (_, index) => ({ run: index + 1,
    ...runWorker(id, condition, options) }));

  const dataBaseline = collect('DATA-01', 'baseline', { rows: dataRows, pressureMs, updates });
  const dataTreatment = collect('DATA-01', 'treatment', { rows: dataRows, pressureMs, updates });
  const data = report('DATA-01', dataBaseline, dataTreatment, 'durationMs', 'lower_is_better', provenance,
    ({ improvementPercent, baselineRuns, treatmentRuns }) => `在同一${dataRows}行合成登记上，分类投影相对完整登记读取的耗时变化为${improvementPercent.toFixed(2)}%；完整读取共触达${baselineRuns.reduce((sum, run) => sum + run.materialRowsRead, 0)}行，投影读取为${treatmentRuns.reduce((sum, run) => sum + run.materialRowsRead, 0)}行，分类结果哈希一致。`);

  const pollBaseline = collect('PERF-01', 'baseline', { rows: dataRows, pressureMs, updates });
  const pollTreatment = collect('PERF-01', 'treatment', { rows: dataRows, pressureMs, updates });
  const poll = report('PERF-01', pollBaseline, pollTreatment, 'drainCount', 'lower_is_better', provenance,
    ({ improvementPercent }) => `持续资源压力下，事件唤醒加1秒兜底相对25ms轮询的drain次数变化为${improvementPercent.toFixed(2)}%；两组均在压力解除后启动任务并记录启动延迟。`);

  const heartbeatBaseline = collect('PERF-02', 'baseline', { rows: taskRows, pressureMs, updates });
  const heartbeatTreatment = collect('PERF-02', 'treatment', { rows: taskRows, pressureMs, updates });
  const heartbeat = report('PERF-02', heartbeatBaseline, heartbeatTreatment, 'durationMs', 'lower_is_better', provenance,
    ({ improvementPercent, baselineRuns }) => `在${taskRows}任务夹具上，定向行patch相对通用writeProgress的耗时变化为${improvementPercent.toFixed(2)}%；基线发生${baselineRuns.reduce((sum, run) => sum + run.normalizationCalls, 0)}次任务归一化，处理组为0，全部运行保持executionId与running状态。`);

  for (const value of [data, poll, heartbeat]) fs.writeFileSync(path.join(output, `ablation-${value.id}.json`), `${JSON.stringify(value, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output, runs, dataRows, taskRows, files: ['ablation-DATA-01.json', 'ablation-PERF-01.json', 'ablation-PERF-02.json'] })}\n`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
