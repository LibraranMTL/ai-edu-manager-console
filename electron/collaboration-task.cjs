const crypto = require('node:crypto');

const COLLABORATION_TASK_SCHEMA = 'edu-manager.collaboration-task.v1';
const COLLABORATION_TASK_EVENT_SCHEMA = 'edu-manager.collaboration-task-event.v1';
const TASK_STATES = new Set(['offered', 'accepted', 'deferred', 'declined', 'submitted', 'feedback', 'closed']);
const EVENT_TYPES = new Set(['offer', 'accept', 'defer', 'decline', 'submit', 'feedback', 'close']);
const REQUEST_KINDS = new Set(['assignment', 'help_request']);
const EXECUTION_MODES = new Set(['manual', 'remote_local']);

function text(value, limit = 4000) {
  return String(value || '').trim().slice(0, limit);
}

function stringList(value, limit = 100) {
  return Array.from(new Set((Array.isArray(value) ? value : []).map((item) => text(item, 240)).filter(Boolean))).slice(0, limit);
}

function eventId(taskId, type, actorNodeId, payload = {}) {
  const seed = JSON.stringify([taskId, type, actorNodeId, payload.idempotencyKey || '', payload.resultId || '', payload.feedbackId || '']);
  return `collab-event-${crypto.createHash('sha256').update(seed).digest('hex').slice(0, 24)}`;
}

function normalizeCollaborationTask(input = {}) {
  const sourceNodeId = text(input.sourceNodeId, 160);
  const targetNodeId = text(input.targetNodeId, 160);
  const studentId = text(input.studentId, 160);
  const sourceStudentId = text(input.sourceStudentId, 160) || studentId;
  const targetStudentId = text(input.targetStudentId, 160) || studentId;
  if (!sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId) throw new Error('协作任务必须指定不同的发送和接收节点。');
  if (!studentId) throw new Error('协作任务必须关联学生。');
  const taskId = text(input.taskId, 200) || `collab-task-${crypto.randomUUID()}`;
  const createdAt = text(input.createdAt, 80) || new Date().toISOString();
  const state = text(input.state, 40) || 'offered';
  if (!TASK_STATES.has(state)) throw new Error(`不支持的协作任务状态：${state}`);
  const requestKind = text(input.requestKind, 40) || 'assignment';
  if (!REQUEST_KINDS.has(requestKind)) throw new Error(`不支持的协作请求类型：${requestKind}`);
  const executionInput = input.executionPolicy && typeof input.executionPolicy === 'object' ? input.executionPolicy : {};
  const executionMode = text(executionInput.mode || input.executionMode, 40) || 'manual';
  if (!EXECUTION_MODES.has(executionMode)) throw new Error(`不支持的协作任务执行方式：${executionMode}`);
  const task = {
    schema: COLLABORATION_TASK_SCHEMA,
    protocolVersion: '1.0',
    taskId,
    requestKind,
    sourceNodeId,
    targetNodeId,
    studentId,
    sourceStudentId,
    targetStudentId,
    projectId: text(input.projectId, 160),
    title: text(input.title, 200) || '协作任务',
    instructions: text(input.instructions, 12000),
    deadlineAt: text(input.deadlineAt, 80),
    submissionRequirements: text(input.submissionRequirements, 4000),
    attachmentObjectIds: stringList(input.attachmentObjectIds, 100),
    executionPolicy: {
      mode: executionMode,
      requestedExecutor: text(executionInput.requestedExecutor, 40) || (executionMode === 'remote_local' ? 'auto' : 'manual'),
      archiveScopeType: text(executionInput.archiveScopeType, 40) || (input.projectId ? 'project' : 'student'),
      autoStartAfterAccept: executionMode === 'remote_local' && executionInput.autoStartAfterAccept !== false,
      returnStructuredResult: executionMode === 'remote_local' && executionInput.returnStructuredResult !== false,
    },
    state,
    createdAt,
    updatedAt: text(input.updatedAt, 80) || createdAt,
    events: Array.isArray(input.events) ? input.events.map(normalizeCollaborationTaskEvent) : [],
  };
  if (!task.events.length) {
    task.events.push(normalizeCollaborationTaskEvent({
      taskId,
      type: 'offer',
      actorNodeId: sourceNodeId,
      targetNodeId,
      occurredAt: createdAt,
      payload: { idempotencyKey: text(input.idempotencyKey, 240) || `offer:${taskId}` },
    }));
  }
  return task;
}

function normalizeCollaborationTaskEvent(input = {}) {
  const taskId = text(input.taskId, 200);
  const type = text(input.type, 40);
  const actorNodeId = text(input.actorNodeId, 160);
  if (!taskId || !EVENT_TYPES.has(type) || !actorNodeId) throw new Error('协作任务事件缺少任务、类型或操作节点。');
  const payload = input.payload && typeof input.payload === 'object' ? input.payload : {};
  const contribution = payload.knowledgeContribution && typeof payload.knowledgeContribution === 'object'
    ? {
      schema: 'edu-manager.knowledge-contribution.v1',
      contributionId: text(payload.knowledgeContribution.contributionId, 200),
      sourceTaskId: text(payload.knowledgeContribution.sourceTaskId, 200) || taskId,
      studentId: text(payload.knowledgeContribution.studentId, 160),
      projectId: text(payload.knowledgeContribution.projectId, 160),
      title: text(payload.knowledgeContribution.title, 200),
      content: text(payload.knowledgeContribution.content, 8000),
      status: 'draft',
      createdByNodeId: text(payload.knowledgeContribution.createdByNodeId, 160) || actorNodeId,
      createdAt: text(payload.knowledgeContribution.createdAt, 80) || new Date().toISOString(),
    }
    : null;
  return {
    schema: COLLABORATION_TASK_EVENT_SCHEMA,
    protocolVersion: '1.0',
    eventId: text(input.eventId, 200) || eventId(taskId, type, actorNodeId, payload),
    taskId,
    type,
    actorNodeId,
    targetNodeId: text(input.targetNodeId, 160),
    occurredAt: text(input.occurredAt, 80) || new Date().toISOString(),
    payload: {
      idempotencyKey: text(payload.idempotencyKey, 240),
      message: text(payload.message, 8000),
      reason: text(payload.reason, 2000),
      resultId: text(payload.resultId, 200),
      feedbackId: text(payload.feedbackId, 200),
      artifactObjectIds: stringList(payload.artifactObjectIds, 200),
      nextDeadlineAt: text(payload.nextDeadlineAt, 80),
      knowledgeContribution: contribution,
    },
  };
}

function expectedActor(task, type) {
  return ['accept', 'defer', 'decline', 'submit'].includes(type) ? task.targetNodeId : task.sourceNodeId;
}

function nextState(current, type) {
  const transitions = {
    offered: { accept: 'accepted', defer: 'deferred', decline: 'declined' },
    deferred: { accept: 'accepted', decline: 'declined' },
    accepted: { submit: 'submitted', decline: 'declined' },
    submitted: { feedback: 'feedback', close: 'closed' },
    feedback: { submit: 'submitted', close: 'closed' },
  };
  return transitions[current]?.[type] || '';
}

function applyCollaborationTaskEvent(taskInput, eventInput) {
  const task = normalizeCollaborationTask(taskInput);
  const event = normalizeCollaborationTaskEvent(eventInput);
  if (event.taskId !== task.taskId) throw new Error('协作任务事件 taskId 不匹配。');
  if (task.events.some((item) => item.eventId === event.eventId)) return { task, duplicate: true };
  if (event.actorNodeId !== expectedActor(task, event.type)) throw new Error('当前节点无权执行该协作任务动作。');
  const state = nextState(task.state, event.type);
  if (!state) throw new Error(`协作任务不允许从 ${task.state} 执行 ${event.type}。`);
  return {
    duplicate: false,
    task: normalizeCollaborationTask({
      ...task,
      state,
      updatedAt: event.occurredAt,
      deadlineAt: event.payload.nextDeadlineAt || task.deadlineAt,
      events: [...task.events, event],
    }),
  };
}

function mergeCollaborationTask(localInput, incomingInput) {
  const local = normalizeCollaborationTask(localInput);
  const incoming = normalizeCollaborationTask(incomingInput);
  if (local.taskId !== incoming.taskId || local.sourceNodeId !== incoming.sourceNodeId || local.targetNodeId !== incoming.targetNodeId) {
    throw new Error('不能合并身份不同的协作任务。');
  }
  let merged = normalizeCollaborationTask({ ...local, events: [] });
  merged.events = [];
  const events = [...local.events, ...incoming.events]
    .filter((item, index, list) => list.findIndex((candidate) => candidate.eventId === item.eventId) === index)
    .sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt)));
  for (const event of events) {
    if (event.type === 'offer' && !merged.events.length) {
      merged.events.push(event);
      merged.state = 'offered';
      continue;
    }
    const applied = applyCollaborationTaskEvent(merged, event);
    merged = applied.task;
  }
  return merged;
}

module.exports = {
  COLLABORATION_TASK_EVENT_SCHEMA,
  COLLABORATION_TASK_SCHEMA,
  EXECUTION_MODES,
  applyCollaborationTaskEvent,
  mergeCollaborationTask,
  normalizeCollaborationTask,
  normalizeCollaborationTaskEvent,
};
