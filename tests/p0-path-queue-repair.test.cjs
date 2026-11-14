const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const paths = require('../electron/rule-path-health.cjs');
const governance = require('../electron/task-governance-policy.cjs');
const recovery = require('../electron/task-recovery-policy.cjs');
const runtime = require('../electron/task-runtime-policy.cjs');
const { taskPresentation } = require('../electron/task-read-model.cjs');
const { validateTaskTransition } = require('../electron/task-protocol.cjs');

test('path scanner excludes URI suffixes and bounds multiple inline paths exactly', () => {
  const text = 'edu://student/report https://example.org/u:/bad `D:\\学生资料\\甲知识库` 中维护；`E:\\old\\甲知识库\\汇总\\index.md` 初始化为导航页。';
  assert.deepEqual(paths.detectedWindowsPaths(text).map(x => x.detectedPath), ['D:\\学生资料\\甲知识库', 'E:\\old\\甲知识库\\汇总\\index.md']);
  const next = paths.replaceDetectedPathSpans(text, [{ detectedPath: 'E:\\old\\甲知识库\\汇总\\index.md', replacement: '@SUMMARY_DIR/index.md' }]);
  assert.ok(next.endsWith('`@SUMMARY_DIR/index.md` 初始化为导航页。'));
  assert.ok(next.includes('edu://student/report'));
});

test('quoted spaces and UNC paths work; incomplete quotes are never rewritten', () => {
  const text = '`C:\\My Files\\甲\\a.md` 和 "\\\\server\\share\\My Files\\a.md"';
  assert.equal(paths.detectedWindowsPaths(text).length, 2);
  assert.equal(paths.detectedWindowsPaths(text)[0].detectedPath, 'C:\\My Files\\甲\\a.md');
  const damaged = '`E:\\old\\甲知识库 中维护学生。';
  const [item] = paths.detectedWindowsPaths(damaged);
  assert.equal(item.repairable, false);
  assert.equal(paths.replaceDetectedPathSpans(damaged, [{ ...item, replacement: '@KB_ROOT' }]), damaged);
});

test('actual host repair never hides a missing current-workspace file behind a logical path', () => {
  const source = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
  const code = source.slice(source.indexOf('function repairStudentStalePaths('), source.indexOf('\nfunction markdownTableCell('));
  const context = { path, readStudentsIndex: () => [{ id: 'student' }], toHostStudent: x => x,
    ensureStudentWorkspaceConfig() {}, scanAbsolutePathsInRuleFiles: () => [{ filePath: 'AGENT.md', detectedPath: 'D:\\student\\missing.md', status: 'warning', matchesCurrentPath: true, exists: false }],
    replacementForDetectedPath: () => { throw Error('Missing originals must not be rewritten'); },
    checkStudentPathHealth: () => JSON.stringify({ reportPath: 'report.md' }) };
  vm.createContext(context); vm.runInContext(code, context);
  const result = JSON.parse(context.repairStudentStalePaths('student'));
  assert.equal(result.ok, true); assert.equal(result.changedFiles.length, 0);
  assert.match(result.skipped[0].reason, /不能.*隐藏资料缺失/);
});

test('rebound paths preserve filenames and student identity, not generic raw/report words', () => {
  const map = { '@KB_ROOT': 'D:\\学生资料\\甲知识库', '@SUMMARY_DIR': 'D:\\学生资料\\甲知识库\\汇总', '@RAW_DIR': 'D:\\学生资料\\甲知识库\\原始资料', '@AGENT_FILE': 'D:\\学生资料\\甲知识库\\AGENT.md' };
  assert.equal(paths.logicalPathReplacement('E:\\旧电脑\\甲知识库\\汇总\\index.md', map, ['E:\\旧电脑\\甲知识库']), '@SUMMARY_DIR/index.md');
  assert.equal(paths.logicalPathReplacement('D:\\学生资料\\甲知识库\\.edu-manager\\digest-state.json', map), '@KB_ROOT/.edu-manager/digest-state.json');
  assert.equal(paths.logicalPathReplacement('E:\\旧电脑\\甲知识库\\汇总\\index.md', map), '');
  assert.equal(paths.logicalPathReplacement('E:\\乙知识库\\raw\\report.md', map), '');
  assert.equal(paths.logicalPathReplacement('E:\\甲知识库副本\\AGENT.md', map), '');
});

const legacy = () => ({ id: 'intake-old', kind: 'smart_material_intake', sourceId: 'system', input: { sourceId: 'legacy-download' },
  status: 'pending', count: 0, attempt: 0, createdAt: '2026-10-01T00:00:00Z' });
const idle = () => ({ id: 'project-idle', kind: 'project_digest', sourceId: 'project', status: 'pending', count: 0, attempt: 0 });
const evidence = () => ({ inboxItems: [], projects: [{ id: 'project', digestState: { pendingCount: 0, pendingFiles: [], status: 'idle' } }], hasExecutionArtifacts: () => false });

test('legacy source fallback repairs system masking without crossing explicit source or real batches', () => {
  assert.equal(governance.isLegacySmartInboxOrphan(legacy()), true);
  for (const patch of [{ sourceId: 'other-student' }, { count: 1 }, { executionId: 'e' }, { result: { recoveryState: 'unknown' } }, { input: { sourceId: 'legacy-download', itemIds: ['one'] } }]) {
    assert.equal(governance.isLegacySmartInboxOrphan({ ...legacy(), ...patch }), false);
  }
});

test('governance requires affirmative association checks and protects nonempty projects and executions', () => {
  const tasks = [legacy(), idle()];
  assert.equal(governance.queueGovernanceCandidates({ tasks }, evidence()).candidates.length, 2);
  assert.equal(governance.queueGovernanceCandidates({ tasks }).candidates.length, 0);
  assert.equal(governance.queueGovernanceCandidates({ tasks }, { ...evidence(), hasExecutionArtifacts: () => true }).candidates.length, 0);
  assert.equal(governance.queueGovernanceCandidates({ tasks }, { ...evidence(), inboxItems: [{ taskId: 'intake-old' }], projects: [{ id: 'project', digestState: { pendingCount: 1 } }] }).candidates.length, 0);
  assert.equal(governance.queueGovernanceCandidates({ tasks: [...tasks, { id: 'child', input: { parentTaskId: 'intake-old' } }] }, evidence()).candidates.length, 1);
});

test('legacy missing unknown marker is repaired without erasing identity or enabling retry', () => {
  const task = { id: 'unknown', status: 'running', executionId: 'retain-me', recoveryState: '', autoRetry: true, nextRetryAt: '2026-10-17T00:00:00Z',
    error: { code: 'HEARTBEAT_LOST', message: '已请求停止，尚未确认外部完成或停止' } };
  assert.equal(taskPresentation(task).occupiesExecutionSlot, false);
  assert.equal(recovery.taskRetryDecision(task, { code: 'ECONNRESET' }, { stopConfirmed: true }).autoRetry, false);
  const result = runtime.repairTaskRuntimeStore({ tasks: [task] });
  assert.equal(result.repairs[0].type, 'unresolved_marker_repaired');
  assert.equal(task.recoveryState, 'unknown');
  assert.equal(task.status, 'running');
  assert.equal(task.executionId, 'retain-me');
  assert.equal(task.autoRetry, false);
  assert.equal(task.nextRetryAt, '');
  assert.equal(runtime.repairTaskRuntimeStore({ tasks: [task] }).changed, false);
  assert.equal(governance.governanceEligibility(task, 'archive').ok, false);
});

test('candidate refresh cannot demote approved preflight to blocked, transition protocol remains strict', () => {
  const current = { status: 'approved', idempotencyKey: 'same', executionId: '' };
  const decision = runtime.candidateRuntimeDecision(current, { status: 'blocked', idempotencyKey: 'same' });
  assert.equal(decision.nextStatus, 'approved');
  assert.equal(decision.preserveRuntime, true);
  assert.equal(validateTaskTransition(decision.nextStatus, 'running').ok, true);
  assert.equal(validateTaskTransition('blocked', 'running').ok, false);
  assert.equal(runtime.candidateRuntimeDecision({ status: 'cancelled', idempotencyKey: 'same' }, { status: 'pending', idempotencyKey: 'same' }).nextStatus, 'cancelled');
});

test('future scheduled work is not a human action; unknown status takes precedence', () => {
  const task = { status: 'pending', trigger: 'schedule', scheduledAt: '2099-01-01T00:00:00Z' };
  assert.equal(taskPresentation(task).statusGroup, 'scheduled');
  assert.equal(taskPresentation(task).phaseLabel, '按计划开始');
  assert.equal(taskPresentation({ ...task, recoveryState: 'unknown' }).statusGroup, 'actionable');
});

test('actual host candidate merge retains quarantine, retry proof and archive audit against empty defaults', () => {
  const source = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
  const code = source.slice(source.indexOf('function upsertTaskCandidates('), source.indexOf('\nfunction dailyActionDraftPath('));
  const tasks = [
    { id: 'u', status: 'running', executionId: 'e', startedAt: 'now', recoveryState: 'unknown', recoveryReason: 'stop_unconfirmed', recoveryCheckedAt: 'checked', idempotencyKey: 'cycle' },
    { id: 'r', status: 'failed', nextRetryAt: 'later', retryRecovery: { version: 1, stopConfirmed: true }, idempotencyKey: 'cycle' },
    { id: 'a', status: 'archived', archive: { reason: 'verified empty' }, idempotencyKey: 'cycle' },
    { id: 'p', status: 'approved', idempotencyKey: 'cycle', executionId: '' },
    { id: 's', status: 'cancelled', recoveryState: 'host_confirmed_stopped',
      idempotencyKey: 'competition:student:old-fingerprint:2026-10', executionId: 'old-run', adapterId: 'internal',
      executor: 'internal', requestedExecutor: 'internal', executionMode: 'internal', input: { operation: 'old-run' },
      executionProvenance: { providerId: 'internal', providerLabel: 'AI 教育管家内置流程' },
      recoveryPlan: { state: 'resolved', providerLabel: 'AI 教育管家内置流程' }, recoveryBudget: { version: 1, executionAttempts: 0 } },
  ];
  const store = { tasks, history: [] };
  const context = { readTaskStore: () => store, writeTaskStore: x => x, candidateRuntimeDecision: runtime.candidateRuntimeDecision,
    taskRequiresApproval: () => false, materialTaskCheckpointForCandidate: () => null,
    normalizeTaskEnvelope: (next, current) => ({ ...current, ...next }), taskStatusGroup: () => 'actionable',
    TASK_TERMINAL_STATUSES: new Set(['failed', 'archived', 'cancelled']) };
  vm.createContext(context); vm.runInContext(code, context);
  context.upsertTaskCandidates(tasks.map(t => ({ id: t.id, status: 'blocked',
    idempotencyKey: t.id === 's' ? 'competition:student:new-fingerprint:2026-10' : 'cycle',
    executor: 'auto', requestedExecutor: 'auto', executionMode: 'adapter', input: { operation: 'new-run' },
    executionProvenance: { providerId: 'auto', providerLabel: 'auto' }, recoveryPlan: { state: 'needs_user', providerLabel: 'auto' },
    recoveryBudget: { version: 1, executionAttempts: 3 },
    recoveryState: '', recoveryReason: '', recoveryCheckedAt: '', retryRecovery: null, nextRetryAt: '', archive: null })));
  assert.equal(store.tasks[0].recoveryState, 'unknown');
  assert.equal(store.tasks[0].executionId, 'e');
  assert.equal(store.tasks[0].recoveryReason, 'stop_unconfirmed');
  assert.equal(store.tasks[1].nextRetryAt, 'later');
  assert.equal(store.tasks[1].retryRecovery.stopConfirmed, true);
  assert.equal(store.tasks[2].archive.reason, 'verified empty');
  assert.equal(store.tasks[3].status, 'approved');
  assert.equal(store.tasks[4].status, 'cancelled');
  assert.equal(store.tasks[4].executor, 'internal');
  assert.equal(store.tasks[4].executionMode, 'internal');
  assert.equal(store.tasks[4].executionId, 'old-run');
  assert.equal(store.tasks[4].input.operation, 'old-run');
  assert.equal(store.tasks[4].executionProvenance.providerLabel, 'AI 教育管家内置流程');
  assert.equal(store.tasks[4].recoveryPlan.providerLabel, 'AI 教育管家内置流程');
  assert.equal(store.tasks[4].recoveryBudget.executionAttempts, 0);
});

test('actual v2 host migration upgrades v1, backs up, is idempotent and never dispatches unknown tasks', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-p0-governance-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'smart-inbox/items'), { recursive: true });
  const unknown = { id: 'active', status: 'running', executionId: 'keep', recoveryState: 'unknown' };
  const store = { tasks: [legacy(), idle(), unknown], runtime: { taskGovernanceMigration: { version: 1, archivedCount: 0 } } };
  const original = JSON.stringify(store);
  fs.writeFileSync(path.join(dir, 'tasks.json'), original);
  const source = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
  const code = source.slice(source.indexOf('async function migrateTaskQueueGovernance()'), source.indexOf('\nasync function acceptImportedTaskResult'));
  let writes = 0;
  const context = { fs, path, app: { getPath: () => dir }, readTaskStore: () => store,
    readProjects: () => evidence().projects, readProjectMetadata: () => evidence().projects,
    normalizeProject: x => x, normalizeProjectMetadata: x => x, readProjectDigestState: p => p.digestState,
    taskNow: () => '2026-10-17T10:00:00Z', timestampForFilename: () => 'fixture', taskCenterDirPath: () => dir,
    taskExecutionDirPath: () => path.join(dir, 'executions'), taskStorePath: () => path.join(dir, 'tasks.json'), taskEventLogPath: () => path.join(dir, 'events.jsonl'),
    queueGovernanceCandidates: governance.queueGovernanceCandidates, archiveTaskRecord: governance.archiveTaskRecord,
    writeTaskStoreDurably: async () => { writes++; } };
  vm.createContext(context); vm.runInContext(code, context);
  const result = await context.migrateTaskQueueGovernance();
  assert.equal(result.version, 2); assert.equal(result.archivedCount, 2); assert.equal(writes, 1);
  assert.equal(fs.readFileSync(path.join(result.backupDir, 'tasks.before.json'), 'utf8'), original);
  assert.deepEqual(store.tasks[2], unknown);
  assert.equal(store.tasks[2].executionId, 'keep');
  await context.migrateTaskQueueGovernance(); assert.equal(writes, 1);
});
