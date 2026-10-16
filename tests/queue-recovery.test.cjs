const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildQueueRecovery, matchingCompetitionReceipt } = require('../electron/queue-recovery.cjs');
const { applyFiles, rollback, hash } = require('../scripts/recover-task-queue.cjs');

function fixture() {
  const task = { id: 'competition', kind: 'competition_research_check', sourceType: 'student', sourceId: 's1',
    status: 'timed_out', error: { code: 'HEARTBEAT_LOST' }, executionId: 'old-run',
    startedAt: '2026-10-09T13:53:18.247Z', completedAt: '2026-10-09T13:57:42.334Z',
    idempotencyKey: 'competition_research_check:s1:fp:2026-10' };
  const receipt = { id: 'receipt', taskType: task.kind, studentId: 's1', status: 'succeeded', inputFingerprint: 'fp',
    checkedAt: '2026-10-09T13:53:18.498Z', versionId: 'v1' };
  const business = { s1: { checks: [receipt], competitionSets: [{ id: 'v1', studentId: 's1', inputFingerprint: 'fp', sources: [{}], candidates: [{}] }] } };
  return { tasks: { tasks: [task], history: [] }, students: [{ id: 's1', agentTool: 'qclaw' }], projects: { projects: [] }, business,
    validRoot: () => true, now: '2026-10-10T00:00:00Z' };
}
test('legacy timeout reconciles only a unique matching receipt and existing version', () => {
  const f = fixture(), task = f.tasks.tasks[0];
  assert.equal(matchingCompetitionReceipt(task, f.business.s1).id, 'receipt');
  const plan = buildQueueRecovery(f);
  assert.equal(plan.tasks.tasks[0].status, 'succeeded'); assert.equal(task.status, 'timed_out');
  assert.equal(buildQueueRecovery({ ...f, tasks: plan.tasks }).changes.length, 0);
  for (const patch of [{ studentId: 'foreign' }, { inputFingerprint: 'changed' }, { checkedAt: '2026-10-01T00:00:00Z' }, { executionId: 'foreign' }, { status: 'failed' }]) {
    const b = structuredClone(f.business.s1); Object.assign(b.checks[0], patch);
    assert.equal(matchingCompetitionReceipt(task, b), null);
  }
  const duplicate = structuredClone(f.business.s1); duplicate.checks.push({ ...duplicate.checks[0], id: 'second' });
  assert.equal(matchingCompetitionReceipt(task, duplicate), null);
  assert.equal(matchingCompetitionReceipt(task, { ...f.business.s1, competitionSets: [] }), null);
});
test('no-results reconciles without inventing a recommendation version', () => {
  const f = fixture(); f.business.s1.checks[0].status = 'no_results'; f.business.s1.competitionSets = [];
  const out = buildQueueRecovery(f); assert.equal(out.tasks.tasks[0].status, 'succeeded');
  assert.equal(out.tasks.tasks[0].result.structuredOutput.receipt.status, 'no_results');
});
test('QClaw migration preserves explicit bindings, paused users, active executions and high risk', () => {
  const f = fixture(); f.students.push({ id: 'paused', agentTool: 'qclaw', activityStatus: 'inactive' }, { id: 'codex', agentTool: 'codex' });
  f.tasks.tasks = ['s1','paused','codex'].map(id => ({ id, sourceType: 'student', sourceId: id, kind: 'learning_profile', status: 'failed', executor: 'qclaw' }));
  f.tasks.tasks.push({ id: 'active', sourceType: 'student', sourceId: 's1', kind: 'weekly_action', status: 'waiting_result' });
  const out = buildQueueRecovery(f);
  assert.equal(out.students[0].agentTool, 'workbuddy'); assert.equal(out.students[0].agentBindingMode, 'mainChat');
  assert.equal(out.students[1].agentTool, 'qclaw'); assert.equal(out.students[2].agentTool, 'codex');
  assert.equal(out.tasks.tasks[0].recovery.manualOnly, true); assert.equal(out.tasks.tasks[0].autoRetry, false);
  assert.equal(out.tasks.tasks[3].status, 'waiting_result');
  assert.equal(buildQueueRecovery({ ...f, tasks: out.tasks, students: out.students }).changes.length, 0);
  f.tasks.tasks[0].riskLevel = 'high'; assert.equal(buildQueueRecovery(f).students[0].agentTool, 'qclaw');
});
test('controlled workspace project leaves an idle task queued but migrates legacy QClaw execution to Codex', () => {
  const f = fixture();
  f.projects.projects.push({ id: 'p1', name: 'controlled', status: 'active', agentTool: 'workbuddy', materialStorageMode: 'workspace-v1', digestState: { pendingCount: 0 } });
  f.tasks.tasks = [{ id: 'p1-task', sourceType: 'project', sourceId: 'p1', kind: 'project_digest', status: 'queued', statusGroup: 'scheduled', executor: 'qclaw', requestedExecutor: 'qclaw', count: 0 }];
  const out = buildQueueRecovery(f);
  assert.equal(out.tasks.tasks[0].status, 'queued');
  assert.equal(out.tasks.tasks[0].executor, 'codex');
  assert.equal(out.tasks.tasks[0].requestedExecutor, 'codex');
  assert.equal(out.tasks.tasks[0].recovery.action, 'controlled_executor_migrated');
  assert.equal(buildQueueRecovery({ ...f, tasks: out.tasks }).changes.length, 0);
});
test('offline recovery never declares research capability available', () => {
  const f = fixture(); f.tasks.tasks = [{ id: 'planning', kind: 'guidance_research_check', status: 'blocked', attempt: 0 }];
  assert.equal(buildQueueRecovery(f).tasks.tasks[0].status, 'blocked');
  assert.equal(buildQueueRecovery({ ...f, researchAvailable: true }).tasks.tasks[0].status, 'pending');
});
test('backup, idempotent rollback, stale preview, concurrent edits and host-running guard', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-queue-recovery-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'tasks.json'); fs.writeFileSync(file, 'before');
  const entries = [{ file, beforeHash: hash(Buffer.from('before')), after: Buffer.from('after') }];
  assert.throws(() => applyFiles(entries, path.join(dir, 'blocked'), () => { throw Error('host running'); }), /host running/);
  assert.equal(fs.existsSync(path.join(dir, 'blocked')), false);
  const backup = path.join(dir, 'backup'); applyFiles(entries, backup, () => {});
  assert.equal(fs.readFileSync(file, 'utf8'), 'after');
  const journal = path.join(backup, 'journal.json');
  fs.writeFileSync(file, 'user edit'); assert.throws(() => rollback(journal, () => {}), /新变化/);
  fs.writeFileSync(file, 'after'); rollback(journal, () => {}); rollback(journal, () => {});
  assert.equal(fs.readFileSync(file, 'utf8'), 'before');
  fs.writeFileSync(file, 'changed'); assert.throws(() => applyFiles(entries, path.join(dir, 'stale'), () => {}), /已变化/);
});
