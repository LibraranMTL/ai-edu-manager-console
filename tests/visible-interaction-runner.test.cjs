'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { percentile, summarizeInteractions, CdpClient, detailsReadyExpression, detailsStateExpression } = require('../scripts/run-p0-visible-interactions.cjs');

test('percentile uses the nearest-rank observation', () => {
  assert.equal(percentile([4, 1, 3, 2], 0.95), 4);
  assert.equal(percentile([], 0.95), 0);
});

test('advanced Agent readiness expression preserves whitespace regex escapes', () => {
  assert.match(detailsReadyExpression, /\\s\*Agent\\s\*/);
  assert.doesNotMatch(detailsReadyExpression, /高级s\*Agents\*/);
});

test('advanced Agent toggle accepts both open and closed settled states', () => {
  assert.match(detailsStateExpression(true), /===true/);
  assert.match(detailsStateExpression(false), /===false/);
});

test('visible interaction runner waits for a temporarily rerendered control before clicking', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'run-p0-visible-interactions.cjs'), 'utf8');
  assert.match(source, /const clickTextWhenReady =/);
  assert.match(source, /control_wait_timeout/);
  assert.match(source, /await new Promise\(resolve=>setTimeout\(resolve,50\)\)/);
});

test('visible interaction summary requires 30 samples per action and exposes failures', () => {
  const samples = ['refresh', 'switch', 'detail'].flatMap(action => Array.from({ length: 30 }, (_, index) => ({
    action, durationMs: index + 1, observedStatus: 'pass',
  })));
  const summary = summarizeInteractions(samples, [{ duration: 75 }]);
  assert.equal(summary.passed, true);
  assert.equal(summary.interactionSamples, 90);
  assert.equal(summary.actions.refresh.count, 30);
  assert.equal(summary.actions.detail.p95Ms, 29);
  assert.equal(summary.maximumLongTaskMs, 75);
});

test('timeout or a renderer long task over 100ms fails the gate', () => {
  const samples = ['refresh', 'switch', 'detail'].flatMap(action => Array.from({ length: 30 }, (_, index) => ({
    action, durationMs: 20, observedStatus: action === 'refresh' && index === 0 ? 'fail' : 'pass',
  })));
  const summary = summarizeInteractions(samples, [{ duration: 101 }]);
  assert.equal(summary.passed, false);
  assert.equal(summary.failures, 1);
});

test('host performance runner does not shadow the VisibleInteractions switch with its process handle', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'run-p0-host-performance.ps1'), 'utf8');
  assert.doesNotMatch(source, /\$visibleInteractions\s*=\s*\$null/i);
  assert.match(source, /\$visibleInteractionProcess\s*=\s*Start-Process/i);
});

test('host performance runner trusts completed probe reports and tolerates one isolated tail write', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'run-p0-host-performance.ps1'), 'utf8');
  assert.match(source, /\$queryStressReport\.passed\s*-eq\s*\$true/i);
  assert.match(source, /\$visibleInteractionReport\.passed\s*-eq\s*\$true/i);
  assert.match(source, /Select-Object\s+-Last\s+12/i);
  assert.match(source, /\$tailChangedIntervals\s*-le\s*1/i);
});

test('visible runner waits for each real UI operation instead of document readiness', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'run-p0-visible-interactions.cjs'), 'utf8');
  assert.match(source, /refreshReadyExpression/);
  assert.match(source, /刷新中/);
  assert.match(source, /groupReadyExpression/);
  assert.match(source, /details summary/);
  assert.match(source, /parentElement\.open/);
  assert.doesNotMatch(source, /clickText\('\/高级Agent 状态与排障\/'\)/);
  assert.doesNotMatch(source, /readyExpression:\s*`document\.readyState==='complete'&&!document\.querySelector\('\[aria-busy="true"\]'\)`/);
  assert.match(source, /if\s*\(refresh\.observedStatus\s*!==\s*'pass'\)\s*break interactionLoop/);
});

test('visible interaction acceptance restores the isolated candidate window before measuring controls', () => {
  const nodeSource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'run-p0-visible-interactions.cjs'), 'utf8');
  const hostSource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'run-p0-host-performance.ps1'), 'utf8');
  assert.match(nodeSource, /Page\.bringToFront/);
  assert.match(hostSource, /ShowWindowAsync/);
  assert.match(hostSource, /IsWindowVisible/);
  assert.match(hostSource, /IsIconic/);
  assert.match(hostSource, /--native-window-visible/);
  assert.match(hostSource, /Restore-P0CandidateWindow\s+-MainProcessId\s+\$mainProcessId/);
});

test('interaction measurement awaits the click and does not depend on throttled animation frames', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'measure-p0-visible-interaction.cjs'), 'utf8');
  assert.match(source, /await evaluate\(`\(async\(\)=>await \(\$\{actionExpression\}\)\)\(\)`\)/);
  assert.match(source, /await evaluate\(`\(\{ready:/);
  assert.match(source, /setTimeout\(resolve,10\)/);
  assert.doesNotMatch(source, /setTimeout\(r,0\)/);
  assert.doesNotMatch(source, /requestAnimationFrame/);
  assert.match(source, /requireDocumentVisibility/);
});

test('CDP calls reject and release pending state when the renderer stops replying', async () => {
  const client = new CdpClient('ws://unused', 20);
  client.socket = { send() {} };
  await assert.rejects(client.call('Runtime.evaluate'), /cdp_call_timeout:Runtime\.evaluate/);
  assert.equal(client.pending.size, 0);
});
