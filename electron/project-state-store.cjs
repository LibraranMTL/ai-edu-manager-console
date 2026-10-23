'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync, backup } = require('node:sqlite');

const SCHEMA_VERSION = 3;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

function text(value) { return value == null ? '' : String(value); }
function json(value, fallback) {
  try { return JSON.parse(String(value || '')); } catch { return fallback; }
}
function stableJson(value) { return JSON.stringify(value ?? null); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function mergePatch(current, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const result = current && typeof current === 'object' && !Array.isArray(current) ? { ...current } : {};
  for (const [key, value] of Object.entries(patch)) {
    result[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? mergePatch(result[key], value) : value;
  }
  return result;
}
function stamp(now = Date.now) { return new Date(typeof now === 'function' ? now() : now).toISOString().replace(/[:.]/g, '-'); }
function safePageSize(value) { return Math.max(1, Math.min(MAX_PAGE_SIZE, Number(value) || DEFAULT_PAGE_SIZE)); }
function cursorOffset(value) {
  if (!value) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    return Math.max(0, Number(parsed.offset) || 0);
  } catch { return 0; }
}
function nextCursor(offset) { return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url'); }
function cursorValue(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch { return null; }
}
function opaqueCursor(value) { return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url'); }

function schemaSql(journalMode = 'WAL') {
  return `
    PRAGMA journal_mode=${journalMode};
    PRAGMA synchronous=FULL;
    PRAGMA busy_timeout=5000;
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS projects (
      project_id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      updated_at TEXT NOT NULL DEFAULT '',
      revision INTEGER NOT NULL DEFAULT 1,
      payload_json TEXT NOT NULL DEFAULT '{}',
      legacy_metadata_json TEXT NOT NULL DEFAULT '{}'
    ) STRICT;
    CREATE INDEX IF NOT EXISTS projects_status_updated ON projects(status,updated_at DESC,project_id);
    CREATE INDEX IF NOT EXISTS projects_name ON projects(name COLLATE NOCASE);
    CREATE TABLE IF NOT EXISTS project_students (
      project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
      student_id TEXT NOT NULL,
      student_name TEXT NOT NULL DEFAULT '',
      PRIMARY KEY(project_id,student_id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS project_students_student ON project_students(student_id,project_id);
    CREATE TABLE IF NOT EXISTS project_assets (
      project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
      asset_id TEXT NOT NULL,
      PRIMARY KEY(project_id,asset_id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS project_assets_asset ON project_assets(asset_id,project_id);
    CREATE TABLE IF NOT EXISTS project_staging_items (
      item_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
      filename TEXT NOT NULL DEFAULT '',
      path TEXT NOT NULL DEFAULT '',
      source_path TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'collected',
      review_status TEXT NOT NULL DEFAULT 'pending',
      sha1 TEXT NOT NULL DEFAULT '',
      sha256 TEXT NOT NULL DEFAULT '',
      byte_size INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT '',
      revision INTEGER NOT NULL DEFAULT 1,
      payload_json TEXT NOT NULL DEFAULT '{}'
    ) STRICT;
    CREATE INDEX IF NOT EXISTS project_staging_project_status ON project_staging_items(project_id,status,item_id);
    CREATE INDEX IF NOT EXISTS project_staging_project_review ON project_staging_items(project_id,review_status,item_id);
    CREATE INDEX IF NOT EXISTS project_staging_project_updated ON project_staging_items(project_id,updated_at DESC,item_id);
    CREATE INDEX IF NOT EXISTS project_staging_status_updated ON project_staging_items(project_id,status,updated_at DESC,item_id);
    CREATE INDEX IF NOT EXISTS project_staging_review_updated ON project_staging_items(project_id,review_status,updated_at DESC,item_id);
    CREATE INDEX IF NOT EXISTS project_staging_sha1 ON project_staging_items(sha1) WHERE sha1<>'';
    CREATE INDEX IF NOT EXISTS project_staging_sha256 ON project_staging_items(sha256) WHERE sha256<>'';
    CREATE INDEX IF NOT EXISTS project_staging_filename ON project_staging_items(project_id,filename COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS project_staging_source_path ON project_staging_items(project_id,source_path);
    CREATE TABLE IF NOT EXISTS project_workspace_scan_entries (
      project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
      entry_path TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY(project_id,entry_path)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS project_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    ) STRICT;
    CREATE VIRTUAL TABLE IF NOT EXISTS project_staging_search USING fts5(
      item_id UNINDEXED, project_id UNINDEXED, filename, path, source, governance,
      tokenize='unicode61 remove_diacritics 2'
    );
    CREATE TABLE IF NOT EXISTS project_staging_search_rows (
      item_id TEXT PRIMARY KEY REFERENCES project_staging_items(item_id) ON DELETE CASCADE,
      project_id TEXT NOT NULL,
      search_rowid INTEGER NOT NULL UNIQUE
    ) STRICT;
    CREATE INDEX IF NOT EXISTS project_staging_search_rows_project ON project_staging_search_rows(project_id,item_id);
    ${stagingCountSchemaSql()}
    PRAGMA user_version=${SCHEMA_VERSION};`;
}

function stagingCountSchemaSql() {
  return `
    CREATE TABLE IF NOT EXISTS project_staging_counts (
      project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
      status TEXT NOT NULL, review_status TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(project_id,status,review_status)
    ) WITHOUT ROWID, STRICT;
    CREATE TRIGGER IF NOT EXISTS project_staging_counts_ai AFTER INSERT ON project_staging_items
      WHEN COALESCE((SELECT value FROM project_meta WHERE key='staging_counts_suspended'),'0')<>'1' BEGIN
      INSERT INTO project_staging_counts(project_id,status,review_status,count)
        VALUES(NEW.project_id,NEW.status,NEW.review_status,1)
        ON CONFLICT(project_id,status,review_status) DO UPDATE SET count=count+1;
    END;
    CREATE TRIGGER IF NOT EXISTS project_staging_counts_ad AFTER DELETE ON project_staging_items
      WHEN COALESCE((SELECT value FROM project_meta WHERE key='staging_counts_suspended'),'0')<>'1' BEGIN
      UPDATE project_staging_counts SET count=count-1
        WHERE project_id=OLD.project_id AND status=OLD.status AND review_status=OLD.review_status;
      DELETE FROM project_staging_counts
        WHERE project_id=OLD.project_id AND status=OLD.status AND review_status=OLD.review_status AND count<=0;
    END;
    CREATE TRIGGER IF NOT EXISTS project_staging_counts_au AFTER UPDATE OF project_id,status,review_status ON project_staging_items
      WHEN COALESCE((SELECT value FROM project_meta WHERE key='staging_counts_suspended'),'0')<>'1'
        AND (OLD.project_id<>NEW.project_id OR OLD.status<>NEW.status OR OLD.review_status<>NEW.review_status) BEGIN
      UPDATE project_staging_counts SET count=count-1
        WHERE project_id=OLD.project_id AND status=OLD.status AND review_status=OLD.review_status;
      DELETE FROM project_staging_counts
        WHERE project_id=OLD.project_id AND status=OLD.status AND review_status=OLD.review_status AND count<=0;
      INSERT INTO project_staging_counts(project_id,status,review_status,count)
        VALUES(NEW.project_id,NEW.status,NEW.review_status,1)
        ON CONFLICT(project_id,status,review_status) DO UPDATE SET count=count+1;
    END;
  `;
}

function projectParts(raw) {
  const project = raw && typeof raw === 'object' ? raw : {};
  const projectId = text(project.id || project.projectId);
  if (!projectId) throw Object.assign(new Error('项目记录缺少 id。'), { code: 'project_migration_invalid' });
  const studentIds = Array.isArray(project.studentIds) ? project.studentIds.map(text).filter(Boolean) : [];
  const studentNames = Array.isArray(project.studentNames) ? project.studentNames.map(text) : [];
  const assetIds = Array.isArray(project.assetIds) ? project.assetIds.map(text).filter(Boolean) : [];
  const stagingItems = Array.isArray(project.stagingItems) ? project.stagingItems : [];
  const scan = project.workspaceScanSnapshot && typeof project.workspaceScanSnapshot === 'object'
    ? project.workspaceScanSnapshot : {};
  const payload = { ...project };
  delete payload.stagingItems;
  delete payload.workspaceScanSnapshot;
  delete payload.studentIds;
  delete payload.studentNames;
  delete payload.assetIds;
  return { projectId, payload, studentIds, studentNames, assetIds, stagingItems, scan };
}

function stagingRecord(projectId, raw, index = 0) {
  const item = raw && typeof raw === 'object' ? raw : {};
  const itemId = text(item.id || item.itemId || `${projectId}-staging-${index}`);
  return {
    itemId, projectId,
    filename: text(item.filename), path: text(item.path), sourcePath: text(item.sourcePath),
    status: text(item.status || 'collected'), reviewStatus: text(item.reviewStatus || 'pending'),
    sha1: text(item.sha1).toLowerCase(), sha256: text(item.sha256 || item.contentSha256).toLowerCase(),
    byteSize: Math.max(0, Number(item.size ?? item.byteSize) || 0),
    updatedAt: text(item.updatedAt || item.reviewedAt || item.createdAt),
    revision: Math.max(1, Number(item.recordRevision || item.revision) || 1), payload: item,
    governance: [item.aiAction, item.aiReason, item.governanceAction, item.governanceReason].filter(Boolean).join(' '),
  };
}

function makeStatements(db) {
  return {
    upsertProject: db.prepare(`INSERT INTO projects(project_id,name,type,status,updated_at,revision,payload_json,legacy_metadata_json)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET name=excluded.name,type=excluded.type,
      status=excluded.status,updated_at=excluded.updated_at,revision=projects.revision+1,payload_json=excluded.payload_json,
      legacy_metadata_json=excluded.legacy_metadata_json`),
    insertStudent: db.prepare('INSERT OR REPLACE INTO project_students(project_id,student_id,student_name) VALUES(?,?,?)'),
    insertAsset: db.prepare('INSERT OR IGNORE INTO project_assets(project_id,asset_id) VALUES(?,?)'),
    upsertStaging: db.prepare(`INSERT INTO project_staging_items(item_id,project_id,filename,path,source_path,status,review_status,sha1,sha256,byte_size,updated_at,revision,payload_json)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(item_id) DO UPDATE SET project_id=excluded.project_id,filename=excluded.filename,
      path=excluded.path,source_path=excluded.source_path,status=excluded.status,review_status=excluded.review_status,
      sha1=excluded.sha1,sha256=CASE WHEN excluded.sha256<>'' THEN excluded.sha256 ELSE project_staging_items.sha256 END,
      byte_size=excluded.byte_size,updated_at=excluded.updated_at,revision=excluded.revision,payload_json=excluded.payload_json`),
    insertSearch: db.prepare('INSERT INTO project_staging_search(item_id,project_id,filename,path,source,governance) VALUES(?,?,?,?,?,?)'),
    insertSearchRow: db.prepare('INSERT OR REPLACE INTO project_staging_search_rows(item_id,project_id,search_rowid) VALUES(?,?,?)'),
    insertScan: db.prepare('INSERT OR REPLACE INTO project_workspace_scan_entries(project_id,entry_path,payload_json) VALUES(?,?,?)'),
  };
}

function replaceProject(db, statements, raw) {
  const part = projectParts(raw);
  const project = part.payload;
  statements.upsertProject.run(part.projectId, text(project.name), text(project.type), text(project.status || 'active'),
    text(project.updatedAt || project.createdAt), Math.max(1, Number(project.revision) || 1), stableJson(project), '{}');
  db.prepare('DELETE FROM project_students WHERE project_id=?').run(part.projectId);
  part.studentIds.forEach((studentId, index) => statements.insertStudent.run(part.projectId, studentId, text(part.studentNames[index])));
  db.prepare('DELETE FROM project_assets WHERE project_id=?').run(part.projectId);
  part.assetIds.forEach(assetId => statements.insertAsset.run(part.projectId, assetId));
  const existingStagingIds = new Set(db.prepare('SELECT item_id FROM project_staging_items WHERE project_id=?').all(part.projectId).map(item => item.item_id));
  db.prepare('DELETE FROM project_staging_search WHERE rowid IN (SELECT search_rowid FROM project_staging_search_rows WHERE project_id=?)').run(part.projectId);
  db.prepare('DELETE FROM project_staging_search_rows WHERE project_id=?').run(part.projectId);
  part.stagingItems.forEach((rawItem, index) => {
    const item = stagingRecord(part.projectId, rawItem, index);
    const previous = !item.sha256 ? db.prepare('SELECT sha256 FROM project_staging_items WHERE project_id=? AND item_id=?').get(part.projectId, item.itemId) : null;
    if (!item.sha256 && previous?.sha256) {
      item.sha256 = previous.sha256;
      item.payload = { ...item.payload, sha256: item.payload.sha256 || previous.sha256,
        contentSha256: item.payload.contentSha256 || previous.sha256 };
    }
    statements.upsertStaging.run(item.itemId,item.projectId,item.filename,item.path,item.sourcePath,item.status,item.reviewStatus,
      item.sha1,item.sha256,item.byteSize,item.updatedAt,item.revision,stableJson(item.payload));
    const searchResult = statements.insertSearch.run(item.itemId,item.projectId,item.filename,item.path,item.sourcePath,item.governance);
    statements.insertSearchRow.run(item.itemId, item.projectId, Number(searchResult.lastInsertRowid));
    existingStagingIds.delete(item.itemId);
  });
  const deleteStaging = db.prepare('DELETE FROM project_staging_items WHERE project_id=? AND item_id=?');
  existingStagingIds.forEach(itemId => deleteStaging.run(part.projectId, itemId));
  db.prepare('DELETE FROM project_workspace_scan_entries WHERE project_id=?').run(part.projectId);
  Object.entries(part.scan).forEach(([entryPath, value]) => statements.insertScan.run(part.projectId, entryPath, stableJson(value)));
  return { projectId: part.projectId, stagingCount: part.stagingItems.length, scanCount: Object.keys(part.scan).length };
}

function importProjects(db, projects) {
  const statements = makeStatements(db);
  const seen = new Set();
  let stagingCount = 0, scanCount = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const project of projects) {
      const result = replaceProject(db, statements, project);
      if (seen.has(result.projectId)) throw Object.assign(new Error(`重复项目 id：${result.projectId}`), { code: 'project_migration_invalid' });
      seen.add(result.projectId); stagingCount += result.stagingCount; scanCount += result.scanCount;
    }
    db.exec('COMMIT');
  } catch (error) { try { db.exec('ROLLBACK'); } catch { /* already closed */ } throw error; }
  return { projectCount: seen.size, stagingCount, scanCount };
}

function validateDatabase(db, expected) {
  const actual = {
    projectCount: Number(db.prepare('SELECT COUNT(*) count FROM projects').get().count),
    stagingCount: Number(db.prepare('SELECT COUNT(*) count FROM project_staging_items').get().count),
    scanCount: Number(db.prepare('SELECT COUNT(*) count FROM project_workspace_scan_entries').get().count),
  };
  for (const key of Object.keys(expected)) if (Number(expected[key]) !== Number(actual[key])) {
    throw Object.assign(new Error(`项目迁移校验失败：${key} ${expected[key]} != ${actual[key]}`), { code: 'project_migration_validation_failed' });
  }
  const foreign = db.prepare('PRAGMA foreign_key_check').all();
  const integrity = db.prepare('PRAGMA integrity_check').get();
  if (foreign.length || Object.values(integrity || {})[0] !== 'ok') {
    throw Object.assign(new Error('项目数据库完整性检查失败。'), { code: 'project_db_corrupt' });
  }
  return actual;
}

function migrateLegacyProjects({ dbPath, legacyJsonPath, now = Date.now }) {
  const raw = fs.existsSync(legacyJsonPath) ? fs.readFileSync(legacyJsonPath, 'utf8') : '{"version":1,"projects":[]}';
  let parsed;
  try { parsed = JSON.parse(raw); } catch (error) {
    throw Object.assign(new Error(`项目索引 JSON 无法解析：${error.message}`), { code: 'project_migration_failed' });
  }
  const projects = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.projects) ? parsed.projects : null;
  if (!projects) throw Object.assign(new Error('项目索引 JSON 结构损坏。'), { code: 'project_migration_failed' });
  const directory = path.dirname(dbPath); fs.mkdirSync(directory, { recursive: true });
  const migrationStamp = stamp(now);
  let backupPath = '';
  if (fs.existsSync(legacyJsonPath)) {
    backupPath = path.join(directory, `projects.pre-sqlite-${migrationStamp}.json`);
    fs.copyFileSync(legacyJsonPath, backupPath, fs.constants.COPYFILE_EXCL);
    try { fs.chmodSync(backupPath, 0o444); } catch { /* ACL may ignore POSIX mode */ }
  }
  const tempPath = `${dbPath}.migrating-${crypto.randomBytes(6).toString('hex')}`;
  let db;
  try {
    db = new DatabaseSync(tempPath); db.exec(schemaSql('DELETE'));
    const expected = importProjects(db, projects);
    validateDatabase(db, expected);
    db.prepare('INSERT OR REPLACE INTO project_meta(key,value) VALUES(?,?)').run('migration_source_sha256', sha256(raw));
    db.prepare('INSERT OR REPLACE INTO project_meta(key,value) VALUES(?,?)').run('migrated_at', new Date(now()).toISOString());
    db.prepare('INSERT OR REPLACE INTO project_meta(key,value) VALUES(?,?)').run('legacy_backup_path', backupPath);
    db.close(); db = null;
    fs.renameSync(tempPath, dbPath);
    const manifest = { version: 1, source: legacyJsonPath, sourceBytes: Buffer.byteLength(raw), sourceSha256: sha256(raw),
      backupPath, databasePath: dbPath, migratedAt: new Date(now()).toISOString(), ...expected };
    if (backupPath) fs.writeFileSync(`${backupPath}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    return manifest;
  } catch (error) {
    try { db?.close(); } catch { /* ignore */ }
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch { /* diagnostic remains in thrown error */ }
    throw Object.assign(error, { code: error.code || 'project_migration_failed', backupPath });
  }
}

function openDatabase(dbPath, quickCheck = true) {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
  let version = Number(db.prepare('PRAGMA user_version').get().user_version || 0);
  if (version === 1) {
    const backupPath = `${dbPath}.pre-schema-v2-${stamp()}.sqlite3`;
    db.exec(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`);
    try {
      db.exec('BEGIN IMMEDIATE');
      db.exec(stagingCountSchemaSql());
      db.exec(`INSERT INTO project_staging_counts(project_id,status,review_status,count)
        SELECT project_id,status,review_status,COUNT(*) FROM project_staging_items GROUP BY project_id,status,review_status;
        PRAGMA user_version=2; COMMIT;`);
    } catch (caught) {
      try { db.exec('ROLLBACK'); } catch { /* transaction already ended */ }
      db.close();
      throw Object.assign(caught, { code: 'project_db_schema_upgrade_failed', backupPath });
    }
    version = 2;
  }
  if (version === 2) {
    const backupPath = `${dbPath}.pre-schema-v3-${stamp()}.sqlite3`;
    db.exec(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`);
    try {
      db.exec(`BEGIN IMMEDIATE;
        DROP TRIGGER IF EXISTS project_staging_counts_ai;
        DROP TRIGGER IF EXISTS project_staging_counts_ad;
        DROP TRIGGER IF EXISTS project_staging_counts_au;
        ${stagingCountSchemaSql()}
        CREATE TABLE IF NOT EXISTS project_staging_search_rows (
          item_id TEXT PRIMARY KEY REFERENCES project_staging_items(item_id) ON DELETE CASCADE,
          project_id TEXT NOT NULL,
          search_rowid INTEGER NOT NULL UNIQUE
        ) STRICT;
        CREATE INDEX IF NOT EXISTS project_staging_search_rows_project ON project_staging_search_rows(project_id,item_id);
        DELETE FROM project_staging_search_rows;
        INSERT INTO project_staging_search_rows(item_id,project_id,search_rowid)
          SELECT item_id,project_id,rowid FROM project_staging_search;
        PRAGMA user_version=3;
        COMMIT;`);
    } catch (caught) {
      try { db.exec('ROLLBACK'); } catch { /* transaction already ended */ }
      db.close();
      throw Object.assign(caught, { code: 'project_db_schema_upgrade_failed', backupPath });
    }
    version = 3;
  }
  if (version !== SCHEMA_VERSION) throw Object.assign(new Error(`不支持的项目数据库版本：${version}`), { code: 'project_db_schema_unsupported' });
  db.exec(schemaSql('WAL'));
  if (quickCheck) {
    const quick = db.prepare('PRAGMA quick_check').get();
    if (Object.values(quick || {})[0] !== 'ok') throw Object.assign(new Error('项目数据库 quick_check 未通过。'), { code: 'project_db_corrupt' });
  }
  return db;
}

function hydrateProject(db, row, includeStaging = false, includeScan = false) {
  const payload = json(row.payload_json, {});
  const students = db.prepare('SELECT student_id,student_name FROM project_students WHERE project_id=? ORDER BY rowid').all(row.project_id);
  const assets = db.prepare('SELECT asset_id FROM project_assets WHERE project_id=? ORDER BY rowid').all(row.project_id);
  const result = { ...payload, id: row.project_id, revision: row.revision,
    studentIds: students.map(item => item.student_id), studentNames: students.map(item => item.student_name),
    assetIds: assets.map(item => item.asset_id), stagingItems: [], workspaceScanSnapshot: {} };
  if (includeStaging) result.stagingItems = db.prepare('SELECT payload_json FROM project_staging_items WHERE project_id=? ORDER BY rowid').all(row.project_id)
    .map(item => json(item.payload_json, {}));
  if (includeScan) for (const entry of db.prepare('SELECT entry_path,payload_json FROM project_workspace_scan_entries WHERE project_id=?').all(row.project_id)) {
    result.workspaceScanSnapshot[entry.entry_path] = json(entry.payload_json, null);
  }
  return result;
}

function createProjectStateStore({ dbPath, legacyJsonPath, now = Date.now, quickCheck = true }) {
  let db = null, migration = null, error = null, metadataCache = null, allCache = null;
  function initialize() {
    if (db) return api;
    if (error) throw error;
    try {
      if (!fs.existsSync(dbPath)) migration = migrateLegacyProjects({ dbPath, legacyJsonPath, now });
      db = openDatabase(dbPath, quickCheck); return api;
    } catch (caught) { error = Object.assign(caught, { code: caught.code || 'project_db_corrupt' }); throw error; }
  }
  function listMetadata() {
    initialize();
    if (!metadataCache) metadataCache = db.prepare('SELECT * FROM projects ORDER BY updated_at DESC,project_id').all()
      .map(row => hydrateProject(db, row, false, false));
    return metadataCache;
  }
  function readAll() {
    initialize();
    if (!allCache) allCache = db.prepare('SELECT * FROM projects ORDER BY updated_at DESC,project_id').all()
      .map(row => hydrateProject(db, row, true, true));
    return allCache;
  }
  function get(projectId, options = {}) {
    initialize(); const row = db.prepare('SELECT * FROM projects WHERE project_id=?').get(text(projectId));
    return row ? hydrateProject(db, row, options.includeStaging !== false, options.includeScan !== false) : null;
  }
  function getMetadata(projectId) {
    initialize(); const row = db.prepare('SELECT * FROM projects WHERE project_id=?').get(text(projectId));
    return row ? hydrateProject(db, row, false, false) : null;
  }
  function patchProjectMetadata(projectId, patch = {}, expectedRevision = null) {
    initialize();
    const id = text(projectId);
    const row = db.prepare('SELECT * FROM projects WHERE project_id=?').get(id);
    if (!row) throw Object.assign(new Error('未找到学习项目。'), { code: 'project_not_found' });
    if (expectedRevision != null && Number(expectedRevision) !== Number(row.revision)) {
      throw Object.assign(new Error('项目数据已更新，请刷新后重试。'), { code: 'project_revision_conflict' });
    }
    const input = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
    const forbidden = ['id','projectId','studentIds','studentNames','assetIds','stagingItems','workspaceScanSnapshot'];
    if (forbidden.some(key => Object.prototype.hasOwnProperty.call(input, key))) {
      throw Object.assign(new Error('元数据补丁不得修改项目关系、暂存资料或扫描快照。'), { code: 'project_metadata_patch_forbidden' });
    }
    const nowText = new Date(now()).toISOString();
    const current = json(row.payload_json, {});
    const next = mergePatch(current, input);
    next.updatedAt = text(input.updatedAt || next.updatedAt || nowText);
    const revision = Number(row.revision) + 1;
    db.prepare(`UPDATE projects SET name=?,type=?,status=?,updated_at=?,revision=?,payload_json=?
      WHERE project_id=?`).run(text(next.name), text(next.type), text(next.status || 'active'),
        next.updatedAt, revision, stableJson(next), id);
    metadataCache = null; allCache = null;
    return getMetadata(id);
  }
  function listProjects(request = {}) {
    initialize();
    const limit = safePageSize(request.pageSize), offset = cursorOffset(request.cursor);
    const where = [], values = [];
    if (request.studentId) {
      where.push('EXISTS(SELECT 1 FROM project_students ps WHERE ps.project_id=p.project_id AND ps.student_id=?)');
      values.push(text(request.studentId));
    }
    if (request.status && request.status !== 'all') { where.push('p.status=?'); values.push(text(request.status)); }
    const keyword = text(request.query).trim();
    if (keyword) {
      const pattern = `%${keyword.replace(/[\\%_]/g, '\\$&')}%`;
      where.push("(p.name LIKE ? ESCAPE '\\' OR p.type LIKE ? ESCAPE '\\' OR p.payload_json LIKE ? ESCAPE '\\')");
      values.push(pattern, pattern, pattern);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = Number(db.prepare(`SELECT COUNT(*) count FROM projects p ${clause}`).get(...values).count);
    const rows = db.prepare(`SELECT p.*,
      (SELECT COUNT(*) FROM project_staging_items si WHERE si.project_id=p.project_id) staging_count,
      (SELECT COUNT(*) FROM project_staging_items si WHERE si.project_id=p.project_id AND si.review_status='accepted') accepted_staging_count,
      (SELECT COUNT(*) FROM project_staging_items si WHERE si.project_id=p.project_id AND si.status NOT IN ('promoted','analyzed','discarded')) pending_staging_count
      FROM projects p ${clause} ORDER BY p.updated_at DESC,p.project_id LIMIT ? OFFSET ?`).all(...values, limit, offset);
    const items = rows.map(row => ({ ...hydrateProject(db, row, false, false), stagingItemsDeferred: Number(row.staging_count) > 0,
      stagingSummary: { total: Number(row.staging_count), accepted: Number(row.accepted_staging_count), pending: Number(row.pending_staging_count) } }));
    return { items, total, nextCursor: offset + items.length < total ? nextCursor(offset + items.length) : '' };
  }
  function replaceAll(projects) {
    initialize(); const list = Array.isArray(projects) ? projects : [];
    const previous = new Set(db.prepare('SELECT project_id FROM projects').all().map(item => item.project_id));
    const statements = makeStatements(db); db.exec('BEGIN IMMEDIATE');
    try {
      for (const project of list) { const result = replaceProject(db, statements, project); previous.delete(result.projectId); }
      const remove = db.prepare('DELETE FROM projects WHERE project_id=?'); previous.forEach(id => remove.run(id));
      db.exec('COMMIT');
    } catch (caught) { try { db.exec('ROLLBACK'); } catch { /* ignore */ } throw caught; }
    metadataCache = null; allCache = null;
    return list;
  }
  function upsert(raw) {
    initialize(); const statements = makeStatements(db);
    db.exec('BEGIN IMMEDIATE');
    try { replaceProject(db, statements, raw); db.exec('COMMIT'); }
    catch (caught) { try { db.exec('ROLLBACK'); } catch {} throw caught; }
    metadataCache = null; allCache = null;
    return get(text(raw?.id || raw?.projectId), { includeStaging: true, includeScan: true });
  }
  function remove(projectId) {
    initialize();
    const id = text(projectId);
    db.exec('BEGIN IMMEDIATE');
    let result;
    try {
      db.prepare('DELETE FROM project_staging_search WHERE rowid IN (SELECT search_rowid FROM project_staging_search_rows WHERE project_id=?)').run(id);
      result = db.prepare('DELETE FROM projects WHERE project_id=?').run(id);
      db.exec('COMMIT');
    } catch (caught) { try { db.exec('ROLLBACK'); } catch { /* ignore */ } throw caught; }
    metadataCache = null; allCache = null;
    return Number(result.changes || 0);
  }
  function listStaging(request = {}) {
    initialize();
    const projectId = text(request.projectId); if (!projectId) throw Object.assign(new Error('缺少项目编号。'), { code: 'project_not_found' });
    const limit = safePageSize(request.pageSize), decoded = cursorValue(request.cursor);
    const where = ['project_id=?']; const values = [projectId];
    if (request.status && request.status !== 'all') { where.push('status=?'); values.push(text(request.status)); }
    if (request.reviewStatus && request.reviewStatus !== 'all') { where.push('review_status=?'); values.push(text(request.reviewStatus)); }
    const keyword = text(request.query).trim();
    let searchCandidateCount = 0;
    if (keyword) {
      if (/^[a-f0-9]{40}$/i.test(keyword)) { where.push('sha1=?'); values.push(keyword.toLowerCase()); }
      else if (/^[a-f0-9]{64}$/i.test(keyword)) { where.push('sha256=?'); values.push(keyword.toLowerCase()); }
      else if ([...keyword].length >= 3) {
        const expression = keyword.split(/\s+/).filter(Boolean).map(part => `"${part.replaceAll('"', '""')}"`).join(' AND ');
        const candidateIds = db.prepare(`SELECT item_id FROM project_staging_items
          WHERE project_id=? AND filename>=? COLLATE NOCASE AND filename<? COLLATE NOCASE LIMIT 201`)
          .all(projectId, keyword, `${keyword}\uffff`).map(item => item.item_id);
        if (candidateIds.length < 201) {
          const remaining = 201 - candidateIds.length;
          const ftsRows = db.prepare(`SELECT item_id FROM project_staging_search
            WHERE project_staging_search MATCH ? AND project_id=? LIMIT ?`).all(expression, projectId, remaining);
          const seen = new Set(candidateIds);
          for (const row of ftsRows) if (!seen.has(row.item_id)) { seen.add(row.item_id); candidateIds.push(row.item_id); }
        }
        searchCandidateCount = candidateIds.length;
        if (!candidateIds.length) return { items: [], total: 0, totalIsLowerBound: false, nextCursor: '' };
        // Candidate ids were already selected inside the requested project.
        // Removing the broad project predicate lets SQLite use the item_id
        // primary key for these bounded lookups instead of scanning the whole
        // project's staging index before applying the IN set.
        where.shift(); values.shift();
        where.push(`item_id IN (${candidateIds.map(() => '?').join(',')})`);
        values.push(...candidateIds);
      } else {
        const escaped = keyword.replace(/[\\%_]/g, '\\$&');
        where.push("(filename LIKE ? ESCAPE '\\' OR path LIKE ? ESCAPE '\\' OR source_path LIKE ? ESCAPE '\\')");
        values.push(`%${escaped}%`, `%${escaped}%`, `%${escaped}%`);
      }
    }
    const countClause = where.join(' AND ');
    const total = searchCandidateCount
      ? Number(db.prepare(`SELECT COUNT(*) count FROM project_staging_items WHERE ${countClause}`).get(...values).count)
      : keyword
      ? Number(db.prepare(`SELECT COUNT(*) count FROM (SELECT 1 FROM project_staging_items WHERE ${countClause} LIMIT 201)`).get(...values).count)
      : Number(db.prepare(`SELECT COALESCE(SUM(count),0) count FROM project_staging_counts WHERE project_id=?
          ${request.status && request.status !== 'all' ? 'AND status=?' : ''}
          ${request.reviewStatus && request.reviewStatus !== 'all' ? 'AND review_status=?' : ''}`).get(projectId,
            ...(request.status && request.status !== 'all' ? [text(request.status)] : []),
            ...(request.reviewStatus && request.reviewStatus !== 'all' ? [text(request.reviewStatus)] : [])).count);
    const pageWhere = [...where], pageValues = [...values];
    if (decoded?.v === 2 && decoded.updatedAt != null && decoded.itemId) {
      pageWhere.push('(updated_at<? OR (updated_at=? AND item_id>?))');
      pageValues.push(text(decoded.updatedAt), text(decoded.updatedAt), text(decoded.itemId));
    }
    const pageRows = db.prepare(`SELECT item_id,updated_at,payload_json,revision FROM project_staging_items WHERE ${pageWhere.join(' AND ')} ORDER BY updated_at DESC,item_id LIMIT ?`)
      .all(...pageValues, limit + 1);
    const hasMore = pageRows.length > limit, selected = pageRows.slice(0, limit), last = selected.at(-1);
    const rows = selected.map(row => ({ ...json(row.payload_json, {}), recordRevision: row.revision }));
    return { items: rows, total, totalIsLowerBound: Boolean(keyword && (searchCandidateCount >= 201 || total >= 201)),
      nextCursor: hasMore && last ? opaqueCursor({ v: 2, updatedAt: last.updated_at, itemId: last.item_id }) : '' };
  }
  function stagingSummary(projectId) {
    initialize();
    const rows = db.prepare('SELECT status,review_status,count FROM project_staging_counts WHERE project_id=?').all(text(projectId));
    const byStatus = {}, byReviewStatus = {}; let total = 0;
    for (const row of rows) { const count = Number(row.count); total += count; byStatus[row.status] = (byStatus[row.status] || 0) + count; byReviewStatus[row.review_status] = (byReviewStatus[row.review_status] || 0) + count; }
    return { total, byStatus, byReviewStatus };
  }
  function mutateStaging(request = {}) {
    initialize();
    const projectId = text(request.projectId);
    const project = db.prepare('SELECT revision FROM projects WHERE project_id=?').get(projectId);
    if (!project) throw Object.assign(new Error('未找到学习项目。'), { code: 'project_not_found' });
    if (request.expectedRevision != null && Number(request.expectedRevision) !== Number(project.revision)) {
      throw Object.assign(new Error('项目数据已更新，请刷新后重试。'), { code: 'project_revision_conflict' });
    }
    const allowedStatuses = new Set(['collected','screened','selected','analyzed','promoted','discarded']);
    const allowedReviews = new Set(['pending','accepted','rejected']);
    const patch = request.patch && typeof request.patch === 'object' ? request.patch : {};
    if (patch.status != null && !allowedStatuses.has(text(patch.status))) throw Object.assign(new Error('无效的暂存状态。'), { code: 'project_invalid_status' });
    if (patch.reviewStatus != null && !allowedReviews.has(text(patch.reviewStatus))) throw Object.assign(new Error('无效的审核状态。'), { code: 'project_invalid_review_status' });
    const ids = Array.isArray(request.itemIds) ? [...new Set(request.itemIds.map(text).filter(Boolean))] : [];
    let rows;
    if (request.selection === 'filter') {
      const where = ['project_id=?']; const values = [projectId];
      if (request.status && request.status !== 'all') { where.push('status=?'); values.push(text(request.status)); }
      if (request.reviewStatus && request.reviewStatus !== 'all') { where.push('review_status=?'); values.push(text(request.reviewStatus)); }
      rows = db.prepare(`SELECT item_id,status,review_status,payload_json,revision FROM project_staging_items WHERE ${where.join(' AND ')}`).all(...values);
    } else {
      if (!ids.length) return { affected: 0, items: [], revision: Number(project.revision), summary: stagingSummary(projectId) };
      rows = [];
      const boundedIds = ids.slice(0, 5000);
      for (let offset = 0; offset < boundedIds.length; offset += 500) {
        const chunk = boundedIds.slice(offset, offset + 500);
        rows.push(...db.prepare(`SELECT item_id,project_id,status,review_status,payload_json,revision FROM project_staging_items
          WHERE item_id IN (${chunk.map(() => '?').join(',')})`).all(...chunk).filter(row => row.project_id === projectId));
      }
    }
    const nowText = new Date(now()).toISOString();
    // Status-only batches are the common automation path. Update the bounded
    // set in one SQL statement instead of parsing and rewriting one row at a
    // time in JavaScript; JSON1 keeps the compatibility payload in sync.
    if (patch.reviewNote == null && rows.length) {
      const rowIds = rows.map(row => row.item_id);
      const assignments = [];
      const jsonArgs = ["'$.updatedAt',?", "'$.recordRevision',revision+1"];
      const values = [];
      if (patch.status != null) {
        assignments.push('status=?'); values.push(text(patch.status));
        jsonArgs.push("'$.status',?");
      }
      if (patch.reviewStatus != null) {
        assignments.push('review_status=?'); values.push(text(patch.reviewStatus));
        jsonArgs.push("'$.reviewStatus',?");
      }
      assignments.push('updated_at=?', 'revision=revision+1');
      const jsonValues = [nowText];
      if (patch.status != null) jsonValues.push(text(patch.status));
      if (patch.reviewStatus != null) jsonValues.push(text(patch.reviewStatus));
      assignments.push(`payload_json=json_set(payload_json,${jsonArgs.join(',')})`);
      const countDeltas = new Map();
      for (const row of rows) {
        const nextStatus = patch.status == null ? row.status : text(patch.status);
        const nextReview = patch.reviewStatus == null ? row.review_status : text(patch.reviewStatus);
        if (nextStatus === row.status && nextReview === row.review_status) continue;
        const oldKey = `${row.status}\u0000${row.review_status}`;
        const newKey = `${nextStatus}\u0000${nextReview}`;
        countDeltas.set(oldKey, Number(countDeltas.get(oldKey) || 0) - 1);
        countDeltas.set(newKey, Number(countDeltas.get(newKey) || 0) + 1);
      }
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('INSERT OR REPLACE INTO project_meta(key,value) VALUES(?,?)').run('staging_counts_suspended', '1');
        db.prepare(`UPDATE project_staging_items SET ${assignments.join(',')}
          WHERE item_id IN (${rowIds.map(() => '?').join(',')})`).run(
          ...values, nowText, ...jsonValues, ...rowIds);
        const adjustCount = db.prepare(`INSERT INTO project_staging_counts(project_id,status,review_status,count)
          VALUES(?,?,?,?) ON CONFLICT(project_id,status,review_status) DO UPDATE SET count=count+excluded.count`);
        for (const [key, delta] of countDeltas) {
          if (!delta) continue;
          const [status, reviewStatus] = key.split('\u0000');
          adjustCount.run(projectId, status, reviewStatus, delta);
        }
        db.prepare('DELETE FROM project_staging_counts WHERE project_id=? AND count<=0').run(projectId);
        db.prepare('DELETE FROM project_meta WHERE key=?').run('staging_counts_suspended');
        db.prepare('UPDATE projects SET revision=revision+1,updated_at=? WHERE project_id=?').run(nowText, projectId);
        db.exec('COMMIT');
      } catch (caught) { try { db.exec('ROLLBACK'); } catch { /* ignore */ } throw caught; }
      metadataCache = null; allCache = null;
      const changed = db.prepare(`SELECT payload_json FROM project_staging_items
        WHERE item_id IN (${rowIds.map(() => '?').join(',')}) LIMIT ?`)
        .all(...rowIds, MAX_PAGE_SIZE).map(row => json(row.payload_json, {}));
      return { affected: rows.length, items: changed,
        revision: Number(db.prepare('SELECT revision FROM projects WHERE project_id=?').get(projectId).revision),
        summary: stagingSummary(projectId) };
    }
    const update = db.prepare(`UPDATE project_staging_items SET status=?,review_status=?,updated_at=?,revision=?,payload_json=? WHERE project_id=? AND item_id=?`);
    const searchRowIds = new Map();
    const rowIds = patch.reviewNote != null ? rows.map(row => row.item_id) : [];
    // item_id/project_id are deliberately UNINDEXED inside FTS. Resolve the
    // bounded target set in one scan, then update by rowid; doing one FTS scan
    // per item turns a 100-row patch on a 30k project into a multi-second stall.
    for (let offset = 0; offset < rowIds.length; offset += 500) {
      const chunk = rowIds.slice(offset, offset + 500);
      for (const hit of db.prepare(`SELECT search_rowid,item_id FROM project_staging_search_rows
        WHERE project_id=? AND item_id IN (${chunk.map(() => '?').join(',')})`).all(projectId, ...chunk)) {
        searchRowIds.set(hit.item_id, hit.search_rowid);
      }
    }
    const changed = []; const searchUpdates = [];
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const row of rows) {
        const payload = json(row.payload_json, {});
        if (patch.status != null) payload.status = text(patch.status);
        if (patch.reviewStatus != null) payload.reviewStatus = text(patch.reviewStatus);
        if (patch.reviewNote != null) payload.reviewNote = text(patch.reviewNote);
        payload.updatedAt = nowText; payload.recordRevision = Number(row.revision) + 1;
        update.run(text(payload.status || 'collected'), text(payload.reviewStatus || 'pending'), nowText,
          payload.recordRevision, stableJson(payload), projectId, row.item_id);
        const searchRowId = searchRowIds.get(row.item_id);
        if (searchRowId != null) searchUpdates.push({ rowid: searchRowId,
          governance: [payload.aiAction,payload.aiReason,payload.governanceAction,payload.governanceReason,payload.reviewNote].filter(Boolean).join(' ') });
        if (changed.length < MAX_PAGE_SIZE) changed.push(payload);
      }
      // One virtual-table statement avoids repeatedly creating FTS delete/insert
      // segments for every item in a bounded batch.
      if (searchUpdates.length) {
        const cases = searchUpdates.map(() => 'WHEN ? THEN ?').join(' ');
        const rowids = searchUpdates.map(() => '?').join(',');
        db.prepare(`UPDATE project_staging_search SET governance=CASE rowid ${cases} ELSE governance END
          WHERE rowid IN (${rowids})`).run(
          ...searchUpdates.flatMap(item => [item.rowid, item.governance]),
          ...searchUpdates.map(item => item.rowid));
      }
      db.prepare('UPDATE projects SET revision=revision+1,updated_at=? WHERE project_id=?').run(nowText, projectId);
      db.exec('COMMIT');
    } catch (caught) { try { db.exec('ROLLBACK'); } catch { /* ignore */ } throw caught; }
    metadataCache = null; allCache = null;
    return { affected: rows.length, items: changed,
      revision: Number(db.prepare('SELECT revision FROM projects WHERE project_id=?').get(projectId).revision),
      summary: stagingSummary(projectId) };
  }
  function mutateStagingBatch(request = {}) {
    initialize();
    const projectId = text(request.projectId);
    let itemIds = Array.isArray(request.itemIds)
      ? [...new Set(request.itemIds.map(text).filter(Boolean))].slice(0, MAX_PAGE_SIZE) : [];
    if (request.selection === 'filter') {
      const where = ['project_id=?']; const values = [projectId];
      if (request.status && request.status !== 'all') { where.push('status=?'); values.push(text(request.status)); }
      if (request.reviewStatus && request.reviewStatus !== 'all') { where.push('review_status=?'); values.push(text(request.reviewStatus)); }
      itemIds = db.prepare(`SELECT item_id FROM project_staging_items WHERE ${where.join(' AND ')}
        ORDER BY updated_at,item_id LIMIT ?`).all(...values, MAX_PAGE_SIZE).map(row => row.item_id);
    }
    return mutateStaging({ ...request, selection: 'ids', itemIds });
  }
  function upsertWorkspaceScanBatch(request = {}) {
    initialize();
    const projectId = text(request.projectId);
    const project = db.prepare('SELECT revision FROM projects WHERE project_id=?').get(projectId);
    if (!project) throw Object.assign(new Error('未找到学习项目。'), { code: 'project_not_found' });
    if (request.expectedRevision != null && Number(request.expectedRevision) !== Number(project.revision)) {
      throw Object.assign(new Error('项目数据已更新，请刷新后重试。'), { code: 'project_revision_conflict' });
    }
    const entries = (Array.isArray(request.entries) ? request.entries : []).slice(0, MAX_PAGE_SIZE)
      .map(entry => ({ path: text(entry?.path || entry?.entryPath), value: entry?.value ?? entry?.payload ?? entry }))
      .filter(entry => entry.path);
    const statement = db.prepare(`INSERT INTO project_workspace_scan_entries(project_id,entry_path,payload_json)
      VALUES(?,?,?) ON CONFLICT(project_id,entry_path) DO UPDATE SET payload_json=excluded.payload_json`);
    const nowText = new Date(now()).toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const entry of entries) statement.run(projectId, entry.path, stableJson(entry.value));
      if (entries.length) db.prepare('UPDATE projects SET revision=revision+1,updated_at=? WHERE project_id=?').run(nowText, projectId);
      db.exec('COMMIT');
    } catch (caught) { try { db.exec('ROLLBACK'); } catch { /* ignore */ } throw caught; }
    metadataCache = null; allCache = null;
    return { affected: entries.length,
      revision: Number(db.prepare('SELECT revision FROM projects WHERE project_id=?').get(projectId).revision) };
  }
  function replaceProjectSnapshot(raw, options = {}) {
    const allowed = new Set(['migration','restore','full_rebuild']);
    if (!allowed.has(text(options.purpose))) {
      throw Object.assign(new Error('完整项目替换仅允许用于迁移、恢复或显式重建。'), { code: 'project_full_replace_forbidden' });
    }
    return upsert(raw);
  }
  function checkpoint(mode = 'PASSIVE') {
    initialize();
    const selected = String(mode || 'PASSIVE').toUpperCase() === 'TRUNCATE' ? 'TRUNCATE' : 'PASSIVE';
    const result = db.prepare(`PRAGMA wal_checkpoint(${selected})`).get();
    return { mode: selected, busy: Number(result?.busy || 0), log: Number(result?.log || 0), checkpointed: Number(result?.checkpointed || 0) };
  }
  function integrityCheck() {
    initialize();
    const integrity = Object.values(db.prepare('PRAGMA integrity_check').get() || {})[0] || '';
    const foreignKeys = db.prepare('PRAGMA foreign_key_check').all();
    return { ok: integrity === 'ok' && foreignKeys.length === 0, integrity, foreignKeyErrors: foreignKeys };
  }
  async function backupTo(destination) { initialize(); return backup(db, destination); }
  const api = { initialize, listMetadata, listProjects, readAll, get, getMetadata, patchProjectMetadata,
    replaceAll, upsert, replaceProjectSnapshot, remove, listStaging, stagingSummary, mutateStaging, mutateStagingBatch,
    upsertWorkspaceScanBatch, checkpoint, integrityCheck, backupTo,
    migrationResult: () => migration, initializationError: () => error,
    invalidateCaches() { metadataCache = null; allCache = null; },
    close() { if (db) db.close(); db = null; metadataCache = null; allCache = null; }, dbPath };
  return api;
}

module.exports = { SCHEMA_VERSION, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, createProjectStateStore, migrateLegacyProjects };
