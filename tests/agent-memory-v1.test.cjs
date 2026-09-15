const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createAgentMemoryStore, MAX_CAPTURE_CHARS, MAX_CAPTURE_MESSAGES } = require('../electron/agent-memory-v1.cjs');

test('Empty authorized sessions can be removed without touching active, populated, or other-student sessions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-agent-memory-empty-'));
  try {
    const store = createAgentMemoryStore({ rootDir: root });
    const empty = store.startSession({ studentId: 'a', sessionId: 'empty-1', agentId: 'qclaw', origin: 'authorized_agent' }).session;
    store.finalizeSession({ studentId: 'a', sessionId: empty.sessionId, status: 'cancelled' });
    store.startSession({ studentId: 'a', sessionId: 'active', agentId: 'qclaw', origin: 'authorized_agent' });
    const kept = store.startSession({ studentId: 'a', sessionId: 'populated', agentId: 'codex', origin: 'authorized_agent' }).session;
    store.appendMessages({ studentId: 'a', sessionId: kept.sessionId, messages: [{ role: 'user', content: 'private', eventId: '1' }] });
    store.finalizeSession({ studentId: 'a', sessionId: kept.sessionId });
    const receipt = store.startSession({ studentId: 'a', sessionId: 'receipt', agentId: 'qclaw', origin: 'authorized_agent' }).session;
    store.finalizeSession({ studentId: 'a', sessionId: receipt.sessionId });
    store.attachConversationReceipt({ studentId: 'a', sessionId: receipt.sessionId, receipt: { status: 'stored', interactionId: 'receipt-only' } });
    const other = store.startSession({ studentId: 'b', sessionId: 'other', agentId: 'qclaw', origin: 'authorized_agent' }).session;
    store.finalizeSession({ studentId: 'b', sessionId: other.sessionId });
    assert.deepEqual(store.deleteEmptySessions({ studentId: 'a', sessionId: 'populated' }), { deleted: 0, remaining: 0 });
    assert.equal(store.deleteEmptySessions({ studentId: 'a' }).deleted, 1);
    assert.equal(store.readSession('a', 'empty-1').status, 'deleted');
    assert.equal(store.readSession('a', 'active').status, 'active');
    assert.equal(store.readSession('a', 'populated').messages.length, 1);
    assert.equal(store.readSession('a', 'receipt').conversationReceipt.interactionId, 'receipt-only');
    assert.equal(store.readSession('b', 'other').status, 'completed');
    assert.equal(store.startSession({ studentId: 'a', sessionId: 'empty-1', agentId: 'qclaw' }).session.status, 'deleted');
    assert.throws(() => store.appendMessages({ studentId: 'a', sessionId: 'empty-1', messages: [{ role: 'user', content: 'late' }] }), /Only active sessions/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Agent memory keeps sessions isolated by student and project', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-agent-memory-'));
  try {
    const store = createAgentMemoryStore({ rootDir: root });
    const a = store.startSession({ studentId: 'a', projectId: 'p1', agentId: 'workbuddy', objective: '整理资料' }).session;
    store.appendObservation({ studentId: 'a', projectId: 'p1', sessionId: a.sessionId, summary: '已读取索引' });
    store.finalizeSession({ studentId: 'a', projectId: 'p1', sessionId: a.sessionId, idempotencyKey: 'finish-a', summary: { completed: ['整理完成'], openLoops: ['生成报告'] }, handoff: { targetAgent: 'codex' } });
    const b = store.startSession({ studentId: 'b', projectId: 'p1', agentId: 'workbuddy', objective: '另一学生' }).session;
    store.finalizeSession({ studentId: 'b', projectId: 'p1', sessionId: b.sessionId, summary: { completed: ['私有结果'] } });
    const context = store.recentContext({ studentId: 'a', projectId: 'p1', agentId: 'codex' });
    assert.equal(context.sessions.length, 1);
    assert.equal(context.sessions[0].sessionId, a.sessionId);
    assert.doesNotMatch(JSON.stringify(context), /私有结果/);
    assert.equal(store.readSession('b', a.sessionId), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Session finalization and handoff acceptance are idempotent and target-bound', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-agent-memory-'));
  try {
    const store = createAgentMemoryStore({ rootDir: root, now: () => '2026-09-05T00:00:00.000Z' });
    const session = store.startSession({ studentId: 'a', agentId: 'workbuddy', idempotencyKey: 'task-1' }).session;
    const first = store.finalizeSession({ studentId: 'a', sessionId: session.sessionId, idempotencyKey: 'finish-1', summary: { openLoops: ['继续'] }, handoff: { targetAgent: 'codex' } });
    const second = store.finalizeSession({ studentId: 'a', sessionId: session.sessionId, idempotencyKey: 'finish-1', summary: { openLoops: ['重复'] } });
    assert.equal(second.reused, true);
    assert.deepEqual(second.session.summary.openLoops, ['继续']);
    assert.throws(() => store.finalizeSession({ studentId: 'a', sessionId: session.sessionId, idempotencyKey: 'different-finish', summary: {} }), /already finalized/i);
    assert.throws(() => store.acceptHandoff({ studentId: 'a', sessionId: session.sessionId, handoffId: first.session.handoff.handoffId, agentId: 'workbuddy' }), /target/i);
    const accepted = store.acceptHandoff({ studentId: 'a', sessionId: session.sessionId, handoffId: first.session.handoff.handoffId, agentId: 'codex' });
    assert.equal(accepted.session.handoff.status, 'accepted');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Authorized conversation turns are stored incrementally and deduplicated by event ID', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-agent-memory-'));
  try {
    const store = createAgentMemoryStore({ rootDir: root, now: () => '2026-09-05T00:00:00.000Z' });
    const started = store.startSession({ studentId: 'a', sessionId: 'codex-thread-1', agentId: 'codex', origin: 'authorized_agent', title: '数学讨论' });
    const session = started.session;
    assert.equal(store.startSession({ studentId: 'a', sessionId: 'codex-thread-1', agentId: 'codex', origin: 'authorized_agent' }).reused, true);
    assert.throws(() => store.startSession({ studentId: 'a', sessionId: 'codex-thread-1', agentId: 'qclaw', origin: 'authorized_agent' }), /identity mismatch/i);
    const batch = {
      studentId: 'a',
      sessionId: session.sessionId,
      messages: [
        { eventId: 'turn-1-user', role: 'user', content: '为什么勾股定理成立？', turnMarker: 'authorized-turn' },
        { eventId: 'turn-1-assistant', role: 'assistant', content: '可以用面积法证明。', turnMarker: 'authorized-turn' },
        { eventId: 'protected', role: 'system', content: 'secret prompt' },
      ],
    };
    const first = store.appendMessages(batch);
    const second = store.appendMessages(batch);
    assert.equal(first.accepted, 2);
    assert.equal(first.skippedProtected, 1);
    assert.equal(second.accepted, 0);
    assert.equal(second.session.messages.length, 2);
    assert.equal(store.readSession('a', session.sessionId).messages[0].turnMarker, 'authorized-turn');
    assert.doesNotMatch(JSON.stringify(second.session), /secret prompt/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Authorized conversation capture is bounded and can attach an archive receipt', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-agent-memory-'));
  try {
    const store = createAgentMemoryStore({ rootDir: root });
    const session = store.startSession({ studentId: 'a', agentId: 'qclaw', origin: 'authorized_agent' }).session;
    const appended = store.appendMessages({
      studentId: 'a',
      sessionId: session.sessionId,
      messages: Array.from({ length: MAX_CAPTURE_MESSAGES + 20 }, (_, index) => ({
        eventId: `message-${index}`,
        role: index % 2 ? 'assistant' : 'user',
        content: 'x'.repeat(Math.ceil(MAX_CAPTURE_CHARS / MAX_CAPTURE_MESSAGES)),
      })),
    });
    assert.equal(appended.session.messages.length, MAX_CAPTURE_MESSAGES);
    assert.ok(appended.session.capturedChars <= MAX_CAPTURE_CHARS);
    assert.equal(appended.truncated, true);
    store.attachConversationReceipt({ studentId: 'a', sessionId: session.sessionId, receipt: { status: 'stored', interactionId: 'i-1' } });
    assert.equal(store.readSession('a', session.sessionId).conversationReceipt.interactionId, 'i-1');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Expired handoffs are never injected into recent Agent context', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-agent-memory-'));
  let now = '2026-09-05T00:00:00.000Z';
  try {
    const store = createAgentMemoryStore({ rootDir: root, now: () => now });
    const session = store.startSession({ studentId: 'a', agentId: 'workbuddy' }).session;
    store.finalizeSession({
      studentId: 'a',
      sessionId: session.sessionId,
      summary: { openLoops: ['等待后续'] },
      handoff: { targetAgent: 'codex', ttlMs: 60_000 },
    });
    now = '2026-09-05T00:02:00.000Z';
    const context = store.recentContext({ studentId: 'a', agentId: 'codex' });
    assert.equal(context.sessions[0].handoff, null);
    assert.equal(store.readSession('a', session.sessionId).handoff.status, 'expired');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Archived conversation trash and permanent deletion also remove Agent memory context', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-agent-memory-'));
  try {
    const store = createAgentMemoryStore({ rootDir: root });
    const session = store.startSession({ studentId: 'student-a', sessionId: 'native-1', agentId: 'codex', origin: 'authorized_agent', title: 'Private title' }).session;
    store.appendMessages({ studentId: 'student-a', sessionId: session.sessionId, messages: [{ role: 'user', content: 'Private conversation', eventId: 'message-1' }] });
    store.finalizeSession({ studentId: 'student-a', sessionId: session.sessionId, summary: { objective: 'Private objective', openLoops: ['Private next step'] } });
    store.attachConversationReceipt({ studentId: 'student-a', sessionId: session.sessionId, receipt: { status: 'stored', assetId: 'asset-1' } });
    assert.equal(store.recentContext({ studentId: 'student-a', agentId: 'qclaw' }).sessions.length, 1);
    const trashed = store.updateArchivedAssetLifecycle({ studentId: 'student-a', assetId: 'asset-1', action: 'trash' });
    assert.equal(trashed.matched, 1);
    assert.deepEqual(trashed.sessionIds, [session.sessionId]);
    assert.equal(store.recentContext({ studentId: 'student-a', agentId: 'qclaw' }).sessions.length, 0);
    assert.equal(store.updateArchivedAssetLifecycle({ studentId: 'student-a', assetId: 'asset-1', action: 'restore' }).changed, 1);
    assert.equal(store.recentContext({ studentId: 'student-a', agentId: 'qclaw' }).sessions.length, 1);
    assert.equal(store.updateArchivedAssetLifecycle({ studentId: 'student-b', assetId: 'asset-1', action: 'delete' }).matched, 0);
    store.updateArchivedAssetLifecycle({ studentId: 'student-a', assetId: 'asset-1', action: 'delete' });
    const tombstone = store.readSession('student-a', session.sessionId);
    assert.equal(tombstone.status, 'deleted');
    assert.equal(store.listSessions({ studentId: 'student-a' }).length, 0);
    assert.equal(store.recentContext({ studentId: 'student-a', agentId: 'qclaw' }).sessions.length, 0);
    assert.doesNotMatch(JSON.stringify(tombstone), /Private/);
    assert.equal(store.startSession({ studentId: 'student-a', sessionId: session.sessionId, agentId: 'codex' }).session.status, 'deleted');
    assert.throws(() => store.appendMessages({ studentId: 'student-a', sessionId: session.sessionId, messages: [{ role: 'user', content: 'resurrect' }] }), /Only active sessions/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
