'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { findUnresolvedDispatchConflict } = require('../electron/task-dispatch-conflict.cjs');
const { taskExecutionUnresolved } = require('../electron/task-recovery-policy.cjs');
const { recoveryBudget, recoveryPlan, executionProvenance } = require('../electron/task-recovery-experience.cjs');
const { productFirewallRuleSpecs, summarizeFirewallInspection } = require('../electron/windows-firewall.cjs');

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function readTasksReadOnly(file) {
  if (/\.sqlite3?$|\.db$/i.test(file)) {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      return db.prepare('SELECT payload_json FROM tasks ORDER BY task_id').all()
        .map((row) => JSON.parse(String(row.payload_json || '{}')));
    } finally {
      db.close();
    }
  }
  const value = readJson(file);
  return Array.isArray(value) ? value : Array.isArray(value?.tasks) ? value.tasks : [];
}

function scheduledTime(task) {
  const parsed = Date.parse(task.scheduledAt || task.nextRetryAt || task.resourceRetryAt || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function dispatchDecision(task, tasks, nowMs) {
  if (taskExecutionUnresolved(task)) return { dispatchable: false, reasonCode: 'execution_unknown_self',
    message: '该任务自身的外部执行结果仍未知；只能核对原执行，禁止重新派发。' };
  if (!['pending', 'approved', 'queued'].includes(String(task.status || ''))) {
    return { dispatchable: false, reasonCode: 'status_not_runnable', message: `状态 ${String(task.status || '')} 不在待调度集合。` };
  }
  if (task.automationSuspended === true) return { dispatchable: false, reasonCode: 'automation_suspended',
    message: '学生或项目自动化已暂停。' };
  if (task.manualOnly === true || (task.automaticExecution !== true && task.trigger === 'manual')) {
    return { dispatchable: false, reasonCode: 'manual_only', message: '任务明确要求人工执行。' };
  }
  const due = scheduledTime(task);
  if (due > nowMs) return { dispatchable: false, reasonCode: 'not_due', message: `尚未到执行时间 ${task.scheduledAt || task.nextRetryAt}。` };
  const conflict = findUnresolvedDispatchConflict(task, tasks, { now: nowMs });
  if (conflict) return { dispatchable: false, ...conflict,
    message: `仅因同一工作、批次或执行标识的未知结果 ${conflict.blockerTaskId} 阻断。` };
  return { dispatchable: true, reasonCode: 'exact_conflict_clear',
    message: '不存在相同工作键、批次或执行标识的未知结果；其他任务不会造成宽泛阻断。' };
}

function missingRecoveryMetadata(task, now) {
  if (!taskExecutionUnresolved(task)) return [];
  const missing = [];
  if (!task.executionProvenance || typeof task.executionProvenance !== 'object') missing.push('executionProvenance');
  if (!task.recoveryBudget || typeof task.recoveryBudget !== 'object') missing.push('recoveryBudget');
  if (!task.recoveryPlan || typeof task.recoveryPlan !== 'object') missing.push('recoveryPlan');
  if (!missing.length) return [];
  return [{ taskId: String(task.id || ''), missing,
    proposed: { executionProvenance: executionProvenance(task), recoveryBudget: recoveryBudget(task, now), recoveryPlan: recoveryPlan(task, now) } }];
}

async function previewRuntimeRepair(options = {}) {
  const taskStorePath = path.resolve(String(options.taskStorePath || ''));
  const materialsPath = path.resolve(String(options.materialsPath || ''));
  const firewallInspectionPath = path.resolve(String(options.firewallInspectionPath || ''));
  for (const file of [taskStorePath, materialsPath, firewallInspectionPath]) {
    if (!file || !fs.existsSync(file)) throw new Error(`preview_source_missing:${file}`);
  }
  const sourcePaths = { taskStorePath, materialsPath, firewallInspectionPath };
  const before = Object.fromEntries(Object.entries(sourcePaths).map(([key, file]) => [key.replace(/Path$/, 'Sha256'), sha256File(file)]));
  const now = String(options.now || new Date().toISOString());
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error('invalid_preview_time');
  const tasks = readTasksReadOnly(taskStorePath);
  const newlyDispatchable = [];
  const blocked = [];
  const wouldGainRecoveryMetadata = [];
  const wouldRedispatchUnknown = [];
  for (const task of tasks) {
    wouldGainRecoveryMetadata.push(...missingRecoveryMetadata(task, now));
    const decision = dispatchDecision(task, tasks, nowMs);
    const entry = { taskId: String(task.id || ''), workKey: String(task.workKey || ''), sourceType: String(task.sourceType || ''),
      sourceId: String(task.sourceId || ''), ...decision };
    if (decision.dispatchable) {
      newlyDispatchable.push(entry);
      if (taskExecutionUnresolved(task)) wouldRedispatchUnknown.push(entry);
    } else {
      blocked.push(entry);
    }
  }
  const rawFirewall = readJson(firewallInspectionPath);
  const firewallSpecs = productFirewallRuleSpecs({ tcpPort: Number(options.tcpPort || 18777),
    discoveryPort: Number(options.discoveryPort || 18778) });
  const firewallSummary = summarizeFirewallInspection(rawFirewall, firewallSpecs);
  const after = Object.fromEntries(Object.entries(sourcePaths).map(([key, file]) => [key.replace(/Path$/, 'Sha256'), sha256File(file)]));
  const readOnlyVerified = Object.keys(before).every((key) => before[key] === after[key]);
  return {
    schema: 'edu-manager.p0-runtime-repair-preview.v1', generatedAt: new Date().toISOString(), evaluatedAt: now,
    sourcePaths, sourceHashes: { before, after }, readOnlyVerified,
    counts: { tasks: tasks.length, materialsBytes: fs.statSync(materialsPath).size,
      wouldGainRecoveryMetadata: wouldGainRecoveryMetadata.length, newlyDispatchable: newlyDispatchable.length,
      blocked: blocked.length, wouldRedispatchUnknown: wouldRedispatchUnknown.length },
    wouldGainRecoveryMetadata, newlyDispatchable, blocked, wouldRedispatchUnknown,
    firewall: { ...firewallSummary,
      requiresUserAuthorizedRepair: firewallSummary.applicableRuleCount !== firewallSpecs.length,
      repairMode: 'explicit_user_uac_only', phoneAccepted: false },
  };
}

function argumentsMap(argv) {
  return new Map(argv.map((entry) => {
    const separator = entry.indexOf('=');
    return separator < 0 ? [entry.replace(/^--/, ''), true]
      : [entry.slice(0, separator).replace(/^--/, ''), entry.slice(separator + 1)];
  }));
}

async function main() {
  const args = argumentsMap(process.argv.slice(2));
  const output = path.resolve(String(args.get('output') || 'artifacts/p0-runtime-repair-preview.json'));
  const report = await previewRuntimeRepair({ taskStorePath: args.get('task-store'), materialsPath: args.get('materials'),
    firewallInspectionPath: args.get('firewall'), now: args.get('now'), tcpPort: Number(args.get('tcp-port') || 18777),
    discoveryPort: Number(args.get('discovery-port') || 18778) });
  await fsp.mkdir(path.dirname(output), { recursive: true });
  await fsp.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ output, readOnlyVerified: report.readOnlyVerified, counts: report.counts }, null, 2)}\n`);
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });

module.exports = { dispatchDecision, previewRuntimeRepair, readTasksReadOnly };
