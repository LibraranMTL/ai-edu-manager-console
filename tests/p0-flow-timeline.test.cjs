'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'capture-p0-flow-timeline.cjs');

test('flow timeline is emitted by a real isolated SmartInbox recovery cycle', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-p0-flow-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'timeline.json');
  const provenance = path.join(directory, 'synthetic-provenance.json');
  fs.writeFileSync(provenance, JSON.stringify({
    workspace: { commit: 'synthetic-test-commit' },
    candidate: { exe: { sha256: 'SYNTHETIC_TEST_CANDIDATE_SHA256' } },
  }), 'utf8');
  const result = spawnSync(process.execPath, [script, `--output=${output}`, `--provenance=${provenance}`, '--run-id=test-flow-1'],
    { cwd: root, encoding: 'utf8', timeout: 60_000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(report.schema, 1);
  assert.ok(report.correlationId);
  assert.deepEqual([...new Set(report.events.map(event => event.stage))],
    ['enqueue', 'permit_wait', 'execution', 'reconciliation', 'settlement']);
  assert.equal(report.observed.finalStatus, 'delivered');
  assert.equal(report.observed.deliveryCalls, 1);
  assert.equal(report.observed.reconcileCalls, 1);
  assert.ok(report.observed.settlementCalls >= 1);
  assert.equal(report.observed.duplicateDeliveryCalls, 0);
});
