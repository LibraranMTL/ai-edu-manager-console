const { studentAutomaticTasksPaused } = require('./student-automation-policy.cjs');
const { recoverableResearchBlock } = require('./research-task-policy.cjs');
const ORDINARY = new Set(['weekly_action', 'learning_profile', 'learning_stage', 'learning_changes', 'student_digest', 'maintenance_lint', 'project_digest']);
const SAFE_STATES = new Set(['pending', 'queued', 'failed', 'timed_out', 'blocked']);
const RECOVERY_VERSION = '0.20.8';

function matchingCompetitionReceipt(task, business = {}) {
  if (task.kind !== 'competition_research_check' || task.status !== 'timed_out' || task.error?.code !== 'HEARTBEAT_LOST') return null;
  const start = Date.parse(task.startedAt), end = Date.parse(task.completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const candidates = (business.checks || []).filter(r => r.taskType === task.kind && String(r.studentId) === String(task.sourceId)
    && ['succeeded', 'unchanged', 'no_results'].includes(r.status) && r.inputFingerprint
    && task.idempotencyKey === `${task.kind}:${task.sourceId}:${r.inputFingerprint}:${new Date(start).getFullYear()}-${new Date(start).getMonth() + 1}`
    && Date.parse(r.checkedAt) >= start && Date.parse(r.checkedAt) <= end
    && (!r.executionId || r.executionId === task.executionId) && (!r.taskId || r.taskId === task.id));
  if (candidates.length !== 1) return null;
  const receipt = candidates[0];
  if (receipt.status !== 'no_results') {
    const versions = (business.competitionSets || []).filter(v => String(v.studentId) === String(task.sourceId)
      && v.inputFingerprint === receipt.inputFingerprint && (!receipt.versionId || v.id === receipt.versionId)
      && Array.isArray(v.sources) && v.sources.length && Array.isArray(v.candidates) && v.candidates.length);
    if (versions.length !== 1) return null;
  }
  return receipt;
}

function buildQueueRecovery({ tasks: originalTasks, students: originalStudents, projects: originalProjects, business = {}, validRoot = () => false, researchAvailable = false, now = new Date().toISOString() }) {
  const tasks = structuredClone(originalTasks), students = structuredClone(originalStudents), projects = structuredClone(originalProjects);
  const changes = [], skipped = [];
  const studentRows = Array.isArray(students) ? students : students.students;
  const projectRows = Array.isArray(projects) ? projects : projects.projects;
  const ownerFor = task => (task.sourceType === 'student' ? studentRows : projectRows).find(o => String(o.id) === String(task.sourceId));
  const eligibleOwner = (owner, type) => owner && !owner.archivedAt && !owner.archived && !['archived', 'cancelled', 'completed'].includes(owner.status)
    && (type !== 'student' || !studentAutomaticTasksPaused(owner)) && validRoot(owner, type);
  for (const task of tasks.tasks) {
    if (task.recovery?.version === RECOVERY_VERSION
      || (task.recovery?.version === '0.20.6' && task.recovery?.manualOnly
        && !['qclaw'].includes(String(task.executor || ''))
        && !['qclaw'].includes(String(task.requestedExecutor || ''))
        && !['qclaw'].includes(String(task.adapterId || '')))) continue;
    const receipt = matchingCompetitionReceipt(task, business[task.sourceId]);
    if (receipt) {
      const previous = { status: task.status, error: task.error, executionId: task.executionId };
      Object.assign(task, { status: 'succeeded', statusGroup: 'completed', error: null, autoRetry: false, nextRetryAt: '', updatedAt: now,
        result: { status: 'succeeded', summary: receipt.message, structuredOutput: { receipt }, validation: { valid: true, checkedAt: now, message: '本地已有唯一匹配的已校验研究回执。' } },
        recovery: { version: RECOVERY_VERSION, action: 'receipt_reconciled', previous, at: now } });
      changes.push({ type: 'receipt_reconciled', id: task.id, title: task.title, receiptId: receipt.id });
      continue;
    }
    if (recoverableResearchBlock(task)) {
      if (researchAvailable) {
        Object.assign(task, { status: 'pending', statusGroup: 'pending', error: null, updatedAt: now,
          recovery: { version: RECOVERY_VERSION, action: 'capability_recovered', at: now } });
        changes.push({ type: 'capability_recovered', id: task.id, title: task.title });
      } else skipped.push({ id: task.id, title: task.title, reason: '研究能力将由新版运行时重新检测，不离线伪造可用状态。' });
      continue;
    }
    const legacyQClawTask = ['executor', 'requestedExecutor', 'adapterId'].some((key) => String(task[key] || '') === 'qclaw');
    if (!legacyQClawTask) continue;
    if (!SAFE_STATES.has(task.status) || !ORDINARY.has(task.kind)) continue;
    const owner = ownerFor(task);
    if (!owner && task.sourceType === 'project' && ['pending', 'queued'].includes(task.status)
      && Number(task.attempt || 0) === 0 && !task.executionId && Number(task.count || 0) === 0) {
      const sameName = projectRows.filter((item) => String(item.name || '') === String(task.sourceName || ''));
      const hasCanonical = sameName.length === 1 && tasks.tasks.some((item) => item !== task && item.kind === task.kind
        && String(item.sourceId) === String(sameName[0].id) && String(item.sourceName || '') === String(task.sourceName || ''));
      if (hasCanonical) {
        task.__removeAfterRecovery = true;
        changes.push({ type: 'legacy_duplicate_archived', id: task.id, title: task.title, canonicalSourceId: sameName[0].id });
        continue;
      }
    }
    if (!eligibleOwner(owner, task.sourceType) || task.riskLevel === 'high' || task.approval?.required) {
      skipped.push({ id: task.id, title: task.title, reason: '对象不存在、已暂停/归档、路径不可用或需要高风险审批。' }); continue;
    }
    if (owner.agentTool === 'qclaw') {
      owner.agentTool = 'workbuddy';
      if (task.sourceType === 'student') owner.agentBindingMode = 'mainChat';
      changes.push({ type: 'binding_migrated', id: owner.id, sourceType: task.sourceType, previous: 'qclaw', next: 'workbuddy' });
    }
    const controlledProjectDigest = task.kind === 'project_digest' && owner.materialStorageMode === 'workspace-v1';
    if (owner.agentTool !== 'workbuddy' && !controlledProjectDigest) {
      skipped.push({ id: task.id, title: task.title, reason: '保留当前非 WorkBuddy 明确绑定，不自动重新执行。' }); continue;
    }
    if (controlledProjectDigest) {
      const previous = { status: task.status, executor: task.executor, requestedExecutor: task.requestedExecutor, adapterId: task.adapterId, executionId: task.executionId, error: task.error };
      const hasPendingWork = Number(task.count || owner.digestState?.pendingCount || 0) > 0;
      const nextStatus = hasPendingWork && ['failed', 'timed_out', 'blocked'].includes(task.status) ? 'pending' : task.status;
      Object.assign(task, {
        status: nextStatus,
        statusGroup: nextStatus === 'queued' ? 'scheduled' : 'actionable',
        executor: 'codex',
        requestedExecutor: 'codex',
        adapterId: '',
        executionId: '',
        executionMode: 'adapter',
        routeAttempts: [],
        routeDecision: null,
        error: nextStatus === 'pending' ? null : task.error,
        result: nextStatus === 'pending' ? null : task.result,
        startedAt: '',
        completedAt: '',
        lastHeartbeatAt: '',
        nextRetryAt: '',
        autoRetry: false,
        automaticExecution: false,
        updatedAt: now,
        recovery: { version: RECOVERY_VERSION, action: 'controlled_executor_migrated', manualOnly: true, previous, at: now },
      });
      changes.push({ type: 'controlled_executor_migrated', id: task.id, title: task.title, status: nextStatus, next: 'codex' });
      continue;
    }
    const previous = { status: task.status, executor: task.executor, adapterId: task.adapterId, executionId: task.executionId, error: task.error };
    Object.assign(task, { status: 'pending', statusGroup: 'pending', executor: 'workbuddy', requestedExecutor: 'workbuddy', adapterId: '', executionId: '',
      executionMode: 'adapter', attempt: 0, routeAttempts: [], routeDecision: null, error: null, result: null,
      startedAt: '', completedAt: '', lastHeartbeatAt: '', nextRetryAt: '', autoRetry: false, automaticExecution: false, updatedAt: now,
      recovery: { version: RECOVERY_VERSION, action: 'prepared_once', manualOnly: true, previous, at: now } });
    changes.push({ type: 'prepared_once', id: task.id, title: task.title });
  }
  tasks.tasks = tasks.tasks.filter((task) => !task.__removeAfterRecovery);
  if (changes.length) {
    tasks.updatedAt = now;
    tasks.history = [...changes.filter(c => c.type !== 'binding_migrated').map(c => ({ id: `recovery-${RECOVERY_VERSION}-${c.id}`, taskId: c.id, at: now, type: c.type, status: tasks.tasks.find(t => t.id === c.id)?.status })), ...(tasks.history || [])];
  }
  return { tasks, students, projects, changes, skipped };
}

module.exports = { RECOVERY_VERSION, matchingCompetitionReceipt, buildQueueRecovery };
