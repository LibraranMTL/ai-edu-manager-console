const assert = require('node:assert/strict');
const test = require('node:test');

const {
  candidateRuntimeDecision,
  compactTaskEvents,
  repairTaskRuntimeStore,
  taskTimeoutDecision,
} = require('../electron/task-runtime-policy.cjs');

test('manual waits never use heartbeat timeout and QClaw inbox uses a result deadline', () => {
  const startedAt = '2026-07-23T00:00:00.000Z';
  const manual = taskTimeoutDecision({
    status: 'waiting_result',
    executionMode: 'manual',
    adapterId: 'manual',
    startedAt,
    lastHeartbeatAt: startedAt,
    heartbeatTimeoutSeconds: 180,
  }, Date.parse('2026-07-24T00:00:00.000Z'));
  assert.equal(manual.enabled, false);
  assert.equal(manual.kind, 'manual_wait');

  const inboxWaiting = taskTimeoutDecision({
    status: 'waiting_result',
    executionMode: 'inbox',
    adapterId: 'qclaw',
    startedAt,
    resultTimeoutSeconds: 86400,
  }, Date.parse('2026-07-23T23:59:00.000Z'));
  assert.equal(inboxWaiting.due, false);
  const inboxExpired = taskTimeoutDecision({
    status: 'waiting_result',
    executionMode: 'inbox',
    adapterId: 'qclaw',
    startedAt,
    resultTimeoutSeconds: 86400,
  }, Date.parse('2026-07-24T00:01:00.000Z'));
  assert.equal(inboxExpired.due, true);
  assert.equal(inboxExpired.error.code, 'RESULT_WAIT_TIMEOUT');
});

test('process tasks still enforce heartbeat and total execution timeout', () => {
  const decision = taskTimeoutDecision({
    status: 'running',
    executionMode: 'automatic',
    adapterId: 'codex',
    startedAt: '2026-07-23T00:00:00.000Z',
    lastHeartbeatAt: '2026-07-23T00:01:00.000Z',
    timeoutSeconds: 900,
    heartbeatTimeoutSeconds: 180,
  }, Date.parse('2026-07-23T00:04:01.000Z'));
  assert.equal(decision.due, true);
  assert.equal(decision.error.code, 'HEARTBEAT_LOST');

  const directQClaw = taskTimeoutDecision({
    status: 'running',
    executionMode: 'automatic',
    adapterId: 'qclaw',
    startedAt: '2026-07-23T00:00:00.000Z',
    lastHeartbeatAt: '2026-07-23T00:01:00.000Z',
    timeoutSeconds: 900,
    heartbeatTimeoutSeconds: 180,
  }, Date.parse('2026-07-23T00:04:01.000Z'));
  assert.equal(directQClaw.kind, 'heartbeat');
  assert.equal(directQClaw.due, true);
});

test('same-cycle terminal tasks stay terminal while a new cycle resets execution state', () => {
  const sameCycle = candidateRuntimeDecision(
    { status: 'timed_out', idempotencyKey: 'batch-1', executionId: 'run-1', startedAt: '2026-07-23T00:00:00Z' },
    { status: 'running', idempotencyKey: 'batch-1' },
  );
  assert.equal(sameCycle.preserveTerminal, true);
  assert.equal(sameCycle.nextStatus, 'timed_out');
  assert.equal(sameCycle.resetExecution, false);

  const newCycle = candidateRuntimeDecision(
    { status: 'timed_out', idempotencyKey: 'batch-1', executionId: 'run-1', startedAt: '2026-07-23T00:00:00Z' },
    { status: 'pending', idempotencyKey: 'batch-2' },
  );
  assert.equal(newCycle.newCycle, true);
  assert.equal(newCycle.nextStatus, 'pending');
  assert.equal(newCycle.resetExecution, true);
});

test('runtime repair restores manual waits, recovers orphans and clamps retry storms', () => {
  const store = {
    tasks: [
      {
        id: 'manual-timeout',
        status: 'timed_out',
        adapterId: 'manual',
        executionMode: 'manual',
        executionId: 'manual-1',
        error: { code: 'HEARTBEAT_LOST' },
        attempt: 8,
        maxAttempts: 3,
        autoRetry: true,
        nextRetryAt: '2026-07-23T01:00:00Z',
      },
      {
        id: 'orphan',
        status: 'running',
        adapterId: '',
        executionId: '',
        startedAt: '',
        attempt: 0,
        maxAttempts: 3,
      },
    ],
  };
  const result = repairTaskRuntimeStore(store, '2026-07-23T02:00:00Z');
  assert.equal(result.changed, true);
  assert.equal(store.tasks[0].status, 'waiting_result');
  assert.equal(store.tasks[0].attempt, 3);
  assert.equal(store.tasks[0].autoRetry, false);
  assert.equal(store.tasks[1].status, 'pending');
  assert.equal(store.tasks[1].executionId, '');
});

test('noisy repeated events are collapsed without dropping distinct audit events', () => {
  const events = [
    { id: '1', taskId: 'task-1', type: 'task_heartbeat_lost', at: '2026-07-23T00:00:00Z' },
    { id: '2', taskId: 'task-1', type: 'task_heartbeat_lost', at: '2026-07-23T00:01:00Z' },
    { id: '3', taskId: 'task-1', type: 'result_approved', at: '2026-07-23T00:02:00Z' },
  ];
  const compacted = compactTaskEvents(events);
  assert.equal(compacted.length, 2);
  assert.equal(compacted[0].repeatCount, 2);
  assert.equal(compacted[0].firstAt, events[0].at);
  assert.equal(compacted[1].type, 'result_approved');
});
