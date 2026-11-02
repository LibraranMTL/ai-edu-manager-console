'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { admitRunnableTaskToRunning } = require('../electron/task-execution-admission.cjs');
const { validateTaskTransition } = require('../electron/task-protocol.cjs');

function harness(status) {
  const task = { id: 'task-1', status };
  const events = [];
  const transition = (_store, _taskId, nextStatus, patch, eventType) => {
    const validation = validateTaskTransition(task.status, nextStatus);
    if (!validation.ok) return validation;
    task.status = nextStatus;
    Object.assign(task, patch);
    events.push(eventType);
    return { ok: true, task };
  };
  return { store: { tasks: [task] }, task, events, transition };
}

test('pending task is durably admitted before an external execution starts', () => {
  const fixture = harness('pending');
  const result = admitRunnableTaskToRunning({
    store: fixture.store,
    taskId: fixture.task.id,
    patch: { executionId: 'execution-1' },
    eventType: 'controlled_material_started',
    transition: fixture.transition,
  });
  assert.equal(result.ok, true);
  assert.equal(fixture.task.status, 'running');
  assert.equal(fixture.task.executionId, 'execution-1');
  assert.deepEqual(fixture.events, ['controlled_material_admitted', 'controlled_material_started']);
});

test('already approved task starts without a duplicate admission event', () => {
  const fixture = harness('approved');
  const result = admitRunnableTaskToRunning({
    store: fixture.store,
    taskId: fixture.task.id,
    patch: { executionId: 'execution-2' },
    eventType: 'adapter_started',
    transition: fixture.transition,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(fixture.events, ['adapter_started']);
});

test('non-runnable task is not silently reset', () => {
  const fixture = harness('blocked');
  const result = admitRunnableTaskToRunning({
    store: fixture.store,
    taskId: fixture.task.id,
    patch: { executionId: 'execution-3' },
    eventType: 'adapter_started',
    transition: fixture.transition,
  });
  assert.equal(result.ok, false);
  assert.equal(fixture.task.status, 'blocked');
  assert.deepEqual(fixture.events, []);
});
