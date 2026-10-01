'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { verifyBackup } = require('./backup.cjs');

function directory(value) {
  if (!value || !path.isAbsolute(value) || path.resolve(value) === path.parse(value).root) throw new Error('须指定非磁盘根的绝对目录');
  return path.resolve(value);
}
async function diskStatus(value, minimumBytes = 512 * 1024 * 1024) {
  const target = directory(value);
  const stat = await fs.statfs(target);
  const freeBytes = stat.bavail * stat.bsize;
  return { freeBytes, minimumBytes, warning: freeBytes < minimumBytes };
}
function signingKey(key) {
  if (typeof key !== 'string' || key.length < 32) throw new Error('独立审计密钥至少 32 字符，须单独保管');
  return key;
}
function auditRows(dataDir, lastId = Number.MAX_SAFE_INTEGER) {
  const db = new DatabaseSync(path.join(directory(dataDir), 'cloud-reports.sqlite'), { readOnly: true });
  try { return db.prepare('SELECT id,occurred_at,actor_id,action,student_id,target_id FROM audit_events WHERE id<=? ORDER BY id').all(lastId); }
  finally { db.close(); }
}
async function exportAudit(dataDir, archivePath, key) {
  signingKey(key);
  if (!path.isAbsolute(archivePath)) throw new Error('审计归档须使用绝对路径');
  const source = directory(dataDir).toLowerCase() + path.sep;
  if (path.resolve(archivePath).toLowerCase().startsWith(source)) throw new Error('独立审计归档不能位于数据目录内');
  const rows = auditRows(dataDir);
  const payload = JSON.stringify({ version: 1, createdAt: new Date().toISOString(), lastId: rows.at(-1)?.id || 0, rows });
  const signature = crypto.createHmac('sha256', key).update(payload).digest('hex');
  await fs.mkdir(path.dirname(archivePath), { recursive: true });
  await fs.writeFile(archivePath, JSON.stringify({ payload, signature }), { flag: 'wx', mode: 0o600 });
  return { archivePath, count: rows.length, lastId: rows.at(-1)?.id || 0 };
}
async function verifyAudit(archivePath, key, dataDir) {
  signingKey(key);
  const archive = JSON.parse(await fs.readFile(archivePath, 'utf8'));
  const signature = crypto.createHmac('sha256', key).update(archive.payload).digest('hex');
  if (signature !== archive.signature) throw new Error('独立审计签名校验失败');
  const payload = JSON.parse(archive.payload);
  if (payload.version !== 1 || !Array.isArray(payload.rows)) throw new Error('审计归档结构无效');
  if (dataDir && JSON.stringify(auditRows(dataDir, payload.lastId)) !== JSON.stringify(payload.rows)) throw new Error('数据库历史审计与独立归档不一致');
  return { verified: true, count: payload.rows.length, lastId: payload.lastId };
}
async function retentionPlan(backupRoot, { keep = 7, days = 30, now = Date.now() } = {}) {
  const root = directory(backupRoot);
  if (!Number.isInteger(keep) || keep < 1 || !Number.isInteger(days) || days < 1) throw new Error('保留份数和天数须为正整数');
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || (await fs.realpath(root)).toLowerCase() !== root.toLowerCase()) throw new Error('备份根目录不能经过符号链接');
  const entries = await fs.readdir(root, { withFileTypes: true });
  const snapshots = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^snapshot-\d{8}T\d{6}Z-[a-f0-9-]{36}$/.test(entry.name)) continue;
    const target = path.join(root, entry.name);
    await verifyBackup(target); // Corruption blocks all pruning; never delete the last good snapshot by guessing.
    const manifest = JSON.parse(await fs.readFile(path.join(target, 'manifest.json'), 'utf8'));
    const createdAt = Date.parse(manifest.createdAt);
    if (!Number.isFinite(createdAt)) throw new Error('备份时间无效');
    snapshots.push({ path: target, createdAt });
  }
  snapshots.sort((a, b) => b.createdAt - a.createdAt);
  return { root, keep, days, retained: snapshots.slice(0, keep).map(item => item.path),
    candidates: snapshots.slice(keep).filter(item => item.createdAt < now - days * 86400000).map(item => item.path) };
}
async function applyRetention(backupRoot, options = {}) {
  const plan = await retentionPlan(backupRoot, options);
  if (!options.confirm) return { ...plan, deleted: [], dryRun: true };
  for (const target of plan.candidates) {
    if (path.dirname(target) !== plan.root || (await fs.lstat(target)).isSymbolicLink()) throw new Error('保留清理路径校验失败');
    await fs.rm(target, { recursive: true });
  }
  return { ...plan, deleted: plan.candidates, dryRun: false };
}
if (require.main === module) {
  const [command, source, target, flag] = process.argv.slice(2);
  const key = process.env.CLOUD_REPORT_AUDIT_KEY;
  const work = command === 'status' ? diskStatus(source)
    : command === 'audit-export' ? exportAudit(source, target, key)
      : command === 'audit-verify' ? verifyAudit(source, key, target)
        : command === 'retention' ? applyRetention(source, { keep: Number(process.env.CLOUD_REPORT_BACKUP_KEEP || 7), days: Number(process.env.CLOUD_REPORT_BACKUP_DAYS || 30), confirm: target === '--apply' || flag === '--apply' })
          : Promise.reject(new Error('Usage: maintenance.cjs status <data-dir> | audit-export <data-dir> <new-archive-file> | audit-verify <archive-file> [data-dir] | retention <backup-root> [--apply]'));
  work.then(value => process.stdout.write(JSON.stringify(value, null, 2) + '\n')).catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
}
module.exports = { diskStatus, exportAudit, verifyAudit, retentionPlan, applyRetention };
