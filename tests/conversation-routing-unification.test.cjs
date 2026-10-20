'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fss = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createSmartInbox } = require('../electron/smart-inbox.cjs');
const control = require('../electron/agent-control-plane.cjs');

test('v3 global authorization migrates atomically to v4 with a fresh conversation routing boundary', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-routing-migration-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'policies.json');
  await fs.writeFile(file, JSON.stringify({ schema: 'edu-manager.agent-control.v3', revision: 4, policies: {}, history: [], global: {
    ...control.globalDefaults(), enabled: true, version: 7, authorizedAt: '2026-10-01T00:00:00.000Z', captureEpoch: 'old-epoch',
  } }));
  const before = Date.now();
  const store = control.createAgentControlStore(file);
  const migrated = await store.migrate();
  assert.equal(store.read().schema, 'edu-manager.agent-control.v4');
  assert.equal(migrated.version, 8);
  assert.equal(migrated.capturedConversationRouting.enabled, true);
  assert.ok(Date.parse(migrated.capturedConversationRouting.authorizedAt) >= before);
  assert.equal(fss.existsSync(`${file}.pre-v4.bak`), true);
  const repeated = await store.migrate();
  assert.equal(repeated.version, 8, 'restart must not move the authorization boundary');
});

test('managed conversation sources separate automatic sessions from suggestion-only history and honor activation time', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'conversation-routing-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const assets = path.join(root, 'assets'); await fs.mkdir(assets);
  const oldFile = path.join(assets, 'old.md'), sessionFile = path.join(assets, 'session.md'), historyFile = path.join(assets, 'history.md');
  await fs.writeFile(oldFile, 'project-physics old');
  const boundary = new Date(Date.now() - 1000).toISOString();
  await fs.utimes(oldFile, new Date(Date.now() - 10000), new Date(Date.now() - 10000));
  await fs.writeFile(sessionFile, 'project-physics session');
  await fs.writeFile(historyFile, 'project-physics history');
  const destination = path.join(root, 'destination'); await fs.mkdir(destination);
  let delivered = 0;
  const target = { studentId: 'student-a', type: 'project', id: 'project-physics' };
  const engine = createSmartInbox({ directory: path.join(root, 'state'), stableAgeMs: 0, automaticAllowed: () => true,
    forbiddenRoots: () => [destination], context: async () => ({ studentId: 'student-a', projects: [{ id: 'project-physics', name: 'Physics', categories: [] }] }),
    validateTarget: async value => value, acquire: () => () => {},
    events: async source => source.type === 'session'
      ? await Promise.all([oldFile, sessionFile].map(async file => ({ name: path.basename(file), locator: file, stat: await fs.lstat(file) })))
      : source.type === 'history' ? [{ name: path.basename(historyFile), locator: historyFile, stat: await fs.lstat(historyFile) }] : [],
    resolveEvent: async (_source, locator) => {
      const stat = await fs.lstat(locator);
      return locator === oldFile ? { path: locator, stat: { ...stat, mtimeMs: Date.now() - 10000, birthtimeMs: Date.now() - 10000 } } : { path: locator, stat };
    },
    extract: async item => ({ text: await fs.readFile(item.snapshotPath, 'utf8'), warnings: [] }),
    classify: async () => ({ candidates: [{ ...target, score: .98, evidence: 'project-physics', reason: 'exact project' }], sensitive: false, conflict: false, reason: '' }),
    deliver: async (snapshot, _target, item) => { delivered++; const file = path.join(destination, `${item.id}.md`); await fs.copyFile(snapshot, file); return { ok: true, path: file, recordId: item.id }; },
  });
  t.after(() => engine.close());
  await engine.bootstrap({ students: [{ id: 'student-a', name: 'Student A' }] });
  await engine.syncConversationRouting({ enabled: true, authorizedAt: boundary }, [{ id: 'student-a', name: 'Student A' }]);
  const managed = (await engine.sources()).sources.filter(source => ['session', 'history'].includes(source.type));
  assert.equal(managed.find(source => source.type === 'session').automatic, true);
  assert.equal(managed.find(source => source.type === 'session').confidenceThreshold, .95);
  assert.equal(managed.find(source => source.type === 'history').automatic, false);
  await engine.requestScan(managed.find(source => source.type === 'session').id);
  await engine.requestScan(managed.find(source => source.type === 'history').id);
  await engine.tick();
  assert.equal(delivered, 1, 'only the post-boundary automatic session is delivered');
  assert.equal((await engine.list({ status: 'delivered' })).total, 1);
  const pending = await engine.list();
  assert.equal(pending.total, 1);
  assert.equal(pending.rows[0].sourceType, 'history');
  assert.equal(pending.rows[0].status, 'review', 'manual history produces a recommendation only');
  await engine.syncConversationRouting({ enabled: false, authorizedAt: '' }, [{ id: 'student-a', name: 'Student A' }]);
  assert.ok((await engine.sources()).sources.filter(source => source.managedRouting).every(source => !source.enabled));
});

test('UI has one delivery center and lifecycle capture is gated by student activity', () => {
  const root = path.resolve(__dirname, '..');
  const ui = fss.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');
  const main = fss.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
  assert.doesNotMatch(ui, /确认投递所选/);
  assert.doesNotMatch(ui, /投递选中会话/);
  assert.doesNotMatch(ui, /投递到所选位置/);
  assert.match(ui, /前往资料收件箱/);
  assert.match(main, /function studentConversationCaptureBlocked/);
  assert.match(main, /function globalConversationCaptureAuthorized/);
  assert.match(main, /全局 Agent 授权已停用，新的自动会话采集已停止/);
  assert.match(main, /finalizeActiveLifecycleSessionsForStudent\(student, 'student-inactive'\)/);
  assert.match(main, /reason: 'student_reactivated'/);
  assert.match(main, /routingDisposition: loc\.type === 'project' \? 'already_scoped'/);
});
