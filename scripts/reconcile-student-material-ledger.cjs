const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { mergeMaterialFromUpload, reconcileCompletedMaterialRevisions } = require('../electron/material-ledger-reconciliation.cjs');

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? String(process.argv[index + 1] || '') : '';
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJsonAtomic(file, value) {
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, file);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

const studentRootArg = argument('student-root');
const studentId = argument('student-id');
const userDataArg = argument('user-data');
const taskCenterArg = argument('task-center');
const apply = process.argv.includes('--apply');
if (!studentRootArg || !studentId || !userDataArg || !taskCenterArg) {
  console.error('Usage: node scripts/reconcile-student-material-ledger.cjs --student-root <path> --student-id <id> --user-data <path> --task-center <path> [--apply]');
  process.exit(2);
}

const studentRoot = path.resolve(studentRootArg);
const userData = path.resolve(userDataArg);
const taskCenter = path.resolve(taskCenterArg);

const managerDir = path.join(studentRoot, '.edu-manager');
const materialsPath = path.join(managerDir, 'materials.json');
const digestStatePath = path.join(managerDir, 'digest-state.json');
const issuesPath = path.join(managerDir, 'material-path-issues.json');
const uploadsPath = path.join(userData, 'upload-records.json');
const tasksPath = path.join(taskCenter, 'tasks.json');
const eventsPath = path.join(taskCenter, 'events.jsonl');
const materialsDocument = readJson(materialsPath, { materials: [] });
const uploadsDocument = readJson(uploadsPath, { records: [] });
const uploads = Array.isArray(uploadsDocument.records) ? uploadsDocument.records : [];
const uploadsById = new Map(uploads.filter((record) => String(record.studentId || '') === studentId).map((record) => [String(record.id || ''), record]));
const mergedMaterials = (materialsDocument.materials || []).map((material) => {
  const upload = uploadsById.get(String(material.id || ''));
  if (!upload) return material;
  return mergeMaterialFromUpload(material, {
    ...upload,
    fileName: upload.filename || material.fileName,
    path: material.path || upload.path,
    absolutePath: material.absolutePath || upload.path,
  });
});
const reconciliation = reconcileCompletedMaterialRevisions(mergedMaterials, uploads);
const openStatuses = new Set(['pending_digest', 'submitted', 'digesting']);
const studentMaterials = reconciliation.materials.filter((item) => String(item.studentId || studentId) === studentId);
const openCount = studentMaterials.filter((item) => openStatuses.has(String(item.status || ''))).length;
const report = {
  ok: true,
  apply,
  studentId,
  reconciledCount: reconciliation.reconciled.length,
  reconciled: reconciliation.reconciled,
  openCount,
};

if (!apply || !reconciliation.reconciled.length) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(0);
}

const backupDir = path.join(managerDir, 'migration-backups', `material-reconciliation-${timestamp()}`);
fs.mkdirSync(backupDir, { recursive: true });
for (const file of [materialsPath, digestStatePath, issuesPath, uploadsPath, tasksPath, eventsPath]) {
  if (fs.existsSync(file)) fs.copyFileSync(file, path.join(backupDir, path.basename(file)));
}

writeJsonAtomic(materialsPath, {
  ...materialsDocument,
  updatedAt: new Date().toISOString(),
  materials: reconciliation.materials,
});
writeJsonAtomic(uploadsPath, { ...uploadsDocument, records: reconciliation.uploadRecords });

const now = new Date().toISOString();
const digestState = readJson(digestStatePath, {});
const pendingCount = studentMaterials.filter((item) => String(item.status || '') === 'pending_digest').length;
const submittedCount = studentMaterials.filter((item) => ['submitted', 'digesting'].includes(String(item.status || ''))).length;
const processedCount = studentMaterials.filter((item) => String(item.status || '') === 'processed').length;
writeJsonAtomic(digestStatePath, {
  ...digestState,
  status: submittedCount ? 'digesting' : pendingCount ? 'pending' : digestState.lastDigestAt ? 'completed' : 'idle',
  message: `已自动结算 ${reconciliation.reconciled.length} 条被最终修订覆盖的旧资料记录。${pendingCount ? `仍有 ${pendingCount} 份资料待处理。` : '当前没有重复待处理资料。'}`,
  pendingCount,
  submittedCount,
  processedCount,
  updatedAt: now,
  materialRevisionReconciliation: { count: reconciliation.reconciled.length, reconciledAt: now, items: reconciliation.reconciled },
  materialPreflight: { checkedAt: now, totalCount: pendingCount, readyCount: pendingCount, selectedCount: 0, repairedCount: 0, blockedCount: 0, retryableCount: 0, deferredCount: 0, issuePath: issuesPath, issues: [] },
});
writeJsonAtomic(issuesPath, {
  version: 1,
  studentId,
  checkedAt: now,
  totalCount: pendingCount,
  readyCount: pendingCount,
  selectedCount: 0,
  repairedCount: 0,
  blockedCount: 0,
  retryableCount: 0,
  deferredCount: 0,
  issues: [],
});

const taskStore = readJson(tasksPath, { tasks: [], history: [] });
const retired = (taskStore.tasks || []).filter((task) => task.kind === 'student_digest' && String(task.sourceId || '') === studentId && ['queued', 'pending', 'approved', 'blocked'].includes(String(task.status || '')));
if (openCount === 0 && retired.length) {
  const retiredIds = new Set(retired.map((task) => String(task.id || '')));
  taskStore.tasks = taskStore.tasks.filter((task) => !retiredIds.has(String(task.id || '')));
  taskStore.history = [
    ...retired.map((task) => ({
      id: `history-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      taskId: task.id,
      executionId: task.executionId || '',
      kind: task.kind,
      title: task.title,
      sourceType: task.sourceType,
      sourceId: task.sourceId,
      sourceName: task.sourceName,
      executor: task.executor,
      status: 'archived',
      at: now,
      detail: '旧屏幕会话记录已由完成修订安全结算，重复待处理任务已归档。',
    })),
    ...(taskStore.history || []),
  ];
  taskStore.updatedAt = now;
  writeJsonAtomic(tasksPath, taskStore);
  fs.appendFileSync(eventsPath, `${retired.map((task) => JSON.stringify({
    id: `event-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    taskId: task.id,
    executionId: task.executionId || '',
    type: 'material_revision_task_reconciled',
    at: now,
    detail: { reconciledCount: reconciliation.reconciled.length, reason: 'completed_revision_superseded_pending_record' },
  })).join('\n')}\n`, 'utf8');
}

report.backupDir = backupDir;
report.retiredTaskCount = openCount === 0 ? retired.length : 0;
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
