'use strict';

const fs = require('node:fs');
const path = require('node:path');

const fixture = path.resolve(process.argv[2] || '');
const mode = String(process.argv[3] || 'legacy-invalid');
const sameWorkKey = String(process.argv[4] || '');
const sourceValid = mode.startsWith('source-valid');
if (!fixture || !fs.existsSync(fixture)) throw new Error('existing fixture directory is required');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const settingsPath = path.join(fixture, 'settings.json');
const studentsPath = path.join(fixture, 'students.json');
const taskPath = path.join(fixture, 'student-data', '.edu-manager', 'task-center', 'tasks.json');
const eventPath = path.join(fixture, 'student-data', '.edu-manager', 'task-center', 'events.jsonl');
const settings = readJson(settingsPath);
const existingStudents = readJson(studentsPath);
const student = Array.isArray(existingStudents) && existingStudents[0];
if (!student?.id) throw new Error('fixture student is required');

student.status = 'active';
student.activityStatus = 'active';
student.active = true;
student.archived = false;
student.automaticTasksPaused = false;
if (sourceValid) {
  student.agentTool = 'manual';
  student.digestTime = '00:00';
  student.summaryPath = path.join(student.rootPath, 'AI教育管家', '汇总');
  const growthDir = path.join(student.summaryPath, '成长模型');
  fs.mkdirSync(growthDir, { recursive: true });
  writeJson(path.join(growthDir, 'growth-index.json'), {
    schema: 'edu-manager.growth-index.v2',
    studentId: student.id,
    sourceFingerprint: 'p0-synthetic-growth-v1',
    updatedAt: new Date().toISOString(),
    abilities: [],
  });
}
settings.taskAutomationEnabled = true;

const now = new Date().toISOString();
const workKey = `student_digest:${student.id}:fixture-v1`;
const tasks = [
  {
    id: 'p0-digest-unknown', title: 'P0未知消化', kind: 'student_digest', sourceType: 'student',
    sourceId: student.id, sourceName: student.name, status: 'cancelled', trigger: 'event',
    executor: 'workbuddy', requestedExecutor: 'workbuddy', executionMode: 'automatic', automaticExecution: true,
    workKey, sourceVersion: 'fixture-v1', pipelineVersion: 'p0-v1', executionId: 'p0-unknown-execution',
    recoveryState: 'unknown', recoveryPlan: { nextCheckAt: new Date(Date.now() + 5 * 60_000).toISOString(), checks: 1, maxChecks: 3 },
    createdAt: now, updatedAt: now,
  },
  ...(sourceValid ? [] : [{
    id: 'p0-weekly-different-work', title: 'P0不同周任务', kind: 'weekly_action', sourceType: 'student',
    sourceId: student.id, sourceName: student.name, status: 'queued', trigger: 'event',
    executor: 'internal', requestedExecutor: 'internal', executionMode: 'internal', automaticExecution: true,
    requestOrigin: 'recovery', workKey: `weekly_action:${student.id}:2026-W44:growth-v1`, sourceVersion: 'growth-v1',
    pipelineVersion: 'p0-v1', priorityClass: 80, queuedAt: now, createdAt: now, updatedAt: now,
    input: { operation: 'unsupported_synthetic', studentId: student.id },
  }]),
  ...(sourceValid ? [] : [{
    id: 'p0-digest-same-work', title: 'P0同工作消化', kind: 'student_digest', sourceType: 'student',
    sourceId: student.id, sourceName: student.name, status: 'queued', trigger: 'event',
    executor: 'workbuddy', requestedExecutor: 'workbuddy', executionMode: 'automatic', automaticExecution: true,
    requestOrigin: 'recovery', workKey, sourceVersion: 'fixture-v1', pipelineVersion: 'p0-v1', priorityClass: 60,
    queuedAt: now, createdAt: now, updatedAt: now,
  }]),
  ...(mode === 'source-valid-same' && sameWorkKey ? [{
    id: 'p0-weekly-unknown-blocker', title: 'P0同工作未知执行', kind: 'generic', sourceType: 'student',
    sourceId: student.id, sourceName: student.name, status: 'cancelled', trigger: 'event',
    executor: 'workbuddy', requestedExecutor: 'workbuddy', executionMode: 'automatic', automaticExecution: true,
    workKey: sameWorkKey, sourceVersion: 'p0-synthetic-growth-v1', pipelineVersion: 'v1',
    executionId: 'p0-same-work-unknown-execution', recoveryState: 'unknown',
    recoveryPlan: { nextCheckAt: new Date(Date.now() + 5 * 60_000).toISOString(), checks: 1, maxChecks: 3 },
    createdAt: now, updatedAt: now,
  }] : []),
];

writeJson(settingsPath, settings);
writeJson(studentsPath, [student]);
writeJson(taskPath, { protocolVersion: 'p0-dispatch-conflict-fixture-v1', updatedAt: now, runtime: {}, deletedTasks: [], history: [], tasks });
fs.writeFileSync(eventPath, `${JSON.stringify({ id: 'p0-dispatch-fixture-created', taskId: '', type: 'fixture_created', at: now, payload: { synthetic: true } })}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ ok: true, fixture, mode, studentId: student.id, taskCount: tasks.length })}\n`);
