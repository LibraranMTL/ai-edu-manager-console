'use strict';
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
const { createTaskIoClient } = require('../electron/task-io-client.cjs');

const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
async function run() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-task-perf-'));
  const client = createTaskIoClient();
  const report = { generatedAt: new Date().toISOString(), scope: 'Synthetic worker read-model benchmark; not Windows UI acceptance or 4-hour soak',
    platform: process.platform, node: process.version, cpus: os.cpus().length, cpu: os.cpus()[0]?.model,
    memoryGiB: Number((os.totalmem() / 1024 ** 3).toFixed(1)), results: [] };
  try {
    for (const count of [1000, 10000]) {
      const file = path.join(root, `tasks-${count}.json`);
      const tasks = Array.from({ length: count }, (_, i) => ({ id: `task-${i}`, title: `合成资料 ${i}`,
        sourceType: i % 3 ? 'student' : 'project', sourceId: String(i % 20), status: i % 4 ? 'succeeded' : 'waiting_result',
        executionMode: i % 4 ? 'automatic' : 'desktop_handoff', executor: i % 4 ? 'codex' : 'workbuddy',
        updatedAt: new Date(1700000000000 + i * 1000).toISOString(),
        input: { prompt: 'synthetic source material '.repeat(50 + i % 50) },
        result: { summary: '合成结果而非真实学生资料。'.repeat(100 + i % 100), validation: { valid: i % 4 !== 0 }, resultFile: `synthetic-${i}.json` } }));
      await fs.writeFile(file, JSON.stringify({ protocolVersion: '1.2', updatedAt: report.generatedAt, tasks, history: [] }));
      const loop = monitorEventLoopDelay({ resolution: 10 }); loop.enable();
      const coldStart = performance.now(); await client.request(file);
      const coldMs = performance.now() - coldStart, durations = [], bytes = [];
      for (let i = 0; i < 60; i++) {
        const start = performance.now();
        const result = await client.request(file, 'list', { page: i % 10 + 1, source: i % 2 ? 'student' : 'all' });
        durations.push(performance.now() - start); bytes.push(Buffer.byteLength(JSON.stringify(result)));
      }
      loop.disable();
      report.results.push({ count, fileBytes: (await fs.stat(file)).size, coldMs: +coldMs.toFixed(2),
        warmQueryP95Ms: +percentile(durations, .95).toFixed(2), warmQueryMaxMs: +Math.max(...durations).toFixed(2),
        maxResponseBytes: Math.max(...bytes), mainEventLoopDelayMaxMs: +(loop.max / 1e6).toFixed(2), queries: durations.length });
    }
  } finally { client.close(); await fs.rm(root, { recursive: true, force: true }); }
  const output = process.argv[2];
  if (output) { await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true }); await fs.writeFile(output, JSON.stringify(report, null, 2)); }
  console.log(JSON.stringify(report, null, 2));
}
run().catch(error => { console.error(error); process.exitCode = 1; });
