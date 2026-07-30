const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  applyCollaborationTaskEvent,
  mergeCollaborationTask,
  normalizeCollaborationTask,
  normalizeCollaborationTaskEvent,
} = require('../electron/collaboration-task.cjs');
const {
  buildCollaborationPackage,
  scanAndImportCollaborationPackages,
} = require('../electron/collaboration-runtime.cjs');

function exchange(root, sourceNodeId, targetNodeId, task) {
  const exportPath = path.join(root, `${sourceNodeId}-${task.events.length}.json`);
  fs.writeFileSync(exportPath, JSON.stringify(task, null, 2), 'utf8');
  buildCollaborationPackage(path.join(root, 'shared'), {
    sourceNodeId,
    targetNodeId,
    files: [{
      sourcePath: exportPath,
      relativePath: `tasks/${task.taskId}.json`,
      objectId: `collaboration-task:${task.taskId}`,
      objectType: 'collaboration_task',
      version: task.events.length,
      studentId: task.studentId,
    }],
  });
  const ledgerPath = path.join(root, `${targetNodeId}-ledger.json`);
  scanAndImportCollaborationPackages(path.join(root, 'shared'), { targetNodeId, ledgerPath });
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const importedPath = ledger.objects[`collaboration-task:${task.taskId}`].importedPath;
  return normalizeCollaborationTask(JSON.parse(fs.readFileSync(importedPath, 'utf8')));
}

function event(task, type, actorNodeId, message) {
  return normalizeCollaborationTaskEvent({
    taskId: task.taskId,
    type,
    actorNodeId,
    targetNodeId: actorNodeId === task.sourceNodeId ? task.targetNodeId : task.sourceNodeId,
    payload: {
      idempotencyKey: `${type}:${task.events.length + 1}`,
      message,
      resultId: type === 'submit' ? `result-${task.events.length + 1}` : '',
      feedbackId: type === 'feedback' ? `feedback-${task.events.length + 1}` : '',
    },
  });
}

test('teacher and student complete one collaboration task through versioned two-node packages', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-collaboration-task-'));
  let teacher = normalizeCollaborationTask({
    sourceNodeId: 'teacher-node',
    targetNodeId: 'student-node',
    studentId: 'student-1',
    title: 'Complete reflection',
    instructions: 'Submit a short reflection.',
  });

  let student = exchange(root, 'teacher-node', 'student-node', teacher);
  student = applyCollaborationTaskEvent(student, event(student, 'accept', 'student-node', 'accepted')).task;
  teacher = mergeCollaborationTask(teacher, exchange(root, 'student-node', 'teacher-node', student));
  assert.equal(teacher.state, 'accepted');

  student = applyCollaborationTaskEvent(student, event(student, 'submit', 'student-node', 'first result')).task;
  teacher = mergeCollaborationTask(teacher, exchange(root, 'student-node', 'teacher-node', student));
  assert.equal(teacher.state, 'submitted');

  teacher = applyCollaborationTaskEvent(teacher, event(teacher, 'feedback', 'teacher-node', 'add evidence')).task;
  student = mergeCollaborationTask(student, exchange(root, 'teacher-node', 'student-node', teacher));
  assert.equal(student.state, 'feedback');

  student = applyCollaborationTaskEvent(student, event(student, 'submit', 'student-node', 'revised result')).task;
  teacher = mergeCollaborationTask(teacher, exchange(root, 'student-node', 'teacher-node', student));
  teacher = applyCollaborationTaskEvent(teacher, event(teacher, 'close', 'teacher-node', 'completed')).task;
  student = mergeCollaborationTask(student, exchange(root, 'teacher-node', 'student-node', teacher));

  assert.equal(teacher.state, 'closed');
  assert.equal(student.state, 'closed');
  assert.equal(student.events.length, 6);
});

test('task attachments arrive as isolated inbox objects and are not silently promoted', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-collaboration-attachment-'));
  const task = normalizeCollaborationTask({
    sourceNodeId: 'teacher-node',
    targetNodeId: 'student-node',
    studentId: 'student-1',
    title: 'Review reference',
    attachmentObjectIds: ['collaboration-attachment:reference-1'],
  });
  const taskPath = path.join(root, 'task.json');
  const attachmentPath = path.join(root, 'reference.txt');
  fs.writeFileSync(taskPath, JSON.stringify(task, null, 2), 'utf8');
  fs.writeFileSync(attachmentPath, 'teacher reference', 'utf8');
  buildCollaborationPackage(path.join(root, 'shared'), {
    sourceNodeId: 'teacher-node',
    targetNodeId: 'student-node',
    files: [
      {
        sourcePath: taskPath,
        relativePath: `tasks/${task.taskId}.json`,
        objectId: `collaboration-task:${task.taskId}`,
        objectType: 'collaboration_task',
        version: 1,
      },
      {
        sourcePath: attachmentPath,
        relativePath: `attachments/${task.taskId}/1-reference.txt`,
        objectId: 'collaboration-attachment:reference-1',
        objectType: 'collaboration_attachment',
        version: 1,
      },
    ],
  });
  const ledgerPath = path.join(root, 'student-ledger.json');
  scanAndImportCollaborationPackages(path.join(root, 'shared'), { targetNodeId: 'student-node', ledgerPath });
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const importedAttachment = ledger.objects['collaboration-attachment:reference-1'];
  assert.equal(importedAttachment.objectType, 'collaboration_attachment');
  assert.match(importedAttachment.importedPath, /inbox/);
  assert.equal(fs.readFileSync(importedAttachment.importedPath, 'utf8'), 'teacher reference');
  assert.equal(fs.existsSync(path.join(root, 'student-raw', 'reference.txt')), false);
});

test('student result attachments return to the teacher as isolated idempotent artifacts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-collaboration-result-attachment-'));
  let task = normalizeCollaborationTask({
    sourceNodeId: 'teacher-node',
    targetNodeId: 'student-node',
    studentId: 'student-1',
    title: 'Return project result',
  });
  task = applyCollaborationTaskEvent(task, event(task, 'accept', 'student-node', 'accepted')).task;
  const resultObjectId = `collaboration-result-attachment:${task.taskId}:result-1:1`;
  task = applyCollaborationTaskEvent(task, normalizeCollaborationTaskEvent({
    taskId: task.taskId,
    type: 'submit',
    actorNodeId: 'student-node',
    targetNodeId: 'teacher-node',
    payload: {
      idempotencyKey: 'submit-with-attachment',
      resultId: 'result-1',
      message: 'completed with attachment',
      artifactObjectIds: [resultObjectId],
    },
  })).task;
  const taskPath = path.join(root, 'task-result.json');
  const resultPath = path.join(root, 'student-result.md');
  fs.writeFileSync(taskPath, JSON.stringify(task, null, 2), 'utf8');
  fs.writeFileSync(resultPath, '# Student result', 'utf8');
  buildCollaborationPackage(path.join(root, 'shared'), {
    sourceNodeId: 'student-node',
    targetNodeId: 'teacher-node',
    files: [
      {
        sourcePath: taskPath,
        relativePath: `tasks/${task.taskId}.json`,
        objectId: `collaboration-task:${task.taskId}`,
        objectType: 'collaboration_task',
        version: task.events.length,
      },
      {
        sourcePath: resultPath,
        relativePath: `results/${task.taskId}/result-1/1-student-result.md`,
        objectId: resultObjectId,
        objectType: 'collaboration_result_attachment',
        version: 1,
      },
    ],
  });
  const ledgerPath = path.join(root, 'teacher-ledger.json');
  const first = scanAndImportCollaborationPackages(path.join(root, 'shared'), { targetNodeId: 'teacher-node', ledgerPath });
  const second = scanAndImportCollaborationPackages(path.join(root, 'shared'), { targetNodeId: 'teacher-node', ledgerPath });
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  assert.equal(first.importedCount, 2);
  assert.equal(second.importedCount, 0);
  assert.equal(second.packageCount, 0);
  assert.equal(second.duplicateCount, 0);
  assert.equal(ledger.objects[resultObjectId].objectType, 'collaboration_result_attachment');
  assert.equal(fs.readFileSync(ledger.objects[resultObjectId].importedPath, 'utf8'), '# Student result');
  const submitEvent = task.events.find((item) => item.type === 'submit');
  assert.deepEqual(submitEvent.payload.artifactObjectIds, [resultObjectId]);
});

test('student help request completes through the same offline two-node exchange', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-collaboration-help-'));
  let student = normalizeCollaborationTask({
    requestKind: 'help_request',
    sourceNodeId: 'student-node',
    targetNodeId: 'teacher-node',
    studentId: 'student-1',
    title: 'Need outline review',
  });
  let teacher = exchange(root, 'student-node', 'teacher-node', student);
  teacher = applyCollaborationTaskEvent(teacher, event(teacher, 'accept', 'teacher-node', 'accepted')).task;
  teacher = applyCollaborationTaskEvent(teacher, event(teacher, 'submit', 'teacher-node', 'review notes')).task;
  student = mergeCollaborationTask(student, exchange(root, 'teacher-node', 'student-node', teacher));
  assert.equal(student.state, 'submitted');
  student = applyCollaborationTaskEvent(student, event(student, 'close', 'student-node', 'resolved')).task;
  teacher = mergeCollaborationTask(teacher, exchange(root, 'student-node', 'teacher-node', student));
  assert.equal(teacher.state, 'closed');
  assert.equal(teacher.requestKind, 'help_request');
});
