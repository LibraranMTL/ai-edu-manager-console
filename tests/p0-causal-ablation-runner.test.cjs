'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const runner = path.join(root, 'scripts', 'run-p0-causal-ablations.cjs');

function read(directory, name) {
  return JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
}

test('causal ablation runner emits measured baseline and treatment evidence', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-p0-ablation-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [runner,
    `--output=${directory}`, '--runs=1', '--data-rows=300', '--task-rows=500',
    '--pressure-ms=80', '--heartbeat-updates=3'], { cwd: root, encoding: 'utf8', timeout: 120_000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const data = read(directory, 'ablation-DATA-01.json');
  const poll = read(directory, 'ablation-PERF-01.json');
  const heartbeat = read(directory, 'ablation-PERF-02.json');
  for (const [value, id] of [[data, 'DATA-01'], [poll, 'PERF-01'], [heartbeat, 'PERF-02']]) {
    assert.equal(value.schema, 1);
    assert.equal(value.id, id);
    assert.equal(value.baseline.runs.length, 1);
    assert.equal(value.treatment.runs.length, 1);
    assert.ok(value.baseline.runs[0].sampleCount > 0);
    assert.ok(value.treatment.runs[0].durationSeconds > 0);
    assert.ok(value.comparison.metric);
    assert.ok(Number.isFinite(value.comparison.improvementPercent));
    assert.ok(value.conclusion);
  }
  assert.equal(data.baseline.runs[0].materialRowsRead, 300);
  assert.equal(data.treatment.runs[0].materialRowsRead, 0);
  assert.equal(data.baseline.runs[0].resultHash, data.treatment.runs[0].resultHash);
  assert.ok(poll.baseline.runs[0].drainCount > poll.treatment.runs[0].drainCount);
  assert.ok(heartbeat.baseline.runs[0].normalizationCalls > 0);
  assert.equal(heartbeat.treatment.runs[0].normalizationCalls, 0);
});
