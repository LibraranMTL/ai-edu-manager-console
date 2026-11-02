'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'artifacts', 'p0-minimal-patch-20261026');
const { summarizeSamples } = require(path.join(artifacts, 'monitor-renderer-latency.cjs'));

test('Renderer monitor proves samples overlap the active task window', () => {
  const report = summarizeSamples([
    { startedAt: '2026-10-27T00:00:00.000Z', durationMs: 2, readyState: 'complete' },
    { startedAt: '2026-10-27T00:00:01.000Z', durationMs: 8, readyState: 'complete' },
    { startedAt: '2026-10-27T00:00:02.000Z', durationMs: 4, readyState: 'complete' },
  ], { startedAt: '2026-10-27T00:00:00.500Z', finishedAt: '2026-10-27T00:00:01.500Z' });
  assert.equal(report.overlapWithTaskActivity, true);
  assert.equal(report.activeSampleCount, 1);
  assert.equal(report.activeMaximumMs, 8);
});

test('active scenario runner starts Renderer monitoring before runtime sampling', () => {
  const script = fs.readFileSync(path.join(artifacts, 'run-r11-active-scenarios.ps1'), 'utf8');
  const monitorStart = script.indexOf("monitor-renderer-latency.cjs");
  const processSample = script.indexOf("sample-p0-live-runtime.ps1");
  assert.ok(monitorStart >= 0 && processSample > monitorStart);
  assert.match(script, /overlapWithTaskActivity/);
  assert.match(script, /activeMaximumMs/);
});

test('Renderer monitor measures event-loop delay inside the Renderer process', () => {
  const script = fs.readFileSync(path.join(artifacts, 'monitor-renderer-latency.cjs'), 'utf8');
  assert.match(script, /const started = performance\.now\(\); setTimeout\(\(\) => resolve\(\{ readyState: document\.readyState, durationMs: performance\.now\(\) - started \}\), 0\)/);
  assert.doesNotMatch(script, /durationMs: performance\.now\(\) - started, readyState/);
});
