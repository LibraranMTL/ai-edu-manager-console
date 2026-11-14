'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

function summarizeSamples(samples, activityWindow = null) {
  const durations = samples.map((sample) => Number(sample.durationMs)).filter(Number.isFinite);
  const startedAt = Date.parse(activityWindow?.startedAt || '');
  const finishedAt = Date.parse(activityWindow?.finishedAt || '');
  const active = Number.isFinite(startedAt) && Number.isFinite(finishedAt)
    ? samples.filter((sample) => {
      const timestamp = Date.parse(sample.startedAt || '');
      return Number.isFinite(timestamp) && timestamp >= startedAt && timestamp <= finishedAt;
    }) : [];
  const activeDurations = active.map((sample) => Number(sample.durationMs)).filter(Number.isFinite);
  return {
    sampleCount: durations.length,
    averageMs: durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : null,
    p95Ms: percentile(durations, 0.95),
    maximumMs: durations.length ? Math.max(...durations) : null,
    activityWindow,
    overlapWithTaskActivity: activeDurations.length > 0,
    activeSampleCount: activeDurations.length,
    activeP95Ms: percentile(activeDurations, 0.95),
    activeMaximumMs: activeDurations.length ? Math.max(...activeDurations) : null,
  };
}

async function evaluate(socket, id, expression) {
  return new Promise((resolve, reject) => {
    const listener = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      clearTimeout(timer);
      socket.removeEventListener('message', listener);
      if (message.error || message.result?.exceptionDetails) reject(new Error('renderer_monitor_evaluation_failed'));
      else resolve(message.result?.result?.value);
    };
    const timer = setTimeout(() => {
      socket.removeEventListener('message', listener);
      reject(new Error('renderer_monitor_timeout'));
    }, 10_000);
    socket.addEventListener('message', listener);
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: {
      expression, awaitPromise: true, returnByValue: true,
    } }));
  });
}

async function waitForTarget(port) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const target = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
      if (target) return target;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('renderer_monitor_target_not_found');
}

async function monitor(port, output, durationSeconds, intervalMs) {
  const target = await waitForTarget(port);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('renderer_monitor_socket_timeout')), 10_000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const samples = [];
  const failures = [];
  const deadline = performance.now() + (durationSeconds * 1_000);
  let id = 0;
  try {
    while (performance.now() < deadline) {
      const startedAt = new Date().toISOString();
      const started = performance.now();
      try {
        const probe = await evaluate(socket, ++id,
          'new Promise(resolve => { const started = performance.now(); setTimeout(() => resolve({ readyState: document.readyState, durationMs: performance.now() - started }), 0); })');
        samples.push({
          startedAt,
          durationMs: Number(probe?.durationMs),
          roundTripMs: performance.now() - started,
          readyState: probe?.readyState,
        });
      } catch (error) {
        failures.push({ startedAt, code: error.message });
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  } finally {
    socket.close();
  }
  const report = {
    schema: 1,
    generatedAt: new Date().toISOString(),
    port,
    target: { id: target.id, title: target.title, url: target.url },
    strategy: 'renderer_event_queue_continuous',
    durationSeconds,
    intervalMs,
    failures,
    samples,
    ...summarizeSamples(samples),
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function correlate(monitorPath, taskPath) {
  const report = JSON.parse(fs.readFileSync(monitorPath, 'utf8').replace(/^\uFEFF/, ''));
  const task = JSON.parse(fs.readFileSync(taskPath, 'utf8').replace(/^\uFEFF/, ''));
  Object.assign(report, summarizeSamples(report.samples || [], task.activityWindow || null));
  fs.writeFileSync(monitorPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

async function main() {
  if (process.argv[2] === '--correlate') {
    correlate(path.resolve(process.argv[3]), path.resolve(process.argv[4]));
    return;
  }
  const port = Number(process.argv[2]);
  const output = path.resolve(process.argv[3] || 'renderer-monitor.json');
  const durationSeconds = Math.max(5, Number(process.argv[4]) || 60);
  const intervalMs = Math.max(100, Number(process.argv[5]) || 250);
  await monitor(port, output, durationSeconds, intervalMs);
}

if (require.main === module) main().catch((error) => { console.error(error?.stack || error); process.exitCode = 1; });

module.exports = { summarizeSamples };
