'use strict';

const { app } = require('electron');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const resources = path.resolve(process.argv[2] || '');
const outputPath = path.resolve(process.argv[3] || 'p0-packaged-dispatch-regression.json');

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const report = {
    schema: 'edu.p0.packaged-dispatch-regression.v1',
    candidateResources: resources,
    syntheticOnly: true,
    formalDataReadOrWritten: false,
    startedAt: new Date().toISOString(),
    passed: false,
  };
  let store;
  let temporaryDirectory = '';
  try {
    const load = file => require(path.join(resources, 'app.asar', 'electron', file));
    const { findUnresolvedDispatchConflict } = load('task-dispatch-conflict.cjs');
    const { createTaskStateStore } = load('task-state-store.cjs');
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-p0-dispatch-regression-'));
    const legacyPath = path.join(temporaryDirectory, 'tasks.json');
    await fs.writeFile(legacyPath, JSON.stringify({ protocolVersion: 3, tasks: [], history: [] }), 'utf8');
    store = createTaskStateStore({ legacyPath });
    const now = new Date().toISOString();
    const cancelledUnknownDigest = {
      id: 'digest-unknown', sourceType: 'student', sourceId: 'student-a', kind: 'student_digest',
      workKey: 'student_digest:student-a:material-hash:v1', status: 'cancelled',
      recoveryState: 'unknown', executionId: 'execution-a', automaticExecution: true,
      updatedAt: now, recoveryPlan: { nextCheckAt: '2026-10-28T18:00:00.000Z' },
    };
    const weeklyTask = {
      id: 'weekly-overdue', sourceType: 'student', sourceId: 'student-a', kind: 'weekly_action',
      workKey: 'weekly_action:student-a:2026-W44:growth-hash', status: 'queued',
      automaticExecution: true, scheduledAt: '2026-10-28T00:00:00.000Z', updatedAt: now,
    };
    const sameWorkTask = {
      id: 'digest-rebuilt', sourceType: 'student', sourceId: 'student-a', kind: 'student_digest',
      workKey: cancelledUnknownDigest.workKey, status: 'queued', automaticExecution: true,
      scheduledAt: '2026-10-28T00:00:00.000Z', updatedAt: now,
    };
    store.upsertTaskBatch([cancelledUnknownDigest, weeklyTask, sameWorkTask]);
    const started = performance.now();
    const runnable = store.listRunnableTasks({ now, limit: 20 }).tasks;
    const weeklyConflict = findUnresolvedDispatchConflict(weeklyTask, [cancelledUnknownDigest]);
    const sameWorkConflict = findUnresolvedDispatchConflict(sameWorkTask, [cancelledUnknownDigest]);
    const durationMs = performance.now() - started;
    report.observed = {
      durationMs,
      runnableTaskIds: runnable.map(task => task.id),
      weeklyConflict,
      sameWorkConflict,
    };
    report.assertions = {
      weeklyRunnable: runnable.some(task => task.id === weeklyTask.id),
      weeklyDifferentWorkUnblocked: weeklyConflict === null,
      sameWorkBlocked: sameWorkConflict?.reasonCode === 'execution_unknown_same_work'
        && sameWorkConflict?.blockerTaskId === cancelledUnknownDigest.id,
      preparedWithinTenSeconds: durationMs < 10_000,
    };
    report.passed = Object.values(report.assertions).every(Boolean);
  } catch (error) {
    report.error = error && error.stack ? error.stack : String(error);
  } finally {
    try { store?.close(); } catch {}
    if (temporaryDirectory) await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
  report.finishedAt = new Date().toISOString();
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
  app.exit(report.passed ? 0 : 1);
});
