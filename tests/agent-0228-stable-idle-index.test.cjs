'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const builder = fs.readFileSync(path.join(__dirname, '../scripts/build-agent-0228-acceptance-index.cjs'), 'utf8');

test('acceptance index is candidate-configured and requires three real runs per provider', () => {
  assert.match(builder, /acceptance-config\.json/);
  assert.match(builder, /realAgentRuns/);
  assert.match(builder, /runs\.length !== 3/);
  assert.match(builder, /formalPerformance/);
  assert.doesNotMatch(builder, /agent-readiness-r5-20261030/);
  assert.doesNotMatch(builder, /A2FD365DBED37A3694E6C44EAB2975D6845EDBBCBEF75B06F34C282FD7550ECD/);
});

test('contract matrix runner only grades rows its targeted integration tests can prove', () => {
  const source = fs.readFileSync(path.join(__dirname, '../scripts/run-agent-0228-matrix-tests.cjs'), 'utf8');
  assert.match(source, /const rowTests/);
  assert.doesNotMatch(source, /length:\s*12/);
  assert.doesNotMatch(source, /'C5'/);
  assert.match(source, /evidenceType:\s*'contract_integration'/);
});

test('formal host performance uses a tracked renderer latency monitor', () => {
  const runner = fs.readFileSync(path.join(__dirname, '../scripts/run-p0-host-performance.ps1'), 'utf8');
  const monitor = path.join(__dirname, '../scripts/monitor-renderer-latency.cjs');
  assert.equal(fs.existsSync(monitor), true);
  assert.match(runner, /scripts\\monitor-renderer-latency\.cjs/);
  assert.doesNotMatch(runner, /artifacts\\p0-minimal-patch/);
});
