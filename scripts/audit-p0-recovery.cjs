// Read-only deployment preflight. Does not write a ledger or start a task.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { queueGovernanceCandidates } = require('../electron/task-governance-policy.cjs');
const { repairTaskRuntimeStore } = require('../electron/task-runtime-policy.cjs');
const { taskExecutionUnresolved } = require('../electron/task-recovery-policy.cjs');
const { detectedWindowsPaths } = require('../electron/rule-path-health.cjs');
const [taskFile, userData, studentRoot, originalAgent] = process.argv.slice(2);
if (![taskFile, userData, studentRoot, originalAgent].every(value => value && path.isAbsolute(value))) throw Error('Four explicit absolute paths are required');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const ledger = read(taskFile), projectFile = path.join(userData, 'projects.json'), projects = read(projectFile);
const inbox = path.join(userData, 'smart-inbox/items');
const inboxItems = fs.readdirSync(inbox).filter(name => name.endsWith('.json')).map(name => read(path.join(inbox, name)));
const proof = queueGovernanceCandidates(ledger, { projects: projects.projects || projects, inboxItems,
  hasExecutionArtifacts: task => fs.existsSync(path.join(path.dirname(taskFile), 'executions', task.id))
    || Boolean(task.input?.manifestPath && fs.existsSync(task.input.manifestPath))
    || Boolean(task.expectedOutput?.path && fs.existsSync(task.expectedOutput.path)) });
const clone = structuredClone(ledger);
const repair = repairTaskRuntimeStore(clone);
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const agent = path.join(studentRoot, 'AGENT.md');
const rules = ['AGENT.md', 'AGENTS.md'].map(name => {
  const file = path.join(studentRoot, name);
  const paths = detectedWindowsPaths(fs.readFileSync(file, 'utf8'));
  return { name, sha256: hash(file), paths: paths.length, missingPaths: paths.filter(item => !fs.existsSync(item.detectedPath)).map(item => item.detectedPath) };
});
const counts = {};
for (const task of ledger.tasks) counts[task.status] = (counts[task.status] || 0) + 1;
console.log(JSON.stringify({ auditedAt: new Date().toISOString(), readOnly: true, taskFile, snapshotAt: ledger.updatedAt,
  hashes: { ledger: hash(taskFile), projects: hash(projectFile), originalAgent: hash(originalAgent) }, total: ledger.tasks.length, counts,
  originalTextRestored: fs.readFileSync(agent, 'utf8').replace(/\r\n/g, '\n') === fs.readFileSync(originalAgent, 'utf8').replace(/\r\n/g, '\n'), rules,
  governanceCandidates: proof.candidates.map(({ task, reason }) => ({ id: task.id, reason })), skipped: proof.skipped,
  runtimeRepairPreview: repair.repairs,
  protectedUnresolved: ledger.tasks.filter(taskExecutionUnresolved).map(task => ({ id: task.id, executionId: task.executionId, status: task.status })),
  noDispatchPerformed: true, ledgerWritten: false }, null, 2));
