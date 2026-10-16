'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), { EventEmitter } = require('node:events');
const { createDesktopHost } = require('../scripts/verify-workbuddy-desktop-live.cjs');
for (const mode of ['success', 'async-error', 'sync-error', 'packet-error', 'link-error']) test(`production desktop handoff durable state: ${mode}`, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wb-desktop-test-'));
  const host = await createDesktopHost(root, () => {
    if (mode === 'sync-error') throw Error('synthetic launch failure');
    const child = new EventEmitter(); child.unref = () => {};
    queueMicrotask(() => mode === 'async-error' ? child.emit('error', Error('synthetic ENOENT')) : child.emit('spawn'));
    return child;
  });
  t.after(async () => { await host.close(); await fs.rm(root, { recursive: true, force: true }); });
  // File-existence discovery is a fixture; dispatch, protocol and Worker writes are real.
  host.context.discoverWorkBuddyRuntime = () => ({ exePath: process.execPath });
  if (mode === 'packet-error') host.context.writeTaskPacket = () => { throw Error('synthetic disk failure'); };
  if (mode === 'link-error') host.context.buildWorkBuddyTaskDeepLink = () => '';
  const task = { id: 'synthetic', title: 'synthetic', protocolVersion: host.context.TASK_PROTOCOL_VERSION, kind: 'agent_acceptance', status: 'approved', attempt: 0, input: { knowledgeRoot: root } };
  const store = host.context.readTaskStore(); store.tasks.push(task); await host.context.writeTaskStoreDurably(store);
  const result = await host.context.submitWorkBuddyTask(task, 'synthetic');
  const saved = host.disk().tasks[0];
  assert.equal(result.ok, mode === 'success'); assert.equal(saved.status, mode === 'success' ? 'waiting_result' : 'failed');
  assert.equal(saved.result.requiresUserAction, true); assert.equal(saved.result.handoffState, mode === 'success' ? 'awaiting_user_send' : 'launch_failed');
  if (mode !== 'success') assert.equal(saved.error.code, 'WORKBUDDY_DESKTOP_LAUNCH_FAILED');
});
