'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA_VERSION = 1;

function databasePathForLegacy(legacyPath) {
  return path.join(path.dirname(legacyPath), 'task-state.sqlite3');
}

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function configure(db, journal = 'WAL') {
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(`PRAGMA journal_mode=${journal}`);
  db.exec('PRAGMA synchronous=FULL');
  db.exec('PRAGMA busy_timeout=5000');
}

function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_state_meta (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      task_id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status_updated ON tasks(status, updated_at DESC);
    CREATE TABLE IF NOT EXISTS task_history (
      sequence INTEGER PRIMARY KEY,
      task_id TEXT NOT NULL DEFAULT '',
      occurred_at TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_task_history_task ON task_history(task_id, sequence DESC);
    CREATE TABLE IF NOT EXISTS task_events (
      event_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL DEFAULT '',
      event_type TEXT NOT NULL DEFAULT '',
      occurred_at TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_task_events_task_time ON task_events(task_id, occurred_at DESC);
  `);
  db.exec(`PRAGMA user_version=${SCHEMA_VERSION}`);
}

function check(db) {
  const quick = db.prepare('PRAGMA quick_check').get();
  if (!quick || String(Object.values(quick)[0]).toLowerCase() !== 'ok') throw new Error('任务数据库快速完整性检查失败');
  const foreign = db.prepare('PRAGMA foreign_key_check').all();
  if (foreign.length) throw new Error('任务数据库外键检查失败');
}

function parseLegacy(file) {
  if (!fs.existsSync(file)) return { tasks: [], history: [], runtime: {}, deletedTasks: [] };
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  if (!parsed || !Array.isArray(parsed.tasks) || (parsed.history != null && !Array.isArray(parsed.history))) {
    throw new Error('任务账本格式损坏，原文件保持不变');
  }
  return parsed;
}

function importEvents(db, eventPath) {
  if (!fs.existsSync(eventPath)) return 0;
  // The active ledger is already rotation-bounded. Historical event-archives
  // are intentionally never traversed during ordinary startup or migration.
  const lines = fs.readFileSync(eventPath, 'utf8').split(/\r?\n/).filter(Boolean);
  const insert = db.prepare(`INSERT OR IGNORE INTO task_events
    (event_id,task_id,event_type,occurred_at,payload_json) VALUES(?,?,?,?,?)`);
  let imported = 0;
  for (const line of lines) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    const eventId = String(event.id || `legacy-${crypto.createHash('sha1').update(line).digest('hex')}`);
    const result = insert.run(eventId, String(event.taskId || ''), String(event.type || ''), String(event.at || ''), JSON.stringify(event));
    imported += Number(result.changes || 0);
  }
  return imported;
}

function migrate({ legacyPath, dbPath }) {
  const source = parseLegacy(legacyPath);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  // Keep the sibling name compact. On Windows SQLite can reject a temporary
  // database near MAX_PATH even when the authoritative task-state.sqlite3 is
  // valid. A full UUID suffix made first-run migration fail before the task
  // scheduler could start.
  const nonce = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  const temporary = path.join(path.dirname(dbPath), `.new-${nonce}.db`);
  const db = new DatabaseSync(temporary);
  let eventCount = 0;
  let imported = false;
  try {
    configure(db, 'DELETE');
    createSchema(db);
    const task = db.prepare('INSERT INTO tasks(task_id,status,updated_at,payload_json) VALUES(?,?,?,?)');
    const history = db.prepare('INSERT INTO task_history(sequence,task_id,occurred_at,payload_json) VALUES(?,?,?,?)');
    const meta = db.prepare('INSERT INTO task_state_meta(key,value_json) VALUES(?,?)');
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const item of source.tasks || []) task.run(String(item.id || crypto.randomUUID()), String(item.status || ''), String(item.updatedAt || ''), JSON.stringify(item));
      (source.history || []).forEach((item, index) => history.run(index, String(item.taskId || ''), String(item.at || item.updatedAt || ''), JSON.stringify(item)));
      meta.run('protocolVersion', JSON.stringify(source.protocolVersion || ''));
      meta.run('updatedAt', JSON.stringify(source.updatedAt || ''));
      meta.run('runtime', JSON.stringify(source.runtime || {}));
      meta.run('deletedTasks', JSON.stringify(source.deletedTasks || []));
      meta.run('migration', JSON.stringify({ migratedAt: new Date().toISOString(), sourcePath: legacyPath,
        sourceSize: fs.existsSync(legacyPath) ? fs.statSync(legacyPath).size : 0,
        sourceSha256: fs.existsSync(legacyPath) ? sha256File(legacyPath) : '', taskCount: (source.tasks || []).length }));
      eventCount = importEvents(db, path.join(path.dirname(legacyPath), 'events.jsonl'));
      db.exec('COMMIT');
    } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
    check(db);
    imported = true;
  } finally {
    db.close();
    if (!imported) {
      try { fs.unlinkSync(temporary); } catch {}
    }
  }
  if (fs.existsSync(legacyPath)) {
    const backupDir = path.join(path.dirname(legacyPath), 'migration-backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const descriptiveBackup = path.join(backupDir, `tasks-before-sqlite-${stamp}.json`);
    const backup = descriptiveBackup.length <= 240
      ? descriptiveBackup : path.join(backupDir, `j-${nonce}.json`);
    fs.copyFileSync(legacyPath, backup, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(backup, 0o444);
    const descriptiveManifest = `${backup}.manifest.json`;
    const manifestPath = descriptiveManifest.length <= 240
      ? descriptiveManifest : path.join(backupDir, `m-${nonce}.json`);
    fs.writeFileSync(manifestPath, JSON.stringify({ source: legacyPath, backup,
      sha256: sha256File(legacyPath), bytes: fs.statSync(legacyPath).size, taskCount: (source.tasks || []).length,
      historyCount: (source.history || []).length, eventCount, createdAt: new Date().toISOString() }, null, 2));
  }
  fs.renameSync(temporary, dbPath);
  return { taskCount: (source.tasks || []).length, historyCount: (source.history || []).length, eventCount };
}

function createTaskStateStore(options) {
  return require('./task-sql-store.cjs').createTaskSqlStore({ ...options, migrate });
}
module.exports = { SCHEMA_VERSION: 3, databasePathForLegacy, createTaskStateStore, migrate };
