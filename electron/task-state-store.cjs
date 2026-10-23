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
  const temporary = `${dbPath}.${crypto.randomUUID()}.migrating`;
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
    const backup = path.join(backupDir, `tasks-before-sqlite-${stamp}.json`);
    fs.copyFileSync(legacyPath, backup, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(backup, 0o444);
    fs.writeFileSync(`${backup}.manifest.json`, JSON.stringify({ source: legacyPath, backup,
      sha256: sha256File(legacyPath), bytes: fs.statSync(legacyPath).size, taskCount: (source.tasks || []).length,
      historyCount: (source.history || []).length, eventCount, createdAt: new Date().toISOString() }, null, 2));
  }
  fs.renameSync(temporary, dbPath);
  return { taskCount: (source.tasks || []).length, historyCount: (source.history || []).length, eventCount };
}

function createTaskStateStore({ legacyPath }) {
  const dbPath = databasePathForLegacy(legacyPath);
  let db = null;
  let state = null;
  let taskJson = new Map();
  let historyJson = '';
  let metaJson = new Map();

  function open() {
    if (db) return;
    if (!fs.existsSync(dbPath)) migrate({ legacyPath, dbPath });
    db = new DatabaseSync(dbPath);
    configure(db, 'WAL');
    createSchema(db);
    check(db);
    if (!state) load();
  }

  function readMeta(key, fallback) {
    const row = db.prepare('SELECT value_json FROM task_state_meta WHERE key=?').get(key);
    if (!row) return fallback;
    try { return JSON.parse(row.value_json); } catch { return fallback; }
  }

  function load() {
    const tasks = db.prepare('SELECT task_id,payload_json FROM tasks ORDER BY updated_at DESC,task_id').all();
    taskJson = new Map(tasks.map(row => [String(row.task_id), String(row.payload_json)]));
    const historyRows = db.prepare('SELECT payload_json FROM task_history ORDER BY sequence').all();
    const history = historyRows.map(row => JSON.parse(row.payload_json));
    historyJson = JSON.stringify(history);
    state = {
      protocolVersion: readMeta('protocolVersion', ''),
      updatedAt: readMeta('updatedAt', ''),
      runtime: readMeta('runtime', {}),
      tasks: tasks.map(row => JSON.parse(row.payload_json)),
      history,
      deletedTasks: readMeta('deletedTasks', []),
    };
    for (const key of ['protocolVersion', 'updatedAt', 'runtime', 'deletedTasks']) metaJson.set(key, JSON.stringify(state[key] ?? (key === 'runtime' ? {} : key === 'deletedTasks' ? [] : '')));
    return state;
  }

  function writeMeta(key, value) {
    const serialized = JSON.stringify(value);
    if (metaJson.get(key) === serialized) return;
    db.prepare(`INSERT INTO task_state_meta(key,value_json) VALUES(?,?)
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json`).run(key, serialized);
    metaJson.set(key, serialized);
  }

  function writeSnapshot(value) {
    open();
    const nextTasks = Array.isArray(value.tasks) ? value.tasks : [];
    const seen = new Set();
    const upsert = db.prepare(`INSERT INTO tasks(task_id,status,updated_at,payload_json) VALUES(?,?,?,?)
      ON CONFLICT(task_id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at,payload_json=excluded.payload_json`);
    const remove = db.prepare('DELETE FROM tasks WHERE task_id=?');
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const item of nextTasks) {
        const id = String(item.id || '');
        if (!id) continue;
        seen.add(id);
        const serialized = JSON.stringify(item);
        if (taskJson.get(id) !== serialized) {
          upsert.run(id, String(item.status || ''), String(item.updatedAt || ''), serialized);
          taskJson.set(id, serialized);
        }
      }
      for (const id of [...taskJson.keys()]) if (!seen.has(id)) { remove.run(id); taskJson.delete(id); }
      const nextHistory = Array.isArray(value.history) ? value.history : [];
      const nextHistoryJson = JSON.stringify(nextHistory);
      if (nextHistoryJson !== historyJson) {
        db.exec('DELETE FROM task_history');
        const insertHistory = db.prepare('INSERT INTO task_history(sequence,task_id,occurred_at,payload_json) VALUES(?,?,?,?)');
        nextHistory.forEach((item, index) => insertHistory.run(index, String(item.taskId || ''), String(item.at || item.updatedAt || ''), JSON.stringify(item)));
        historyJson = nextHistoryJson;
      }
      writeMeta('protocolVersion', value.protocolVersion || '');
      writeMeta('updatedAt', value.updatedAt || '');
      writeMeta('runtime', value.runtime || {});
      writeMeta('deletedTasks', value.deletedTasks || []);
      db.exec('COMMIT');
    } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
    state = structuredClone(value);
    return state;
  }

  function applyProgress(entries) {
    open();
    const update = db.prepare('UPDATE tasks SET updated_at=?,payload_json=? WHERE task_id=?');
    let accepted = 0;
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const patch of entries || []) {
        const id = String(patch.taskId || '');
        const currentJson = taskJson.get(id);
        if (!currentJson) continue;
        const task = JSON.parse(currentJson);
        if (String(task.executionId || '') !== String(patch.executionId || '') || !['running', 'waiting_result'].includes(String(task.status || ''))) continue;
        if (patch.lastHeartbeatAt) task.lastHeartbeatAt = String(patch.lastHeartbeatAt);
        if (patch.lastProgressAt) { task.lastProgressAt = String(patch.lastProgressAt); task.progressSource = String(patch.progressSource || ''); }
        const serialized = JSON.stringify(task);
        update.run(String(task.updatedAt || task.lastProgressAt || task.lastHeartbeatAt || ''), serialized, id);
        taskJson.set(id, serialized);
        accepted++;
      }
      db.exec('COMMIT');
    } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
    return accepted;
  }

  function appendEvent(event) {
    open();
    const payload = event && typeof event === 'object' ? event : {};
    db.prepare(`INSERT OR IGNORE INTO task_events(event_id,task_id,event_type,occurred_at,payload_json)
      VALUES(?,?,?,?,?)`).run(String(payload.id || crypto.randomUUID()), String(payload.taskId || ''),
      String(payload.type || ''), String(payload.at || ''), JSON.stringify(payload));
  }

  return { dbPath, open, value: () => state || load(), writeSnapshot, applyProgress, appendEvent,
    release() { if (db) { try { db.exec('PRAGMA wal_checkpoint(PASSIVE)'); } catch {} db.close(); db = null; } },
    close() { if (db) db.close(); db = null; state = null; taskJson.clear(); historyJson = ''; metaJson.clear(); } };
}

module.exports = { SCHEMA_VERSION, databasePathForLegacy, createTaskStateStore, migrate };
