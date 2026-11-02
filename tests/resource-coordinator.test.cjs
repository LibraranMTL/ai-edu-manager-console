const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ResourceCoordinator } = require('../electron/resource-coordinator.cjs');

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('resource coordinator shares one heavy slot across disk, CPU and local Agent work', async () => {
  const queue = new ResourceCoordinator();
  const disk = deferred(), diskTwo = deferred(), cpu = deferred(), networkA = deferred(), networkB = deferred(), networkC = deferred();
  let diskStarted = 0, cpuStarted = 0, networkStarted = 0;
  const jobs = [
    queue.run('disk', () => { diskStarted++; return disk.promise; }),
    queue.run('disk', () => { diskStarted++; return diskTwo.promise; }),
    queue.run('cpu', () => { cpuStarted++; return cpu.promise; }),
    queue.run('network', () => { networkStarted++; return networkA.promise; }),
    queue.run('network', () => { networkStarted++; return networkB.promise; }),
    queue.run('network', () => { networkStarted++; return networkC.promise; }),
  ];
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(diskStarted, 1); assert.equal(cpuStarted, 0); assert.equal(networkStarted, 2);
  disk.resolve('disk-1'); networkA.resolve('a'); networkB.resolve('b');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(diskStarted + cpuStarted, 2); assert.equal(networkStarted, 3);
  if (diskStarted === 2) diskTwo.resolve('disk-2');
  if (cpuStarted) cpu.resolve('cpu');
  await new Promise(resolve => setImmediate(resolve));
  if (diskStarted === 2) diskTwo.resolve('disk-2');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(diskStarted + cpuStarted, 3);
  cpu.resolve('cpu');
  networkC.resolve('c'); await Promise.all(jobs); queue.close();
});

test('background maintenance waits briefly after foreground activity and keyed work coalesces', async () => {
  let now = 1000;
  const queue = new ResourceCoordinator({ now: () => now });
  queue.noteForegroundActivity(500);
  let runs = 0;
  const first = queue.run('disk', () => { runs++; return 7; }, { background: true, key: 'maintenance' });
  const second = queue.run('disk', () => { runs++; return 8; }, { background: true, key: 'maintenance' });
  assert.equal(first, second);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(runs, 0);
  now = 1501; queue.drain();
  assert.equal(await first, 7); assert.equal(runs, 1); queue.close();
});

test('a user request may ignore its own foreground delay but never system pressure or real contention', async () => {
  let now = 1_000;
  const queue = new ResourceCoordinator({ now: () => now });
  queue.noteForegroundActivity(60_000);
  assert.equal(queue.acquireExternal('localAgent', { background: true }), null);
  const release = queue.acquireExternal('localAgent', { background: true, ignoreForegroundDelay: true });
  assert.equal(typeof release, 'function');
  assert.equal(queue.acquireExternal('localAgent', { background: true, ignoreForegroundDelay: true }), null);
  release();
  queue.updatePressure({ availableMemoryRatio: .1, availableMemoryBytes: 2 * 1024 ** 3 });
  assert.equal(queue.acquireExternal('localAgent', { background: true, ignoreForegroundDelay: true }), null);
  queue.close();
});

test('pressure hysteresis and scope locks pause new background heavy work', async () => {
  let now = 1_000;
  const queue = new ResourceCoordinator({ now: () => now });
  queue.updatePressure({ cpuPercent: 70, availableMemoryRatio: .8 });
  queue.updatePressure({ cpuPercent: 70, availableMemoryRatio: .8 });
  let started = 0;
  const blocked = queue.run('cpu', () => { started++; return 'ok'; }, { background: true, studentId: 'a' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, 0);
  queue.updatePressure({ cpuPercent: 20, availableMemoryRatio: .8 });
  queue.updatePressure({ cpuPercent: 20, availableMemoryRatio: .8 });
  queue.updatePressure({ cpuPercent: 20, availableMemoryRatio: .8 });
  now += 1_001; queue.drain();
  assert.equal(await blocked, 'ok');
  await new Promise(resolve => setImmediate(resolve));
  const release = queue.acquireExternal('localAgent', { studentId: 'a' });
  assert.equal(typeof release, 'function');
  assert.equal(queue.acquireExternal('disk', { studentId: 'b' }), null);
  release(); queue.close();
});
