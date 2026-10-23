'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync, backup } = require('node:sqlite');

const SCHEMA_VERSION = 4;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

const ASSET_COLUMNS = [
  'asset_id', 'sha1', 'sha256', 'filename', 'byte_size', 'asset_type', 'canonical_path',
  'owner_student_id', 'owner_student_name', 'source_path', 'source_name', 'source_type',
  'status', 'uploaded_at', 'created_at', 'updated_at', 'governance_action', 'governance_reason',
  'governance_risk', 'governance_decision', 'governance_decision_label',
  'governance_decision_note', 'governance_decision_at', 'governance_status',
  'governance_reviewed_at', 'recommended_keep_asset_id', 'record_json',
];

const FIELD_TO_COLUMN = {
  assetId: 'asset_id', sha1: 'sha1', sha256: 'sha256', filename: 'filename', size: 'byte_size',
  type: 'asset_type', path: 'canonical_path', ownerStudentId: 'owner_student_id',
  ownerStudentName: 'owner_student_name', sourcePath: 'source_path', sourceName: 'source_name',
  sourceType: 'source_type', status: 'status', uploadedAt: 'uploaded_at', createdAt: 'created_at',
  updatedAt: 'updated_at', governanceAction: 'governance_action', governanceReason: 'governance_reason',
  governanceRisk: 'governance_risk', governanceDecision: 'governance_decision',
  governanceDecisionLabel: 'governance_decision_label', governanceDecisionNote: 'governance_decision_note',
  governanceDecisionAt: 'governance_decision_at', governanceStatus: 'governance_status',
  governanceReviewedAt: 'governance_reviewed_at', recommendedKeepAssetId: 'recommended_keep_asset_id',
};

const REFERENCE_FIELDS = [
  ['referenceId', 'reference_id'], ['spaceType', 'space_type'], ['spaceId', 'space_id'],
  ['spaceName', 'space_name'], ['workspaceId', 'workspace_id'], ['studentId', 'student_id'],
  ['deviceId', 'device_id'], ['contentSha256', 'content_sha256'], ['logicalPath', 'logical_path'],
  ['role', 'role'], ['path', 'path'], ['source', 'source'], ['linkedAt', 'linked_at'],
  ['state', 'state'], ['quarantineOperationId', 'quarantine_operation_id'],
  ['availabilityState', 'availability_state'], ['availabilityCheckedAt', 'availability_checked_at'],
];

function text(value) { return String(value ?? ''); }
function nowIso(now) { return new Date(now()).toISOString(); }
function fingerprint(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function json(value) { return JSON.stringify(value ?? {}); }
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}
function comparableRecord(value) {
  let record = value && typeof value === 'object' ? { ...value } : {};
  if (typeof value === 'string') {
    try { record = JSON.parse(value || '{}'); } catch { record = {}; }
  }
  delete record.updatedAt;
  delete record.references;
  delete record.linkedStudents;
  delete record.linkedProjects;
  delete record.aliases;
  return stableJson(record);
}

function cursorEncode(value) {
  return Buffer.from(JSON.stringify(value && typeof value === 'object' ? value : { offset: value }), 'utf8').toString('base64url');
}

function cursorDecode(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    if (parsed && typeof parsed === 'object') return parsed;
    return null;
  } catch { return null; }
}

function normalizeReference(reference, fallback = {}) {
  const value = reference && typeof reference === 'object' ? reference : {};
  const normalized = {};
  for (const [field] of REFERENCE_FIELDS) normalized[field] = text(value[field]);
  normalized.referenceId = normalized.referenceId || text(value.id) || text(fallback.referenceId)
    || `ref-${crypto.randomUUID()}`;
  normalized.spaceType = normalized.spaceType || text(fallback.spaceType) || 'legacy';
  normalized.spaceId = normalized.spaceId || text(fallback.spaceId);
  normalized.spaceName = normalized.spaceName || text(fallback.spaceName);
  normalized.studentId = normalized.studentId || text(fallback.studentId);
  normalized.role = normalized.role || text(fallback.role) || 'raw';
  normalized.path = normalized.path || text(fallback.path);
  normalized.source = normalized.source || text(fallback.source);
  normalized.linkedAt = normalized.linkedAt || text(fallback.linkedAt) || new Date().toISOString();
  normalized.state = normalized.state || text(fallback.state) || 'active';
  normalized.availabilityState = normalized.availabilityState || text(fallback.availabilityState) || 'unchecked';
  return normalized;
}

function referenceKey(reference) {
  return [reference.spaceType, reference.spaceId, reference.role, reference.path].map(text).join('|');
}

function assetValues(asset) {
  const clean = asset && typeof asset === 'object' ? asset : {};
  const values = {};
  for (const [field, column] of Object.entries(FIELD_TO_COLUMN)) {
    values[column] = field === 'size' ? Math.max(0, Number(clean[field]) || 0) : text(clean[field]);
  }
  values.record_json = json(Object.fromEntries(Object.entries(clean)
    .filter(([key]) => !['references', 'linkedStudents', 'linkedProjects'].includes(key))));
  return values;
}

function rowToAsset(row) {
  let stored = {};
  try { stored = JSON.parse(row.record_json || '{}'); } catch { /* explicit columns remain authoritative */ }
  const asset = { ...stored };
  for (const [field, column] of Object.entries(FIELD_TO_COLUMN)) {
    const value = row[column];
    asset[field] = field === 'size' ? Number(value || 0) : text(value);
  }
  return asset;
}

function rowToReference(row) {
  const result = { id: text(row.reference_id) };
  for (const [field, column] of REFERENCE_FIELDS) result[field === 'referenceId' ? 'id' : field] = text(row[column]);
  return result;
}

function schemaSql() {
  return `
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS asset_index_meta (
      key TEXT PRIMARY KEY, value TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS assets (
      asset_id TEXT PRIMARY KEY,
      sha1 TEXT NOT NULL DEFAULT '', sha256 TEXT NOT NULL DEFAULT '',
      filename TEXT NOT NULL DEFAULT '', byte_size INTEGER NOT NULL DEFAULT 0,
      asset_type TEXT NOT NULL DEFAULT 'file', canonical_path TEXT NOT NULL DEFAULT '',
      owner_student_id TEXT NOT NULL DEFAULT '', owner_student_name TEXT NOT NULL DEFAULT '',
      source_path TEXT NOT NULL DEFAULT '', source_name TEXT NOT NULL DEFAULT '', source_type TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active', uploaded_at TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '',
      governance_action TEXT NOT NULL DEFAULT '', governance_reason TEXT NOT NULL DEFAULT '', governance_risk TEXT NOT NULL DEFAULT '',
      governance_decision TEXT NOT NULL DEFAULT '', governance_decision_label TEXT NOT NULL DEFAULT '', governance_decision_note TEXT NOT NULL DEFAULT '',
      governance_decision_at TEXT NOT NULL DEFAULT '', governance_status TEXT NOT NULL DEFAULT '', governance_reviewed_at TEXT NOT NULL DEFAULT '',
      recommended_keep_asset_id TEXT NOT NULL DEFAULT '', record_json TEXT NOT NULL DEFAULT '{}'
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS assets_sha1_unique ON assets(sha1) WHERE sha1 <> '';
    CREATE INDEX IF NOT EXISTS assets_sha256 ON assets(sha256) WHERE sha256 <> '';
    CREATE INDEX IF NOT EXISTS assets_owner_student ON assets(owner_student_id);
    CREATE INDEX IF NOT EXISTS assets_owner_filename ON assets(owner_student_id, filename COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS assets_updated ON assets(updated_at DESC, asset_id);
    CREATE INDEX IF NOT EXISTS assets_filename ON assets(filename COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS assets_source ON assets(source_name);
    CREATE INDEX IF NOT EXISTS assets_type_risk ON assets(asset_type, governance_risk);
    CREATE TABLE IF NOT EXISTS asset_references (
      row_id INTEGER PRIMARY KEY,
      reference_id TEXT NOT NULL, asset_id TEXT NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
      space_type TEXT NOT NULL DEFAULT '', space_id TEXT NOT NULL DEFAULT '', space_name TEXT NOT NULL DEFAULT '',
      workspace_id TEXT NOT NULL DEFAULT '', student_id TEXT NOT NULL DEFAULT '', device_id TEXT NOT NULL DEFAULT '',
      content_sha256 TEXT NOT NULL DEFAULT '', logical_path TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT '',
      path TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '', linked_at TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT 'active', quarantine_operation_id TEXT NOT NULL DEFAULT '',
      availability_state TEXT NOT NULL DEFAULT 'unchecked', availability_checked_at TEXT NOT NULL DEFAULT '',
      UNIQUE(asset_id, space_type, space_id, role, path)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS asset_refs_asset ON asset_references(asset_id);
    CREATE INDEX IF NOT EXISTS asset_refs_asset_state_path ON asset_references(asset_id,state,path);
    CREATE INDEX IF NOT EXISTS asset_refs_space ON asset_references(space_type, space_id);
    CREATE INDEX IF NOT EXISTS asset_refs_space_state_asset ON asset_references(space_type,space_id,state,asset_id);
    CREATE INDEX IF NOT EXISTS asset_refs_student ON asset_references(student_id);
    CREATE INDEX IF NOT EXISTS asset_refs_student_state_asset ON asset_references(student_id,state,asset_id);
    CREATE INDEX IF NOT EXISTS asset_refs_device ON asset_references(device_id);
    CREATE INDEX IF NOT EXISTS asset_refs_path ON asset_references(path);
    CREATE INDEX IF NOT EXISTS asset_refs_availability ON asset_references(availability_state,asset_id);
    CREATE TABLE IF NOT EXISTS asset_aliases (
      old_asset_id TEXT PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE
    ) STRICT;
    CREATE TABLE IF NOT EXISTS asset_scan_runs (
      run_id TEXT PRIMARY KEY, status TEXT NOT NULL, phase TEXT NOT NULL,
      started_at TEXT NOT NULL, updated_at TEXT NOT NULL, finished_at TEXT NOT NULL DEFAULT '',
      discovered INTEGER NOT NULL DEFAULT 0, processed INTEGER NOT NULL DEFAULT 0,
      added INTEGER NOT NULL DEFAULT 0, changed INTEGER NOT NULL DEFAULT 0,
      skipped INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0,
      current_path TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', cancelled INTEGER NOT NULL DEFAULT 0,
      phase_total INTEGER NOT NULL DEFAULT 0, phase_processed INTEGER NOT NULL DEFAULT 0,
      current_scope_type TEXT NOT NULL DEFAULT '', current_scope_id TEXT NOT NULL DEFAULT '', current_scope_name TEXT NOT NULL DEFAULT ''
    ) STRICT;
    CREATE TABLE IF NOT EXISTS asset_duplicate_operations (
      operation_id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at TEXT NOT NULL,
      confirmed_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL, finished_at TEXT NOT NULL DEFAULT '',
      filter_json TEXT NOT NULL DEFAULT '{}', summary_json TEXT NOT NULL DEFAULT '{}', error TEXT NOT NULL DEFAULT ''
    ) STRICT;
    CREATE TABLE IF NOT EXISTS asset_duplicate_entries (
      entry_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES asset_duplicate_operations(operation_id) ON DELETE CASCADE,
      asset_id TEXT NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
      keep_path TEXT NOT NULL, source_path TEXT NOT NULL, quarantine_path TEXT NOT NULL DEFAULT '',
      space_type TEXT NOT NULL DEFAULT '', space_id TEXT NOT NULL DEFAULT '',
      sha1 TEXT NOT NULL DEFAULT '', sha256 TEXT NOT NULL DEFAULT '', byte_size INTEGER NOT NULL DEFAULT 0,
      mtime_ms REAL NOT NULL DEFAULT 0, file_key TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', reference_snapshot_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS asset_duplicate_entries_operation ON asset_duplicate_entries(operation_id,status);
    CREATE INDEX IF NOT EXISTS asset_duplicate_entries_asset ON asset_duplicate_entries(asset_id);
    CREATE VIRTUAL TABLE IF NOT EXISTS asset_search USING fts5(
      asset_id UNINDEXED, filename, paths, owner_name, source_name, sha1, sha256, governance
    );
    ${summarySchemaSql()}
  `;
}

function summarySchemaSql() {
  return `
    CREATE TABLE IF NOT EXISTS asset_summary_rows (
      asset_id TEXT PRIMARY KEY REFERENCES assets(asset_id) ON DELETE CASCADE,
      owner_student_id TEXT NOT NULL DEFAULT '', source_name TEXT NOT NULL DEFAULT '',
      asset_type TEXT NOT NULL DEFAULT 'file', governance_risk TEXT NOT NULL DEFAULT '',
      issue_count INTEGER NOT NULL DEFAULT 0, high_risk_count INTEGER NOT NULL DEFAULT 0,
      sha256_ready_count INTEGER NOT NULL DEFAULT 0, sha256_pending_count INTEGER NOT NULL DEFAULT 0,
      fingerprint_conflict_count INTEGER NOT NULL DEFAULT 0,
      reference_count INTEGER NOT NULL DEFAULT 0, path_count INTEGER NOT NULL DEFAULT 0,
      stale_count INTEGER NOT NULL DEFAULT 0, unchecked_count INTEGER NOT NULL DEFAULT 0
    ) STRICT;
    CREATE INDEX IF NOT EXISTS asset_summary_owner ON asset_summary_rows(owner_student_id,asset_id);
    CREATE INDEX IF NOT EXISTS asset_summary_source ON asset_summary_rows(source_name,asset_id);
    CREATE INDEX IF NOT EXISTS asset_summary_type ON asset_summary_rows(asset_type,asset_id);
    CREATE INDEX IF NOT EXISTS asset_summary_risk ON asset_summary_rows(governance_risk,asset_id);
    CREATE TABLE IF NOT EXISTS asset_student_memberships (
      asset_id TEXT NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
      student_id TEXT NOT NULL, PRIMARY KEY(asset_id,student_id)
    ) WITHOUT ROWID, STRICT;
    CREATE INDEX IF NOT EXISTS asset_student_memberships_student ON asset_student_memberships(student_id,asset_id);
    CREATE TABLE IF NOT EXISTS asset_summary_totals (
      singleton INTEGER PRIMARY KEY CHECK(singleton=1), total INTEGER NOT NULL DEFAULT 0,
      issue_count INTEGER NOT NULL DEFAULT 0, high_risk_count INTEGER NOT NULL DEFAULT 0,
      sha256_ready_count INTEGER NOT NULL DEFAULT 0, sha256_pending_count INTEGER NOT NULL DEFAULT 0,
      fingerprint_conflict_count INTEGER NOT NULL DEFAULT 0,
      reference_total INTEGER NOT NULL DEFAULT 0, duplicate_groups INTEGER NOT NULL DEFAULT 0,
      stale_count INTEGER NOT NULL DEFAULT 0, unchecked_count INTEGER NOT NULL DEFAULT 0
    ) STRICT;
    INSERT OR IGNORE INTO asset_summary_totals(singleton) VALUES(1);
    CREATE TABLE IF NOT EXISTS asset_summary_facets (
      kind TEXT NOT NULL, value TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(kind,value)
    ) WITHOUT ROWID, STRICT;

    CREATE TRIGGER IF NOT EXISTS asset_summary_rows_ai AFTER INSERT ON asset_summary_rows BEGIN
      UPDATE asset_summary_totals SET total=total+1,issue_count=issue_count+NEW.issue_count,
        high_risk_count=high_risk_count+NEW.high_risk_count,
        sha256_ready_count=sha256_ready_count+NEW.sha256_ready_count,
        sha256_pending_count=sha256_pending_count+NEW.sha256_pending_count,
        fingerprint_conflict_count=fingerprint_conflict_count+NEW.fingerprint_conflict_count,
        reference_total=reference_total+NEW.reference_count,
        duplicate_groups=duplicate_groups+CASE WHEN NEW.path_count>1 THEN 1 ELSE 0 END,
        stale_count=stale_count+NEW.stale_count,unchecked_count=unchecked_count+NEW.unchecked_count
        WHERE singleton=1;
      INSERT INTO asset_summary_facets(kind,value,count) VALUES('source',NEW.source_name,1)
        ON CONFLICT(kind,value) DO UPDATE SET count=count+1;
      INSERT INTO asset_summary_facets(kind,value,count) VALUES('type',NEW.asset_type,1)
        ON CONFLICT(kind,value) DO UPDATE SET count=count+1;
    END;
    CREATE TRIGGER IF NOT EXISTS asset_summary_rows_au AFTER UPDATE ON asset_summary_rows BEGIN
      UPDATE asset_summary_totals SET issue_count=issue_count-OLD.issue_count+NEW.issue_count,
        high_risk_count=high_risk_count-OLD.high_risk_count+NEW.high_risk_count,
        sha256_ready_count=sha256_ready_count-OLD.sha256_ready_count+NEW.sha256_ready_count,
        sha256_pending_count=sha256_pending_count-OLD.sha256_pending_count+NEW.sha256_pending_count,
        fingerprint_conflict_count=fingerprint_conflict_count-OLD.fingerprint_conflict_count+NEW.fingerprint_conflict_count,
        reference_total=reference_total-OLD.reference_count+NEW.reference_count,
        duplicate_groups=duplicate_groups-(CASE WHEN OLD.path_count>1 THEN 1 ELSE 0 END)+(CASE WHEN NEW.path_count>1 THEN 1 ELSE 0 END),
        stale_count=stale_count-OLD.stale_count+NEW.stale_count,
        unchecked_count=unchecked_count-OLD.unchecked_count+NEW.unchecked_count WHERE singleton=1;
      UPDATE asset_summary_facets SET count=count-1 WHERE kind='source' AND value=OLD.source_name AND OLD.source_name<>NEW.source_name;
      DELETE FROM asset_summary_facets WHERE kind='source' AND value=OLD.source_name AND count<=0;
      INSERT INTO asset_summary_facets(kind,value,count) SELECT 'source',NEW.source_name,1 WHERE OLD.source_name<>NEW.source_name
        ON CONFLICT(kind,value) DO UPDATE SET count=count+1;
      UPDATE asset_summary_facets SET count=count-1 WHERE kind='type' AND value=OLD.asset_type AND OLD.asset_type<>NEW.asset_type;
      DELETE FROM asset_summary_facets WHERE kind='type' AND value=OLD.asset_type AND count<=0;
      INSERT INTO asset_summary_facets(kind,value,count) SELECT 'type',NEW.asset_type,1 WHERE OLD.asset_type<>NEW.asset_type
        ON CONFLICT(kind,value) DO UPDATE SET count=count+1;
    END;
    CREATE TRIGGER IF NOT EXISTS asset_summary_rows_ad AFTER DELETE ON asset_summary_rows BEGIN
      UPDATE asset_summary_totals SET total=total-1,issue_count=issue_count-OLD.issue_count,
        high_risk_count=high_risk_count-OLD.high_risk_count,
        sha256_ready_count=sha256_ready_count-OLD.sha256_ready_count,
        sha256_pending_count=sha256_pending_count-OLD.sha256_pending_count,
        fingerprint_conflict_count=fingerprint_conflict_count-OLD.fingerprint_conflict_count,
        reference_total=reference_total-OLD.reference_count,
        duplicate_groups=duplicate_groups-CASE WHEN OLD.path_count>1 THEN 1 ELSE 0 END,
        stale_count=stale_count-OLD.stale_count,unchecked_count=unchecked_count-OLD.unchecked_count WHERE singleton=1;
      UPDATE asset_summary_facets SET count=count-1 WHERE kind='source' AND value=OLD.source_name;
      DELETE FROM asset_summary_facets WHERE kind='source' AND value=OLD.source_name AND count<=0;
      UPDATE asset_summary_facets SET count=count-1 WHERE kind='type' AND value=OLD.asset_type;
      DELETE FROM asset_summary_facets WHERE kind='type' AND value=OLD.asset_type AND count<=0;
    END;

    CREATE TRIGGER IF NOT EXISTS assets_summary_ai AFTER INSERT ON assets BEGIN
      INSERT INTO asset_summary_rows(asset_id,owner_student_id,source_name,asset_type,governance_risk,
        issue_count,high_risk_count,sha256_ready_count,sha256_pending_count,fingerprint_conflict_count)
      VALUES(NEW.asset_id,NEW.owner_student_id,NEW.source_name,NEW.asset_type,NEW.governance_risk,
        CASE WHEN NEW.governance_action<>'' AND NEW.governance_action<>'无需处理' THEN 1 ELSE 0 END,
        CASE WHEN NEW.governance_risk='high' THEN 1 ELSE 0 END,CASE WHEN NEW.sha256<>'' THEN 1 ELSE 0 END,
        CASE WHEN NEW.sha256='' THEN 1 ELSE 0 END,CASE WHEN NEW.governance_status='fingerprint_conflict' THEN 1 ELSE 0 END);
      INSERT INTO asset_student_memberships(asset_id,student_id)
        SELECT NEW.asset_id,NEW.owner_student_id WHERE NEW.owner_student_id<>'' ON CONFLICT(asset_id,student_id) DO NOTHING;
    END;
    CREATE TRIGGER IF NOT EXISTS assets_summary_au AFTER UPDATE ON assets BEGIN
      UPDATE asset_summary_rows SET owner_student_id=NEW.owner_student_id,source_name=NEW.source_name,
        asset_type=NEW.asset_type,governance_risk=NEW.governance_risk,
        issue_count=CASE WHEN NEW.governance_action<>'' AND NEW.governance_action<>'无需处理' THEN 1 ELSE 0 END,
        high_risk_count=CASE WHEN NEW.governance_risk='high' THEN 1 ELSE 0 END,
        sha256_ready_count=CASE WHEN NEW.sha256<>'' THEN 1 ELSE 0 END,
        sha256_pending_count=CASE WHEN NEW.sha256='' THEN 1 ELSE 0 END,
        fingerprint_conflict_count=CASE WHEN NEW.governance_status='fingerprint_conflict' THEN 1 ELSE 0 END
        WHERE asset_id=NEW.asset_id;
      DELETE FROM asset_student_memberships WHERE asset_id=NEW.asset_id;
      INSERT INTO asset_student_memberships(asset_id,student_id)
        SELECT NEW.asset_id,NEW.owner_student_id WHERE NEW.owner_student_id<>'' ON CONFLICT(asset_id,student_id) DO NOTHING;
      INSERT INTO asset_student_memberships(asset_id,student_id)
        SELECT NEW.asset_id,student_id FROM asset_references WHERE asset_id=NEW.asset_id AND state='active' AND student_id<>''
        ON CONFLICT(asset_id,student_id) DO NOTHING;
      INSERT INTO asset_student_memberships(asset_id,student_id)
        SELECT NEW.asset_id,space_id FROM asset_references WHERE asset_id=NEW.asset_id AND state='active' AND space_type='student' AND space_id<>''
        ON CONFLICT(asset_id,student_id) DO NOTHING;
    END;

    CREATE TRIGGER IF NOT EXISTS asset_refs_summary_ai AFTER INSERT ON asset_references BEGIN
      UPDATE asset_summary_rows SET
        reference_count=(SELECT COUNT(*) FROM asset_references WHERE asset_id=NEW.asset_id AND state='active'),
        path_count=(SELECT COUNT(DISTINCT path) FROM asset_references WHERE asset_id=NEW.asset_id AND state='active' AND path<>''),
        stale_count=(SELECT COUNT(*) FROM asset_references WHERE asset_id=NEW.asset_id AND state='active' AND availability_state='missing'),
        unchecked_count=(SELECT COUNT(*) FROM asset_references WHERE asset_id=NEW.asset_id AND state='active' AND availability_state='unchecked' AND path<>'')
        WHERE asset_id=NEW.asset_id;
      INSERT INTO asset_student_memberships(asset_id,student_id)
        SELECT NEW.asset_id,NEW.student_id WHERE NEW.state='active' AND NEW.student_id<>'' ON CONFLICT(asset_id,student_id) DO NOTHING;
      INSERT INTO asset_student_memberships(asset_id,student_id)
        SELECT NEW.asset_id,NEW.space_id WHERE NEW.state='active' AND NEW.space_type='student' AND NEW.space_id<>''
        ON CONFLICT(asset_id,student_id) DO NOTHING;
    END;
    CREATE TRIGGER IF NOT EXISTS asset_refs_summary_ad AFTER DELETE ON asset_references BEGIN
      UPDATE asset_summary_rows SET
        reference_count=(SELECT COUNT(*) FROM asset_references WHERE asset_id=OLD.asset_id AND state='active'),
        path_count=(SELECT COUNT(DISTINCT path) FROM asset_references WHERE asset_id=OLD.asset_id AND state='active' AND path<>''),
        stale_count=(SELECT COUNT(*) FROM asset_references WHERE asset_id=OLD.asset_id AND state='active' AND availability_state='missing'),
        unchecked_count=(SELECT COUNT(*) FROM asset_references WHERE asset_id=OLD.asset_id AND state='active' AND availability_state='unchecked' AND path<>'')
        WHERE asset_id=OLD.asset_id;
      DELETE FROM asset_student_memberships WHERE asset_id=OLD.asset_id;
      INSERT INTO asset_student_memberships(asset_id,student_id)
        SELECT OLD.asset_id,owner_student_id FROM assets WHERE asset_id=OLD.asset_id AND owner_student_id<>''
        ON CONFLICT(asset_id,student_id) DO NOTHING;
      INSERT INTO asset_student_memberships(asset_id,student_id)
        SELECT OLD.asset_id,student_id FROM asset_references WHERE asset_id=OLD.asset_id AND state='active' AND student_id<>''
        ON CONFLICT(asset_id,student_id) DO NOTHING;
      INSERT INTO asset_student_memberships(asset_id,student_id)
        SELECT OLD.asset_id,space_id FROM asset_references WHERE asset_id=OLD.asset_id AND state='active' AND space_type='student' AND space_id<>''
        ON CONFLICT(asset_id,student_id) DO NOTHING;
    END;
    CREATE TRIGGER IF NOT EXISTS asset_refs_summary_au AFTER UPDATE ON asset_references BEGIN
      UPDATE asset_summary_rows SET
        reference_count=(SELECT COUNT(*) FROM asset_references WHERE asset_id=OLD.asset_id AND state='active'),
        path_count=(SELECT COUNT(DISTINCT path) FROM asset_references WHERE asset_id=OLD.asset_id AND state='active' AND path<>''),
        stale_count=(SELECT COUNT(*) FROM asset_references WHERE asset_id=OLD.asset_id AND state='active' AND availability_state='missing'),
        unchecked_count=(SELECT COUNT(*) FROM asset_references WHERE asset_id=OLD.asset_id AND state='active' AND availability_state='unchecked' AND path<>'')
        WHERE asset_id=OLD.asset_id;
      UPDATE asset_summary_rows SET
        reference_count=(SELECT COUNT(*) FROM asset_references WHERE asset_id=NEW.asset_id AND state='active'),
        path_count=(SELECT COUNT(DISTINCT path) FROM asset_references WHERE asset_id=NEW.asset_id AND state='active' AND path<>''),
        stale_count=(SELECT COUNT(*) FROM asset_references WHERE asset_id=NEW.asset_id AND state='active' AND availability_state='missing'),
        unchecked_count=(SELECT COUNT(*) FROM asset_references WHERE asset_id=NEW.asset_id AND state='active' AND availability_state='unchecked' AND path<>'')
        WHERE asset_id=NEW.asset_id;
      DELETE FROM asset_student_memberships WHERE asset_id IN (OLD.asset_id,NEW.asset_id);
      INSERT INTO asset_student_memberships(asset_id,student_id)
        SELECT asset_id,owner_student_id FROM assets WHERE asset_id IN (OLD.asset_id,NEW.asset_id) AND owner_student_id<>''
        ON CONFLICT(asset_id,student_id) DO NOTHING;
      INSERT INTO asset_student_memberships(asset_id,student_id)
        SELECT asset_id,student_id FROM asset_references WHERE asset_id IN (OLD.asset_id,NEW.asset_id) AND state='active' AND student_id<>''
        ON CONFLICT(asset_id,student_id) DO NOTHING;
      INSERT INTO asset_student_memberships(asset_id,student_id)
        SELECT asset_id,space_id FROM asset_references WHERE asset_id IN (OLD.asset_id,NEW.asset_id) AND state='active' AND space_type='student' AND space_id<>''
        ON CONFLICT(asset_id,student_id) DO NOTHING;
    END;
  `;
}

function createSchema(db, journalMode = 'WAL') {
  db.exec(`PRAGMA journal_mode=${journalMode}; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;`);
  db.exec(schemaSql());
  db.exec(`PRAGMA user_version=${SCHEMA_VERSION}`);
}

function sqliteString(value) { return `'${String(value).replaceAll("'", "''")}'`; }

function schemaUpgradeBackup(db, dbPath, targetVersion, now = Date.now) {
  const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-');
  let target = `${dbPath}.pre-schema-v${targetVersion}-${stamp}.sqlite3`;
  if (fs.existsSync(target)) target = `${dbPath}.pre-schema-v${targetVersion}-${stamp}-${crypto.randomBytes(3).toString('hex')}.sqlite3`;
  db.exec(`VACUUM INTO ${sqliteString(target)}`);
  try { fs.chmodSync(target, 0o444); } catch { /* Windows may ignore POSIX write bits. */ }
  return target;
}

function migrateSchemaV1ToV2(db, dbPath, now = Date.now) {
  const backupPath = schemaUpgradeBackup(db, dbPath, 2, now);
  try {
    db.exec(`BEGIN IMMEDIATE;
      ALTER TABLE asset_references ADD COLUMN state TEXT NOT NULL DEFAULT 'active';
      ALTER TABLE asset_references ADD COLUMN quarantine_operation_id TEXT NOT NULL DEFAULT '';
      ALTER TABLE asset_scan_runs ADD COLUMN phase_total INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE asset_scan_runs ADD COLUMN phase_processed INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE asset_scan_runs ADD COLUMN current_scope_type TEXT NOT NULL DEFAULT '';
      ALTER TABLE asset_scan_runs ADD COLUMN current_scope_id TEXT NOT NULL DEFAULT '';
      ALTER TABLE asset_scan_runs ADD COLUMN current_scope_name TEXT NOT NULL DEFAULT '';
      CREATE TABLE asset_duplicate_operations (
        operation_id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at TEXT NOT NULL,
        confirmed_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL, finished_at TEXT NOT NULL DEFAULT '',
        filter_json TEXT NOT NULL DEFAULT '{}', summary_json TEXT NOT NULL DEFAULT '{}', error TEXT NOT NULL DEFAULT ''
      ) STRICT;
      CREATE TABLE asset_duplicate_entries (
        entry_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES asset_duplicate_operations(operation_id) ON DELETE CASCADE,
        asset_id TEXT NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
        keep_path TEXT NOT NULL, source_path TEXT NOT NULL, quarantine_path TEXT NOT NULL DEFAULT '',
        space_type TEXT NOT NULL DEFAULT '', space_id TEXT NOT NULL DEFAULT '',
        sha1 TEXT NOT NULL DEFAULT '', sha256 TEXT NOT NULL DEFAULT '', byte_size INTEGER NOT NULL DEFAULT 0,
        mtime_ms REAL NOT NULL DEFAULT 0, file_key TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', reference_snapshot_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX asset_duplicate_entries_operation ON asset_duplicate_entries(operation_id,status);
      CREATE INDEX asset_duplicate_entries_asset ON asset_duplicate_entries(asset_id);
      UPDATE assets SET sha256=(
        SELECT MIN(r.content_sha256) FROM asset_references r
        WHERE r.asset_id=assets.asset_id AND r.content_sha256<>''
        HAVING COUNT(DISTINCT r.content_sha256)=1
      ) WHERE sha256='' AND EXISTS(
        SELECT 1 FROM asset_references r WHERE r.asset_id=assets.asset_id AND r.content_sha256<>''
        GROUP BY r.asset_id HAVING COUNT(DISTINCT r.content_sha256)=1
      );
      UPDATE assets SET governance_status='fingerprint_conflict', governance_risk='high',
        governance_action='人工核对指纹冲突', governance_reason='同一资产引用记录包含不同 SHA-256，已停止自动物理治理。'
      WHERE asset_id IN (SELECT asset_id FROM asset_references WHERE content_sha256<>'' GROUP BY asset_id HAVING COUNT(DISTINCT content_sha256)>1);
      UPDATE assets SET governance_status='fingerprint_pending'
      WHERE sha256='' AND governance_status NOT IN ('fingerprint_conflict','resolved');
      PRAGMA user_version=2;
      COMMIT;`);
    const foreign = db.prepare('PRAGMA foreign_key_check').all();
    const integrity = db.prepare('PRAGMA integrity_check').get();
    if (foreign.length || Object.values(integrity || {})[0] !== 'ok') throw new Error('SQLite v2 schema integrity check failed');
    return backupPath;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* transaction already ended */ }
    throw Object.assign(error, { code: 'asset_db_schema_upgrade_failed', backupPath });
  }
}

function migrateSchemaV2ToV3(db, dbPath, now = Date.now) {
  const backupPath = schemaUpgradeBackup(db, dbPath, 3, now);
  try {
    const referenceColumns = new Set(db.prepare('PRAGMA table_info(asset_references)').all().map(column => column.name));
    const availabilityColumns = `${referenceColumns.has('availability_state') ? '' : "ALTER TABLE asset_references ADD COLUMN availability_state TEXT NOT NULL DEFAULT 'unchecked';"}
      ${referenceColumns.has('availability_checked_at') ? '' : "ALTER TABLE asset_references ADD COLUMN availability_checked_at TEXT NOT NULL DEFAULT '';"}`;
    db.exec(`BEGIN IMMEDIATE;
      ${availabilityColumns}
      CREATE INDEX IF NOT EXISTS asset_refs_availability ON asset_references(availability_state,asset_id);
      DELETE FROM asset_search;
      INSERT INTO asset_search(rowid,asset_id,filename,paths,owner_name,source_name,sha1,sha256,governance)
      SELECT a.rowid,a.asset_id,a.filename,
        TRIM(a.canonical_path || ' ' || COALESCE((SELECT GROUP_CONCAT(r.path,' ') FROM asset_references r
          WHERE r.asset_id=a.asset_id AND r.state='active' AND r.path<>''),'')),
        a.owner_student_name,a.source_name,a.sha1,a.sha256,
        TRIM(a.governance_action || ' ' || a.governance_reason)
      FROM assets a;
      PRAGMA user_version=3;`);
    const foreign = db.prepare('PRAGMA foreign_key_check').all();
    const integrity = db.prepare('PRAGMA integrity_check').get();
    if (foreign.length || Object.values(integrity || {})[0] !== 'ok') throw new Error('SQLite v3 schema integrity check failed');
    db.exec('COMMIT');
    return backupPath;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* transaction already ended */ }
    throw Object.assign(error, { code: 'asset_db_schema_upgrade_failed', backupPath });
  }
}

function migrateSchemaV3ToV4(db, dbPath, now = Date.now) {
  const backupPath = schemaUpgradeBackup(db, dbPath, 4, now);
  try {
    db.exec('BEGIN IMMEDIATE');
    db.exec(summarySchemaSql());
    db.exec(`
      INSERT INTO asset_summary_rows(asset_id,owner_student_id,source_name,asset_type,governance_risk,
        issue_count,high_risk_count,sha256_ready_count,sha256_pending_count,fingerprint_conflict_count,
        reference_count,path_count,stale_count,unchecked_count)
      SELECT a.asset_id,a.owner_student_id,a.source_name,a.asset_type,a.governance_risk,
        CASE WHEN a.governance_action<>'' AND a.governance_action<>'无需处理' THEN 1 ELSE 0 END,
        CASE WHEN a.governance_risk='high' THEN 1 ELSE 0 END,
        CASE WHEN a.sha256<>'' THEN 1 ELSE 0 END,CASE WHEN a.sha256='' THEN 1 ELSE 0 END,
        CASE WHEN a.governance_status='fingerprint_conflict' THEN 1 ELSE 0 END,
        COALESCE(r.reference_count,0),COALESCE(r.path_count,0),COALESCE(r.stale_count,0),COALESCE(r.unchecked_count,0)
      FROM assets a LEFT JOIN (
        SELECT asset_id,COUNT(*) reference_count,COUNT(DISTINCT CASE WHEN path<>'' THEN path END) path_count,
          SUM(CASE WHEN availability_state='missing' THEN 1 ELSE 0 END) stale_count,
          SUM(CASE WHEN availability_state='unchecked' AND path<>'' THEN 1 ELSE 0 END) unchecked_count
        FROM asset_references WHERE state='active' GROUP BY asset_id
      ) r ON r.asset_id=a.asset_id;
      INSERT OR IGNORE INTO asset_student_memberships(asset_id,student_id)
        SELECT asset_id,owner_student_id FROM assets WHERE owner_student_id<>'';
      INSERT OR IGNORE INTO asset_student_memberships(asset_id,student_id)
        SELECT asset_id,student_id FROM asset_references WHERE state='active' AND student_id<>'';
      INSERT OR IGNORE INTO asset_student_memberships(asset_id,student_id)
        SELECT asset_id,space_id FROM asset_references WHERE state='active' AND space_type='student' AND space_id<>'';
      PRAGMA user_version=4;
    `);
    const foreign = db.prepare('PRAGMA foreign_key_check').all();
    const integrity = db.prepare('PRAGMA integrity_check').get();
    if (foreign.length || Object.values(integrity || {})[0] !== 'ok') throw new Error('SQLite v4 schema integrity check failed');
    db.exec('COMMIT');
    return backupPath;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* transaction already ended */ }
    throw Object.assign(error, { code: 'asset_db_schema_upgrade_failed', backupPath });
  }
}

function canonicalAsset(group) {
  const sha1 = text(group[0]?.sha1);
  const expected = sha1 ? `asset-${sha1.slice(0, 16)}` : '';
  return [...group].sort((a, b) => {
    const expectedDiff = Number(text(b.assetId) === expected) - Number(text(a.assetId) === expected);
    if (expectedDiff) return expectedDiff;
    return text(a.assetId).localeCompare(text(b.assetId));
  })[0];
}

function mergeLegacyGroup(group) {
  const canonical = canonicalAsset(group);
  const merged = { ...canonical };
  const oldestUpload = group.map(item => text(item.uploadedAt || item.createdAt)).filter(Boolean).sort()[0];
  const latestUpdate = group.map(item => text(item.updatedAt)).filter(Boolean).sort().at(-1);
  if (oldestUpload) merged.uploadedAt = oldestUpload;
  if (latestUpdate) merged.updatedAt = latestUpdate;
  const references = new Map();
  for (const asset of group) {
    for (const raw of Array.isArray(asset.references) ? asset.references : []) {
      const ref = normalizeReference(raw, { linkedAt: asset.uploadedAt });
      const key = referenceKey(ref);
      const previous = references.get(key);
      references.set(key, previous ? { ...previous, ...ref, linkedAt: previous.linkedAt || ref.linkedAt } : ref);
    }
    const assetPath = text(asset.path);
    if (assetPath && ![...references.values()].some(ref => text(ref.path) === assetPath)) {
      const ref = normalizeReference({}, {
        referenceId: `legacy-${fingerprint(`${asset.assetId}|${assetPath}`).slice(0, 20)}`,
        spaceType: asset.ownerStudentId ? 'student' : 'legacy', spaceId: asset.ownerStudentId,
        spaceName: asset.ownerStudentName, studentId: asset.ownerStudentId, role: 'legacy_asset_path',
        path: assetPath, source: 'asset-index.json migration', linkedAt: asset.uploadedAt || asset.updatedAt,
      });
      references.set(referenceKey(ref), ref);
    }
  }
  return { canonical: merged, references: [...references.values()], aliases: group.map(item => text(item.assetId)).filter(Boolean) };
}

function openCheckedDatabase(dbPath, now = Date.now, quickCheck = true) {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
  let version = Number(db.prepare('PRAGMA user_version').get().user_version || 0);
  if (version === 0) createSchema(db, 'WAL');
  else if (version === 1) migrateSchemaV1ToV2(db, dbPath, now);
  version = Number(db.prepare('PRAGMA user_version').get().user_version || 0);
  if (version === 2) migrateSchemaV2ToV3(db, dbPath, now);
  version = Number(db.prepare('PRAGMA user_version').get().user_version || 0);
  if (version === 3) migrateSchemaV3ToV4(db, dbPath, now);
  version = Number(db.prepare('PRAGMA user_version').get().user_version || 0);
  if (version !== SCHEMA_VERSION) throw Object.assign(new Error(`Unsupported asset database schema ${version}`), { code: 'asset_db_schema_unsupported' });
  db.exec(schemaSql());
  if (quickCheck) {
    const quick = db.prepare('PRAGMA quick_check').get();
    if (!quick || Object.values(quick)[0] !== 'ok') throw Object.assign(new Error('Asset database quick_check failed'), { code: 'asset_db_corrupt' });
  }
  db.prepare(`INSERT INTO asset_index_meta(key,value) VALUES('schema_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(String(SCHEMA_VERSION));
  const openedAt = new Date().toISOString();
  db.prepare(`UPDATE asset_scan_runs SET status='interrupted',phase='interrupted',updated_at=?,finished_at=? WHERE status='running'`).run(openedAt, openedAt);
  return db;
}

function migrateLegacyJson({ dbPath, legacyJsonPath, now = Date.now }) {
  const directory = path.dirname(dbPath);
  fs.mkdirSync(directory, { recursive: true });
  let legacy = { version: 1, assets: [] };
  let raw = '';
  if (fs.existsSync(legacyJsonPath)) {
    raw = fs.readFileSync(legacyJsonPath, 'utf8');
    try { legacy = JSON.parse(raw); } catch (error) {
      throw Object.assign(new Error(`资产索引 JSON 无法解析：${error.message}`), { code: 'asset_migration_failed' });
    }
    if (!legacy || !Array.isArray(legacy.assets)) throw Object.assign(new Error('资产索引 JSON 结构损坏，未执行迁移。'), { code: 'asset_migration_failed' });
  }
  const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-');
  if (raw) {
    const backupPath = path.join(directory, `asset-index.pre-sqlite-${stamp}.json`);
    fs.copyFileSync(legacyJsonPath, backupPath, fs.constants.COPYFILE_EXCL);
    try { fs.chmodSync(backupPath, 0o444); } catch { /* Windows ACL may ignore POSIX write bits. */ }
    fs.writeFileSync(`${backupPath}.manifest.json`, `${JSON.stringify({
      kind: 'edu-manager-asset-index-pre-sqlite', createdAt: new Date(now()).toISOString(),
      source: path.basename(legacyJsonPath), sha256: fingerprint(raw), assetCount: legacy.assets.length,
    }, null, 2)}\n`, 'utf8');
  }
  const tempPath = `${dbPath}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.migrating`;
  const db = new DatabaseSync(tempPath);
  let importedReferenceCount = 0;
  let duplicateReferenceCount = 0;
  try {
    createSchema(db, 'DELETE');
    const groups = new Map();
    for (const asset of legacy.assets) {
      if (!asset || typeof asset !== 'object' || !text(asset.assetId)) throw Object.assign(new Error('旧资产记录缺少 assetId。'), { code: 'asset_migration_failed' });
      const key = text(asset.sha1) ? `sha1:${text(asset.sha1)}` : `id:${text(asset.assetId)}`;
      const current = groups.get(key) || [];
      current.push(asset);
      groups.set(key, current);
    }
    db.exec('BEGIN IMMEDIATE');
    const store = makeStoreApi(db, { dbPath: tempPath, now });
    for (const group of groups.values()) {
      const merged = mergeLegacyGroup(group);
      importedReferenceCount += group.reduce((sum, item) => sum + (Array.isArray(item.references) ? item.references.length : 0), 0);
      duplicateReferenceCount += importedReferenceCount;
      store.upsertAsset(merged.canonical, merged.references, merged.aliases, { refreshSearch: false });
    }
    duplicateReferenceCount = Math.max(0, importedReferenceCount - Number(db.prepare('SELECT COUNT(*) count FROM asset_references').get().count));
    db.prepare(`INSERT INTO asset_index_meta(key,value) VALUES('migration_source_sha256',?)`).run(raw ? fingerprint(raw) : '');
    db.prepare(`INSERT INTO asset_index_meta(key,value) VALUES('migrated_at',?)`).run(new Date(now()).toISOString());
    db.prepare(`INSERT INTO asset_index_meta(key,value) VALUES('legacy_asset_count',?)`).run(String(legacy.assets.length));
    db.prepare(`INSERT INTO asset_index_meta(key,value) VALUES('legacy_duplicate_reference_count',?)`).run(String(duplicateReferenceCount));
    store.rebuildSearchIndex();
    const canonicalCount = Number(db.prepare('SELECT COUNT(*) count FROM assets').get().count);
    const aliasCount = Number(db.prepare('SELECT COUNT(*) count FROM asset_aliases WHERE old_asset_id <> asset_id').get().count);
    if (legacy.assets.length !== canonicalCount + aliasCount) throw new Error('资产数量校验失败。');
    const unresolved = Number(db.prepare(`SELECT COUNT(*) count FROM asset_aliases a LEFT JOIN assets s ON s.asset_id=a.asset_id WHERE s.asset_id IS NULL`).get().count);
    if (unresolved) throw new Error('存在无法解析的旧资产编号。');
    const foreign = db.prepare('PRAGMA foreign_key_check').all();
    const integrity = db.prepare('PRAGMA integrity_check').get();
    if (foreign.length || Object.values(integrity || {})[0] !== 'ok') throw new Error('SQLite 完整性校验失败。');
    db.exec('COMMIT');
    db.close();
    fs.renameSync(tempPath, dbPath);
    return { migrated: true, legacyAssetCount: legacy.assets.length, canonicalCount, aliasCount, duplicateReferenceCount };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* no active transaction */ }
    try { db.close(); } catch { /* ignore close errors */ }
    try { fs.rmSync(tempPath, { force: true }); } catch { /* temp data is derived from preserved JSON */ }
    const report = path.join(directory, `asset-index-migration-failed-${stamp}.json`);
    fs.writeFileSync(report, `${JSON.stringify({ at: new Date(now()).toISOString(), code: error.code || 'asset_migration_failed', message: error.message }, null, 2)}\n`, 'utf8');
    throw Object.assign(error, { code: error.code || 'asset_migration_failed', reportPath: report });
  }
}

function makeStoreApi(db, options) {
  const dbPath = options.dbPath;
  const now = options.now || Date.now;
  const summaryCache = new Map();
  const listCountCache = new Map();
  const SUMMARY_CACHE_LIMIT = 64;
  const LIST_COUNT_CACHE_LIMIT = 256;
  let transactionDepth = 0;
  const cacheGet = (cache, key) => {
    if (!cache.has(key)) return undefined;
    const value = cache.get(key);
    cache.delete(key);
    cache.set(key, value);
    return value;
  };
  const cacheSet = (cache, key, value, limit) => {
    if (cache.has(key)) cache.delete(key);
    cache.set(key, value);
    while (cache.size > limit) cache.delete(cache.keys().next().value);
  };
  const invalidateSummary = () => { summaryCache.clear(); listCountCache.clear(); };
  const insertAsset = db.prepare(`INSERT INTO assets(${ASSET_COLUMNS.join(',')}) VALUES(${ASSET_COLUMNS.map(() => '?').join(',')})
    ON CONFLICT(asset_id) DO UPDATE SET ${ASSET_COLUMNS.filter(column => column !== 'asset_id').map(column => column === 'sha256'
      ? `sha256=CASE WHEN excluded.sha256<>'' THEN excluded.sha256 ELSE assets.sha256 END`
      : `${column}=excluded.${column}`).join(',')}`);
  const insertReference = db.prepare(`INSERT INTO asset_references(
      reference_id,asset_id,space_type,space_id,space_name,workspace_id,student_id,device_id,content_sha256,logical_path,role,path,source,linked_at,state,quarantine_operation_id,availability_state,availability_checked_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(asset_id,space_type,space_id,role,path) DO UPDATE SET
      reference_id=excluded.reference_id,space_name=excluded.space_name,workspace_id=excluded.workspace_id,
      student_id=excluded.student_id,device_id=excluded.device_id,
      content_sha256=CASE WHEN excluded.content_sha256<>'' THEN excluded.content_sha256 ELSE asset_references.content_sha256 END,
      logical_path=excluded.logical_path,source=excluded.source,
      linked_at=CASE WHEN asset_references.linked_at='' THEN excluded.linked_at ELSE asset_references.linked_at END,
      state=excluded.state,quarantine_operation_id=excluded.quarantine_operation_id,
      availability_state=CASE WHEN excluded.availability_state<>'unchecked' THEN excluded.availability_state ELSE asset_references.availability_state END,
      availability_checked_at=CASE WHEN excluded.availability_checked_at<>'' THEN excluded.availability_checked_at ELSE asset_references.availability_checked_at END`);
  const insertAlias = db.prepare(`INSERT INTO asset_aliases(old_asset_id,asset_id) VALUES(?,?) ON CONFLICT(old_asset_id) DO UPDATE SET asset_id=excluded.asset_id`);
  const selectAssetBySha256 = db.prepare("SELECT asset_id,sha1,sha256 FROM assets WHERE sha256<>'' AND sha256=? LIMIT 1");
  const selectAssetBySha1 = db.prepare("SELECT asset_id,sha1,sha256 FROM assets WHERE sha1<>'' AND sha1=? LIMIT 1");
  const selectReferenceByKey = db.prepare(`SELECT * FROM asset_references
    WHERE asset_id=? AND space_type=? AND space_id=? AND role=? AND path=? LIMIT 1`);
  const selectAlias = db.prepare('SELECT asset_id FROM asset_aliases WHERE old_asset_id=? LIMIT 1');

  function referenceNeedsWrite(current, next) {
    if (!current) return true;
    const direct = [['spaceName','space_name'],['workspaceId','workspace_id'],['studentId','student_id'],
      ['deviceId','device_id'],['logicalPath','logical_path'],['source','source'],['state','state'],
      ['quarantineOperationId','quarantine_operation_id']];
    if (direct.some(([field, column]) => text(next[field]) !== text(current[column]))) return true;
    if (next.contentSha256 && text(next.contentSha256) !== text(current.content_sha256)) return true;
    if (next.availabilityState && next.availabilityState !== 'unchecked'
      && text(next.availabilityState) !== text(current.availability_state)) return true;
    return Boolean(next.availabilityCheckedAt
      && text(next.availabilityCheckedAt) !== text(current.availability_checked_at));
  }

  function resolveAssetId(assetId) {
    const row = db.prepare(`SELECT asset_id FROM assets WHERE asset_id=? UNION ALL SELECT asset_id FROM asset_aliases WHERE old_asset_id=? LIMIT 1`).get(text(assetId), text(assetId));
    return text(row?.asset_id);
  }

  function referencesFor(assetId) {
    return db.prepare(`SELECT * FROM asset_references WHERE asset_id=? ORDER BY linked_at, row_id`).all(assetId).map(rowToReference);
  }

  function refreshSearch(assetId) {
    const row = db.prepare('SELECT rowid search_rowid,* FROM assets WHERE asset_id=?').get(assetId);
    if (!row) return;
    const paths = db.prepare("SELECT path FROM asset_references WHERE asset_id=? AND path<>? AND state='active' ORDER BY row_id").all(assetId, '').map(item => item.path).join(' ');
    db.prepare('DELETE FROM asset_search WHERE rowid=?').run(row.search_rowid);
    db.prepare('INSERT INTO asset_search(rowid,asset_id,filename,paths,owner_name,source_name,sha1,sha256,governance) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(row.search_rowid, assetId, row.filename, `${row.canonical_path} ${paths}`.trim(), row.owner_student_name, row.source_name, row.sha1, row.sha256, `${row.governance_action} ${row.governance_reason}`.trim());
  }

  function upsertAsset(asset, references = asset?.references || [], aliases = [], settings = {}) {
    const execute = () => {
      const input = asset && typeof asset === 'object' ? { ...asset } : {};
      let canonicalId = text(input.assetId);
      const sha256 = text(input.sha256);
      const sha1 = text(input.sha1);
      const bySha256 = sha256 ? selectAssetBySha256.get(sha256) : null;
      const bySha1 = sha1 ? selectAssetBySha1.get(sha1) : null;
      if (bySha1?.asset_id && sha256 && bySha1.sha256 && bySha1.sha256 !== sha256) {
        db.prepare(`UPDATE assets SET governance_status='fingerprint_conflict',governance_risk='high',
          governance_action='人工核对指纹冲突',governance_reason='同一 SHA-1 对应不同 SHA-256，已停止自动合并。' WHERE asset_id=?`).run(bySha1.asset_id);
        return { __upsertError: Object.assign(new Error('同一 SHA-1 对应不同 SHA-256，已停止自动合并。'), { code: 'asset_fingerprint_conflict', assetId: bySha1.asset_id }) };
      }
      const existing = bySha256 || bySha1;
      if (existing?.asset_id) canonicalId = text(existing.asset_id);
      if (!canonicalId) canonicalId = `asset-${(sha256 || sha1 || crypto.randomBytes(16).toString('hex')).slice(0, 16)}`;
      const current = db.prepare('SELECT * FROM assets WHERE asset_id=?').get(canonicalId);
      const source = current ? { ...rowToAsset(current), ...input } : input;
      source.assetId = canonicalId;
      source.sha256 = sha256 || text(current?.sha256);
      const requestedUpdatedAt = text(input.updatedAt) || nowIso(now);
      source.updatedAt = text(current?.updated_at) || requestedUpdatedAt;
      const normalizedReferences = (Array.isArray(references) ? references : []).map(raw =>
        normalizeReference(raw, { path: source.path, linkedAt: source.uploadedAt || requestedUpdatedAt }));
      const referencePlans = normalizedReferences.map(ref => ({ ref, current: selectReferenceByKey.get(canonicalId,
        ref.spaceType, ref.spaceId, ref.role, ref.path) }));
      const aliasesToWrite = [...new Set([canonicalId, ...(aliases || []), text(asset?.assetId)].filter(Boolean))]
        .filter(alias => text(selectAlias.get(text(alias))?.asset_id) !== canonicalId);
      const comparisonValues = assetValues(source);
      const assetChanged = !current || ASSET_COLUMNS.some(column => !['updated_at', 'record_json'].includes(column)
        && text(current[column]) !== text(comparisonValues[column]))
        || comparableRecord(current.record_json) !== comparableRecord(source);
      const referencesChanged = referencePlans.some(plan => referenceNeedsWrite(plan.current, plan.ref));
      const changed = assetChanged || referencesChanged || aliasesToWrite.length > 0;
      if (!changed) return settings.returnDetail === false
        ? { assetId: canonicalId, changed: false }
        : { ...getAssetDetail(canonicalId), changed: false };
      invalidateSummary();
      if (assetChanged || referencesChanged) {
        source.updatedAt = requestedUpdatedAt;
        const values = assetValues(source);
        insertAsset.run(...ASSET_COLUMNS.map(column => values[column]));
      }
      for (const alias of aliasesToWrite) insertAlias.run(text(alias), canonicalId);
      for (const { ref, current: currentReference } of referencePlans) {
        if (!referenceNeedsWrite(currentReference, ref)) continue;
        insertReference.run(ref.referenceId, canonicalId, ref.spaceType, ref.spaceId, ref.spaceName, ref.workspaceId,
          ref.studentId, ref.deviceId, ref.contentSha256, ref.logicalPath, ref.role, ref.path, ref.source, ref.linkedAt,
          ref.state, ref.quarantineOperationId, ref.availabilityState, ref.availabilityCheckedAt);
      }
      if ((assetChanged || referencesChanged) && settings.refreshSearch !== false) refreshSearch(canonicalId);
      return settings.returnDetail === false
        ? { assetId: canonicalId, changed: true }
        : { ...getAssetDetail(canonicalId), changed: true };
    };
    const result = settings.transaction === false || transactionDepth > 0 || Boolean(db.isTransaction) ? execute() : transaction(execute);
    if (result?.__upsertError) throw result.__upsertError;
    return result;
  }

  function replaceAll(assets) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec('DELETE FROM asset_search; DELETE FROM asset_aliases; DELETE FROM asset_references; DELETE FROM assets;');
      const groups = new Map();
      for (const asset of Array.isArray(assets) ? assets : []) {
        const key = text(asset.sha1) ? `sha1:${text(asset.sha1)}` : `id:${text(asset.assetId)}`;
        groups.set(key, [...(groups.get(key) || []), asset]);
      }
      for (const group of groups.values()) {
        const merged = mergeLegacyGroup(group);
        upsertAsset(merged.canonical, merged.references, merged.aliases, { refreshSearch: false });
      }
      rebuildSearchIndex();
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  function readAll() {
    return db.prepare('SELECT * FROM assets ORDER BY updated_at DESC, asset_id').all().map(row => {
      const asset = rowToAsset(row);
      const references = referencesFor(asset.assetId);
      return { ...asset, references,
        linkedStudents: [...new Set(references.filter(ref => ref.state === 'active' && ref.spaceType === 'student').map(ref => ref.spaceId).filter(Boolean))],
        linkedProjects: [...new Set(references.filter(ref => ref.state === 'active' && ref.spaceType === 'project').map(ref => ref.spaceId).filter(Boolean))] };
    });
  }

  function queryDetails(filter = {}) {
    const clauses = [];
    const params = [];
    if (filter.studentId) {
      clauses.push(`(a.owner_student_id=? OR EXISTS(SELECT 1 FROM asset_references sr WHERE sr.asset_id=a.asset_id AND sr.state='active' AND ((sr.space_type='student' AND sr.space_id=?) OR sr.student_id=?)))`);
      params.push(text(filter.studentId), text(filter.studentId), text(filter.studentId));
    }
    if (filter.projectId) {
      clauses.push(`EXISTS(SELECT 1 FROM asset_references pr WHERE pr.asset_id=a.asset_id AND pr.state='active' AND pr.space_type='project' AND pr.space_id=?)`);
      params.push(text(filter.projectId));
    }
    if (Array.isArray(filter.sourceTypes) && filter.sourceTypes.length) {
      clauses.push(`a.source_type IN (${filter.sourceTypes.map(() => '?').join(',')})`);
      params.push(...filter.sourceTypes.map(text));
    }
    if (filter.captureSessionId) {
      clauses.push(`json_extract(a.record_json,'$.captureSessionId')=?`);
      params.push(text(filter.captureSessionId));
    }
    if (filter.referenceId) {
      clauses.push(`EXISTS(SELECT 1 FROM asset_references rr WHERE rr.asset_id=a.asset_id AND rr.reference_id=?${filter.referenceSpaceType ? ' AND rr.space_type=?' : ''}${filter.referenceSpaceId ? ' AND rr.space_id=?' : ''}${filter.referenceDeviceId !== undefined ? ' AND rr.device_id=?' : ''}${filter.referenceStudentId !== undefined ? ' AND rr.student_id=?' : ''})`);
      params.push(text(filter.referenceId));
      if (filter.referenceSpaceType) params.push(text(filter.referenceSpaceType));
      if (filter.referenceSpaceId) params.push(text(filter.referenceSpaceId));
      if (filter.referenceDeviceId !== undefined) params.push(text(filter.referenceDeviceId));
      if (filter.referenceStudentId !== undefined) params.push(text(filter.referenceStudentId));
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = Number(filter.limit) > 0 ? ' LIMIT ?' : '';
    if (limit) params.push(Math.min(10000, Math.max(1, Number(filter.limit))));
    return db.prepare(`SELECT a.asset_id FROM assets a ${where} ORDER BY a.asset_id${limit}`).all(...params)
      .map(row => getAssetDetail(row.asset_id));
  }

  function detailsByIds(assetIds = []) {
    const seen = new Set();
    return (Array.isArray(assetIds) ? assetIds : []).map((assetId) => getAssetDetail(assetId))
      .filter((asset) => asset && !seen.has(asset.assetId) && seen.add(asset.assetId));
  }

  function *detailBatches(batchSize = 250) {
    const limit = Math.min(1000, Math.max(1, Number(batchSize) || 250));
    let after = '';
    while (true) {
      const rows = db.prepare('SELECT asset_id FROM assets WHERE asset_id>? ORDER BY asset_id LIMIT ?').all(after, limit);
      if (!rows.length) return;
      yield rows.map(row => getAssetDetail(row.asset_id));
      after = rows.at(-1).asset_id;
    }
  }

  function filterSql(filter = {}, params = []) {
    const clauses = [];
    if (filter.studentId && filter.studentId !== 'all') {
      clauses.push(`a.asset_id IN (
        SELECT asset_id FROM assets WHERE owner_student_id=?
        UNION
        SELECT asset_id FROM asset_references WHERE state='active' AND ((space_type='student' AND space_id=?) OR student_id=?)
      )`);
      params.push(text(filter.studentId), text(filter.studentId), text(filter.studentId));
    }
    if (filter.sourceName && filter.sourceName !== 'all') { clauses.push('a.source_name=?'); params.push(text(filter.sourceName)); }
    if (filter.type && filter.type !== 'all') { clauses.push('a.asset_type=?'); params.push(text(filter.type)); }
    if (filter.risk && filter.risk !== 'all') { clauses.push('a.governance_risk=?'); params.push(text(filter.risk)); }
    if (filter.duplicateOnly) clauses.push(`(SELECT COUNT(DISTINCT dr.path) FROM asset_references dr WHERE dr.asset_id=a.asset_id AND dr.state='active' AND dr.path<>'') > 1`);
    return clauses;
  }

  function listAssets(request = {}, searchText = '') {
    const params = [];
    const clauses = filterSql(request, params);
    const query = text(searchText).trim().slice(0, 200);
    if (query) {
      if (/^asset-[a-z0-9_-]+$/i.test(query)) { clauses.push(`(a.asset_id=? OR a.asset_id IN (SELECT asset_id FROM asset_aliases WHERE old_asset_id=?))`); params.push(query, query); }
      else if (/^[a-f0-9]{40}$/i.test(query)) { clauses.push("a.sha1<>'' AND a.sha1=?"); params.push(query.toLowerCase()); }
      else if (/^[a-f0-9]{64}$/i.test(query)) { clauses.push("a.sha256<>'' AND a.sha256=?"); params.push(query.toLowerCase()); }
      else if ([...query].length >= 3) {
        clauses.push(`a.asset_id IN (SELECT asset_id FROM asset_search WHERE asset_search MATCH ?)`);
        params.push(query.split(/\s+/).filter(Boolean).map(part => `"${part.replaceAll('"', '""')}"`).join(' AND '));
      } else {
        const scoped = Boolean((request.studentId && request.studentId !== 'all')
          || (request.sourceName && request.sourceName !== 'all') || (request.type && request.type !== 'all')
          || (request.risk && request.risk !== 'all') || request.duplicateOnly);
        if (!scoped) return { ok: false, code: 'asset_search_scope_required', items: [], total: 0,
          pageSize: Math.min(MAX_PAGE_SIZE, Math.max(1, Number(request.pageSize || request.limit) || DEFAULT_PAGE_SIZE)),
          nextCursor: '', message: '1～2 个字符的搜索请先选择学生、来源、类型、风险或重复项范围。' };
        const pattern = `%${query.replace(/[\\%_]/g, value => `\\${value}`)}%`;
        clauses.push(`(a.filename LIKE ? ESCAPE '\\' OR a.canonical_path LIKE ? ESCAPE '\\' OR a.owner_student_name LIKE ? ESCAPE '\\' OR a.source_name LIKE ? ESCAPE '\\')`);
        params.push(pattern, pattern, pattern, pattern);
      }
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const countKey = JSON.stringify({ studentId: request.studentId || '', sourceName: request.sourceName || '',
      type: request.type || '', risk: request.risk || '', duplicateOnly: Boolean(request.duplicateOnly), query });
    let total = cacheGet(listCountCache, countKey);
    if (total === undefined) {
      total = Number(db.prepare(`SELECT COUNT(*) count FROM assets a ${where}`).get(...params).count);
      cacheSet(listCountCache, countKey, total, LIST_COUNT_CACHE_LIMIT);
    }
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(request.pageSize || request.limit) || DEFAULT_PAGE_SIZE));
    const sort = request.sort === 'filename_asc' || request.sort === 'size_desc' ? request.sort : 'updated_desc';
    const signature = fingerprint(`${countKey}|${sort}`).slice(0, 16);
    const decoded = cursorDecode(request.cursor);
    const cursor = decoded?.v === 2 && decoded.signature === signature && decoded.sort === sort ? decoded : null;
    const legacyOffset = decoded && Object.hasOwn(decoded, 'offset') ? Math.max(0, Number(decoded.offset) || 0) : 0;
    const pageClauses = [...clauses];
    const pageParams = [...params];
    if (cursor?.key) {
      if (sort === 'filename_asc') {
        pageClauses.push(`(a.filename COLLATE NOCASE > ? COLLATE NOCASE OR (a.filename=? COLLATE NOCASE AND a.asset_id>?))`);
        pageParams.push(text(cursor.key.filename), text(cursor.key.filename), text(cursor.key.assetId));
      } else if (sort === 'size_desc') {
        pageClauses.push(`(a.byte_size < ? OR (a.byte_size=? AND a.asset_id>?))`);
        pageParams.push(Number(cursor.key.size) || 0, Number(cursor.key.size) || 0, text(cursor.key.assetId));
      } else {
        pageClauses.push(`(a.updated_at < ? OR (a.updated_at=? AND a.asset_id>?))`);
        pageParams.push(text(cursor.key.updatedAt), text(cursor.key.updatedAt), text(cursor.key.assetId));
      }
    }
    const pageWhere = pageClauses.length ? `WHERE ${pageClauses.join(' AND ')}` : '';
    const order = sort === 'filename_asc' ? 'a.filename COLLATE NOCASE, a.asset_id'
      : sort === 'size_desc' ? 'a.byte_size DESC, a.asset_id' : 'a.updated_at DESC, a.asset_id';
    const offsetSql = !cursor && legacyOffset ? ' OFFSET ?' : '';
    const rows = db.prepare(`SELECT a.*,
      (SELECT COUNT(*) FROM asset_references r WHERE r.asset_id=a.asset_id AND r.state='active') reference_count,
      (SELECT COUNT(DISTINCT r.path) FROM asset_references r WHERE r.asset_id=a.asset_id AND r.state='active' AND r.path<>'') duplicate_count,
      (SELECT COUNT(*) FROM assets v WHERE v.owner_student_id=a.owner_student_id AND v.filename=a.filename COLLATE NOCASE) version_count
      FROM assets a ${pageWhere} ORDER BY ${order} LIMIT ?${offsetSql}`).all(...pageParams, limit + 1, ...(!cursor && legacyOffset ? [legacyOffset] : []));
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const last = pageRows.at(-1);
    const nextCursor = hasMore && last ? cursorEncode({ v: 2, signature, sort, key: sort === 'filename_asc'
      ? { filename: last.filename, assetId: last.asset_id } : sort === 'size_desc'
        ? { size: Number(last.byte_size), assetId: last.asset_id } : { updatedAt: last.updated_at, assetId: last.asset_id } }) : '';
    return { ok: true, items: pageRows.map(row => ({ ...rowToAsset(row), referenceCount: Number(row.reference_count),
      duplicateCount: Math.max(1, Number(row.duplicate_count)), versionCount: Number(row.version_count) })),
      total, pageSize: limit, nextCursor };
  }

  function getAssetDetail(assetId) {
    const resolvedId = resolveAssetId(assetId);
    if (!resolvedId) return null;
    const row = db.prepare(`SELECT a.*,
      (SELECT COUNT(*) FROM asset_references r WHERE r.asset_id=a.asset_id AND r.state='active') reference_count,
      (SELECT COUNT(DISTINCT r.path) FROM asset_references r WHERE r.asset_id=a.asset_id AND r.state='active' AND r.path<>'') duplicate_count,
      (SELECT COUNT(*) FROM assets v WHERE v.owner_student_id=a.owner_student_id AND v.filename=a.filename COLLATE NOCASE) version_count
      FROM assets a WHERE a.asset_id=?`).get(resolvedId);
    if (!row) return null;
    const references = referencesFor(resolvedId);
    return { ...rowToAsset(row), references, referenceCount: Number(row.reference_count),
      duplicateCount: Math.max(1, Number(row.duplicate_count)), versionCount: Number(row.version_count),
      linkedStudents: [...new Set(references.filter(ref => ref.state === 'active' && ref.spaceType === 'student').map(ref => ref.spaceId).filter(Boolean))],
      linkedProjects: [...new Set(references.filter(ref => ref.state === 'active' && ref.spaceType === 'project').map(ref => ref.spaceId).filter(Boolean))],
      aliases: db.prepare('SELECT old_asset_id FROM asset_aliases WHERE asset_id=? AND old_asset_id<>asset_id ORDER BY old_asset_id').all(resolvedId).map(item => item.old_asset_id) };
  }

  function findByFingerprint({ sha256 = '', sha1 = '', path: assetPath = '' } = {}) {
    let row = null;
    if (sha256) row = db.prepare("SELECT asset_id FROM assets WHERE sha256<>'' AND sha256=? LIMIT 1").get(text(sha256));
    if (!row && sha1) row = db.prepare("SELECT asset_id FROM assets WHERE sha1<>'' AND sha1=? LIMIT 1").get(text(sha1));
    if (!row && assetPath) row = db.prepare('SELECT asset_id FROM assets WHERE canonical_path=? LIMIT 1').get(text(assetPath));
    return row?.asset_id ? getAssetDetail(row.asset_id) : null;
  }

  function replaceReferences(assetId, references) {
    const resolvedId = resolveAssetId(assetId);
    if (!resolvedId) return null;
    db.exec('BEGIN IMMEDIATE');
    try {
      invalidateSummary();
      db.prepare('DELETE FROM asset_references WHERE asset_id=?').run(resolvedId);
      const asset = getAssetDetail(resolvedId);
      for (const raw of Array.isArray(references) ? references : []) {
        const ref = normalizeReference(raw, { path: asset?.path, linkedAt: asset?.uploadedAt || asset?.updatedAt });
        insertReference.run(ref.referenceId, resolvedId, ref.spaceType, ref.spaceId, ref.spaceName, ref.workspaceId,
          ref.studentId, ref.deviceId, ref.contentSha256, ref.logicalPath, ref.role, ref.path, ref.source, ref.linkedAt,
          ref.state, ref.quarantineOperationId, ref.availabilityState, ref.availabilityCheckedAt);
      }
      refreshSearch(resolvedId);
      db.exec('COMMIT');
      return getAssetDetail(resolvedId);
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  function patchAsset(assetId, patch = {}) {
    const current = getAssetDetail(assetId);
    if (!current) return null;
    const aliases = current.aliases || [];
    return upsertAsset({ ...current, ...patch, assetId: current.assetId }, current.references, aliases);
  }

  function listVersionGroup(assetId) {
    const current = getAssetDetail(assetId);
    if (!current) return [];
    return db.prepare(`SELECT asset_id FROM assets
      WHERE owner_student_id=? AND filename=? COLLATE NOCASE ORDER BY uploaded_at,asset_id`)
      .all(current.ownerStudentId, current.filename).map(row => getAssetDetail(row.asset_id));
  }

  function importSnapshot(sourcePath, transform = value => value) {
    const source = new DatabaseSync(sourcePath, { readOnly: true });
    try {
      const integrity = source.prepare('PRAGMA integrity_check').get();
      if (Object.values(integrity || {})[0] !== 'ok') throw Object.assign(new Error('资产备份完整性检查失败。'), { code: 'asset_db_corrupt' });
      const aliases = new Map();
      for (const row of source.prepare('SELECT old_asset_id,asset_id FROM asset_aliases').all()) {
        aliases.set(row.asset_id, [...(aliases.get(row.asset_id) || []), row.old_asset_id]);
      }
      const assets = source.prepare('SELECT * FROM assets ORDER BY asset_id').all().map(row => {
        const asset = rowToAsset(row);
        const refs = source.prepare('SELECT * FROM asset_references WHERE asset_id=? ORDER BY row_id').all(asset.assetId).map(rowToReference);
        return transform({ ...asset, references: refs });
      });
      db.exec('BEGIN IMMEDIATE');
      try {
        db.exec('DELETE FROM asset_search; DELETE FROM asset_aliases; DELETE FROM asset_references; DELETE FROM assets;');
        for (const asset of assets) upsertAsset(asset, asset.references, aliases.get(asset.assetId) || [], { refreshSearch: false });
        rebuildSearchIndex();
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return { assetCount: assets.length };
    } finally { source.close(); }
  }

  function summary(filter = {}) {
    const cacheKey = JSON.stringify(filter || {});
    const cached = cacheGet(summaryCache, cacheKey);
    if (cached) return cached;
    const params = [];
    const clauses = [];
    if (filter.studentId && filter.studentId !== 'all') {
      clauses.push('s.asset_id IN (SELECT asset_id FROM asset_student_memberships WHERE student_id=?)');
      params.push(text(filter.studentId));
    }
    if (filter.sourceName && filter.sourceName !== 'all') { clauses.push('s.source_name=?'); params.push(text(filter.sourceName)); }
    if (filter.type && filter.type !== 'all') { clauses.push('s.asset_type=?'); params.push(text(filter.type)); }
    if (filter.risk && filter.risk !== 'all') { clauses.push('s.governance_risk=?'); params.push(text(filter.risk)); }
    if (filter.duplicateOnly) clauses.push('s.path_count>1');
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const unfiltered = clauses.length === 0;
    const row = unfiltered
      ? db.prepare(`SELECT total,issue_count,high_risk_count,sha256_ready_count,sha256_pending_count,
          fingerprint_conflict_count,reference_total,duplicate_groups,stale_count,unchecked_count
          FROM asset_summary_totals WHERE singleton=1`).get()
      : db.prepare(`SELECT COUNT(*) total,COALESCE(SUM(s.issue_count),0) issue_count,
          COALESCE(SUM(s.high_risk_count),0) high_risk_count,
          COALESCE(SUM(s.sha256_ready_count),0) sha256_ready_count,
          COALESCE(SUM(s.sha256_pending_count),0) sha256_pending_count,
          COALESCE(SUM(s.fingerprint_conflict_count),0) fingerprint_conflict_count,
          COALESCE(SUM(s.reference_count),0) reference_total,
          COALESCE(SUM(CASE WHEN s.path_count>1 THEN 1 ELSE 0 END),0) duplicate_groups,
          COALESCE(SUM(s.stale_count),0) stale_count,COALESCE(SUM(s.unchecked_count),0) unchecked_count
          FROM asset_summary_rows s ${where}`).get(...params);
    const facets = unfiltered
      ? db.prepare('SELECT kind,value,count FROM asset_summary_facets ORDER BY kind,value').all()
      : db.prepare(`WITH scoped_assets AS MATERIALIZED (
          SELECT s.source_name,s.asset_type FROM asset_summary_rows s ${where}
        )
        SELECT 'source' kind,source_name value,COUNT(*) count FROM scoped_assets GROUP BY source_name
        UNION ALL
        SELECT 'type' kind,asset_type value,COUNT(*) count FROM scoped_assets GROUP BY asset_type
        ORDER BY kind,value`).all(...params);
    const sourceFacets = facets.filter(item => item.kind === 'source');
    const typeFacets = facets.filter(item => item.kind === 'type');
    const referenceTotal = Number(row.reference_total || 0);
    const duplicateGroups = Number(row.duplicate_groups || 0);
    const staleReferenceCount = Number(row.stale_count || 0);
    const lastRebuild = db.prepare(`SELECT value FROM asset_index_meta WHERE key='last_rebuild_at'`).get();
    const result = { ok: true, total: Number(row.total), referenceTotal, duplicateGroups,
      issueCount: Number(row.issue_count), highRiskCount: Number(row.high_risk_count), staleReferenceCount,
      uncheckedReferenceCount: Number(row.unchecked_count || 0),
      sha256ReadyCount: Number(row.sha256_ready_count), sha256PendingCount: Number(row.sha256_pending_count),
      fingerprintConflictCount: Number(row.fingerprint_conflict_count),
      facets: { sources: sourceFacets.map(item => ({ value: item.value || '未标注来源', count: Number(item.count) })),
        types: typeFacets.map(item => ({ value: item.value || 'file', count: Number(item.count) })) },
      health: 'ok', lastRebuildAt: text(lastRebuild?.value) };
    cacheSet(summaryCache, cacheKey, result, SUMMARY_CACHE_LIMIT);
    return result;
  }

  function listDuplicateGroups(request = {}) {
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(request.pageSize) || DEFAULT_PAGE_SIZE));
    const params = [];
    let scope = '';
    if (request.studentId && request.studentId !== 'all') {
      scope = `AND (a.owner_student_id=? OR EXISTS(SELECT 1 FROM asset_references sr WHERE sr.asset_id=a.asset_id
        AND sr.state='active' AND ((sr.space_type='student' AND sr.space_id=?) OR sr.student_id=?)))`;
      params.push(text(request.studentId), text(request.studentId), text(request.studentId));
    }
    const base = `FROM assets a WHERE EXISTS(
      SELECT 1 FROM asset_references r WHERE r.asset_id=a.asset_id AND r.state='active' AND r.path<>''
      GROUP BY r.asset_id HAVING COUNT(DISTINCT r.path)>1
    ) ${scope}`;
    const countKey = `duplicates:${JSON.stringify({ studentId: request.studentId || 'all' })}`;
    let total = cacheGet(listCountCache, countKey);
    if (total === undefined) {
      total = Number(db.prepare(`SELECT COUNT(*) count ${base}`).get(...params).count);
      cacheSet(listCountCache, countKey, total, LIST_COUNT_CACHE_LIMIT);
    }
    const signature = fingerprint(countKey).slice(0, 16);
    const decoded = cursorDecode(request.cursor);
    const cursor = decoded?.v === 2 && decoded.signature === signature && decoded.sort === 'updated_desc' ? decoded : null;
    const legacyOffset = decoded && Object.hasOwn(decoded, 'offset') ? Math.max(0, Number(decoded.offset) || 0) : 0;
    const cursorClause = cursor?.key ? ` AND (a.updated_at < ? OR (a.updated_at=? AND a.asset_id>?))` : '';
    const cursorParams = cursor?.key ? [text(cursor.key.updatedAt), text(cursor.key.updatedAt), text(cursor.key.assetId)] : [];
    const offsetSql = !cursor && legacyOffset ? ' OFFSET ?' : '';
    const rows = db.prepare(`SELECT a.asset_id,a.filename,a.sha1,a.sha256,a.byte_size,a.updated_at,a.governance_status,
      (SELECT COUNT(DISTINCT r.path) FROM asset_references r WHERE r.asset_id=a.asset_id AND r.state='active' AND r.path<>'') path_count,
      (SELECT COUNT(*) FROM asset_references r WHERE r.asset_id=a.asset_id AND r.state='active') reference_count,
      (SELECT COUNT(DISTINCT CASE WHEN r.space_type IN ('student','project') AND r.space_id<>'' THEN r.space_type||':'||r.space_id END)
        FROM asset_references r WHERE r.asset_id=a.asset_id AND r.state='active') scope_count,
      (SELECT GROUP_CONCAT(sample.path,CHAR(10)) FROM (SELECT r.path FROM asset_references r
        WHERE r.asset_id=a.asset_id AND r.state='active' AND r.path<>'' GROUP BY r.path ORDER BY r.path LIMIT 3) sample) path_samples
      ${base}${cursorClause} ORDER BY a.updated_at DESC,a.asset_id LIMIT ?${offsetSql}`)
      .all(...params, ...cursorParams, limit + 1, ...(!cursor && legacyOffset ? [legacyOffset] : []));
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(row => {
      const scopeProtected = Number(row.scope_count) > 1;
      const status = !row.sha256 ? 'fingerprint_pending' : row.governance_status === 'fingerprint_conflict'
        ? 'fingerprint_conflict' : scopeProtected ? 'scope_protected' : 'reviewable';
      return { assetId: row.asset_id, filename: row.filename, sha1: row.sha1, sha256: row.sha256,
        size: Number(row.byte_size), pathCount: Number(row.path_count), referenceCount: Number(row.reference_count),
        pathSamples: text(row.path_samples).split('\n').filter(Boolean), status,
        protectionReason: status === 'fingerprint_pending' ? '待补齐 SHA-256' : status === 'fingerprint_conflict'
          ? '指纹冲突，需人工核对' : status === 'scope_protected' ? '跨学生或项目空间使用，受保护' : '' };
    });
    const last = rows.slice(0, limit).at(-1);
    return { ok: true, items, total, pageSize: limit, nextCursor: hasMore && last
      ? cursorEncode({ v: 2, signature, sort: 'updated_desc', key: { updatedAt: last.updated_at, assetId: last.asset_id } }) : '' };
  }

  function createDuplicateOperation(operation, entries = []) {
    const at = text(operation.createdAt) || nowIso(now);
    db.prepare(`INSERT INTO asset_duplicate_operations(operation_id,status,created_at,confirmed_at,updated_at,finished_at,filter_json,summary_json,error)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(operation.operationId, operation.status || 'prepared', at, text(operation.confirmedAt), at,
      text(operation.finishedAt), json(operation.filter || {}), json(operation.summary || {}), text(operation.error));
    const insert = db.prepare(`INSERT INTO asset_duplicate_entries(entry_id,operation_id,asset_id,keep_path,source_path,quarantine_path,
      space_type,space_id,sha1,sha256,byte_size,mtime_ms,file_key,status,reason,error,reference_snapshot_json,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const entry of entries) insert.run(entry.entryId, operation.operationId, entry.assetId, entry.keepPath, entry.sourcePath,
      text(entry.quarantinePath), text(entry.spaceType), text(entry.spaceId), text(entry.sha1), text(entry.sha256), Number(entry.size || 0),
      Number(entry.mtimeMs || 0), text(entry.fileKey), entry.status || 'eligible', text(entry.reason), text(entry.error),
      json(entry.references || []), at, at);
    return duplicateOperation(operation.operationId);
  }

  function duplicateOperation(operationId) {
    const row = db.prepare('SELECT * FROM asset_duplicate_operations WHERE operation_id=?').get(text(operationId));
    if (!row) return null;
    const entries = db.prepare('SELECT * FROM asset_duplicate_entries WHERE operation_id=? ORDER BY entry_id').all(text(operationId)).map(entry => ({
      entryId: entry.entry_id, operationId: entry.operation_id, assetId: entry.asset_id, keepPath: entry.keep_path,
      sourcePath: entry.source_path, quarantinePath: entry.quarantine_path, spaceType: entry.space_type, spaceId: entry.space_id,
      sha1: entry.sha1, sha256: entry.sha256, size: Number(entry.byte_size), mtimeMs: Number(entry.mtime_ms), fileKey: entry.file_key,
      status: entry.status, reason: entry.reason, error: entry.error,
      references: (() => { try { return JSON.parse(entry.reference_snapshot_json); } catch { return []; } })(),
      createdAt: entry.created_at, updatedAt: entry.updated_at,
    }));
    let filter = {}, operationSummary = {};
    try { filter = JSON.parse(row.filter_json); } catch { /* keep safe defaults */ }
    try { operationSummary = JSON.parse(row.summary_json); } catch { /* keep safe defaults */ }
    return { operationId: row.operation_id, status: row.status, createdAt: row.created_at, confirmedAt: row.confirmed_at,
      updatedAt: row.updated_at, finishedAt: row.finished_at, filter, summary: operationSummary, error: row.error, entries };
  }

  function listDuplicateOperations(request = {}) {
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(request.pageSize) || DEFAULT_PAGE_SIZE));
    const signature = fingerprint('duplicate-operations:updated-desc').slice(0, 16);
    const decoded = cursorDecode(request.cursor);
    const cursor = decoded?.v === 2 && decoded.signature === signature ? decoded : null;
    const params = [];
    let where = '';
    if (cursor?.key) {
      where = 'WHERE updated_at < ? OR (updated_at=? AND operation_id>?)';
      params.push(text(cursor.key.updatedAt), text(cursor.key.updatedAt), text(cursor.key.operationId));
    }
    const rows = db.prepare(`SELECT o.*,
      (SELECT COUNT(*) FROM asset_duplicate_entries e WHERE e.operation_id=o.operation_id) entry_count,
      (SELECT COUNT(*) FROM asset_duplicate_entries e WHERE e.operation_id=o.operation_id AND e.status='quarantined') quarantined_count,
      (SELECT COUNT(*) FROM asset_duplicate_entries e WHERE e.operation_id=o.operation_id AND e.status IN ('failed','restore_failed','recovered')) failed_count
      FROM asset_duplicate_operations o ${where} ORDER BY updated_at DESC,operation_id LIMIT ?`).all(...params, limit + 1);
    const page = rows.slice(0, limit).map(row => {
      let summary = {};
      try { summary = JSON.parse(row.summary_json || '{}'); } catch { /* keep empty summary */ }
      return { operationId: row.operation_id, status: row.status, createdAt: row.created_at,
        confirmedAt: row.confirmed_at, updatedAt: row.updated_at, finishedAt: row.finished_at,
        error: row.error, summary, entryCount: Number(row.entry_count),
        quarantinedCount: Number(row.quarantined_count), failedCount: Number(row.failed_count) };
    });
    const last = rows.slice(0, limit).at(-1);
    return { ok: true, items: page,
      total: Number(db.prepare('SELECT COUNT(*) count FROM asset_duplicate_operations').get().count),
      pageSize: limit, nextCursor: rows.length > limit && last ? cursorEncode({ v: 2, signature,
        key: { updatedAt: last.updated_at, operationId: last.operation_id } }) : '' };
  }

  function updateDuplicateOperation(operationId, patch = {}) {
    const allowed = { status: 'status', confirmedAt: 'confirmed_at', finishedAt: 'finished_at', error: 'error' };
    const entries = Object.entries(patch).filter(([key]) => allowed[key])
      .map(([key, value]) => ({ key, column: allowed[key], value }));
    if (Object.hasOwn(patch, 'summary')) entries.push({ key: 'summary', column: 'summary_json', value: patch.summary });
    if (!entries.length) return duplicateOperation(operationId);
    db.prepare(`UPDATE asset_duplicate_operations SET ${entries.map(entry => `${entry.column}=?`).join(',')},updated_at=? WHERE operation_id=?`)
      .run(...entries.map(entry => entry.column === 'summary_json' ? json(entry.value) : text(entry.value)), nowIso(now), text(operationId));
    return duplicateOperation(operationId);
  }

  function updateDuplicateEntry(entryId, patch = {}) {
    const allowed = { status: 'status', quarantinePath: 'quarantine_path', reason: 'reason', error: 'error' };
    const entries = Object.entries(patch).filter(([key]) => allowed[key]);
    if (!entries.length) return null;
    db.prepare(`UPDATE asset_duplicate_entries SET ${entries.map(([key]) => `${allowed[key]}=?`).join(',')},updated_at=? WHERE entry_id=?`)
      .run(...entries.map(([, value]) => text(value)), nowIso(now), text(entryId));
    return db.prepare('SELECT * FROM asset_duplicate_entries WHERE entry_id=?').get(text(entryId)) || null;
  }

  function setReferenceQuarantine(assetId, sourcePath, operationId, quarantined) {
    const resolvedId = resolveAssetId(assetId);
    if (!resolvedId) return 0;
    const result = db.prepare(`UPDATE asset_references SET state=?,quarantine_operation_id=? WHERE asset_id=? AND path=?`)
      .run(quarantined ? 'quarantined' : 'active', quarantined ? text(operationId) : '', resolvedId, text(sourcePath));
    invalidateSummary();
    refreshSearch(resolvedId);
    return Number(result.changes || 0);
  }

  function setReferenceAvailability(updates = [], checkedAt = nowIso(now)) {
    const rows = Array.isArray(updates) ? updates : [];
    if (!rows.length) return 0;
    const statement = db.prepare(`UPDATE asset_references SET availability_state=?,availability_checked_at=?
      WHERE asset_id=? AND path=? AND state='active'`);
    let changed = 0;
    transaction(() => {
      for (const update of rows) changed += Number(statement.run(update.exists ? 'available' : 'missing', checkedAt,
        resolveAssetId(update.assetId), text(update.path)).changes || 0);
    });
    invalidateSummary();
    return changed;
  }

  function rebuildSearchIndex() {
    db.exec(`DELETE FROM asset_search;
      INSERT INTO asset_search(rowid,asset_id,filename,paths,owner_name,source_name,sha1,sha256,governance)
      SELECT a.rowid,a.asset_id,a.filename,
        TRIM(a.canonical_path || ' ' || COALESCE((SELECT GROUP_CONCAT(r.path,' ') FROM asset_references r
          WHERE r.asset_id=a.asset_id AND r.state='active' AND r.path<>''),'')),
        a.owner_student_name,a.source_name,a.sha1,a.sha256,
        TRIM(a.governance_action || ' ' || a.governance_reason)
      FROM assets a;`);
  }

  function transaction(fn) {
    if (transactionDepth > 0 || Boolean(db.isTransaction)) return fn();
    db.exec('BEGIN IMMEDIATE');
    transactionDepth += 1;
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* transaction already ended */ }
      throw error;
    } finally { transactionDepth -= 1; }
  }

  function beginScan(runId) {
    const at = nowIso(now);
    db.prepare(`UPDATE asset_scan_runs SET status='interrupted',phase='interrupted',updated_at=?,finished_at=? WHERE status='running'`).run(at, at);
    db.prepare(`INSERT INTO asset_scan_runs(run_id,status,phase,started_at,updated_at) VALUES(?, 'running','enumerating',?,?)`).run(runId, at, at);
    return scanStatus(runId);
  }

  function updateScan(runId, patch = {}) {
    const allowed = ['status','phase','finished_at','discovered','processed','added','changed','skipped','failed','current_path','error','cancelled',
      'phase_total','phase_processed','current_scope_type','current_scope_id','current_scope_name'];
    const entries = Object.entries(patch).filter(([key]) => allowed.includes(key));
    if (!entries.length) return scanStatus(runId);
    db.prepare(`UPDATE asset_scan_runs SET ${entries.map(([key]) => `${key}=?`).join(',')},updated_at=? WHERE run_id=?`)
      .run(...entries.map(([, value]) => typeof value === 'number' ? value : text(value)), nowIso(now), runId);
    return scanStatus(runId);
  }

  function scanStatus(runId = '') {
    return runId ? db.prepare('SELECT * FROM asset_scan_runs WHERE run_id=?').get(runId)
      : db.prepare('SELECT * FROM asset_scan_runs ORDER BY started_at DESC LIMIT 1').get() || null;
  }

  function setMeta(key, value) {
    invalidateSummary();
    db.prepare('INSERT INTO asset_index_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(text(key), text(value));
  }

  async function backupTo(destination) { return backup(db, destination); }

  return {
    dbPath, db, resolveAssetId, upsertAsset, replaceAll, readAll, listAssets,
    searchAssets: request => listAssets(request, request?.query), getAssetDetail, findByFingerprint, summary,
    referencesFor, replaceReferences, patchAsset, listVersionGroup, importSnapshot,
    queryDetails, detailsByIds, detailBatches,
    listDuplicateGroups, listDuplicateOperations, createDuplicateOperation, duplicateOperation, updateDuplicateOperation, updateDuplicateEntry, setReferenceQuarantine,
    setReferenceAvailability,
    refreshSearch, rebuildSearchIndex, beginScan, updateScan, scanStatus, setMeta,
    cacheStats: () => ({ summary: summaryCache.size, listCount: listCountCache.size,
      summaryLimit: SUMMARY_CACHE_LIMIT, listCountLimit: LIST_COUNT_CACHE_LIMIT }),
    transaction,
    backupTo, close() { db.close(); },
  };
}

function createAssetIndexStore({ dbPath, legacyJsonPath, now = Date.now, quickCheck = true }) {
  let api = null;
  let migration = null;
  let initializationError = null;
  function initialize() {
    if (api) return api;
    if (initializationError) throw initializationError;
    try {
      if (!fs.existsSync(dbPath)) migration = migrateLegacyJson({ dbPath, legacyJsonPath, now });
      const db = openCheckedDatabase(dbPath, now, quickCheck);
      api = makeStoreApi(db, { dbPath, now });
      return api;
    } catch (error) {
      initializationError = Object.assign(error, { code: error.code || 'asset_db_corrupt' });
      throw initializationError;
    }
  }
  return new Proxy({}, {
    get(_target, property) {
      if (property === 'initialize') return initialize;
      if (property === 'migrationResult') return () => migration;
      if (property === 'initializationError') return () => initializationError;
      const value = initialize()[property];
      return typeof value === 'function' ? value.bind(initialize()) : value;
    },
  });
}

module.exports = {
  SCHEMA_VERSION, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, createAssetIndexStore,
  migrateLegacyJson, normalizeReference, referenceKey,
};
