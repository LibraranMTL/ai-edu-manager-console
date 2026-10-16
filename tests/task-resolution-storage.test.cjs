'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createTaskStoreGuard } = require('../electron/task-store-guard.cjs');
const { taskResolution, resultIdentityFeedback } = require('../electron/task-resolution.cjs');
const { candidateRuntimeDecision, repairTaskRuntimeStore } = require('../electron/task-runtime-policy.cjs');
const { taskRecordDeletable } = require('../electron/task-history-policy.cjs');
const { workBuddyReadyResult, createWorkBuddyProbeCache, probeWorkBuddyAuthorization } = require('../electron/workbuddy-runtime.cjs');
const { EventEmitter } = require('node:events');
const { validateTaskTransition } = require('../electron/task-protocol.cjs');
const source = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
function load(name, context) {
  let start = source.indexOf(`function ${name}(`);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  assert(start >= 0);
  vm.createContext(context);
  vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
  return context[name];
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-store-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, 'tasks.json');
}
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value));

test('corrupt existing ledger is never replaced with empty state', t => {
  const file = fixture(t), guard = createTaskStoreGuard();
  fs.writeFileSync(file, '{broken');
  assert.throws(() => guard.read(file));
  assert.throws(() => guard.assertHealthy(), /暂停派发/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
});
test('store detects stale snapshots and persists neither lost updates nor false success', t => {
  const file = fixture(t), guard = createTaskStoreGuard();
  write(file, { tasks: [], history: [] });
  const a = guard.read(file), b = guard.read(file);
  guard.track(a.value, a.revision); guard.track(b.value, b.revision);
  guard.write(file, a.value, { tasks: [{ id: 't', title: 'new' }], history: [] }, write);
  assert.throws(() => guard.write(file, b.value, { tasks: [] }, write), /旧快照/);
  assert.equal(JSON.parse(fs.readFileSync(file)).tasks[0].id, 't');
  assert.equal(guard.status(), null, 'a stale caller is not a disk fault');
});
test('disk failure latches dispatch protection; disappearance never initializes a blank ledger', t => {
  const file = fixture(t), guard = createTaskStoreGuard();
  const stored = guard.read(file); guard.track(stored.value, stored.revision);
  assert.throws(() => guard.write(file, stored.value, { tasks: [] }, () => { throw new Error('disk full'); }), /disk full/);
  assert.throws(() => guard.assertHealthy(), /暂停派发/);
  const fresh = createTaskStoreGuard(); write(file, { tasks: [] }); fresh.read(file); fs.unlinkSync(file);
  assert.throws(() => fresh.read(file), /消失/);
});

test('failed validation returns failure, not a successful transition or the Agent success claim', async () => {
  const task = { id: 't', executionId: 'e', startedAt: 'now', sourceId: 's' };
  const context = { readTaskStore: () => ({ tasks: [task] }), validateExternalTaskResultIdentity: () => ({ ok: true }),
    validateTaskCompletion: () => ({ valid: false, message: '观察项不能写成正式定论：evidence-1' }),
    normalizeTaskResult: (_task, result) => result,
    commitValidatedTaskResult: (_store, _task, _result, _validation, options) => {
      assert.match(options.error.message, /观察项/); return { ok: true, task: { status: 'failed' } };
    }, writeTaskStoreDurably: async () => {}, isDigestTask: () => false };
  const result = await load('acceptImportedTaskResult', context)('t', { status: 'completed', message: '全部完成' });
  assert.equal(result.ok, false); assert.equal(result.accepted, true); assert.equal(result.validationPassed, false);
  assert.match(result.message, /观察项/); assert.doesNotMatch(result.message, /全部完成/);
});
test('old execution imports do not write task state or leak foreign payload details', async () => {
  const task = { id: 't', executionId: 'new' };
  const context = { readTaskStore: () => ({ tasks: [task] }),
    validateExternalTaskResultIdentity: () => ({ ok: false, code: 'EXECUTION_ID_MISMATCH', message: '执行批次不一致' }),
    appendTaskEvent: () => {}, resultIdentityFeedback,
    writeTaskStore: () => assert.fail('must not write') };
  const result = await load('acceptImportedTaskResult', context)('t', { executionId: 'old', studentId: 'foreign' });
  assert.equal(result.ok, false); assert.match(result.message, /粘贴内容已保留/);
  assert.doesNotMatch(JSON.stringify(result), /foreign/);
});
test('cancelled but unconfirmed executions cannot be deleted or erased by recovery/candidate refresh', () => {
  const task = { id: 't', status: 'cancelled', executionId: 'old', recoveryState: 'unknown', idempotencyKey: 'a' };
  assert.equal(taskRecordDeletable(task), false);
  assert.equal(candidateRuntimeDecision(task, { status: 'pending', idempotencyKey: 'b' }).preserveRuntime, true);
  const store = { tasks: [task] }; repairTaskRuntimeStore(store);
  assert.equal(task.executionId, 'old'); assert.equal(taskResolution(task).kind, 'unknown');
});
test('failure guidance distinguishes outdated internal handler, evidence and credentials', () => {
  for (const [message, kind] of [['未知内部操作：topic_suggestion_refresh', 'topic_handler'], ['观察项不能写成正式定论：a', 'evidence_quality'], ['authentication required', 'authorization']]) {
    assert.equal(taskResolution({ status: 'failed', error: { message } }).kind, kind);
  }
});
test('manual stop confirmation is execution-bound and cannot override a tracked process', () => {
  const task = { id: 't', executionId: 'e', status: 'cancelled', recoveryState: 'unknown' };
  const children = new Map([['t', {}]]), events = [];
  const fn = load('confirmTaskExternalStopped', { readTaskStore: () => ({ tasks: [task] }), taskChildProcesses: children,
    appendTaskEvent: (...args) => events.push(args), writeTaskStore: () => {} });
  assert.equal(JSON.parse(fn('t', 'other')).ok, false);
  assert.equal(JSON.parse(fn('t', 'e')).ok, false);
  children.clear(); assert.equal(JSON.parse(fn('t', 'e')).ok, true);
  assert.equal(task.recoveryState, 'user_confirmed_stopped'); assert.equal(events.length, 1);
});

test('topic refresh dispatches the scoped local service and completes without model calls or formal evidence', async () => {
  const task = { id: 'topic', kind: 'topic_suggestion_refresh', sourceType: 'student', sourceId: 's', attempt: 0,
    status: 'approved', input: { studentId: 's', operation: 'topic_suggestion_refresh' } };
  let serviceCalls = 0;
  const store = { tasks: [task] };
  const fn = load('submitInternalTask', { readTaskStore: () => store, writeTaskStoreDurably: async () => {}, assertTaskDispatchCurrent() {},
    crypto: { randomBytes: () => ({ toString: () => 'nonce' }) }, taskNow: () => 'now',
    transitionTaskInStore: (_store, _id, status, patch) => { assert.equal(validateTaskTransition(task.status, status).ok, true, `${task.status} -> ${status}`); Object.assign(task, patch, { status }); return { ok: true, task }; },
    planningGuidanceService: () => ({ refreshTopicSuggestions: id => { assert.equal(id, 's'); serviceCalls++; return { ok: true, message: '本地建议已更新' }; } }),
    normalizeTaskResult: (_task, result, validation) => ({ ...result, validation }), notify: () => {}, fs,
  });
  assert.equal((await fn(task)).ok, true); assert.equal(task.status, 'succeeded'); assert.equal(serviceCalls, 1);
  assert.match(task.result.structuredOutput.message, /本地建议/);
});
test('topic refresh refuses a mismatched student instead of dispatching a scoped write', async () => {
  const task = { id: 'topic', kind: 'topic_suggestion_refresh', sourceType: 'student', sourceId: 's', attempt: 0,
    input: { studentId: 'other', operation: 'topic_suggestion_refresh' } };
  const store = { tasks: [task] };
  const fn = load('submitInternalTask', { readTaskStore: () => store, writeTaskStoreDurably: async () => {}, assertTaskDispatchCurrent() {},
    crypto: { randomBytes: () => ({ toString: () => 'nonce' }) }, taskNow: () => 'now',
    transitionTaskInStore: (_store, _id, status, patch) => { Object.assign(task, patch, { status }); return { ok: true, task }; },
    planningGuidanceService: () => assert.fail('must not call service'),
    normalizeTaskResult: (_task, result) => result, notify: () => {}, fs,
  });
  await fn(task); assert.equal(task.status, 'failed');
});

test('READY requires final structured answer; zero exit, logs and errors are not authorization', () => {
  assert.equal(workBuddyReadyResult('{"result":"READY"}'), true);
  for (const value of ['READY', 'starting READY', '{"message":"READY"}', '{"result":"READY","is_error":true}', '{"type":"tool_use","result":"READY"}', '{"result":"authentication required"}']) assert.equal(workBuddyReadyResult(value), false, value);
  assert.equal(workBuddyReadyResult('{"result":"READY"}', 'authentication required'), false);
  assert.equal(workBuddyReadyResult('{"result":"READY"}', '', null), false);
});
test('probe cache coalesces concurrent requests, expires success and failure separately', async () => {
  let calls = 0, time = 0, authorized = true;
  const cache = createWorkBuddyProbeCache({ now: () => time, probe: async () => { calls++; return { authorized }; } });
  const runtime = { cliPath: 'cli', configDir: 'profile' };
  await Promise.all([cache.detect(runtime), cache.detect(runtime)]); assert.equal(calls, 1);
  time = 29 * 60000; await cache.detect(runtime); assert.equal(calls, 1);
  time = 31 * 60000; authorized = false; await cache.detect(runtime); assert.equal(calls, 2);
  time += 4 * 60000; await cache.detect(runtime); assert.equal(calls, 2);
  time += 2 * 60000; await cache.detect(runtime); assert.equal(calls, 3);
  cache.invalidate(runtime); await cache.detect(runtime); assert.equal(calls, 4);
});
test('authorization probe never uses supplied student working directory and disables tools/MCP', async () => {
  let cwd;
  const result = await probeWorkBuddyAuthorization({ available: true, cliPath: '/synthetic/cli', nodePath: process.execPath, mode: 'node' }, {
    cwd: '/student/private', spawnProcess: (_exe, args, options) => {
      cwd = options.cwd;
      assert.notEqual(cwd, '/student/private'); assert.deepEqual(fs.readdirSync(cwd), []);
      assert.equal(args[args.indexOf('--tools') + 1], '');
      assert(args.includes('--strict-mcp-config')); assert(args.includes('dontAsk'));
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.stdin = { end: () => { process.nextTick(() => { child.stdout.emit('data', '{"result":"READY"}'); child.emit('close', 0); }); } };
      return child;
    },
  });
  assert.equal(result.authorized, true); assert.equal(fs.existsSync(cwd), false);
});
