'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createQuickCaptureDirect } = require('../electron/quick-capture-direct.cjs');
const { createCaptureInbox } = require('../electron/capture-inbox.cjs');

function fixture(overrides = {}) {
  let selected = 'a';
  const records = [{ id: 'a', name: '测试甲' }, { id: 'b', name: '测试乙' }];
  const projectList = [{ id: 'pa', name: '项目甲', studentIds: ['a'] }, { id: 'pb', name: '项目乙', studentIds: ['b'] }, { id: 'sealed', studentIds: ['a'], status: 'sealed' }];
  const starts = [], saves = [];
  const service = createQuickCaptureDirect({ currentStudent: () => selected, findStudent: id => records.find(s => s.id === id),
    projects: () => projectList, sources: async () => [{ id: 'screen:1', name: '测试屏幕' }],
    startScreen: async (input, validate) => { validate(); starts.push(input); return { ok: true }; },
    receivePhoto: async (id, input) => { saves.push({ id, input }); return { item: { itemId: 'photo' } }; }, ...overrides });
  return { service, starts, saves, projectList, records, select: id => { selected = id; service.invalidateScreen(); } };
}
const screenInput = setup => ({ token: setup.token, sourceId: 'screen:1', projectId: 'pa', durationMinutes: 30, mode: 'smart' });
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0xff, 0xd9]).toString('base64');

test('screen setup lists only associated live projects, start derives student from host context', async () => {
  const f = fixture(); const setup = await f.service.prepareScreen();
  assert.deepEqual(setup.projects.map(p => p.id), ['pa']);
  await f.service.start({ ...screenInput(setup), studentId: 'b', autoDeliver: true });
  assert.deepEqual(f.starts, [{ studentId: 'a', sourceId: 'screen:1', projectId: 'pa', durationMinutes: 30, mode: 'smart' }]);
  await assert.rejects(f.service.start(screenInput(setup)), /已变化/);
});

test('student change including A-B-A, cancellation and late source results invalidate setup', async () => {
  let finish; const f = fixture({ sources: () => new Promise(resolve => { finish = resolve; }) });
  const pending = f.service.prepareScreen(); f.select('b'); f.select('a'); finish([]);
  await assert.rejects(pending, /已切换/);
  const g = fixture(); const setup = await g.service.prepareScreen(); g.service.invalidateScreen();
  await assert.rejects(g.service.start(screenInput(setup)), /已变化/);
  assert.equal(g.starts.length, 0);
});

test('revalidates project, source request, strategy and duration before starting', async () => {
  const f = fixture(); const setup = await f.service.prepareScreen();
  for (const override of [{ projectId: 'pb' }, { projectId: 'sealed' }, { sourceId: '' }, { durationMinutes: 0 }, { mode: 'video' }]) {
    await assert.rejects(f.service.start({ ...screenInput(setup), ...override }));
  }
  f.projectList[0].status = 'sealed';
  await assert.rejects(f.service.start(screenInput(setup)), /已封存/);
  assert.equal(f.starts.length, 0);
});

test('duplicate start cannot create two sessions; student switch during native source lookup prevents start', async () => {
  let finish; let writes = 0;
  const f = fixture({ startScreen: async (_input, validate) => { await new Promise(resolve => { finish = resolve; }); validate(); writes++; return { ok: true }; } });
  const setup = await f.service.prepareScreen(); const first = f.service.start(screenInput(setup));
  await assert.rejects(f.service.start(screenInput(setup)), /正在启动/);
  f.select('b'); finish(); await assert.rejects(first, /已变化/); assert.equal(writes, 0);
});

test('unavailable source failure preserves setup for retry', async () => {
  let available = false;
  const f = fixture({ startScreen: async () => ({ ok: available, message: '来源不可用' }) });
  const setup = await f.service.prepareScreen(); assert.equal((await f.service.start(screenInput(setup))).ok, false);
  available = true; assert.equal((await f.service.start(screenInput(setup))).ok, true);
});

test('photo ownership remains fixed across student switches, close revokes session, malformed inputs rejected', async () => {
  const f = fixture(); const photo = f.service.createPhotoSession(); f.select('b');
  const input = { shotId: randomUUID(), base64: jpeg, studentId: 'b', sourceChannel: 'share' };
  await f.service.savePhoto(photo.token, input);
  assert.equal(f.saves[0].id, 'a'); assert.equal(f.saves[0].input.sourceChannel, 'photo');
  await assert.rejects(f.service.savePhoto(photo.token, { ...input, base64: 'dGV4dA==' }), /JPEG/);
  await assert.rejects(f.service.savePhoto(photo.token, { ...input, shotId: '../bad' }), /编号/);
  await assert.rejects(f.service.savePhoto(photo.token, { ...input, base64: 'x'.repeat(28 * 1024 * 1024 + 1) }), /超/);
  f.service.closePhoto(photo.token); await assert.rejects(f.service.savePhoto(photo.token, input), /失效/);
  assert.equal(f.saves.length, 1);
});

test('photo retries receive one immutable inbox item, never auto-deliver or cross students', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'quick-photo-test-'));
  try {
    const inbox = createCaptureInbox({ resolveStudentDir: async id => path.join(root, id), deliver: () => { throw Error('must not deliver'); } });
    const f = fixture({ receivePhoto: (id, input) => inbox.receive(id, input) });
    const photo = f.service.createPhotoSession(), input = { shotId: randomUUID(), base64: jpeg };
    const [first, second] = await Promise.all([f.service.savePhoto(photo.token, input), f.service.savePhoto(photo.token, input)]);
    assert.equal(first.item.itemId, second.item.itemId); assert.equal(second.duplicate, true);
    assert.equal((await inbox.listStored('a')).length, 1); assert.equal((await inbox.listStored('b')).length, 0);
    assert.equal(first.item.status, 'ready');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
