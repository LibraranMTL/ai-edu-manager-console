'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createReadStream } = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const DB_NAME = 'cloud-reports.sqlite';
const OBJECT_NAME = /^[a-f0-9]{64}\.(?:md|txt|pdf|docx)$/;

function absoluteDirectory(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error(`${label}须为绝对目录`);
  const resolved = path.resolve(value);
  if (resolved === path.parse(resolved).root) throw new Error(`${label}不能是磁盘根目录`);
  return resolved;
}

function separate(a, b) {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  if (left === right || left.startsWith(`${right}${path.sep}`) || right.startsWith(`${left}${path.sep}`)) {
    throw new Error('源目录与目标目录不能重叠');
  }
}

async function hashFile(filename) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

function requiredObjects(db) {
  const rows = db.prepare(`SELECT object_name AS objectName, content_sha256 AS sha256 FROM reports
    UNION SELECT object_name AS objectName, content_sha256 AS sha256 FROM documents`).all();
  const objects = new Map();
  for (const row of rows) {
    if (!OBJECT_NAME.test(row.objectName) || !/^[a-f0-9]{64}$/.test(row.sha256) ||
        !row.objectName.startsWith(`${row.sha256}.`)) throw new Error('数据库对象索引无效');
    if (objects.has(row.objectName) && objects.get(row.objectName) !== row.sha256) throw new Error('对象哈希冲突');
    objects.set(row.objectName, row.sha256);
  }
  return [...objects].map(([name, sha256]) => ({ name, sha256 })).sort((a, b) => a.name.localeCompare(b.name));
}

function readSnapshot(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('数据库完整性检查失败');
    return requiredObjects(db);
  } finally { db.close(); }
}

async function verifyBackup(backupDirInput) {
  const backupDir = absoluteDirectory(backupDirInput, '备份目录');
  const backupStat = await fs.lstat(backupDir);
  const manifestPath = path.join(backupDir, 'manifest.json');
  const dbPath = path.join(backupDir, DB_NAME);
  const objectsPath = path.join(backupDir, 'objects');
  const [manifestStat, dbStat, objectsStat] = await Promise.all([
    fs.lstat(manifestPath), fs.lstat(dbPath), fs.lstat(objectsPath),
  ]);
  if (!backupStat.isDirectory() || backupStat.isSymbolicLink() ||
      !manifestStat.isFile() || manifestStat.isSymbolicLink() ||
      !dbStat.isFile() || dbStat.isSymbolicLink() ||
      !objectsStat.isDirectory() || objectsStat.isSymbolicLink()) throw new Error('备份目录结构无效');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  if (manifest.version !== 1 || !/^[a-f0-9]{64}$/.test(manifest.databaseSha256) || !Array.isArray(manifest.objects)) {
    throw new Error('备份清单无效');
  }
  if (await hashFile(dbPath) !== manifest.databaseSha256) throw new Error('备份数据库哈希不匹配');
  const expected = readSnapshot(dbPath);
  if (JSON.stringify(expected) !== JSON.stringify(manifest.objects)) throw new Error('备份对象清单与数据库不一致');
  for (const object of expected) {
    const filename = path.join(backupDir, 'objects', object.name);
    const stat = await fs.lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || await hashFile(filename) !== object.sha256) {
      throw new Error(`备份对象校验失败：${object.name}`);
    }
  }
  return { databaseSha256: manifest.databaseSha256, objectCount: expected.length };
}

async function createBackup(dataDirInput, backupDirInput) {
  const dataDir = absoluteDirectory(dataDirInput, '数据目录');
  const backupDir = absoluteDirectory(backupDirInput, '备份目录');
  separate(dataDir, backupDir);
  try { await fs.lstat(backupDir); throw new Error('备份目标已存在，禁止覆盖'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.mkdir(path.dirname(backupDir), { recursive: true });
  const temp = `${backupDir}.${crypto.randomUUID()}.tmp`;
  await fs.mkdir(temp);
  try {
    const sourceDb = path.join(dataDir, DB_NAME);
    const db = new DatabaseSync(sourceDb, { readOnly: true });
    try {
      db.exec(`VACUUM INTO '${path.join(temp, DB_NAME).replaceAll("'", "''")}'`);
    } finally { db.close(); }
    const objects = readSnapshot(path.join(temp, DB_NAME));
    await fs.mkdir(path.join(temp, 'objects'));
    for (const object of objects) {
      const source = path.join(dataDir, 'objects', object.name);
      const stat = await fs.lstat(source);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`源对象无效：${object.name}`);
      const destination = path.join(temp, 'objects', object.name);
      await fs.copyFile(source, destination);
      if (await hashFile(destination) !== object.sha256) throw new Error(`源对象哈希不匹配：${object.name}`);
    }
    const manifest = { version: 1, createdAt: new Date().toISOString(),
      databaseSha256: await hashFile(path.join(temp, DB_NAME)), objects };
    await fs.writeFile(path.join(temp, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
    await verifyBackup(temp);
    await fs.rename(temp, backupDir);
    return { backupDir, objectCount: objects.length };
  } catch (error) { await fs.rm(temp, { recursive: true, force: true }); throw error; }
}

async function restoreBackup(backupDirInput, targetDirInput) {
  const backupDir = absoluteDirectory(backupDirInput, '备份目录');
  const targetDir = absoluteDirectory(targetDirInput, '恢复目录');
  separate(backupDir, targetDir);
  try { await fs.lstat(targetDir); throw new Error('恢复目标已存在，禁止覆盖'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const verified = await verifyBackup(backupDir);
  await fs.mkdir(path.dirname(targetDir), { recursive: true });
  const temp = `${targetDir}.${crypto.randomUUID()}.tmp`;
  await fs.mkdir(temp);
  try {
    await fs.copyFile(path.join(backupDir, DB_NAME), path.join(temp, DB_NAME));
    await fs.mkdir(path.join(temp, 'objects'));
    const manifest = JSON.parse(await fs.readFile(path.join(backupDir, 'manifest.json'), 'utf8'));
    for (const object of manifest.objects) {
      await fs.copyFile(path.join(backupDir, 'objects', object.name), path.join(temp, 'objects', object.name));
    }
    await fs.copyFile(path.join(backupDir, 'manifest.json'), path.join(temp, 'manifest.json'));
    await verifyBackup(temp);
    // A restored snapshot must not resurrect revoked device permissions or browser sessions.
    const restored = new DatabaseSync(path.join(temp, DB_NAME));
    try {
      restored.exec('BEGIN IMMEDIATE');
      if (!restored.prepare('PRAGMA table_info(devices)').all().some(column => column.name === 'revoked_at')) restored.exec('ALTER TABLE devices ADD COLUMN revoked_at INTEGER');
      restored.prepare("UPDATE devices SET revoked_at=? WHERE id<>'admin_local'").run(Date.now());
      restored.prepare('UPDATE grants SET revoked_at=?').run(Date.now());
      if (restored.prepare("SELECT 1 FROM sqlite_master WHERE name='admin_sessions'").get()) restored.exec('DELETE FROM admin_sessions');
      restored.exec('DELETE FROM request_nonces; COMMIT; PRAGMA wal_checkpoint(TRUNCATE)');
    } finally { restored.close(); }
    manifest.databaseSha256 = await hashFile(path.join(temp, DB_NAME));
    manifest.restoredAt = new Date().toISOString();
    manifest.requiresDeviceReenrollment = true;
    await fs.writeFile(path.join(temp, 'manifest.json'), JSON.stringify(manifest, null, 2));
    await verifyBackup(temp);
    await fs.rename(temp, targetDir);
    return { targetDir, objectCount: verified.objectCount, requiresDeviceReenrollment: true };
  } catch (error) { await fs.rm(temp, { recursive: true, force: true }); throw error; }
}

if (require.main === module) {
  const [command, source, target] = process.argv.slice(2);
  const action = command === 'backup' && target ? createBackup(source, target)
    : command === 'verify' && source && !target ? verifyBackup(source)
      : command === 'restore' && target ? restoreBackup(source, target) : null;
  if (!action) {
    process.stderr.write('Usage: node backup.cjs backup <data-dir> <new-backup-dir> | verify <backup-dir> | restore <backup-dir> <new-data-dir>\n');
    process.exitCode = 2;
  } else action.then(result => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}

module.exports = { createBackup, verifyBackup, restoreBackup };
