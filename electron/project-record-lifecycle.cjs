const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA = 'edu-manager.project-record-operation.v1';
const ROOT_NAME = 'project-record-operations';
const JOURNAL_NAME = 'journal.json';
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const key = (file) => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);

function hashTarget(file) {
  if (!fs.existsSync(file)) return null;
  if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) throw new Error(`项目记录目标不是普通文件：${file}`);
  return sha256(fs.readFileSync(file));
}

function writeAtomic(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, bytes, { flag: 'wx' });
    const descriptor = fs.openSync(temporary, 'r+');
    try {
      try { fs.fsyncSync(descriptor); }
      catch (error) {
        if (process.platform !== 'win32' || !['EPERM', 'EINVAL', 'ENOTSUP'].includes(error.code)) throw error;
      }
    } finally { fs.closeSync(descriptor); }
    fs.renameSync(temporary, file);
  } finally { if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true }); }
}

function journalFile(userDataDir, id) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error('项目记录操作ID无效。');
  return path.join(path.resolve(userDataDir), ROOT_NAME, id, JOURNAL_NAME);
}

function readJournal(file, userDataDir) {
  const journal = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (journal.schema !== SCHEMA || !['prepared', 'files_written', 'committed'].includes(journal.phase)
    || key(file) !== key(journalFile(userDataDir, journal.id))
    || !['remove', 'restore'].includes(journal.operation) || !journal.projectId
    || !Array.isArray(journal.entries) || !journal.entries.length || journal.entries.length > 8
    || !Array.isArray(journal.affectedStudentIds)) throw new Error('项目记录操作日志不可信。');
  const root = path.dirname(file), seen = new Set();
  for (let index = 0; index < journal.entries.length; index++) {
    const entry = journal.entries[index];
    if (!path.isAbsolute(entry.target) || key(entry.target) === key(path.parse(entry.target).root)
      || seen.has(key(entry.target)) || !/^[a-f0-9]{64}$/.test(entry.afterHash)
      || (entry.beforeHash !== null && !/^[a-f0-9]{64}$/.test(entry.beforeHash))
      || entry.beforeFile !== (entry.beforeHash ? `${index}.before` : '')
      || entry.afterFile !== `${index}.after`) throw new Error('项目记录操作目标不可信。');
    seen.add(key(entry.target));
    const after = path.join(root, entry.afterFile);
    if (!fs.existsSync(after) || hashTarget(after) !== entry.afterHash) throw new Error('项目记录候选文件缺失或损坏。');
    if (entry.beforeHash) {
      const before = path.join(root, entry.beforeFile);
      if (!fs.existsSync(before) || hashTarget(before) !== entry.beforeHash) throw new Error('项目记录原文件备份缺失或损坏。');
    }
  }
  return journal;
}

function prepareProjectRecordOperation({ userDataDir, operation, projectId, entries, affectedStudentIds = [] }) {
  if (!['remove', 'restore'].includes(operation) || !projectId || !Array.isArray(entries)
    || !entries.length || entries.length > 8) throw new Error('项目记录操作范围无效。');
  const id = crypto.randomUUID();
  const file = journalFile(userDataDir, id);
  const root = path.dirname(file);
  fs.mkdirSync(path.dirname(root), { recursive: true });
  fs.mkdirSync(root);
  const seen = new Set(), stored = [];
  for (let index = 0; index < entries.length; index++) {
    const input = entries[index];
    const target = path.resolve(input.target);
    if (!path.isAbsolute(input.target) || key(target) === key(path.parse(target).root) || seen.has(key(target))) throw new Error('项目记录目标路径无效或重复。');
    seen.add(key(target));
    const beforeHash = hashTarget(target);
    const beforeFile = beforeHash ? `${index}.before` : '';
    if (beforeFile) writeAtomic(path.join(root, beforeFile), fs.readFileSync(target));
    const afterFile = `${index}.after`;
    const afterBytes = Buffer.isBuffer(input.after) ? input.after : Buffer.from(String(input.after), 'utf8');
    writeAtomic(path.join(root, afterFile), afterBytes);
    stored.push({ target, beforeHash, beforeFile, afterHash: sha256(afterBytes), afterFile });
  }
  writeAtomic(file, Buffer.from(`${JSON.stringify({ schema: SCHEMA, phase: 'prepared', id, operation,
    projectId: String(projectId), affectedStudentIds: affectedStudentIds.map(String), entries: stored }, null, 2)}\n`));
  return file;
}

function applyProjectRecordOperation(file, userDataDir, onCommitted = () => {}) {
  let journal = readJournal(file, userDataDir);
  if (journal.phase === 'committed') return { committed: true, changed: false, journal };
  // Preflight every target before modifying the first one. Existing files may
  // be either the original or the exact staged result after a process exit.
  for (const entry of journal.entries) {
    const current = hashTarget(entry.target);
    if (current !== entry.beforeHash && current !== entry.afterHash) throw new Error(`项目记录目标已被其他操作修改：${entry.target}`);
  }
  for (const entry of journal.entries) {
    const current = hashTarget(entry.target);
    if (current === entry.afterHash) continue;
    if (current !== entry.beforeHash) throw new Error(`项目记录目标在安装期间发生变化：${entry.target}`);
    writeAtomic(entry.target, fs.readFileSync(path.join(path.dirname(file), entry.afterFile)));
  }
  if (journal.phase !== 'files_written') {
    journal = { ...journal, phase: 'files_written' };
    writeAtomic(file, Buffer.from(`${JSON.stringify(journal, null, 2)}\n`));
  }
  onCommitted(journal);
  journal = { ...journal, phase: 'committed' };
  writeAtomic(file, Buffer.from(`${JSON.stringify(journal, null, 2)}\n`));
  return { committed: true, changed: true, journal };
}

function recoverProjectRecordOperations(userDataDir, onCommitted = () => {}) {
  const root = path.join(path.resolve(userDataDir), ROOT_NAME);
  if (!fs.existsSync(root)) return { ready: true, recovered: [], issues: [] };
  let directories;
  try {
    if (!fs.lstatSync(root).isDirectory() || fs.lstatSync(root).isSymbolicLink()) throw new Error('项目记录操作目录不是普通目录。');
    directories = fs.readdirSync(root, { withFileTypes: true });
  } catch (error) { return { ready: false, recovered: [], issues: [{ journalPath: root, message: error.message }] }; }
  const recovered = [], issues = [];
  for (const entry of directories) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) { issues.push({ journalPath: path.join(root, entry.name), message: '项目记录操作目录包含异常条目。' }); continue; }
    const file = path.join(root, entry.name, JOURNAL_NAME);
    if (!fs.existsSync(file)) continue; // Preparation did not reach its first durable mutation.
    try {
      const result = applyProjectRecordOperation(file, userDataDir, onCommitted);
      if (result.changed) recovered.push({ id: result.journal.id, operation: result.journal.operation,
        projectId: result.journal.projectId });
    } catch (error) { issues.push({ journalPath: file, message: error.message }); }
  }
  return { ready: issues.length === 0, recovered, issues };
}

module.exports = { prepareProjectRecordOperation, applyProjectRecordOperation, recoverProjectRecordOperations };
