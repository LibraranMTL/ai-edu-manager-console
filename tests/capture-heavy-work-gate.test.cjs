const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { CaptureHeavyWorkGate } = require('../electron/capture-heavy-work-gate.cjs');

test('shared heavy-work gate allows only one disk or CPU heavy task', () => {
  const gate = new CaptureHeavyWorkGate();
  const idle = { availableMemoryRatio: 0.7, idleSeconds: 120, cpuPercent: 10 };
  const first = gate.tryAcquire({ kind: 'timeline', studentId: 'student-a', sessionId: 'a', snapshot: idle });
  assert.equal(typeof first, 'function');
  assert.equal(gate.tryAcquire({ kind: 'vision', studentId: 'student-a', sessionId: 'a', snapshot: idle }), null);
  const second = gate.tryAcquire({ kind: 'timeline', studentId: 'student-b', sessionId: 'b', snapshot: idle });
  assert.equal(second, null);
  assert.equal(gate.tryAcquire({ kind: 'report_projection', studentId: 'student-c', sessionId: 'c', snapshot: idle }), null);
  assert.equal(gate.tryAcquire({ kind: 'vision', studentId: 'student-c', sessionId: 'c', snapshot: { ...idle, captureActive: true } }), null);
  first();
  first();
  const next = gate.tryAcquire({ kind: 'vision', studentId: 'student-a', sessionId: 'a', snapshot: idle });
  assert.equal(typeof next, 'function');
  next();
  assert.deepEqual(gate.state(), []);
});

test('network class permits two tasks while preserving the global adaptive cap', () => {
  const gate = new CaptureHeavyWorkGate();
  const idle = { availableMemoryRatio: 0.7, idleSeconds: 120, cpuPercent: 10 };
  const first = gate.tryAcquire({ kind: 'upload', studentId: 'a', sessionId: 'a', resourceClass: 'network', snapshot: idle });
  const second = gate.tryAcquire({ kind: 'download', studentId: 'b', sessionId: 'b', resourceClass: 'network', snapshot: idle });
  assert.equal(typeof first, 'function'); assert.equal(typeof second, 'function');
  assert.equal(gate.tryAcquire({ kind: 'sync', studentId: 'c', sessionId: 'c', resourceClass: 'network', snapshot: idle }), null);
  first(); second();
});

test('Agent, vision, and timeline tasks share one capture-aware capacity', () => {
  const gate = new CaptureHeavyWorkGate();
  const normal = { availableMemoryRatio: 0.6, idleSeconds: 25, cpuPercent: 10 };
  assert.equal(gate.tryAcquire({ kind: 'agent_codex', studentId: 'a', snapshot: { ...normal, captureActive: true } }), null);
  const agent = gate.tryAcquire({ kind: 'agent_codex', studentId: 'a', snapshot: normal });
  assert.equal(typeof agent, 'function');
  assert.equal(gate.tryAcquire({ kind: 'capture_vision', studentId: 'b', snapshot: normal }), null);
  agent();
  assert.equal(typeof gate.tryAcquire({ kind: 'capture_vision', studentId: 'b', snapshot: normal }), 'function');
});

test('oldest eligible student gets the next permit after contention', () => {
  const gate = new CaptureHeavyWorkGate();
  const snapshot = { availableMemoryRatio: 0.6, idleSeconds: 10, cpuPercent: 10 };
  const active = gate.tryAcquire({ kind: 'agent', studentId: 'active', sessionId: 'one', snapshot });
  assert.equal(gate.tryAcquire({ kind: 'timeline', studentId: 'student-a', sessionId: 'two', snapshot }), null);
  assert.equal(gate.tryAcquire({ kind: 'vision', studentId: 'student-b', sessionId: 'three', snapshot }), null);
  active();
  assert.equal(gate.tryAcquire({ kind: 'vision', studentId: 'student-b', sessionId: 'three', snapshot }), null);
  const first = gate.tryAcquire({ kind: 'timeline', studentId: 'student-a', sessionId: 'two', snapshot });
  assert.equal(typeof first, 'function');
  first();
  assert.equal(typeof gate.tryAcquire({ kind: 'vision', studentId: 'student-b', sessionId: 'three', snapshot }), 'function');
});

test('main process routes CLI Agent launch and automatic retry through shared permit', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  const launch = main.slice(main.indexOf('function launchCommandAdapter('), main.indexOf('function submitOpenClawTask('));
  assert.match(launch, /captureHeavyWorkGate\.tryAcquire\(/);
  assert.match(launch, /scheduleHeavyTaskRetry\(task\.id, adapterId\)/);
  assert.match(launch, /releaseHeavyPermit\(\)/);
});
