const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const pnpm = path.join(root, 'node_modules/.pnpm');
const esbuild = require(path.join(pnpm, fs.readdirSync(pnpm).find(name => name.startsWith('esbuild@')), 'node_modules/esbuild'));
const moduleContext = { exports: {} };
vm.runInNewContext(esbuild.transformSync(fs.readFileSync(path.join(root, 'src/agent-session-batch.ts'), 'utf8'), { loader: 'ts', format: 'cjs' }).code, { module: moduleContext });
const { runCapturedSessionBatch, matchesCapturedSessionTab } = moduleContext.exports;
const session = (id, overrides = {}) => ({ sessionId: String(id), status: 'completed', materialAvailable: true, materialLifecycleStatus: 'active', conversationReceipt: { assetId: `asset-${id}`, studentId: 'student-a' }, materialDependencies: { canPermanentlyDelete: true }, ...overrides });
const defaults = { studentId: 'student-a', action: 'deliver', target: 'student', isCurrent: () => true };

test('pending/delivered/all/trash classify actual receipts and preserve classification after restore', () => {
  const pending = session(1), delivered = session(2, { materialDependencies: { canPermanentlyDelete: false, deliveryCount: 1 } });
  const visibleTabs = item => ['pending', 'delivered', 'all', 'trash'].filter(tab => matchesCapturedSessionTab(item, tab));
  assert.deepEqual(visibleTabs(pending), ['pending', 'all']);
  assert.deepEqual(visibleTabs(delivered), ['delivered', 'all']);
  assert.deepEqual(visibleTabs({ ...delivered, materialLifecycleStatus: 'trashed' }), ['trash']);
  assert.deepEqual(visibleTabs({ ...delivered, materialLifecycleStatus: 'active' }), ['delivered', 'all']);
  assert.deepEqual(visibleTabs({ ...pending, materialLifecycleStatus: 'active' }), ['pending', 'all']);
});

test('actual host state exposes records beyond the old eight-item cutoff with dependency protection', () => {
  const source = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8');
  const start = source.indexOf('function agentMemoryState(studentId)');
  const body = source.slice(start, source.indexOf('\n}', start) + 2);
  const sessions = Array.from({ length: 25 }, (_, i) => session(i, { origin: 'authorized_agent' }));
  const imports = sessions.map(item => ({ assetId: item.conversationReceipt.assetId }));
  const scope = {
    findStudentByKey: id => id === 'student-a' ? { id } : null,
    agentMemoryStore: () => ({ listSessions: () => sessions, getSettings: () => ({}) }),
    activeAgentKnowledgeDescriptorPath: () => '', safeReadJson: () => ({}), studentCaptureStatus: () => ({}),
    conversationIndexPath: () => '', readJsonFile: () => ({ imports }),
    readConversationDeliveries: () => ({ deliveries: [
      { assetId: 'asset-24', sourceScopeType: 'student', sourceScopeId: 'student-a', targetType: 'project', targetId: 'p1', targetName: '测试项目', deliveredAt: '2026-10-08T01:00:00Z' },
      { assetId: 'asset-24', sourceScopeType: 'student', sourceScopeId: 'student-a', targetType: 'student', targetId: 'student-a', targetName: '测试学生', deliveredAt: '2026-10-08T02:00:00Z' },
      { assetId: 'asset-24', sourceScopeType: 'student', sourceScopeId: 'student-b', targetType: 'project', targetId: 'foreign', targetName: '其他学生项目', deliveredAt: '2026-10-08T03:00:00Z' },
    ] }),
    readConversationCandidateRegistry: () => ({ candidates: [] }), agentKnowledgeDescriptorPath: () => '',
    publicCodexHookOnboarding: () => ({}), codexHookOnboardingPath: () => '', currentCodexHookIdentity: () => '', findPreferredCodexCliInstall: () => ({}),
  };
  const read = vm.runInNewContext(`(${body})`, scope);
  const result = JSON.parse(read('student-a'));
  assert.equal(result.ok, true, result.message);
  assert.equal(result.sessions.length, 25);
  assert.equal(result.sessions[24].materialDependencies.canPermanentlyDelete, false);
  assert.equal(result.sessions[24].materialDependencies.deliveryCount, 2);
  assert.equal(result.sessions[24].materialDeliveries[0].targetType, 'student');
  assert.equal(result.sessions[24].materialDeliveries[1].targetName, '测试项目');
  assert.equal(result.sessions[24].materialDeliveries.length, 2);
  assert.equal(matchesCapturedSessionTab(result.sessions[24], 'delivered'), true);
  assert.equal(JSON.parse(read('student-b')).ok, false);
});

test('selection over multiple pages is delivered in bounded batches with the fixed student and project', async () => {
  const requests = [];
  const result = await runCapturedSessionBatch({ ...defaults, target: 'project:p1', sessions: Array.from({ length: 65 }, (_, i) => session(i)),
    invoke: async raw => { const request = JSON.parse(raw); requests.push(request); return JSON.stringify({ ok: true, results: request.sources }); } });
  assert.deepEqual(requests.map(request => request.sources.length), [20, 20, 20, 5]);
  assert.equal(result.succeeded.length, 65);
  assert.equal(result.remaining, 0);
  assert.ok(requests.every(request => request.targetType === 'project' && request.targetId === 'p1' && request.sources.every(source => source.sourceScopeId === 'student-a')));
});

test('active, unavailable, foreign-student and trashed sessions cannot be delivered', async () => {
  const result = await runCapturedSessionBatch({ ...defaults, sessions: [session(1), session(2, { status: 'active' }), session(3, { materialAvailable: false }), session(4, { materialLifecycleStatus: 'trashed' }), session(5, { conversationReceipt: { assetId: 'foreign', studentId: 'student-b' } })],
    invoke: async raw => { const request = JSON.parse(raw); assert.equal(request.sources.length, 1); return JSON.stringify({ results: request.sources }); } });
  assert.equal(result.succeeded.join(), '1');
  assert.equal(result.skipped, 4);
});

test('permanent deletion only submits eligible recycled items and retains failures', async () => {
  const result = await runCapturedSessionBatch({ ...defaults, action: 'delete', sessions: [session(1, { materialLifecycleStatus: 'trashed' }), session(2, { materialLifecycleStatus: 'trashed' }), session(3, { materialLifecycleStatus: 'trashed', materialDependencies: { canPermanentlyDelete: false } }), session(4)],
    invoke: async raw => { const request = JSON.parse(raw); assert.equal(request.confirmPermanentDelete, true); assert.equal(request.sources.length, 2); return JSON.stringify({ partial: true, results: [{ assetId: 'asset-1', ok: true }, { assetId: 'asset-2', ok: false, message: '新增投递依赖' }] }); } });
  assert.equal(result.succeeded.join(), '1');
  assert.equal(result.skipped, 2);
  assert.equal(result.remaining, 1);
  assert.equal(result.errors.join(), '新增投递依赖');
});

test('switching students stops subsequent batches; in-flight work keeps its original owner', async () => {
  let current = true, calls = 0;
  const result = await runCapturedSessionBatch({ ...defaults, sessions: Array.from({ length: 40 }, (_, i) => session(i)), isCurrent: () => current,
    invoke: async raw => { calls++; current = false; return JSON.stringify({ results: JSON.parse(raw).sources }); } });
  assert.equal(calls, 1); assert.equal(result.succeeded.length, 20); assert.equal(result.remaining, 20); assert.equal(result.stopped, true);
});

test('invalid response or disconnected bridge cannot report success or silently repeat writes', async () => {
  for (const response of [undefined, 'invalid json', JSON.stringify({ ok: true })]) {
    let calls = 0;
    const result = await runCapturedSessionBatch({ ...defaults, sessions: [session(1)], invoke: async () => { calls++; return response; } });
    assert.equal(calls, 1); assert.equal(result.succeeded.length, 0); assert.equal(result.remaining, 1); assert.ok(result.errors.length);
  }
});

test('trash and restore preserve per-item host failures even on overall partial success', async () => {
  for (const action of ['trash', 'restore']) {
    const result = await runCapturedSessionBatch({ ...defaults, action, sessions: [session(1, { materialLifecycleStatus: action === 'restore' ? 'trashed' : 'active' }), session(2, { materialLifecycleStatus: action === 'restore' ? 'trashed' : 'active' })],
      invoke: async raw => { assert.equal(JSON.parse(raw).action, action); return JSON.stringify({ partial: true, results: [{ assetId: 'asset-1', ok: true }, { assetId: 'asset-2', ok: false }] }); } });
    assert.equal(result.succeeded.join(), '1'); assert.equal(result.remaining, 1);
  }
});
