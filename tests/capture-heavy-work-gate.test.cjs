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

test('resource admission reports disk and active capture pressure precisely', () => {
  const gate = new CaptureHeavyWorkGate();
  const base = { availableMemoryRatio: 0.7, idleSeconds: 120, cpuPercent: 10 };
  assert.equal(gate.tryAcquire({ kind: 'agent_codex', studentId: 'a', snapshot: { ...base, diskPressure: true } }), null);
  assert.equal(gate.blockState().reason, 'disk_pressure');
  assert.equal(gate.tryAcquire({ kind: 'agent_codex', studentId: 'a', snapshot: { ...base, captureActive: true } }), null);
  assert.equal(gate.blockState().reason, 'capture_active');
});

test('the durable scheduler chooses the next task and the gate only checks live capacity', () => {
  const gate = new CaptureHeavyWorkGate();
  const snapshot = { availableMemoryRatio: 0.6, idleSeconds: 10, cpuPercent: 10 };
  const active = gate.tryAcquire({ kind: 'agent', studentId: 'active', sessionId: 'one', snapshot });
  assert.equal(gate.tryAcquire({ kind: 'timeline', studentId: 'student-a', sessionId: 'two', snapshot }), null);
  assert.equal(gate.tryAcquire({ kind: 'vision', studentId: 'student-b', sessionId: 'three', snapshot }), null);
  active();
  const first = gate.tryAcquire({ kind: 'vision', studentId: 'student-b', sessionId: 'three', snapshot });
  assert.equal(typeof first, 'function');
  assert.equal(gate.tryAcquire({ kind: 'timeline', studentId: 'student-a', sessionId: 'two', snapshot }), null);
  first();
  assert.equal(typeof gate.tryAcquire({ kind: 'timeline', studentId: 'student-a', sessionId: 'two', snapshot }), 'function');
});

test('desktop Agent processes keep a global cooldown between students', () => {
  let now = 1_000;
  const gate = new CaptureHeavyWorkGate({ minLocalAgentGapMs: 30_000, now: () => now });
  const snapshot = { availableMemoryRatio: 0.7, idleSeconds: 120, cpuPercent: 10 };
  const first = gate.tryAcquire({ kind: 'agent_workbuddy', studentId: 'a', sessionId: 'one', snapshot });
  assert.equal(typeof first, 'function');
  first();
  now += 29_999;
  assert.equal(gate.tryAcquire({ kind: 'agent_workbuddy', studentId: 'b', sessionId: 'two', snapshot }), null);
  now += 1;
  const second = gate.tryAcquire({ kind: 'agent_workbuddy', studentId: 'b', sessionId: 'two', snapshot });
  assert.equal(typeof second, 'function');
  second();
});

test('intake classification shares the live Agent slot without imposing the ten-minute digest cooldown', () => {
  let now = 1_000;
  const gate = new CaptureHeavyWorkGate({ minStudentGapMs: 10 * 60_000, minLocalAgentGapMs: 30_000, now: () => now });
  const snapshot = { availableMemoryRatio: 0.7, idleSeconds: 120, cpuPercent: 10 };
  const classification = gate.tryAcquire({ kind: 'agent_classification', studentId: 'student-a', sessionId: 'classify', snapshot });
  assert.equal(typeof classification, 'function'); classification();
  now += 30_000;
  const digest = gate.tryAcquire({ kind: 'agent_workbuddy', studentId: 'student-a', sessionId: 'digest', snapshot });
  assert.equal(typeof digest, 'function'); digest();
});

test('resource waits are durable in SQLite and never create stale in-memory holders', () => {
  let now = Date.parse('2026-10-24T08:00:00.000Z');
  const gate = new CaptureHeavyWorkGate({ now: () => now });
  const idle = { availableMemoryRatio: 0.7, idleSeconds: 120, cpuPercent: 10 };
  const active = gate.tryAcquire({ kind: 'agent_workbuddy', studentId: 'active', sessionId: 'running', snapshot: idle });
  assert.equal(typeof active, 'function');
  assert.equal(gate.tryAcquire({ kind: 'timeline', studentId: 'student-a', sessionId: 'a', snapshot: idle }), null);
  now += 61_000;
  assert.equal(gate.tryAcquire({ kind: 'vision', studentId: 'student-b', sessionId: 'b', snapshot: idle }), null);
  assert.deepEqual(gate.waitingState(), []);
  active();
  const next = gate.tryAcquire({ kind: 'vision', studentId: 'student-b', sessionId: 'b', snapshot: idle });
  assert.equal(typeof next, 'function');
  next();
});

test('non-Agent heavy work does not create a desktop Agent cooldown', () => {
  let now = 1_000;
  const gate = new CaptureHeavyWorkGate({ minLocalAgentGapMs: 30_000, now: () => now });
  const snapshot = { availableMemoryRatio: 0.7, idleSeconds: 120, cpuPercent: 10 };
  const scan = gate.tryAcquire({ kind: 'workspace_scan', studentId: 'a', sessionId: 'scan', snapshot });
  assert.equal(typeof scan, 'function'); scan(); now += 1;
  const agent = gate.tryAcquire({ kind: 'agent_codex', studentId: 'b', sessionId: 'agent', snapshot });
  assert.equal(typeof agent, 'function'); agent();
});

test('user-originated work ignores only foreground delay and pure network work does not impersonate a local Agent conflict', () => {
  let now = 1_000;
  const { ResourceCoordinator } = require('../electron/resource-coordinator.cjs');
  const coordinator = new ResourceCoordinator({ now: () => now });
  coordinator.noteForegroundActivity(60_000);
  const gate = new CaptureHeavyWorkGate({ coordinator, now: () => now });
  const idle = { availableMemoryRatio: .7, availableMemoryBytes: 8 * 1024 ** 3, idleSeconds: 0, cpuPercent: 10 };
  assert.equal(gate.tryAcquire({ kind: 'agent_probe', sessionId: 'background', snapshot: idle, requestOrigin: 'probe' }), null);
  const network = gate.tryAcquire({ kind: 'cloud_sync', sessionId: 'network', resourceClass: 'network', snapshot: idle,
    requestOrigin: 'user' });
  assert.equal(typeof network, 'function');
  const userProbe = gate.tryAcquire({ kind: 'agent_probe', sessionId: 'user', snapshot: idle, requestOrigin: 'user' });
  assert.equal(typeof userProbe, 'function');
  userProbe(); network();
  const agedBackground = gate.tryAcquire({ kind: 'agent_classification', studentId: 'aged', sessionId: 'aged',
    snapshot: idle, ignoreForegroundDelay: true });
  assert.equal(typeof agedBackground, 'function');
  agedBackground(); coordinator.close();
});

test('main process routes CLI Agent launch and automatic retry through shared permit', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  const launch = main.slice(main.indexOf('function launchCommandAdapter('), main.indexOf('function submitOpenClawTask('));
  assert.match(launch, /captureHeavyWorkGate\.tryAcquire\(/);
  assert.match(launch, /deferTaskForAdapter\(task, adapterId/);
  assert.match(launch, /releaseHeavyPermit\(\)/);
});
