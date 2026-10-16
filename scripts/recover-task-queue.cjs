// Offline, explicit migration. Preview is default; never writes while the host app runs.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { buildQueueRecovery } = require('../electron/queue-recovery.cjs');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function assertHostStopped() {
  if (process.platform !== 'win32') throw new Error('此恢复工具只用于 Windows 本机。');
  const checked = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "@(Get-Process -Name 'AI Education Manager Console' -ErrorAction SilentlyContinue).Count"], { encoding: 'utf8', windowsHide: true });
  if (checked.status !== 0 || !/^0\s*$/.test(checked.stdout)) throw new Error('请先退出教育管家（包括托盘），避免并发覆盖。');
}
function atomic(file, bytes) {
  const temporary = `${file}.recovery-${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, bytes, { flag: 'wx' });
  fs.renameSync(temporary, file);
}
function applyFiles(entries, backupRoot, guard = assertHostStopped) {
  guard();
  for (const e of entries) if (hash(fs.readFileSync(e.file)) !== e.beforeHash) throw new Error(`预览后文件已变化：${e.file}`);
  fs.mkdirSync(backupRoot, { recursive: false });
  const journal = { schema: 'edu-manager.queue-recovery.v1', status: 'prepared', createdAt: new Date().toISOString(), entries: [] };
  for (const [index, e] of entries.entries()) {
    const backup = path.join(backupRoot, `${index}.before`);
    fs.copyFileSync(e.file, backup);
    journal.entries.push({ file: e.file, backup, beforeHash: e.beforeHash, afterHash: hash(e.after) });
  }
  const journalFile = path.join(backupRoot, 'journal.json');
  fs.writeFileSync(journalFile, JSON.stringify(journal, null, 2));
  for (const e of entries) {
    guard();
    if (hash(fs.readFileSync(e.file)) !== e.beforeHash) throw new Error(`写入前检测到并发修改：${e.file}；已保留恢复日志。`);
    atomic(e.file, e.after);
  }
  journal.status = 'applied'; atomic(journalFile, JSON.stringify(journal, null, 2));
  return journal;
}
function rollback(journalFile, guard = assertHostStopped) {
  guard();
  const root = fs.realpathSync(path.dirname(journalFile));
  const journal = JSON.parse(fs.readFileSync(journalFile, 'utf8'));
  if (journal.schema !== 'edu-manager.queue-recovery.v1') throw new Error('未知恢复日志。');
  // Validate every target first, so a conflict cannot cause a partial rollback.
  for (const e of journal.entries) {
    if (path.dirname(fs.realpathSync(e.backup)) !== root || hash(fs.readFileSync(e.backup)) !== e.beforeHash) throw new Error('备份校验失败。');
    if (![e.beforeHash, e.afterHash].includes(hash(fs.readFileSync(e.file)))) throw new Error(`目标含迁移后的新变化，不可自动回滚：${e.file}`);
  }
  for (const e of journal.entries) {
    guard();
    const currentHash = hash(fs.readFileSync(e.file));
    if (![e.beforeHash, e.afterHash].includes(currentHash)) throw new Error('回滚期间检测到并发修改。');
    if (currentHash !== e.beforeHash) atomic(e.file, fs.readFileSync(e.backup));
  }
  journal.status = 'rolled_back'; atomic(journalFile, JSON.stringify(journal, null, 2));
}

function main(args) {
  const value = key => args[args.indexOf(key) + 1];
  if (args.includes('--rollback')) { rollback(path.resolve(value('--rollback'))); console.log('回滚完成。'); return; }
  if (!args.includes('--user-data')) throw new Error('必须明确提供 --user-data 目录。');
  const userData = fs.realpathSync(value('--user-data'));
  const settings = JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'));
  const taskRoot = fs.realpathSync(path.join(settings.studentBaseDir, '.edu-manager/task-center'));
  const files = ['tasks.json', 'students.json', 'projects.json'].map((name, i) => path.join(i ? userData : taskRoot, name));
  const before = files.map(f => fs.readFileSync(f));
  const [tasks, students, projects] = before.map(b => JSON.parse(b));
  const business = {};
  for (const student of Array.isArray(students) ? students : students.students) {
    if (!student.rootPath) continue;
    const file = path.join(student.rootPath, '.ai-manager/planning-guidance/store.json');
    if (fs.existsSync(file)) business[student.id] = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  const plan = buildQueueRecovery({ tasks, students, projects, business, validRoot: (owner, type) => {
    const root = type === 'student' ? owner.rootPath : owner.knowledgeRootPath;
    return Boolean(root && path.isAbsolute(root) && fs.existsSync(root) && fs.statSync(root).isDirectory());
  } });
  console.log(JSON.stringify({ mode: args.includes('--apply') ? 'apply' : 'preview', changes: plan.changes, skipped: plan.skipped }, null, 2));
  if (!args.includes('--apply') || !plan.changes.length) return;
  const entries = [plan.tasks, plan.students, plan.projects].flatMap((data, i) => {
    const after = Buffer.from(JSON.stringify(data, null, 2) + '\n');
    return JSON.stringify(JSON.parse(before[i])) === JSON.stringify(data) ? [] : [{ file: files[i], beforeHash: hash(before[i]), after }];
  });
  const eventsFile = path.join(taskRoot, 'events.jsonl'), eventsBefore = fs.readFileSync(eventsFile);
  const audit = plan.changes.map(c => JSON.stringify({ id: `recovery-${crypto.randomUUID()}`, taskId: c.id, type: 'queue_recovery_0208', at: new Date().toISOString(), detail: c })).join('\n');
  entries.push({ file: eventsFile, beforeHash: hash(eventsBefore), after: Buffer.concat([eventsBefore, Buffer.from('\n' + audit + '\n')]) });
  const backup = path.join(taskRoot, `recovery-0.20.8-${Date.now()}`);
  const journal = applyFiles(entries, backup);
  fs.writeFileSync(path.join(backup, 'summary.json'), JSON.stringify({ changes: plan.changes, skipped: plan.skipped }, null, 2));
  console.log(JSON.stringify({ backup, status: journal.status }));
}
if (require.main === module) { try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { applyFiles, rollback, hash };
