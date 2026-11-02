const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const {
  terminateAndCollectResearchEvidence,
} = require('../electron/planning-research.cjs');
const { classifyResearchTimeout } = require('../electron/research-task-policy.cjs');

function closedEvidence(patch = {}) {
  return {
    executionId: 'exec-1', workKey: 'research:student:1', sourceVersion: 'v1', providerId: 'codex',
    terminationState: 'closed', terminationCause: 'timeout_kill', exitCode: null, signal: 'SIGTERM',
    stdoutDrained: true, stderrDrained: true, outputCheckedAfterClose: true, graceCompletedAt: new Date().toISOString(),
    completedWebEvents: 0, completedToolEvents: 0, outputPresent: false, outputSize: 0,
    localReceiptPresent: false, businessWriteStarted: false, sideEffectClass: 'read_only_research',
    identityMatches: true, ...patch,
  };
}

test('zero-event timeout with confirmed close is a bounded safe retry', () => {
  const result = classifyResearchTimeout(closedEvidence(), {
    remainingRouteAttempts: 1, nextProviderAvailable: true, now: 0,
  });
  assert.equal(result.disposition, 'safe_retry');
  assert.equal(result.reasonCode, 'research_timeout_closed_no_effect');
  assert.equal(result.nextRetryAt, '1970-01-01T00:00:15.000Z');
  assert.equal(result.nextProviderPolicy, 'next_ready_provider');
});

test('timeout remains unknown whenever close, drain, grace or no-effect proof is incomplete', () => {
  for (const patch of [
    { terminationState: 'unknown' }, { stdoutDrained: false }, { stderrDrained: false },
    { outputCheckedAfterClose: false }, { graceCompletedAt: '' }, { completedWebEvents: 1 },
    { completedToolEvents: 1 }, { outputPresent: true, outputSize: 12 }, { localReceiptPresent: true },
    { businessWriteStarted: true }, { sideEffectClass: 'unknown' }, { identityMatches: false },
  ]) {
    const result = classifyResearchTimeout(closedEvidence(patch), { remainingRouteAttempts: 1, now: 0 });
    assert.equal(result.disposition, 'execution_unknown', JSON.stringify(patch));
    assert.equal(result.nextRetryAt, '1970-01-01T00:00:30.000Z');
  }
});

test('confirmed no-effect timeout becomes terminal only after route budget is exhausted', () => {
  const result = classifyResearchTimeout(closedEvidence(), { remainingRouteAttempts: 0, now: 0 });
  assert.equal(result.disposition, 'terminal_failure');
  assert.equal(result.nextRetryAt, '');
});

test('user cancellation never becomes an automatic retry', () => {
  const result = classifyResearchTimeout(closedEvidence({ terminationCause: 'user_cancel' }), { remainingRouteAttempts: 1 });
  assert.equal(result.disposition, 'terminal_failure');
  assert.equal(result.reasonCode, 'research_cancelled');
});

test('collector waits for close and post-close grace before proving no output', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-timeout-proof-'));
  const outputPath = path.join(dir, 'result.json');
  const child = new EventEmitter();
  child.pid = 321;
  child.stdout = { readableEnded: false };
  child.stderr = { readableEnded: false };
  const startedAt = new Date(0).toISOString();
  const work = terminateAndCollectResearchEvidence({
    child, outputPath, events: [], stderrTail: '', startedAt, timeoutAt: new Date(1000).toISOString(),
    executionContext: { executionId: 'exec-1', workKey: 'research:student:1', sourceVersion: 'v1', providerId: 'codex' },
    terminateProcess() {
      setImmediate(() => {
        child.stdout.readableEnded = true;
        child.stderr.readableEnded = true;
        child.emit('close', null, 'SIGTERM');
      });
    },
    graceMs: 10, finalizationTimeoutMs: 200,
  });
  const evidence = await work;
  assert.equal(evidence.terminationState, 'closed');
  assert.equal(evidence.stdoutDrained, true);
  assert.equal(evidence.stderrDrained, true);
  assert.equal(evidence.outputCheckedAfterClose, true);
  assert.equal(evidence.outputPresent, false);
  assert.ok(evidence.graceCompletedAt);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('collector never claims a safe close when the child does not emit close', async () => {
  const child = new EventEmitter(); child.pid = 999;
  child.stdout = { readableEnded: false }; child.stderr = { readableEnded: false };
  const evidence = await terminateAndCollectResearchEvidence({
    child, outputPath: path.join(os.tmpdir(), `missing-${Date.now()}.json`), events: [], stderrTail: '',
    startedAt: new Date(0).toISOString(), timeoutAt: new Date(1000).toISOString(), terminateProcess() {},
    executionContext: {}, graceMs: 5, finalizationTimeoutMs: 20,
  });
  assert.equal(evidence.terminationState, 'unknown');
  assert.equal(classifyResearchTimeout(evidence, { remainingRouteAttempts: 1 }).disposition, 'execution_unknown');
});

test('collector includes events arriving after termination request and before close', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-timeout-late-event-'));
  const child = new EventEmitter();
  child.stdout = { readableEnded: false };
  child.stderr = { readableEnded: false };
  const events = [];
  const evidence = await terminateAndCollectResearchEvidence({
    child, outputPath: path.join(dir, 'result.json'), events, stderrTail: '',
    startedAt: new Date(0).toISOString(), timeoutAt: new Date(1000).toISOString(),
    executionContext: { executionId: 'exec-late', workKey: 'research:late', sourceVersion: 'v1', providerId: 'codex' },
    terminateProcess() {
      setImmediate(() => {
        events.push({ type: 'item.completed', item: { type: 'web_search', status: 'completed' } });
        child.stdout.readableEnded = true;
        child.stderr.readableEnded = true;
        child.emit('close', null, 'SIGTERM');
      });
    },
    graceMs: 5, finalizationTimeoutMs: 200,
  });
  assert.equal(evidence.completedWebEvents, 1);
  assert.equal(evidence.eventTypeCounts['item.completed'], 1);
  assert.equal(classifyResearchTimeout(evidence, { remainingRouteAttempts: 1 }).disposition, 'execution_unknown');
  fs.rmSync(dir, { recursive: true, force: true });
});
