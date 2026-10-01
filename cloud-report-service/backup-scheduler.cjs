'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { createBackup } = require('./backup.cjs');
const fs = require('node:fs/promises');
const { diskStatus, exportAudit, applyRetention } = require('./maintenance.cjs');

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;

function checkedDirectory(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error(`${label}须为绝对目录`);
  const resolved = path.resolve(value);
  if (resolved === path.parse(resolved).root) throw new Error(`${label}不能是磁盘根目录`);
  return resolved;
}

function startBackupScheduler({ dataDir, backupRoot, intervalMs = DEFAULT_INTERVAL_MS,
  now = () => Date.now(), onError = error => process.stderr.write(`Cloud backup failed: ${error.message}\n`),
  onSuccess = result => process.stdout.write(`Cloud backup verified: ${result.backupDir}\n`),
  backup = createBackup, immediate = true, minimumFreeBytes = 512 * 1024 * 1024,
  auditRoot, auditKey, prune = false, keep = 7, days = 30 }) {
  const source = checkedDirectory(dataDir, '数据目录');
  const root = checkedDirectory(backupRoot, '备份根目录');
  const left = source.toLowerCase();
  const right = root.toLowerCase();
  if (left === right || left.startsWith(`${right}${path.sep}`) || right.startsWith(`${left}${path.sep}`)) {
    throw new Error('数据目录与备份根目录不能重叠');
  }
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 60_000 || intervalMs > 30 * DEFAULT_INTERVAL_MS) {
    throw new Error('备份间隔须为 1 分钟至 30 天');
  }
  let active = null;
  let stopped = false;
  const status = { enabled: true, lastSuccessAt: 0, lastError: '', running: false };
  function runNow() {
    if (stopped) throw new Error('备份调度已停止');
    if (active) return active;
    const stamp = new Date(now()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const destination = path.join(root, `snapshot-${stamp}-${crypto.randomUUID()}`);
    status.running = true;
    active = Promise.resolve().then(async () => {
      await fs.mkdir(root, { recursive: true });
      if ((await fs.realpath(root)).toLowerCase() !== root.toLowerCase()) throw new Error('备份根目录不能经过符号链接');
      if ((await diskStatus(root, minimumFreeBytes)).warning) throw new Error('备份磁盘剩余空间不足，未删除任何备份');
      const result = await backup(source, destination);
      if (auditRoot) await exportAudit(result.backupDir, path.join(checkedDirectory(auditRoot, '独立审计目录'), `${path.basename(destination)}.audit.json`), auditKey);
      if (prune) await applyRetention(root, { keep, days, confirm: true });
      return result;
    }).then(result => {
      status.lastSuccessAt = now(); status.lastError = '';
      try { onSuccess(result); } catch { /* logging must not change backup success */ }
      return result;
    }).catch(error => { status.lastError = error.message; throw error; }).finally(() => { active = null; status.running = false; });
    return active;
  }
  const timer = setInterval(() => { void runNow().catch(onError); }, intervalMs);
  timer.unref();
  if (immediate) void runNow().catch(onError);
  return {
    runNow,
    status: () => ({ ...status }),
    stop: async () => { stopped = true; clearInterval(timer); if (active) await active.catch(() => {}); },
  };
}

module.exports = { startBackupScheduler, DEFAULT_INTERVAL_MS };
