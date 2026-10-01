const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA = 'edu-manager.migration-state-install.v1';
const JOURNAL = 'state-install.json';

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function samePath(left, right) {
  const a = path.resolve(left), b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function inside(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) throw new Error('迁移状态相对路径无效。');
  const parts = relative.replace(/\\/g, '/').split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || part.includes('\0'))) throw new Error('迁移状态相对路径无效。');
  const result = path.resolve(root, ...parts);
  const remainder = path.relative(path.resolve(root), result);
  if (!remainder || remainder.startsWith('..') || path.isAbsolute(remainder)) throw new Error('迁移状态目标越界。');
  return result;
}

function writeJournal(file, value) {
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  const descriptor = fs.openSync(temporary, 'r+');
  try {
    try { fs.fsyncSync(descriptor); }
    catch (error) {
      // Some Windows filesystems reject fsync even on a writable descriptor.
      // The atomic rename still protects against a worker-process interruption.
      if (process.platform !== 'win32' || !['EPERM', 'EINVAL', 'ENOTSUP'].includes(error.code)) throw error;
    }
  } finally { fs.closeSync(descriptor); }
  fs.renameSync(temporary, file);
}

function stagedFiles(root) {
  const result = [], queue = [''];
  while (queue.length) {
    const relativeDir = queue.shift();
    const directory = relativeDir ? inside(root, relativeDir) : root;
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = relativeDir ? `${relativeDir}/${item.name}` : item.name;
      if (item.isSymbolicLink()) throw new Error('迁移状态暂存目录含链接。');
      if (item.isDirectory()) queue.push(relative);
      else if (item.isFile()) result.push(relative);
      else throw new Error('迁移状态暂存目录含不支持的条目。');
    }
  }
  return result.sort();
}

function validateJournal(file, expectedUserDataDir) {
  const rollbackRoot = path.dirname(file);
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (state.schema !== SCHEMA || !['pending', 'committed', 'rolled_back'].includes(state.status)
    || !state.migrationId || !/^[a-z0-9_-]+$/i.test(state.migrationId)
    || !samePath(rollbackRoot, path.join(expectedUserDataDir, 'migration-rollbacks', state.migrationId))
    || !samePath(state.userDataDir, expectedUserDataDir)
    || !path.isAbsolute(state.targetRoot) || samePath(state.targetRoot, path.parse(state.targetRoot).root)
    || !samePath(state.recoveryPath, `${state.targetRoot}.migration-unactivated-${state.migrationId}`)
    || state.markerRelativePath !== `.edu-manager/migration-activation-${state.migrationId}.json`
    || !/^[a-f0-9]{32}$/i.test(state.activationNonce)
    || !Array.isArray(state.entries)) throw new Error('迁移状态安装记录不可信。');
  const identities = new Set();
  for (const entry of state.entries) {
    const target = inside(expectedUserDataDir, entry.relativePath);
    const backup = inside(path.join(rollbackRoot, 'originals'), entry.relativePath);
    if (!samePath(target, entry.target) || !samePath(backup, entry.backup)
      || !/^[a-f0-9]{64}$/i.test(entry.candidateHash)
      || (entry.existed && !/^[a-f0-9]{64}$/i.test(entry.originalHash))
      || (!entry.existed && entry.originalHash !== null)) throw new Error('迁移状态安装条目不可信。');
    const identity = process.platform === 'win32' ? target.toLowerCase() : target;
    if (identities.has(identity)) throw new Error('迁移状态安装目标重复。');
    identities.add(identity);
  }
  return state;
}

function prepareMigrationStateInstall({ stateStage, managedStage, userDataDir, rollbackRoot, targetRoot, migrationId }) {
  const id = String(migrationId);
  if (!/^[a-z0-9_-]+$/i.test(id)
    || !samePath(rollbackRoot, path.join(userDataDir, 'migration-rollbacks', id))
    || fs.existsSync(rollbackRoot)
    || fs.existsSync(`${path.resolve(targetRoot)}.migration-unactivated-${id}`)) throw new Error('迁移状态回滚记录或待核对目录已存在，请先核对旧恢复。');
  const files = stagedFiles(stateStage);
  const entries = [];
  const activationNonce = crypto.randomBytes(16).toString('hex');
  const markerRelativePath = `.edu-manager/migration-activation-${id}.json`;
  const marker = inside(managedStage, markerRelativePath);
  if (fs.existsSync(marker)) throw new Error('迁移原文暂存目录已有同名启用标记。');
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  writeJournal(marker, { migrationId: id, activationNonce });
  fs.mkdirSync(path.join(rollbackRoot, 'originals'), { recursive: true });
  for (const relativePath of files) {
    const source = inside(stateStage, relativePath);
    const target = inside(userDataDir, relativePath);
    const backup = inside(path.join(rollbackRoot, 'originals'), relativePath);
    const existed = fs.existsSync(target);
    if (existed && (!fs.lstatSync(target).isFile() || fs.lstatSync(target).isSymbolicLink())) throw new Error(`迁移状态目标不是普通文件：${relativePath}`);
    let originalHash = null;
    if (existed) {
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.copyFileSync(target, backup);
      originalHash = hashFile(backup);
      if (hashFile(target) !== originalHash) throw new Error(`迁移状态原文件在备份时发生变化：${relativePath}`);
    }
    entries.push({ relativePath, target, backup, existed, originalHash, candidateHash: hashFile(source) });
  }
  const journalPath = path.join(rollbackRoot, JOURNAL);
  writeJournal(journalPath, {
    schema: SCHEMA, status: 'pending', migrationId: id, userDataDir: path.resolve(userDataDir),
    targetRoot: path.resolve(targetRoot), recoveryPath: `${path.resolve(targetRoot)}.migration-unactivated-${id}`,
    markerRelativePath, activationNonce, entries,
  });
  return journalPath;
}

function replaceFrom(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.migration`;
  try { fs.copyFileSync(source, temporary); fs.renameSync(temporary, target); }
  finally { if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true }); }
}

function installMigrationStateFiles(journalPath, stateStage, onInstalled = () => {}) {
  const state = validateJournal(journalPath, path.dirname(path.dirname(path.dirname(journalPath))));
  if (state.status !== 'pending') throw new Error('迁移状态安装记录不是待提交状态。');
  for (const entry of state.entries) {
    const source = inside(stateStage, entry.relativePath);
    if (hashFile(source) !== entry.candidateHash) throw new Error(`迁移状态暂存内容已变化：${entry.relativePath}`);
    const currentHash = fs.existsSync(entry.target) ? hashFile(entry.target) : null;
    if (currentHash !== entry.originalHash) throw new Error(`迁移状态原文件已变化：${entry.relativePath}`);
    replaceFrom(source, entry.target);
    onInstalled(entry.relativePath);
  }
  return state.entries.length;
}

function commitMigrationStateInstall(journalPath) {
  const state = validateJournal(journalPath, path.dirname(path.dirname(path.dirname(journalPath))));
  if (state.status !== 'pending') throw new Error('迁移状态安装记录不是待提交状态。');
  for (const entry of state.entries) {
    if (!fs.existsSync(entry.target) || hashFile(entry.target) !== entry.candidateHash) throw new Error(`迁移状态安装内容不完整：${entry.relativePath}`);
  }
  writeJournal(journalPath, { ...state, status: 'committed' });
}

function rollbackMigrationStateInstall(journalPath, expectedUserDataDir) {
  const state = validateJournal(journalPath, expectedUserDataDir);
  if (state.status !== 'pending') return { status: state.status, recoveryPath: state.recoveryPath, changed: false };
  // Check every destination before changing any. A later edit must not be
  // overwritten just because an earlier file was still safe to restore.
  for (const entry of state.entries) {
    if (fs.existsSync(entry.target) && fs.lstatSync(entry.target).isSymbolicLink()) throw new Error(`迁移状态目标已变为链接：${entry.relativePath}`);
    const current = fs.existsSync(entry.target) ? hashFile(entry.target) : null;
    if (current !== entry.originalHash && current !== entry.candidateHash) throw new Error(`迁移状态目标已被其他操作修改：${entry.relativePath}`);
    if (entry.existed && (!fs.existsSync(entry.backup) || hashFile(entry.backup) !== entry.originalHash)) throw new Error(`迁移状态原件备份缺失或损坏：${entry.relativePath}`);
  }
  if (fs.existsSync(state.targetRoot) && fs.lstatSync(state.targetRoot).isSymbolicLink()) throw new Error('迁移原文目录已变为链接，不能自动处置。');
  if (fs.existsSync(state.targetRoot) && fs.existsSync(state.recoveryPath)) throw new Error('迁移原文与待核对副本同时存在，不能自动处置。');
  const activated = (root) => {
    const marker = inside(root, state.markerRelativePath);
    if (!fs.existsSync(marker) || fs.lstatSync(marker).isSymbolicLink()) return false;
    try {
      const value = JSON.parse(fs.readFileSync(marker, 'utf8'));
      return value.migrationId === state.migrationId && value.activationNonce === state.activationNonce;
    } catch { return false; }
  };
  const targetExists = fs.existsSync(state.targetRoot);
  const recoveryExists = fs.existsSync(state.recoveryPath);
  if (recoveryExists && !activated(state.recoveryPath)) throw new Error('待核对迁移原文缺少匹配的启用标记。');
  const shouldMoveTarget = targetExists && activated(state.targetRoot);
  if (targetExists && !shouldMoveTarget && fs.readdirSync(state.targetRoot).length) throw new Error('迁移目标目录含未标记的文件，不能自动移动。');
  for (const entry of [...state.entries].reverse()) {
    const current = fs.existsSync(entry.target) ? hashFile(entry.target) : null;
    if (current === entry.originalHash) continue;
    if (entry.existed) replaceFrom(entry.backup, entry.target);
    else fs.rmSync(entry.target, { force: true });
  }
  if (shouldMoveTarget) fs.renameSync(state.targetRoot, state.recoveryPath);
  writeJournal(journalPath, { ...state, status: 'rolled_back' });
  return { status: 'rolled_back', recoveryPath: state.recoveryPath, changed: true };
}

function recoverInterruptedMigrationStateInstalls(userDataDir) {
  const root = path.join(userDataDir, 'migration-rollbacks');
  if (!fs.existsSync(root)) return { ready: true, recovered: [], issues: [] };
  const recovered = [], issues = [];
  let directories;
  try {
    if (fs.lstatSync(root).isSymbolicLink() || !fs.lstatSync(root).isDirectory()) throw new Error('迁移恢复记录根目录不是普通目录。');
    directories = fs.readdirSync(root, { withFileTypes: true });
  } catch (error) {
    return { ready: false, recovered, issues: [{ migrationId: '', journalPath: root, message: error.message }] };
  }
  for (const item of directories) {
    if (!item.isDirectory() || item.isSymbolicLink()) continue;
    const journalPath = path.join(root, item.name, JOURNAL);
    if (!fs.existsSync(journalPath)) continue;
    try {
      const result = rollbackMigrationStateInstall(journalPath, userDataDir);
      if (result.changed) recovered.push({ migrationId: item.name, recoveryPath: result.recoveryPath });
    } catch (error) { issues.push({ migrationId: item.name, journalPath, message: error.message }); }
  }
  return { ready: issues.length === 0, recovered, issues };
}

module.exports = { prepareMigrationStateInstall, installMigrationStateFiles, commitMigrationStateInstall,
  rollbackMigrationStateInstall, recoverInterruptedMigrationStateInstalls };
