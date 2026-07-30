const assert = require('node:assert/strict');
const test = require('node:test');
const {
  EXECUTION_MODES,
  applyCollaborationTaskEvent,
  mergeCollaborationTask,
  normalizeCollaborationTask,
  normalizeCollaborationTaskEvent,
} = require('../electron/collaboration-task.cjs');

test('D4-A collaboration tasks carry a versioned remote-local execution policy', () => {
  const remote = normalizeCollaborationTask({
    sourceNodeId: 'node-teacher',
    targetNodeId: 'node-student',
    studentId: 'student-1',
    title: '本机知识分析',
    executionPolicy: {
      mode: 'remote_local',
      requestedExecutor: 'auto',
      archiveScopeType: 'student',
      autoStartAfterAccept: true,
    },
  });
  assert.equal(EXECUTION_MODES.has('remote_local'), true);
  assert.deepEqual(remote.executionPolicy, {
    mode: 'remote_local',
    requestedExecutor: 'auto',
    archiveScopeType: 'student',
    autoStartAfterAccept: true,
    returnStructuredResult: true,
  });
  assert.equal(normalizeCollaborationTask({
    sourceNodeId: 'node-teacher',
    targetNodeId: 'node-student',
    studentId: 'student-1',
  }).executionPolicy.mode, 'manual');
  assert.throws(() => normalizeCollaborationTask({
    sourceNodeId: 'node-teacher',
    targetNodeId: 'node-student',
    studentId: 'student-1',
    executionPolicy: { mode: 'remote_shell' },
  }), /不支持的协作任务执行方式/);
});

function task() {
  return normalizeCollaborationTask({
    taskId: 'task-a',
    sourceNodeId: 'node-teacher',
    targetNodeId: 'node-student',
    studentId: 'student-1',
    title: '完成实验反思',
    instructions: '提交一页反思。',
    createdAt: '2026-07-24T10:00:00.000Z',
  });
}

function event(type, actorNodeId, payload = {}, occurredAt = '2026-07-24T11:00:00.000Z') {
  return normalizeCollaborationTaskEvent({ taskId: 'task-a', type, actorNodeId, occurredAt, payload });
}

test('collaboration task preserves source and target host student mappings', () => {
  const mapped = normalizeCollaborationTask({
    sourceNodeId: 'teacher-node',
    targetNodeId: 'student-node',
    studentId: 'student-host-local-id',
    sourceStudentId: 'teacher-host-local-id',
    targetStudentId: 'student-host-local-id',
    title: 'Cross-host mapped task',
  });
  assert.equal(mapped.studentId, 'student-host-local-id');
  assert.equal(mapped.sourceStudentId, 'teacher-host-local-id');
  assert.equal(mapped.targetStudentId, 'student-host-local-id');
});

test('teacher offer, student decision, submission and teacher feedback remain one task', () => {
  let current = task();
  current = applyCollaborationTaskEvent(current, event('accept', 'node-student')).task;
  assert.equal(current.state, 'accepted');
  current = applyCollaborationTaskEvent(current, event('submit', 'node-student', { resultId: 'result-1', message: '已完成' }, '2026-07-24T12:00:00.000Z')).task;
  assert.equal(current.state, 'submitted');
  current = applyCollaborationTaskEvent(current, event('feedback', 'node-teacher', { feedbackId: 'feedback-1', message: '请补充证据' }, '2026-07-24T13:00:00.000Z')).task;
  assert.equal(current.state, 'feedback');
  current = applyCollaborationTaskEvent(current, event('submit', 'node-student', { resultId: 'result-2' }, '2026-07-24T14:00:00.000Z')).task;
  current = applyCollaborationTaskEvent(current, event('close', 'node-teacher', {}, '2026-07-24T15:00:00.000Z')).task;
  assert.equal(current.state, 'closed');
  assert.equal(current.taskId, 'task-a');
});

test('duplicate delivery is idempotent and wrong actors are rejected', () => {
  const accepted = event('accept', 'node-student');
  const first = applyCollaborationTaskEvent(task(), accepted);
  assert.equal(applyCollaborationTaskEvent(first.task, accepted).duplicate, true);
  assert.throws(() => applyCollaborationTaskEvent(task(), event('accept', 'node-teacher')), /无权/);
  assert.throws(() => applyCollaborationTaskEvent(task(), event('feedback', 'node-teacher')), /不允许/);
});

test('offline event histories merge deterministically without duplicate events', () => {
  const base = task();
  const accepted = applyCollaborationTaskEvent(base, event('accept', 'node-student')).task;
  const submitted = applyCollaborationTaskEvent(accepted, event('submit', 'node-student', { resultId: 'result-1' }, '2026-07-24T12:00:00.000Z')).task;
  const merged = mergeCollaborationTask(accepted, submitted);
  assert.equal(merged.state, 'submitted');
  assert.equal(new Set(merged.events.map((item) => item.eventId)).size, merged.events.length);
});

test('student help request uses the same state machine with teacher as responder', () => {
  let current = normalizeCollaborationTask({
    taskId: 'help-a',
    requestKind: 'help_request',
    sourceNodeId: 'node-student',
    targetNodeId: 'node-teacher',
    studentId: 'student-1',
    title: '请协助检查研究提纲',
  });
  assert.equal(current.requestKind, 'help_request');
  current = applyCollaborationTaskEvent(current, normalizeCollaborationTaskEvent({
    taskId: current.taskId,
    type: 'accept',
    actorNodeId: 'node-teacher',
    payload: { idempotencyKey: 'accept-help-a' },
  })).task;
  current = applyCollaborationTaskEvent(current, normalizeCollaborationTaskEvent({
    taskId: current.taskId,
    type: 'submit',
    actorNodeId: 'node-teacher',
    payload: {
      idempotencyKey: 'reply-help-a',
      resultId: 'reply-1',
      message: '已给出修改建议。',
      knowledgeContribution: {
        contributionId: 'contribution-1',
        studentId: 'student-1',
        title: '研究提纲建议',
        content: '先补充来源证据。',
        status: 'verified',
      },
    },
  })).task;
  const submitted = current.events.find((item) => item.type === 'submit');
  assert.equal(submitted.payload.knowledgeContribution.status, 'draft');
  assert.equal(submitted.payload.knowledgeContribution.studentId, 'student-1');
  current = applyCollaborationTaskEvent(current, normalizeCollaborationTaskEvent({
    taskId: current.taskId,
    type: 'close',
    actorNodeId: 'node-student',
    payload: { idempotencyKey: 'close-help-a' },
  })).task;
  assert.equal(current.state, 'closed');
});

test('unknown collaboration request kinds are rejected', () => {
  assert.throws(() => normalizeCollaborationTask({
    sourceNodeId: 'node-a',
    targetNodeId: 'node-b',
    studentId: 'student-1',
    requestKind: 'remote_control',
  }), /请求类型/);
});
