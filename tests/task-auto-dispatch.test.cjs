'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  automaticWakeDelay,
  automaticWakeDecisionEvents,
  receiptReconcileDelay,
  receiptReconcileSchedule,
} = require('../electron/task-auto-dispatch.cjs');

test('startup candidates wait for the execution plane instead of entering the 15 second retry drain', () => {
  const now = Date.parse('2026-10-28T09:28:03.000Z');
  const readyAt = now + 6_437;
  assert.equal(automaticWakeDelay({ requestedDelayMs: 2_000, executionPlaneReadyAt: readyAt, now }), 6_487);
  assert.equal(automaticWakeDelay({ requestedDelayMs: 2_000, executionPlaneReadyAt: now - 1, now }), 2_000);
  assert.equal(automaticWakeDelay({ requestedDelayMs: 2_000, executionPlaneReadyAt: Infinity, now }), 2_000);
});

test('one semantic wake produces one queue and one terminal decision event', () => {
  const queued = automaticWakeDecisionEvents({ taskId: 'task-1', workKey: 'work-1', phase: 'queued', reason: 'event' });
  const blocked = automaticWakeDecisionEvents({ taskId: 'task-1', workKey: 'work-1', phase: 'blocked', reason: 'resource_wait' });
  assert.deepEqual([...queued, ...blocked].map(event => event.type), ['auto_wake_queued', 'auto_wake_blocked']);
  assert.equal(queued[0].decisionKey, 'work-1:queued:event:v1');
  assert.equal(blocked[0].decisionKey, 'work-1:blocked:resource_wait:v1');
});

test('unchanged receipt checks use bounded backoff', () => {
  assert.deepEqual(receiptReconcileSchedule(), [30_000, 60_000, 180_000, 300_000]);
  assert.deepEqual([0, 1, 2, 3, 4, 99].map(receiptReconcileDelay), [30_000, 60_000, 180_000, 300_000, 300_000, 300_000]);
});

test('invalid wake phases do not manufacture observability events', () => {
  assert.deepEqual(automaticWakeDecisionEvents({ taskId: 'task-1', workKey: 'work-1', phase: 'unknown', reason: 'x' }), []);
});
