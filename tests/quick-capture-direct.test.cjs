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
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=', 'base64');

test('single screenshot has no writes before confirmation, validates target and saves host-owned bytes', async () => {
  const writes = []; const f = fixture({ takeScreenshot: async (_id, validate) => { validate(); return { bytes: png, capturedAt: '2026-10-08T00:00:00Z', sourceName: '已授权屏幕' }; },
    receiveScreenshot: async (id, input) => { writes.push({ id, input }); return { item: { itemId: 'shot' } }; } });
  const setup = await f.service.prepareScreen();
  await assert.rejects(f.service.screenshot({ ...screenInput(setup), projectId: 'pb' }), /未关联/);
  const shot = await f.service.screenshot(screenInput(setup));
  assert.equal(writes.length, 0); assert.equal(f.starts.length, 0);
  await f.service.saveScreenshot({ token: setup.token, shotId: shot.shotId, studentId: 'b', base64: 'malicious', projectId: 'pb' });
  assert.equal(writes[0].id, 'a'); assert.ok(writes[0].input.bytes.equals(png));
  assert.deepEqual(writes[0].input.suggestedTarget, { type: 'project', id: 'pa' });
});

test('late screenshots, cancelled previews, replaced previews and sealed project cannot be saved', async () => {
  let finish; const f = fixture({ takeScreenshot: () => new Promise(resolve => { finish = resolve; }) });
  const setup = await f.service.prepareScreen(); const pending = f.service.screenshot(screenInput(setup));
  f.select('b'); f.select('a'); finish({ bytes: png }); await assert.rejects(pending, /已变化/);
  const g = fixture({ takeScreenshot: async () => ({ bytes: png }) }); const next = await g.service.prepareScreen();
  const first = await g.service.screenshot(screenInput(next)), second = await g.service.screenshot(screenInput(next));
  await assert.rejects(g.service.saveScreenshot({ token: next.token, shotId: first.shotId }), /失效/);
  g.projectList[0].status = 'sealed'; await assert.rejects(g.service.saveScreenshot({ token: next.token, shotId: second.shotId }), /封存/);
  g.service.invalidateScreen(); await assert.rejects(g.service.saveScreenshot({ token: next.token, shotId: second.shotId }), /已变化/);
});

test('screenshot failure can retry, concurrent acquisition is rejected, receipt retry creates one item', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'quick-screen-test-'));
  try {
    let fail = true, finish; const inbox = createCaptureInbox({ resolveStudentDir: async id => path.join(root, id), deliver: () => { throw Error('No auto delivery'); } });
    const f = fixture({ takeScreenshot: async () => { if (fail) throw Error('来源关闭'); await new Promise(resolve => { finish = resolve; }); return { bytes: png }; }, receiveScreenshot: (id, input) => inbox.receive(id, input) });
    const setup = await f.service.prepareScreen(); await assert.rejects(f.service.screenshot(screenInput(setup)), /来源关闭/);
    fail = false; const pending = f.service.screenshot(screenInput(setup));
    await assert.rejects(f.service.screenshot(screenInput(setup)), /正在执行/); finish(); const shot = await pending;
    const input = { token: setup.token, shotId: shot.shotId };
    const [one, two] = await Promise.all([f.service.saveScreenshot(input), f.service.saveScreenshot(input)]);
    assert.equal(one.item.itemId, two.item.itemId); assert.equal(two.duplicate, true);
    const records = await inbox.listStored('a'); assert.equal(records.length, 1); assert.equal(records[0].status, 'ready');
    assert.equal(records[0].sourceChannel, 'screen'); assert.deepEqual(records[0].suggestedTarget, { type: 'project', id: 'pa' });
    assert.equal((await inbox.listStored('b')).length, 0);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

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
