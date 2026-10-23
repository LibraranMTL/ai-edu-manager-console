'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { createSmartInbox } = require('../electron/smart-inbox.cjs');
const { createDownloadInbox } = require('../electron/download-inbox.cjs');
const { createCaptureInbox } = require('../electron/capture-inbox.cjs');
const { createLegacyIntakeBridge } = require('../electron/smart-inbox-legacy.cjs');
const policy = require('../electron/agent-invocation-service.cjs');
const target = studentId => ({ studentId, type: 'project', id: `project-${studentId}`, categoryId: '' });
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'inbox-r15-')), folder = path.join(root, 'downloads'), dest = path.join(root, 'managed');
  await fs.mkdir(folder); await fs.mkdir(dest);
  const calls = { classify: [], extract: [], deliver: 0, corrections: [] };
  const taskHost = await require('./helpers/smart-inbox-task-host.cjs').createTaskHost(root);
  t.after(() => taskHost.close());
  let engine;
  const capture = createCaptureInbox({ resolveStudentDir: async id => { if (!['a', 'b'].includes(id)) throw Error('forbidden'); return path.join(root, id); }, deliver: () => { throw Error('legacy importer must not run'); } });
  const host = { directory: path.join(root, 'state'), stableAgeMs: 0, forbiddenRoots: () => [dest], automaticAllowed: () => true,
    beginBatch: taskHost.beginBatch, endBatch: taskHost.endBatch,
    context: async id => { if (!['a', 'b'].includes(id)) throw Error('forbidden'); return { studentId: id, projects: [{ id: `project-${id}`, name: '实验项目', categories: [] }] }; },
    validateTarget: async t => { if (!['a', 'b'].includes(t.studentId) || t.id !== `project-${t.studentId}`) throw Error('forbidden target'); return t; },
    extract: async item => { calls.extract.push(item.studentId); return { text: await fs.readFile(item.snapshotPath, 'utf8'), warnings: [] }; },
    classify: async ({ context, text }) => { calls.classify.push(context.studentId); return { candidates: [{ ...target(context.studentId), score: .99, evidence: text, reason: '正文实验主题一致' }], sensitive: false, conflict: false, reason: '' }; },
    deliver: async (input, t, item, checkpoint) => { calls.deliver++; const file = path.join(dest, `${t.studentId}-${item.id}.txt`); await checkpoint({ destinationPath: file }); await fs.copyFile(input, file); return { ok: true, path: file, recordId: item.operationId }; },
    correctAssociation: async (item, previous) => { calls.corrections.push({ from: previous.target.studentId, to: item.studentId }); return { retained: true, status: 'retained' }; },
    acquire: () => () => {}, events: () => [], resolveEvent: (source, locator) => capture.resolveStored(source.studentId, locator),
    acknowledge: async (source, item) => { if (source.type === 'share') await capture.acknowledgeStored(source.studentId, item.locator, item.fingerprint.sha256, item.receipt, item.target); },
  };
  engine = createSmartInbox(host); await engine.init();
  const download = createDownloadInbox({ dataDir: path.join(root, 'download-state'), stableAgeMs: 0, validateTarget: host.validateTarget,
    forbiddenRoots: () => [dest], deliver: () => { throw Error('legacy importer must not run'); } });
  await download.configure(folder);
  const bridge = createLegacyIntakeBridge({ ready: async () => engine, download: () => download, capture: () => capture });
  const source = await engine.updateSource({ folder, studentId: '', enabled: true, automatic: false, staging: true, originalMode: 'archive' });
  const file = path.join(folder, 'report.txt');
  await fs.writeFile(file, '本次实验研究摆长与周期之间的关系。记录多个不同摆长下的周期，统计重复测量误差并讨论实验结论。');
  await engine.requestScan(source.id); await engine.tick();
  const row = (await engine.list()).rows[0];
  t.after(async () => { await engine.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, folder, file, source, engine, host, calls, row, download, bridge, capture, taskHost };
}
async function decide(f, action, id, extra, requestId = `${action}-${Math.random().toString(36).slice(2)}`) {
  const item = await f.engine.detail(id);
  return f.engine.decide({ requestId, action, items: [{ id, revision: item.revision, ...extra }] });
}
test('wrong confirmed student can be explicitly corrected and reclassified; old context is never reused', async t => {
  const f = await fixture(t);
  await decide(f, 'confirm_student', f.row.id, { studentId: 'a' }); await f.engine.tick();
  assert.deepEqual(f.calls.classify, ['a']);
  const row = await f.engine.detail(f.row.id);
  const request = { requestId: 'change-student', action: 'reassign_student', items: [{ id: row.id, revision: row.revision, studentId: 'b', confirmedStudentChange: true }] };
  assert.equal((await f.engine.decide(request)).results[0].ok, true); await f.engine.tick();
  assert.equal((await f.engine.decide(request)).results[0].ok, true);
  const next = await f.engine.detail(row.id);
  assert.equal(next.studentId, 'b'); assert.equal(next.proposedTarget.id, 'project-b');
  assert.deepEqual(f.calls.classify, ['a', 'b']); assert.deepEqual(f.calls.extract, ['a', 'b']);
  assert.equal(next.studentCorrections[0].from, 'a'); assert.equal((await f.engine.sources()).sources[0].studentId, '');
  assert.ok(f.taskHost.disk().tasks.every(task => task.status === 'succeeded'));
});
test('delivered staging original can be reassigned and automatically reclassified after snapshot release', async t => {
  const f = await fixture(t);
  assert.equal((await decide(f, 'correct', f.row.id, { target: target('a') })).results[0].ok, true);
  await assert.rejects(fs.access(f.file)); assert.equal((await f.engine.detail(f.row.id)).snapshotPath, '');
  await f.engine.updateSource({ ...f.source, automatic: true });
  assert.equal((await decide(f, 'reassign_student', f.row.id, { studentId: 'b', confirmedStudentChange: true })).results[0].ok, true);
  await f.engine.tick(); const next = await f.engine.detail(f.row.id);
  assert.equal(next.status, 'delivered'); assert.equal(next.studentId, 'b'); assert.equal(next.target.studentId, 'b');
  assert.equal(next.snapshotPath, ''); assert.deepEqual(f.calls.classify, ['b']);
  assert.deepEqual(f.calls.corrections, [{ from: 'a', to: 'b' }]); await fs.access(await f.engine.openOriginal(next.id));
});
test('manual cross-student correction requires explicit intent and revalidates target permission', async t => {
  const f = await fixture(t); await decide(f, 'confirm_student', f.row.id, { studentId: 'a' }); await f.engine.tick();
  assert.equal((await decide(f, 'correct', f.row.id, { target: target('b') })).results[0].ok, false);
  assert.equal((await decide(f, 'correct', f.row.id, { target: target('deleted'), confirmedStudentChange: true })).results[0].ok, false);
  assert.equal((await f.engine.detail(f.row.id)).studentId, 'a');
  assert.equal((await decide(f, 'correct', f.row.id, { target: target('b'), confirmedStudentChange: true })).results[0].ok, true);
  assert.equal((await f.engine.detail(f.row.id)).target.studentId, 'b');
});
test('unknown execution cannot be bypassed by student correction', async t => {
  const f = await fixture(t);
  f.host.classify = async () => { throw Object.assign(Error('unknown'), { code: 'execution_unknown' }); };
  await decide(f, 'confirm_student', f.row.id, { studentId: 'a' }); await f.engine.tick();
  const row = await f.engine.detail(f.row.id); assert.equal(row.status, 'execution_unknown');
  assert.equal((await decide(f, 'reassign_student', row.id, { studentId: 'b', confirmedStudentChange: true })).results[0].ok, false);
  assert.equal((await decide(f, 'correct', row.id, { target: target('b'), confirmedStudentChange: true })).results[0].ok, false);
  assert.equal(f.calls.deliver, 0);
});

test('changed source version blocks reassignment and leaves student scope unchanged', async t => {
  const f = await fixture(t); await decide(f, 'confirm_student', f.row.id, { studentId: 'a' }); await f.engine.tick();
  await fs.appendFile(f.file, 'new version');
  assert.equal((await decide(f, 'reassign_student', f.row.id, { studentId: 'b', confirmedStudentChange: true })).results[0].ok, false);
  assert.equal((await f.engine.detail(f.row.id)).studentId, 'a'); assert.equal(f.calls.deliver, 0);
});

test('explicit correction overrides only this item in a student-bound source', async t => {
  const f = await fixture(t); await f.engine.updateSource({ ...f.source, studentId: 'a' });
  // New discovery records the current source authorization before explicit correction.
  await f.engine.requestScan(f.source.id); await f.engine.tick();
  const result = await decide(f, 'correct', f.row.id, { target: target('b'), confirmedStudentChange: true });
  assert.equal(result.results[0].ok, true, result.results[0].message);
  assert.equal((await f.engine.detail(f.row.id)).target.studentId, 'b');
  assert.equal((await f.engine.sources()).sources[0].studentId, 'a');
});
test('legacy download delivery updates the same wrong-student record and keeps only one managed original', async t => {
  const f = await fixture(t); await decide(f, 'confirm_student', f.row.id, { studentId: 'a' }); await f.engine.tick();
  const listed = await f.bridge.downloadList(), id = listed.files[0].fileId;
  const first = await f.bridge.deliverDownloads([id], target('b')); assert.equal(first.results[0].ok, true, first.results[0].message);
  const row = await f.engine.detail(f.row.id); assert.equal(row.studentId, 'b'); assert.equal(row.status, 'delivered');
  await assert.rejects(fs.access(f.file)); await assert.rejects(fs.access(path.join(f.folder, '已投递')));
  assert.equal((await f.bridge.downloadList()).files[0].status, 'delivered');
  assert.equal((await f.bridge.deliverDownloads([id], target('b'))).results[0].ok, true);
  assert.equal(f.calls.deliver, 1); assert.equal((await f.engine.list({ status: 'delivered' })).total, 1);
});
test('legacy share delivery uses unified receipt and releases temporary object without permitting another student read', async t => {
  const f = await fixture(t); await f.engine.bootstrap({ students: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] });
  const received = await f.capture.receive('a', { name: 'share.txt', sourceChannel: 'share', bytes: Buffer.from('实验记录 project-a') });
  const original = (await f.capture.resolveStored('a', received.item.itemId)).path;
  const result = await f.bridge.deliverShares('a', [received.item.itemId], target('a'));
  assert.equal(result.results[0].ok, true, result.results[0].message); await assert.rejects(fs.access(original));
  const managed = await f.capture.resolveStored('a', received.item.itemId); await fs.access(managed.path);
  assert.equal((await f.bridge.deliverShares('a', [received.item.itemId], target('a'))).results[0].ok, true);
  await assert.rejects(f.capture.resolveStored('b', received.item.itemId)); assert.equal(f.calls.deliver, 1);
});
test('actual main legacy IPC handlers await the unified engine and never invoke the old importer', async t => {
  const f = await fixture(t), vm = require('node:vm');
  const main = await fs.readFile(path.join(__dirname, '../electron/main.cjs'), 'utf8'), handlers = {};
  const ctx = vm.createContext({ getSmartInbox: async () => f.engine, getDownloadInbox: () => f.download, getCaptureInbox: () => f.capture,
    require: name => require(path.join(__dirname, '../electron', name)),
    licensedInvoke: (_label, work) => work(), planningResultAsync: work => work(),
    ipcMain: { handle: (name, fn) => { handlers[name] = fn; } } });
  vm.runInContext('let legacyIntakeBridge;', ctx);
  const start = main.indexOf('function getLegacyIntakeBridge(');
  vm.runInContext(main.slice(start, main.indexOf('\n}', start) + 2), ctx);
  for (const name of ['listDownloadInboxFiles', 'deliverDownloadInboxFiles', 'captureInboxChange']) {
    const from = main.indexOf(`ipcMain.handle('bridge:${name}'`), to = main.indexOf('));', from) + 3;
    vm.runInContext(main.slice(from, to), ctx);
  }
  const data = await handlers['bridge:listDownloadInboxFiles']();
  const result = await handlers['bridge:deliverDownloadInboxFiles'](null, [data.data.files[0].fileId], target('b'));
  assert.equal(result.data.results[0].ok, true); assert.equal((await f.engine.detail(f.row.id)).studentId, 'b');
});

test('share drop-folder staging copies are released only after verified unified delivery', async t => {
  const f = await fixture(t); await f.engine.bootstrap({ students: [{ id: 'a', name: 'A' }] });
  const info = await f.capture.info('a'); await fs.writeFile(path.join(info.incomingPath, 'drop.txt'), 'project-a drop-folder synthetic');
  const item = (await f.capture.list('a'))[0];
  assert.equal((await fs.readdir(info.receivedPath)).length, 1);
  assert.equal((await f.bridge.deliverShares('a', [item.itemId], target('a'))).results[0].ok, true);
  assert.equal((await fs.readdir(info.receivedPath)).length, 0); assert.equal((await fs.readdir(info.registeredPath)).length, 0);
  await fs.access((await f.capture.resolveStored('a', item.itemId)).path);
});

test('delivered audio remains transcribable from verified managed original', async t => {
  const f = await fixture(t); await f.engine.bootstrap({ students: [{ id: 'a', name: 'A' }] });
  const item = (await f.capture.receive('a', { name: 'audio.wav', sourceChannel: 'audio', bytes: Buffer.from('synthetic audio') })).item;
  assert.equal((await f.bridge.deliverShares('a', [item.itemId], target('a'))).results[0].ok, true);
  const result = await f.capture.transcribe('a', item.itemId, { transcribe: async ({ bytes }) => { assert.equal(bytes.toString(), 'synthetic audio'); return { text: 'test', mode: 'synthetic', model: 'test' }; } }, true);
  assert.ok(result.itemId);
});
test('shared provider login survives switching students; route reports usable fallback and expired qualification never requests login', () => {
  const adapter = { id: 'codex', executable: 'fake', authScope: 'same-profile', authVersion: 1 };
  const saved = { ready: true, runtimeScope: policy.classificationIdentity(adapter, ''), expiresAt: new Date(Date.now() + 60000).toISOString() };
  const fallback = policy.classificationSavedStatus({ providerId: 'codex', label: 'Codex', state: 'login_required' }, adapter, saved);
  for (const studentId of ['a', 'b']) {
    const status = policy.classificationRouteStatus({ studentId, providerId: 'workbuddy', state: 'login_required', fallback: { enabled: true } }, fallback);
    assert.equal(status.state, 'ready'); assert.equal(status.effectiveProviderId, 'codex');
  }
  assert.equal(policy.classificationSavedStatus(fallback, adapter, { ...saved, ready: true, expiresAt: '2020-01-01' }).state, 'channel_ready');
  assert.equal(policy.classificationRouteStatus({ providerId: 'workbuddy', state: 'login_required', fallback: { enabled: false } }, fallback).state, 'login_required');
});
