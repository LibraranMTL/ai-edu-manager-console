'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const {
  MATERIAL_CATEGORIES, PROFILE_FIELDS, V2_SCOPES, checkedCategories, checkedFields,
  normalizeProfile, profileRevisionId, sha256, stableJson,
} = require('./v2-contract.cjs');
const { normalizeRemoteProjectResult } = require('./remote-result-contract.cjs');
const { verifyCloudSourceProductLicense } = require('./product-license.cjs');

const REPORT_TYPES = new Set(['learning_profile', 'learning_change', 'weekly_action', 'stage_summary']);
const MAX_REPORT_BYTES = 2 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const CODE_LIFETIME_MS = 5 * 60 * 1000;
const READ_GRANT_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000;
const ADMIN_SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;
const DEFAULT_MAX_STUDENT_BYTES = 256 * 1024 * 1024;
const DOCUMENT_TYPES = new Map([
  ['text/markdown', '.md'],
  ['application/pdf', '.pdf'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
]);

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function randomToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function validId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{8,96}$/.test(value);
}

function createService({ dataDir, adminToken, now = () => Date.now(), maxStudentBytes = DEFAULT_MAX_STUDENT_BYTES,
  allowLegacyTestCredentials = false, publicOrigin = 'https://www.greatbg.com/edu-cloud', trustedLicenseIssuers = { issuers: [] } }) {
  if (allowLegacyTestCredentials && !process.env.NODE_TEST_CONTEXT) throw new Error('Legacy credentials are restricted to node:test migration fixtures');
  if (!dataDir || !adminToken || String(adminToken).length < 24) {
    throw new Error('dataDir and a 24+ character adminToken are required');
  }
  if (!Number.isSafeInteger(maxStudentBytes) || maxStudentBytes <= 0) {
    throw new Error('maxStudentBytes must be a positive safe integer');
  }
  const oauthIssuer = String(publicOrigin || '').replace(/\/+$/, '');
  if (!/^https:\/\/[^/]+(?:\/[^?#]*)?$/i.test(oauthIssuer) && !/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:\/[^?#]*)?$/i.test(oauthIssuer)) {
    throw new Error('publicOrigin must be HTTPS or a loopback development URL');
  }
  fs.mkdirSync(dataDir, { recursive: true });
  const objectDir = path.join(dataDir, 'objects');
  fs.mkdirSync(objectDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'cloud-reports.sqlite'));
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS students (
      id TEXT PRIMARY KEY, display_name TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('source','viewer')),
      token_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, public_key TEXT
    );
    CREATE TABLE IF NOT EXISTS request_nonces (
      device_id TEXT NOT NULL REFERENCES devices(id), nonce TEXT NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY(device_id,nonce)
    );
    CREATE TABLE IF NOT EXISTS grants (
      device_id TEXT NOT NULL REFERENCES devices(id), student_id TEXT NOT NULL REFERENCES students(id),
      scope TEXT NOT NULL CHECK(scope IN ('report.write','cloud_document.read')),
      revoked_at INTEGER, created_at INTEGER NOT NULL, expires_at INTEGER,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
      PRIMARY KEY(device_id, student_id, scope)
    );
    CREATE TABLE IF NOT EXISTS pairings (
      code_hash TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id),
      expires_at INTEGER NOT NULL, consumed_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS source_enrollments (
      code_hash TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id),
      expires_at INTEGER NOT NULL, consumed_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS source_auto_bindings (
      binding_hash TEXT PRIMARY KEY,
      license_id TEXT NOT NULL,
      product_device_id TEXT NOT NULL,
      source_device_id TEXT NOT NULL REFERENCES devices(id),
      student_id TEXT NOT NULL REFERENCES students(id),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      revoked_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS source_auto_license ON source_auto_bindings(license_id,revoked_at,created_at);
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id),
      origin_device_id TEXT NOT NULL REFERENCES devices(id), origin_platform TEXT NOT NULL, report_type TEXT NOT NULL,
      source_sha256 TEXT NOT NULL, content_sha256 TEXT NOT NULL, source_status TEXT NOT NULL,
      published_at TEXT NOT NULL, received_at INTEGER NOT NULL, byte_size INTEGER NOT NULL,
      filename TEXT NOT NULL, object_name TEXT NOT NULL,
      UNIQUE(student_id, origin_device_id, report_type, content_sha256)
    );
    CREATE INDEX IF NOT EXISTS reports_student_cursor ON reports(student_id, received_at, id);
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id),
      origin_device_id TEXT NOT NULL REFERENCES devices(id), display_name TEXT NOT NULL,
      content_type TEXT NOT NULL, content_sha256 TEXT NOT NULL, byte_size INTEGER NOT NULL,
      object_name TEXT NOT NULL, created_at INTEGER NOT NULL, deleted_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS documents_student ON documents(student_id, created_at);
    CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, occurred_at INTEGER NOT NULL,
      actor_id TEXT NOT NULL, action TEXT NOT NULL, student_id TEXT, target_id TEXT
    );
    CREATE INDEX IF NOT EXISTS audit_events_student ON audit_events(student_id, id);
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_identity (
      id TEXT PRIMARY KEY, salt TEXT NOT NULL, credential_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS report_tombstones (
      revision_id TEXT PRIMARY KEY REFERENCES reports(id), student_id TEXT NOT NULL,
      deleted_at INTEGER NOT NULL, actor_id TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS student_profile_revisions (
      revision_id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id),
      source_device_id TEXT NOT NULL REFERENCES devices(id), profile_json TEXT NOT NULL,
      fields_json TEXT NOT NULL, content_sha256 TEXT NOT NULL, created_at INTEGER NOT NULL,
      UNIQUE(student_id, source_device_id, content_sha256)
    );
    CREATE INDEX IF NOT EXISTS student_profile_revisions_student
      ON student_profile_revisions(student_id, created_at, revision_id);
    CREATE TABLE IF NOT EXISTS student_profile_current (
      student_id TEXT PRIMARY KEY REFERENCES students(id), revision_id TEXT NOT NULL REFERENCES student_profile_revisions(revision_id),
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS v2_grants (
      device_id TEXT NOT NULL REFERENCES devices(id), student_id TEXT NOT NULL REFERENCES students(id),
      scope TEXT NOT NULL, category TEXT NOT NULL DEFAULT '', fields_json TEXT NOT NULL DEFAULT '[]',
      object_scope_json TEXT NOT NULL DEFAULT '[]', purpose TEXT NOT NULL DEFAULT 'document_sync', created_at INTEGER NOT NULL, expires_at INTEGER,
      revoked_at INTEGER, policy_version INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY(device_id, student_id, scope, category)
    );
    CREATE INDEX IF NOT EXISTS v2_grants_student ON v2_grants(student_id, device_id, scope);
    CREATE TABLE IF NOT EXISTS scoped_viewer_bindings (
      device_id TEXT NOT NULL REFERENCES devices(id), student_id TEXT NOT NULL REFERENCES students(id),
      source_device_id TEXT REFERENCES devices(id), created_at INTEGER NOT NULL,
      PRIMARY KEY(device_id, student_id)
    );
    CREATE TABLE IF NOT EXISTS device_student_bindings (
      binding_id TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id),
      student_id TEXT NOT NULL REFERENCES students(id), local_student_id TEXT NOT NULL,
      profile_revision_id TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      revoked_at INTEGER, UNIQUE(device_id, student_id)
    );
    CREATE TABLE IF NOT EXISTS transfer_receipts (
      receipt_id TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id),
      student_id TEXT NOT NULL REFERENCES students(id), object_type TEXT NOT NULL,
      object_id TEXT NOT NULL, revision_id TEXT NOT NULL DEFAULT '', action TEXT NOT NULL,
      idempotency_key TEXT NOT NULL, status TEXT NOT NULL, detail_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE(device_id, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS transfer_receipts_student ON transfer_receipts(student_id, device_id, updated_at);
    CREATE TABLE IF NOT EXISTS sync_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, student_id TEXT NOT NULL REFERENCES students(id),
      event_type TEXT NOT NULL, object_type TEXT NOT NULL, object_id TEXT NOT NULL,
      revision_id TEXT NOT NULL DEFAULT '', occurred_at INTEGER NOT NULL, tombstone INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS sync_events_student ON sync_events(student_id, sequence);
    CREATE TABLE IF NOT EXISTS remote_agent_sessions (
      session_id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
      owner_device_id TEXT NOT NULL REFERENCES devices(id), provider TEXT NOT NULL,
      student_id TEXT NOT NULL REFERENCES students(id), project_id TEXT NOT NULL DEFAULT '',
      student_ids_json TEXT NOT NULL DEFAULT '[]', scope_fingerprint TEXT NOT NULL DEFAULT '', categories_json TEXT NOT NULL DEFAULT '[]',
      task_id TEXT NOT NULL DEFAULT '', execution_id TEXT NOT NULL DEFAULT '', task_type TEXT NOT NULL DEFAULT '', idempotency_key TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'issued', result_submission_id TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS remote_agent_sessions_owner ON remote_agent_sessions(owner_device_id,student_id,expires_at);
    CREATE TABLE IF NOT EXISTS cloud_inbox_submissions (
      submission_id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id),
      student_ids_json TEXT NOT NULL DEFAULT '[]',
      target_device_id TEXT NOT NULL REFERENCES devices(id), provider TEXT NOT NULL,
      project_id TEXT NOT NULL DEFAULT '', scope_fingerprint TEXT NOT NULL DEFAULT '',
      idempotency_key TEXT NOT NULL, payload_json TEXT NOT NULL, content_sha256 TEXT NOT NULL,
      status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      lease_id TEXT, lease_owner_device_id TEXT, lease_expires_at INTEGER,
      consumed_at INTEGER, quarantined_reason TEXT NOT NULL DEFAULT '',
      UNIQUE(target_device_id,idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS cloud_inbox_target ON cloud_inbox_submissions(target_device_id,status,created_at,submission_id);
    CREATE TABLE IF NOT EXISTS cloud_inbox_attachments (
      submission_id TEXT NOT NULL REFERENCES cloud_inbox_submissions(submission_id),
      attachment_id TEXT NOT NULL, display_name TEXT NOT NULL, content_type TEXT NOT NULL,
      content_sha256 TEXT NOT NULL, byte_size INTEGER NOT NULL, object_name TEXT NOT NULL,
      created_at INTEGER NOT NULL, PRIMARY KEY(submission_id,attachment_id)
    );
    CREATE TABLE IF NOT EXISTS health_records (
      revision_id TEXT PRIMARY KEY, health_record_id TEXT NOT NULL,
      student_id TEXT NOT NULL REFERENCES students(id), origin_device_id TEXT NOT NULL REFERENCES devices(id),
      display_name TEXT NOT NULL, content_type TEXT NOT NULL, content_sha256 TEXT NOT NULL,
      byte_size INTEGER NOT NULL, object_name TEXT NOT NULL, idempotency_key TEXT NOT NULL,
      created_at INTEGER NOT NULL, deleted_at INTEGER,
      UNIQUE(student_id,origin_device_id,idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS health_records_student ON health_records(student_id,health_record_id,created_at,revision_id);
    CREATE TABLE IF NOT EXISTS material_current (
      student_id TEXT NOT NULL REFERENCES students(id), material_category TEXT NOT NULL,
      material_id TEXT NOT NULL, project_id TEXT NOT NULL DEFAULT '', scope_fingerprint TEXT NOT NULL DEFAULT '',
      revision_id TEXT NOT NULL UNIQUE, updated_at INTEGER NOT NULL,
      PRIMARY KEY(student_id,material_category,material_id,project_id,scope_fingerprint)
    );
    CREATE INDEX IF NOT EXISTS material_current_revision ON material_current(revision_id);
    CREATE TABLE IF NOT EXISTS material_index_jobs (
      revision_id TEXT PRIMARY KEY, status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, available_at INTEGER NOT NULL, claimed_at INTEGER,
      updated_at INTEGER NOT NULL, error_code TEXT NOT NULL DEFAULT '', error_message TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS material_index_jobs_ready ON material_index_jobs(status,available_at,updated_at);
    CREATE TABLE IF NOT EXISTS material_search_documents (
      revision_id TEXT PRIMARY KEY, content_sha256 TEXT NOT NULL,
      extracted_text TEXT NOT NULL, extraction_status TEXT NOT NULL, page_count INTEGER NOT NULL DEFAULT 0,
      indexed_at INTEGER NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS material_search_fts USING fts5(
      revision_id UNINDEXED, display_name, body, tokenize='unicode61'
    );
    CREATE TABLE IF NOT EXISTS oauth_clients (
      client_id TEXT PRIMARY KEY, owner_device_id TEXT NOT NULL REFERENCES devices(id), client_name TEXT NOT NULL,
      redirect_uris_json TEXT NOT NULL, created_at INTEGER NOT NULL, revoked_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
      code_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES oauth_clients(client_id),
      session_id TEXT NOT NULL REFERENCES remote_agent_sessions(session_id), redirect_uri TEXT NOT NULL,
      code_challenge TEXT NOT NULL, scope TEXT NOT NULL, created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL, consumed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS oauth_authorization_codes_expiry ON oauth_authorization_codes(expires_at,consumed_at);
    CREATE TABLE IF NOT EXISTS oauth_access_tokens (
      token_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES oauth_clients(client_id),
      session_id TEXT NOT NULL REFERENCES remote_agent_sessions(session_id), scope TEXT NOT NULL,
      audience TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS oauth_access_tokens_session ON oauth_access_tokens(session_id,expires_at,revoked_at);
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL, detail_json TEXT NOT NULL DEFAULT '{}'
    );
  `);
  if (!db.prepare('PRAGMA table_info(reports)').all().some(column => column.name === 'origin_platform')) {
    db.exec("ALTER TABLE reports ADD COLUMN origin_platform TEXT NOT NULL DEFAULT 'unknown'");
  }
  if (!db.prepare('PRAGMA table_info(grants)').all().some(column => column.name === 'expires_at')) {
    db.exec('ALTER TABLE grants ADD COLUMN expires_at INTEGER');
    db.prepare('UPDATE grants SET expires_at=created_at+? WHERE scope=?')
      .run(READ_GRANT_LIFETIME_MS, 'cloud_document.read');
  }
  if (!db.prepare('PRAGMA table_info(grants)').all().some(column => column.name === 'enabled')) {
    db.exec('ALTER TABLE grants ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1))');
  }
  if (!db.prepare('PRAGMA table_info(devices)').all().some(column => column.name === 'public_key')) {
    db.exec('ALTER TABLE devices ADD COLUMN public_key TEXT');
  }
  if (!db.prepare('PRAGMA table_info(devices)').all().some(column => column.name === 'revoked_at')) db.exec('ALTER TABLE devices ADD COLUMN revoked_at INTEGER');
  const studentColumns = new Set(db.prepare('PRAGMA table_info(students)').all().map(column => column.name));
  if (!studentColumns.has('archived_at')) db.exec('ALTER TABLE students ADD COLUMN archived_at INTEGER');
  if (!studentColumns.has('archived_reason')) db.exec("ALTER TABLE students ADD COLUMN archived_reason TEXT NOT NULL DEFAULT ''");
  const documentColumns = new Set(db.prepare('PRAGMA table_info(documents)').all().map(column => column.name));
  if (!documentColumns.has('material_category')) db.exec("ALTER TABLE documents ADD COLUMN material_category TEXT NOT NULL DEFAULT 'learning_material'");
  if (!documentColumns.has('material_id')) db.exec("ALTER TABLE documents ADD COLUMN material_id TEXT NOT NULL DEFAULT ''");
  if (!documentColumns.has('revision_id')) db.exec("ALTER TABLE documents ADD COLUMN revision_id TEXT NOT NULL DEFAULT ''");
  if (!documentColumns.has('idempotency_key')) db.exec("ALTER TABLE documents ADD COLUMN idempotency_key TEXT NOT NULL DEFAULT ''");
  if (!documentColumns.has('project_id')) db.exec("ALTER TABLE documents ADD COLUMN project_id TEXT NOT NULL DEFAULT ''");
  if (!documentColumns.has('scope_fingerprint')) db.exec("ALTER TABLE documents ADD COLUMN scope_fingerprint TEXT NOT NULL DEFAULT ''");
  const v2GrantColumns = new Set(db.prepare('PRAGMA table_info(v2_grants)').all().map(column => column.name));
  if (!v2GrantColumns.has('purpose')) db.exec("ALTER TABLE v2_grants ADD COLUMN purpose TEXT NOT NULL DEFAULT 'document_sync'");
  db.exec('CREATE INDEX IF NOT EXISTS documents_v2_material ON documents(student_id,material_category,material_id,created_at,revision_id)');
  const remoteSessionColumns = new Set(db.prepare('PRAGMA table_info(remote_agent_sessions)').all().map(column => column.name));
  for (const [column, sql] of [
    ['task_id', "ALTER TABLE remote_agent_sessions ADD COLUMN task_id TEXT NOT NULL DEFAULT ''"],
    ['execution_id', "ALTER TABLE remote_agent_sessions ADD COLUMN execution_id TEXT NOT NULL DEFAULT ''"],
    ['task_type', "ALTER TABLE remote_agent_sessions ADD COLUMN task_type TEXT NOT NULL DEFAULT ''"],
    ['idempotency_key', "ALTER TABLE remote_agent_sessions ADD COLUMN idempotency_key TEXT NOT NULL DEFAULT ''"],
    ['status', "ALTER TABLE remote_agent_sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'issued'"],
    ['result_submission_id', "ALTER TABLE remote_agent_sessions ADD COLUMN result_submission_id TEXT NOT NULL DEFAULT ''"],
    ['updated_at', 'ALTER TABLE remote_agent_sessions ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0'],
    ['student_ids_json', "ALTER TABLE remote_agent_sessions ADD COLUMN student_ids_json TEXT NOT NULL DEFAULT '[]'"],
  ]) if (!remoteSessionColumns.has(column)) db.exec(sql);
  const inboxColumns = new Set(db.prepare('PRAGMA table_info(cloud_inbox_submissions)').all().map(column => column.name));
  if (!inboxColumns.has('student_ids_json')) db.exec("ALTER TABLE cloud_inbox_submissions ADD COLUMN student_ids_json TEXT NOT NULL DEFAULT '[]'");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS remote_agent_sessions_task ON remote_agent_sessions(owner_device_id,idempotency_key) WHERE idempotency_key!=''");
  db.prepare('INSERT OR IGNORE INTO schema_migrations(id,applied_at,detail_json) VALUES(?,?,?)')
    .run('cloud-contract-v2', now(), JSON.stringify({ contractVersion: 2, legacyContractSupported: true }));
  db.prepare('INSERT OR IGNORE INTO schema_migrations(id,applied_at,detail_json) VALUES(?,?,?)')
    .run('cloud-student-archive-v1', now(), JSON.stringify({ recoverable: true, physicalObjectsRetained: true }));
  const materialIndexMigrationExists = Boolean(db.prepare('SELECT 1 FROM schema_migrations WHERE id=?')
    .get('cloud-material-index-c4'));
  if (!materialIndexMigrationExists) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        INSERT OR IGNORE INTO material_current(student_id,material_category,material_id,project_id,scope_fingerprint,revision_id,updated_at)
        SELECT d.student_id,d.material_category,d.material_id,d.project_id,d.scope_fingerprint,d.revision_id,d.created_at
        FROM documents d
        WHERE d.revision_id!='' AND d.deleted_at IS NULL AND NOT EXISTS (
          SELECT 1 FROM documents newer
          WHERE newer.student_id=d.student_id AND newer.material_category=d.material_category
            AND newer.material_id=d.material_id AND newer.project_id=d.project_id
            AND newer.scope_fingerprint=d.scope_fingerprint AND newer.deleted_at IS NULL
            AND (newer.created_at>d.created_at OR (newer.created_at=d.created_at AND newer.revision_id>d.revision_id))
        );
        INSERT OR IGNORE INTO material_index_jobs(revision_id,status,attempts,available_at,updated_at)
        SELECT c.revision_id,'pending',0,0,0 FROM material_current c
        LEFT JOIN material_search_documents s ON s.revision_id=c.revision_id
        WHERE s.revision_id IS NULL;
      `);
      db.prepare('INSERT INTO schema_migrations(id,applied_at,detail_json) VALUES(?,?,?)')
        .run('cloud-material-index-c4', now(), JSON.stringify({ currentRevisionPointer: true, asynchronousExtraction: true, currentOnlyIndex: true }));
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  db.prepare('INSERT OR IGNORE INTO schema_migrations(id,applied_at,detail_json) VALUES(?,?,?)')
    .run('cloud-oauth-pkce-v1', now(), JSON.stringify({ authorizationCode: true, pkceMethod: 'S256', publicClients: true }));
  db.prepare('INSERT OR IGNORE INTO schema_migrations(id,applied_at,detail_json) VALUES(?,?,?)')
    .run('cloud-health-records-c2', now(), JSON.stringify({ independentObjectScope: true, explicitReadWriteGrant: true }));
  db.prepare('INSERT OR IGNORE INTO schema_migrations(id,applied_at,detail_json) VALUES(?,?,?)')
    .run('cloud-inbox-attachments-c5', now(), JSON.stringify({ contentAddressedObjects: true, leaseProtectedDownload: true }));
  if (!db.prepare('SELECT 1 FROM admin_identity WHERE id=?').get('admin_local')) {
    const salt = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO admin_identity VALUES(?,?,?)').run('admin_local', salt, crypto.scryptSync(adminToken, salt, 32).toString('hex'));
    db.exec('DELETE FROM admin_sessions');
  }
  db.prepare('INSERT OR IGNORE INTO devices(id,kind,token_hash,created_at) VALUES(?,?,?,?)')
    .run('admin_local', 'source', digest(`admin-local:${adminToken}`), now());

  function audit(actorId, action, studentId = null, targetId = null) {
    db.prepare('INSERT INTO audit_events(occurred_at,actor_id,action,student_id,target_id) VALUES(?,?,?,?,?)')
      .run(now(), actorId, action, studentId, targetId);
  }
  function schemaStatus() {
    const migration = db.prepare('SELECT id,applied_at AS appliedAt,detail_json AS detailJson FROM schema_migrations WHERE id=?')
      .get('cloud-contract-v2');
    const studentArchiveMigration = db.prepare('SELECT id,applied_at AS appliedAt FROM schema_migrations WHERE id=?')
      .get('cloud-student-archive-v1');
    const materialIndexMigration = db.prepare('SELECT id,applied_at AS appliedAt FROM schema_migrations WHERE id=?')
      .get('cloud-material-index-c4');
    const oauthMigration = db.prepare('SELECT id,applied_at AS appliedAt FROM schema_migrations WHERE id=?')
      .get('cloud-oauth-pkce-v1');
    const healthMigration = db.prepare('SELECT id,applied_at AS appliedAt FROM schema_migrations WHERE id=?')
      .get('cloud-health-records-c2');
    const inboxAttachmentMigration = db.prepare('SELECT id,applied_at AS appliedAt FROM schema_migrations WHERE id=?')
      .get('cloud-inbox-attachments-c5');
    return { contractVersion: 2, legacyContractSupported: true, migrationId: 'cloud-contract-v2',
      applied: Boolean(migration), appliedAt: migration?.appliedAt || 0,
      studentArchive: { migrationId: 'cloud-student-archive-v1', applied: Boolean(studentArchiveMigration),
        appliedAt: studentArchiveMigration?.appliedAt || 0 },
      materialIndex: { migrationId: 'cloud-material-index-c4', applied: Boolean(materialIndexMigration),
        appliedAt: materialIndexMigration?.appliedAt || 0 },
      oauthPkce: { migrationId: 'cloud-oauth-pkce-v1', applied: Boolean(oauthMigration), appliedAt: oauthMigration?.appliedAt || 0 },
      healthRecords: { migrationId: 'cloud-health-records-c2', applied: Boolean(healthMigration),
        appliedAt: healthMigration?.appliedAt || 0 },
      inboxAttachments: { migrationId: 'cloud-inbox-attachments-c5', applied: Boolean(inboxAttachmentMigration),
        appliedAt: inboxAttachmentMigration?.appliedAt || 0 } };
  }
  function atomic(action) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  function listAudit(token, cursor = '', studentId = '') {
    if (!isAdmin(token)) fail(401, '管理员凭据无效');
    if (cursor && (!/^[1-9]\d*$/.test(String(cursor)) || !Number.isSafeInteger(Number(cursor)))) fail(400, '审计游标无效');
    if (studentId && !validId(studentId)) fail(400, '学生标识无效');
    const rows = db.prepare(`SELECT id, occurred_at AS occurredAt, actor_id AS actorId, action,
      student_id AS studentId, target_id AS targetId FROM audit_events
      WHERE (?='' OR student_id=?) AND (?=0 OR id<?) ORDER BY id DESC LIMIT 101`)
      .all(studentId, studentId, cursor ? Number(cursor) : 0, cursor ? Number(cursor) : 0);
    const events = rows.slice(0, 100);
    return { events, nextCursor: rows.length > 100 ? String(events.at(-1).id) : '' };
  }

  function loginAdmin(credential) {
    if (!validAdminCredential(credential)) fail(401, '管理员凭据无效');
    const sessionToken = randomToken();
    const expiresAt = now() + ADMIN_SESSION_LIFETIME_MS;
    atomic(() => {
      db.prepare('DELETE FROM admin_sessions WHERE expires_at<=?').run(now());
      db.prepare('INSERT INTO admin_sessions(token_hash,created_at,expires_at) VALUES(?,?,?)')
        .run(digest(sessionToken), now(), expiresAt);
      audit('admin_local', 'admin.session.login');
    });
    return { sessionToken, expiresAt };
  }
  function validAdminCredential(value) {
    if (typeof value !== 'string' || value.length < 24 || value.length > 256) return false;
    const identity = db.prepare('SELECT * FROM admin_identity WHERE id=?').get('admin_local');
    return safeEqual(crypto.scryptSync(value, identity.salt, 32).toString('hex'), identity.credential_hash);
  }
  function rotateAdmin(token, oldCredential, newCredential) {
    if (!isAdmin(token) || !validAdminCredential(oldCredential)) fail(401, '管理员凭据无效');
    if (typeof newCredential !== 'string' || newCredential.length < 24 || newCredential.length > 256 || newCredential === oldCredential) fail(400, '新凭据须为不同的 24–256 字符');
    const salt = crypto.randomBytes(32).toString('hex');
    const hash = crypto.scryptSync(newCredential, salt, 32).toString('hex');
    atomic(() => {
      db.prepare('UPDATE admin_identity SET salt=?,credential_hash=? WHERE id=?').run(salt, hash, 'admin_local');
      db.exec('DELETE FROM admin_sessions');
      audit('admin_local', 'admin.credential.rotate');
    });
    return { rotated: true, loginRequired: true };
  }
  function logoutAdmin(token) {
    if (!token || safeEqual(token, adminToken)) fail(401, '管理会话无效');
    return atomic(() => {
      const result = db.prepare('DELETE FROM admin_sessions WHERE token_hash=? AND expires_at>?')
        .run(digest(token), now());
      if (result.changes !== 1) fail(401, '管理会话无效');
      audit('admin_local', 'admin.session.logout');
      return { loggedOut: true };
    });
  }
  function isAdmin(token) {
    if (!token) return false;
    if (allowLegacyTestCredentials && safeEqual(token, adminToken)) return true;
    return Boolean(db.prepare('SELECT 1 FROM admin_sessions WHERE token_hash=? AND expires_at>?')
      .get(digest(token), now()));
  }
  function deviceFor(token) {
    if (!token) return null;
    return db.prepare('SELECT id, kind, public_key FROM devices WHERE token_hash=? AND revoked_at IS NULL').get(digest(token)) || null;
  }
  function requireDevice(token, kind) {
    const device = deviceFor(token);
    if (!device || (kind && device.kind !== kind)) fail(401, '设备凭据无效');
    return device;
  }
  function verifyViewerProof(token, method, route, headers) {
    const device = deviceFor(token);
    if (!device || (device.kind === 'source' && allowLegacyTestCredentials && !device.public_key)) return;
    const row = db.prepare('SELECT public_key FROM devices WHERE id=?').get(device.id);
    const timestamp = String(headers['x-cloud-timestamp'] || '');
    const nonce = String(headers['x-cloud-nonce'] || '');
    const signature = String(headers['x-cloud-signature'] || '');
    if (!row?.public_key || headers['x-cloud-device-id'] !== device.id || !/^\d{10,16}$/.test(timestamp) ||
        Math.abs(now() - Number(timestamp)) > 60000 || !/^[A-Za-z0-9_-]{16,64}$/.test(nonce) ||
        !/^[A-Za-z0-9_-]{64,256}$/.test(signature)) fail(401, '主机持有证明无效');
    const bodyHash = String(headers['x-cloud-body-sha256'] || '');
    if (device.kind === 'source' && !/^[a-f0-9]{64}$/.test(bodyHash)) fail(401, '请求正文证明缺失');
    const message = Buffer.from(`${method}\n${route}\n${timestamp}\n${nonce}${device.kind === 'source' ? `\n${bodyHash}` : ''}`);
    let verified = false;
    try { verified = crypto.verify('sha256', message, row.public_key, Buffer.from(signature, 'base64url')); }
    catch { /* malformed signature */ }
    if (!verified) fail(401, '主机持有证明无效');
    db.prepare('DELETE FROM request_nonces WHERE created_at<?').run(now() - 120000);
    try { db.prepare('INSERT INTO request_nonces(device_id,nonce,created_at) VALUES(?,?,?)').run(device.id, nonce, now()); }
    catch { fail(401, '主机请求已使用'); }
  }
  function verifyBody(token, bytes, headers) {
    verifyBodyHash(token, digest(bytes), headers);
  }
  function verifyBodyHash(token, hash, headers) {
    const device = deviceFor(token);
    if (device?.kind === 'source' && (device.public_key || !allowLegacyTestCredentials) &&
        !safeEqual(headers['x-cloud-body-sha256'], hash)) fail(401, '请求正文与签名不一致');
  }
  function checkedKey(value) {
    if (!value && allowLegacyTestCredentials) return null;
    try {
      const key = crypto.createPublicKey(value);
      if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1' || value.length > 1000) throw new Error();
      return key.export({ type: 'spki', format: 'pem' });
    } catch { fail(400, '来源公钥须为 P-256'); }
  }
  function rotateDevice(token, nextToken) {
    const device = requireDevice(token, 'source');
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(nextToken || '') || nextToken === token) fail(400, '新设备凭据无效');
    atomic(() => {
      db.prepare('UPDATE devices SET token_hash=? WHERE id=?').run(digest(nextToken), device.id);
      audit(device.id, 'device.credential.rotate', null, device.id);
    });
    return { rotated: true };
  }
  function recordDenied(token, status) {
    if ([401, 403, 429].includes(status)) audit(deviceFor(token)?.id || 'anonymous', `security.denied.${status}`);
  }
  function revokeDevice(token, deviceId) {
    if (!isAdmin(token)) fail(401, '管理员凭据无效');
    if (!validId(deviceId) || deviceId === 'admin_local') fail(400, '设备标识无效');
    atomic(() => {
      db.prepare('UPDATE devices SET revoked_at=? WHERE id=?').run(now(), deviceId);
      db.prepare('UPDATE grants SET revoked_at=? WHERE device_id=?').run(now(), deviceId);
      audit('admin_local', 'device.revoke', null, deviceId);
    });
    return { revoked: true };
  }
  function hasGrant(deviceId, studentId, scope) {
    return Boolean(db.prepare("SELECT 1 FROM grants g JOIN students s ON s.id=g.student_id WHERE g.device_id=? AND g.student_id=? AND g.scope=? AND g.revoked_at IS NULL AND g.enabled=1 AND s.archived_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>?)")
      .get(deviceId, studentId, scope, now()));
  }
  function requireGrant(deviceId, studentId, scope) {
    if (!hasGrant(deviceId, studentId, scope)) fail(403, '该设备没有此学生的许可');
  }
  function studentExists(studentId) {
    return Boolean(db.prepare('SELECT 1 FROM students WHERE id=? AND archived_at IS NULL').get(studentId));
  }
  function studentUsedBytes(studentId) {
    const reports = db.prepare('SELECT COALESCE(SUM(byte_size),0) AS bytes FROM reports WHERE student_id=?').get(studentId).bytes;
    const documents = db.prepare('SELECT COALESCE(SUM(byte_size),0) AS bytes FROM documents WHERE student_id=?').get(studentId).bytes;
    const health = db.prepare('SELECT COALESCE(SUM(byte_size),0) AS bytes FROM health_records WHERE student_id=? AND deleted_at IS NULL').get(studentId).bytes;
    return reports + documents + health;
  }
  function studentStorage(token, studentId) {
    if (!isAdmin(token)) fail(401, '管理员凭据无效');
    if (!studentExists(studentId)) fail(404, '学生不存在');
    return { cloudStudentId: studentId, usedBytes: studentUsedBytes(studentId), maxBytes: maxStudentBytes };
  }
  function requireStudentCapacity(studentId, additionalBytes) {
    if (additionalBytes > maxStudentBytes - studentUsedBytes(studentId)) fail(413, '该学生云端容量已满');
  }
  function grant(deviceId, studentId, scope, actorId = 'admin_local') {
    if (!studentExists(studentId)) fail(404, '学生不存在');
    const device = db.prepare('SELECT kind FROM devices WHERE id=?').get(deviceId);
    if (!device) fail(404, '设备不存在');
    if (scope === 'report.write' && device.kind !== 'source') fail(400, '只有来源设备可上传');
    if (scope === 'cloud_document.read' && device.kind !== 'viewer') fail(400, '只有接收设备可下载');
    const expiresAt = scope === 'cloud_document.read' ? now() + READ_GRANT_LIFETIME_MS : null;
    db.prepare(`INSERT INTO grants(device_id,student_id,scope,created_at,revoked_at,expires_at,enabled) VALUES(?,?,?,?,NULL,?,1)
      ON CONFLICT(device_id,student_id,scope) DO UPDATE SET revoked_at=NULL,created_at=excluded.created_at,expires_at=excluded.expires_at,enabled=1`)
      .run(deviceId, studentId, scope, now(), expiresAt);
    audit(actorId, `grant.issue.${scope}`, studentId, deviceId);
    return { deviceId, studentId, scope, active: true, expiresAt };
  }
  function grantV2(deviceId, studentId, scope, { category = '', fields = [], objectScope = [], purpose = 'document_sync', expiresAt: requestedExpiresAt = null, actorId = 'admin_local' } = {}) {
    if (!studentExists(studentId)) fail(404, '学生不存在');
    if (!V2_SCOPES.includes(scope)) fail(400, 'v2 许可范围无效');
    const device = db.prepare('SELECT kind FROM devices WHERE id=? AND revoked_at IS NULL').get(deviceId);
    if (!device) fail(404, '设备不存在');
    if (scope.endsWith('.write') && device.kind !== 'source') fail(400, '只有来源设备可获得上传许可');
    if (scope.endsWith('.read') && device.kind !== 'viewer') fail(400, '只有接收设备可获得读取许可');
    if (scope.startsWith('material.') && !MATERIAL_CATEGORIES.includes(category)) fail(400, '资料类别无效');
    if (!scope.startsWith('material.') && category) fail(400, '该许可不接受资料类别');
    const normalizedFields = scope.startsWith('student_profile.') ? checkedFields(fields) : [];
    const normalizedObjects = [...new Set((Array.isArray(objectScope) ? objectScope : []).map(String).filter(Boolean))].sort();
    const normalizedPurpose = String(purpose || 'document_sync');
    if (!['document_sync', 'expert_interpretation'].includes(normalizedPurpose)) fail(400, '授权用途无效');
    let expiresAt = scope.endsWith('.read') ? now() + READ_GRANT_LIFETIME_MS : null;
    if (scope.endsWith('.write') && requestedExpiresAt !== null && requestedExpiresAt !== undefined) {
      expiresAt = Number(requestedExpiresAt);
      if (!Number.isSafeInteger(expiresAt) || expiresAt <= now() + 5 * 60 * 1000 || expiresAt > now() + 365 * 24 * 60 * 60 * 1000) {
        fail(400, '上传授权有效期无效');
      }
    }
    db.prepare(`INSERT INTO v2_grants(device_id,student_id,scope,category,fields_json,object_scope_json,purpose,created_at,expires_at,revoked_at,policy_version)
      VALUES(?,?,?,?,?,?,?,?,?,NULL,1)
      ON CONFLICT(device_id,student_id,scope,category) DO UPDATE SET fields_json=excluded.fields_json,
      object_scope_json=excluded.object_scope_json,purpose=excluded.purpose,created_at=excluded.created_at,expires_at=excluded.expires_at,revoked_at=NULL,
      policy_version=v2_grants.policy_version+1`)
      .run(deviceId, studentId, scope, category, JSON.stringify(normalizedFields), JSON.stringify(normalizedObjects), normalizedPurpose, now(), expiresAt);
    audit(actorId, `grant.v2.issue.${scope}${category ? `.${category}` : ''}`, studentId, deviceId);
    return { deviceId, studentId, scope, category, fields: normalizedFields, objectScope: normalizedObjects, purpose: normalizedPurpose, expiresAt };
  }
  function v2Grant(deviceId, studentId, scope, category = '') {
    const row = db.prepare(`SELECT g.* FROM v2_grants g JOIN students s ON s.id=g.student_id
      WHERE g.device_id=? AND g.student_id=? AND g.scope=? AND g.category=? AND s.archived_at IS NULL
      AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>?)`).get(deviceId, studentId, scope, category, now());
    if (!row) return null;
    return { ...row, fields: JSON.parse(row.fields_json || '[]'), objectScope: JSON.parse(row.object_scope_json || '[]') };
  }
  function requireV2Grant(deviceId, studentId, scope, category = '') {
    const row = v2Grant(deviceId, studentId, scope, category);
    if (!row) fail(403, scope.startsWith('health_record.') ? '该设备没有单独的健康资料许可' : '该设备没有此学生的对应资料许可');
    if (scope === 'student_profile.read' || scope === 'material.read') {
      const binding = db.prepare('SELECT source_device_id AS sourceId FROM scoped_viewer_bindings WHERE device_id=? AND student_id=?').get(deviceId, studentId);
      if (binding?.sourceId) {
        if (!hasGrant(binding.sourceId, studentId, 'report.write')) fail(403, '来源设备的授权已停止或到期');
        const source = v2Grant(binding.sourceId, studentId, scope === 'student_profile.read' ? 'student_profile.write' : 'material.write', category);
        if (!source || (scope === 'student_profile.read' && row.fields.some(field => !source.fields.includes(field)))) fail(403, '读取范围超出当前来源授权');
      }
    }
    return row;
  }

  function requireScopedViewerMaterial(deviceId, studentId, category) {
    const scoped = db.prepare('SELECT 1 FROM scoped_viewer_bindings WHERE device_id=? AND student_id=?').get(deviceId, studentId);
    if (scoped) requireV2Grant(deviceId, studentId, 'material.read', category);
  }
  function requireScopedSourceMaterial(deviceId, studentId, category) {
    const scoped = db.prepare(`SELECT 1 FROM v2_grants WHERE device_id=? AND student_id=?
      AND scope IN ('student_profile.write','material.write') LIMIT 1`).get(deviceId, studentId)
      || db.prepare('SELECT 1 FROM source_auto_bindings WHERE source_device_id=? AND student_id=?').get(deviceId, studentId);
    if (scoped) requireV2Grant(deviceId, studentId, 'material.write', category);
  }
  function appendSyncEvent(studentId, eventType, objectType, objectId, revisionId = '', tombstone = 0) {
    db.prepare(`INSERT INTO sync_events(student_id,event_type,object_type,object_id,revision_id,occurred_at,tombstone)
      VALUES(?,?,?,?,?,?,?)`).run(studentId, eventType, objectType, objectId, revisionId, now(), tombstone ? 1 : 0);
  }
  function createStudent(token, displayName) {
    if (!isAdmin(token)) fail(401, '管理员凭据无效');
    const name = String(displayName || '').trim();
    if (!name || name.length > 100) fail(400, '学生显示名无效');
    const id = `cs_${crypto.randomUUID().replaceAll('-', '')}`;
    atomic(() => {
      db.prepare('INSERT INTO students(id,display_name,created_at) VALUES(?,?,?)').run(id, name, now());
      audit('admin_local', 'student.create', id);
    });
    return { id, displayName: name };
  }
  function registerSource(token, publicKey) {
    if (!isAdmin(token)) fail(401, '管理员凭据无效');
    const key = checkedKey(publicKey);
    const deviceToken = randomToken();
    const deviceId = `src_${crypto.randomUUID().replaceAll('-', '')}`;
    atomic(() => {
      db.prepare('INSERT INTO devices(id,kind,token_hash,created_at,public_key) VALUES(?,?,?,?,?)')
        .run(deviceId, 'source', digest(deviceToken), now(), key);
      audit('admin_local', 'source.register', null, deviceId);
    });
    return { deviceId, deviceToken };
  }
  function allowWrite(token, deviceId, studentId) {
    if (!isAdmin(token)) fail(401, '管理员凭据无效');
    return atomic(() => grant(deviceId, studentId, 'report.write'));
  }
  function createSourceEnrollment(token, studentId) {
    if (!isAdmin(token)) fail(401, '管理员凭据无效');
    if (!studentExists(studentId)) fail(404, '学生不存在');
    const code = crypto.randomBytes(9).toString('base64url').toUpperCase();
    const expiresAt = now() + CODE_LIFETIME_MS;
    atomic(() => {
      db.prepare('INSERT INTO source_enrollments(code_hash,student_id,expires_at) VALUES(?,?,?)')
        .run(digest(code), studentId, expiresAt);
      audit('admin_local', 'source.enrollment.create', studentId);
    });
    return { enrollmentCode: code, expiresAt };
  }
  function redeemSourceEnrollment(code, existingToken = '', publicKey, options = {}) {
    const key = checkedKey(publicKey);
    if (!/^[A-Z0-9_-]{12}$/.test(String(code || ''))) fail(400, '开通码格式无效');
    const record = db.prepare('SELECT student_id,expires_at,consumed_at FROM source_enrollments WHERE code_hash=?').get(digest(code));
    if (!record || record.consumed_at || record.expires_at <= now()) fail(404, '开通码无效或已过期');
    const existing = existingToken ? requireDevice(existingToken, 'source') : null;
    if (existing && existing.public_key !== key) fail(403, '来源公钥与已绑定设备不一致');
    const deviceToken = existing ? existingToken : randomToken();
    const deviceId = existing ? existing.id : `src_${crypto.randomUUID().replaceAll('-', '')}`;
    atomic(() => {
      const consumed = db.prepare('UPDATE source_enrollments SET consumed_at=? WHERE code_hash=? AND consumed_at IS NULL AND expires_at>?')
        .run(now(), digest(code), now());
      if (consumed.changes !== 1) fail(409, '开通码已使用');
      if (!existing) db.prepare('INSERT INTO devices(id,kind,token_hash,created_at,public_key) VALUES(?,?,?,?,?)')
        .run(deviceId, 'source', digest(deviceToken), now(), key);
      grant(deviceId, record.student_id, 'report.write', deviceId);
      if (Number(options.contractVersion) >= 2) {
        grantV2(deviceId, record.student_id, 'student_profile.write', { fields: checkedFields(options.profileFields), actorId: deviceId });
        for (const category of checkedCategories(options.materialCategories)) {
          grantV2(deviceId, record.student_id, 'material.write', { category, actorId: deviceId });
        }
        // V2 redemption establishes identity first; a bounded upload-scope confirmation enables writes.
        db.prepare(`UPDATE grants SET enabled=0 WHERE device_id=? AND student_id=? AND scope='report.write' AND revoked_at IS NULL`)
          .run(deviceId, record.student_id);
      }
      audit(deviceId, 'source.enrollment.redeem', record.student_id);
    });
    return { deviceId, deviceToken, cloudStudentId: record.student_id };
  }
  function autoEnrollSource(input = {}, existingToken = '') {
    const key = checkedKey(input.publicKey);
    const bindingKey = String(input.bindingKey || '').trim();
    const productDeviceId = String(input.deviceId || '').trim();
    const displayName = String(input.displayName || '').trim();
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(bindingKey)) fail(400, '本机学生绑定凭据无效');
    if (!productDeviceId || productDeviceId.length > 160) fail(400, '来源端设备码无效');
    if (!displayName || displayName.length > 120 || /[\\/\x00-\x1f]/.test(displayName)) fail(400, '学生显示名无效');
    const verified = verifyCloudSourceProductLicense(input.licenseToken, {
      trustedIssuers: trustedLicenseIssuers, deviceId: productDeviceId, now: now(),
    });
    if (!verified.ok) fail(403, verified.message || '来源端产品许可证无效');
    const selectedFields = checkedFields(input.profileFields);
    const selectedCategories = checkedCategories(input.materialCategories);
    const bindingHash = digest(`${verified.license.licenseId}\n${productDeviceId.toLowerCase()}\n${bindingKey}`);
    const prior = db.prepare(`SELECT binding_hash AS bindingHash,source_device_id AS sourceDeviceId,
      student_id AS studentId,revoked_at AS revokedAt FROM source_auto_bindings WHERE binding_hash=?`).get(bindingHash);
    const authenticated = existingToken ? requireDevice(existingToken, 'source') : null;
    if (authenticated && authenticated.public_key !== key) fail(403, '来源公钥与已绑定设备不一致');
    const deviceToken = authenticated ? existingToken : randomToken();
    const deviceId = authenticated?.id || prior?.sourceDeviceId || `src_${crypto.randomUUID().replaceAll('-', '')}`;
    const studentId = prior?.studentId || `cs_${crypto.randomUUID().replaceAll('-', '')}`;
    if (prior?.revokedAt) fail(403, '此本机学生云端绑定已撤销');
    if (!prior) {
      const active = Number(db.prepare('SELECT COUNT(*) AS count FROM source_auto_bindings WHERE license_id=? AND revoked_at IS NULL')
        .get(verified.license.licenseId)?.count || 0);
      if (active >= verified.license.maxActiveStudents) fail(403, '许可证允许的云端学生数量已满');
    }
    atomic(() => {
      if (!prior) db.prepare('INSERT INTO students(id,display_name,created_at) VALUES(?,?,?)').run(studentId, displayName, now());
      else db.prepare('UPDATE students SET display_name=? WHERE id=? AND archived_at IS NULL').run(displayName, studentId);
      if (!authenticated && !prior) {
        db.prepare('INSERT INTO devices(id,kind,token_hash,created_at,public_key) VALUES(?,?,?,?,?)')
          .run(deviceId, 'source', digest(deviceToken), now(), key);
      } else if (!authenticated) {
        db.prepare('UPDATE devices SET token_hash=?,public_key=?,revoked_at=NULL WHERE id=? AND kind=?')
          .run(digest(deviceToken), key, deviceId, 'source');
      }
      if (!prior) db.prepare(`INSERT INTO source_auto_bindings
        (binding_hash,license_id,product_device_id,source_device_id,student_id,created_at,updated_at,revoked_at)
        VALUES(?,?,?,?,?,?,?,NULL)`).run(bindingHash, verified.license.licenseId, productDeviceId, deviceId, studentId, now(), now());
      else db.prepare('UPDATE source_auto_bindings SET updated_at=? WHERE binding_hash=?').run(now(), bindingHash);
      if (!prior || verified.license.productId !== 'ANDROID_STANDALONE') {
        grant(deviceId, studentId, 'report.write', deviceId);
        if (verified.license.productId === 'ANDROID_STANDALONE') {
          // Product activation creates identity only. The separate, explicit scope request enables upload.
          db.prepare(`UPDATE grants SET enabled=0 WHERE device_id=? AND student_id=? AND scope='report.write' AND revoked_at IS NULL`)
            .run(deviceId, studentId);
        } else {
          grantV2(deviceId, studentId, 'student_profile.write', { fields: selectedFields, actorId: deviceId });
          for (const category of selectedCategories) grantV2(deviceId, studentId, 'material.write', { category, actorId: deviceId });
        }
      }
      audit(deviceId, prior ? 'source.auto-enrollment.reuse' : 'source.auto-enrollment.create', studentId, verified.license.licenseId);
    });
    return { deviceId, deviceToken, cloudStudentId: studentId, created: !prior,
      contractVersion: 2, profileFields: selectedFields, materialCategories: selectedCategories };
  }
  function createPairing(existingToken = '', publicKey = '') {
    const existing = existingToken ? requireDevice(existingToken, 'viewer') : null;
    let key;
    try { key = crypto.createPublicKey(publicKey); }
    catch { fail(400, '主机公钥无效'); }
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1' || String(publicKey).length > 1000) {
      fail(400, '主机公钥须为 P-256');
    }
    if (existing) {
      const registered = db.prepare('SELECT public_key FROM devices WHERE id=?').get(existing.id)?.public_key;
      if (registered !== publicKey) fail(403, '主机公钥与已绑定设备不一致');
    }
    const deviceToken = existing ? existingToken : randomToken();
    const deviceId = existing ? existing.id : `win_${crypto.randomUUID().replaceAll('-', '')}`;
    const code = String(crypto.randomInt(0, 100000000)).padStart(8, '0');
    const codeHash = digest(code);
    atomic(() => {
      if (!existing) db.prepare('INSERT INTO devices(id,kind,token_hash,created_at,public_key) VALUES(?,?,?,?,?)')
        .run(deviceId, 'viewer', digest(deviceToken), now(), publicKey);
      db.prepare('INSERT INTO pairings(code_hash,device_id,expires_at) VALUES(?,?,?)')
        .run(codeHash, deviceId, now() + CODE_LIFETIME_MS);
      audit(deviceId, 'viewer.pairing.request');
    });
    return { deviceId, deviceToken, pairingCode: code, expiresAt: now() + CODE_LIFETIME_MS };
  }
  function approvePairing(token, code, studentIds, options = {}) {
    const admin = isAdmin(token);
    const source = admin ? null : requireDevice(token, 'source');
    if (!/^\d{8}$/.test(String(code || ''))) fail(400, '配对码格式无效');
    const ids = [...new Set(Array.isArray(studentIds) ? studentIds : [])];
    if (ids.length < 1 || ids.length > 20 || ids.some(id => !validId(id))) fail(400, '请选择有效学生');
    for (const studentId of ids) {
      if (admin) { if (!studentExists(studentId)) fail(404, '学生不存在'); }
      else {
        requireGrant(source.id, studentId, 'report.write');
        const managed = db.prepare('SELECT 1 FROM source_auto_bindings WHERE source_device_id=? AND student_id=? AND revoked_at IS NULL').get(source.id, studentId);
        if (managed && Number(options.contractVersion) < 2) fail(400, '安卓来源必须按当前授权范围配对');
      }
    }
    const pairing = db.prepare('SELECT device_id,expires_at,consumed_at FROM pairings WHERE code_hash=?').get(digest(code));
    if (!pairing || pairing.consumed_at || pairing.expires_at <= now()) fail(404, '配对码无效或已过期');
    atomic(() => {
      const consumed = db.prepare('UPDATE pairings SET consumed_at=? WHERE code_hash=? AND consumed_at IS NULL AND expires_at>?')
        .run(now(), digest(code), now());
      if (consumed.changes !== 1) fail(409, '配对码已使用');
      for (const studentId of ids) {
        const requestedFields = Array.isArray(options.profileFields) ? options.profileFields : [];
        const fields = checkedFields(requestedFields, { requireDisplayName: requestedFields.length > 0 });
        const categories = checkedCategories(options.materialCategories);
        let boundedExpiry = now() + READ_GRANT_LIFETIME_MS;
        if (!admin && Number(options.contractVersion) >= 2) {
          const write = db.prepare("SELECT expires_at AS expiresAt FROM grants WHERE device_id=? AND student_id=? AND scope='report.write'").get(source.id, studentId);
          if (write?.expiresAt != null) boundedExpiry = Math.min(boundedExpiry, write.expiresAt);
          if (fields.length) {
            const allowed = requireV2Grant(source.id, studentId, 'student_profile.write');
            if (fields.some(field => !allowed.fields.includes(field))) fail(403, '基础信息范围超出来源授权');
            if (allowed.expires_at != null) boundedExpiry = Math.min(boundedExpiry, allowed.expires_at);
          }
          for (const category of categories) {
            const allowed = requireV2Grant(source.id, studentId, 'material.write', category);
            if (allowed.expires_at != null) boundedExpiry = Math.min(boundedExpiry, allowed.expires_at);
          }
        }
        grant(pairing.device_id, studentId, 'cloud_document.read', source?.id || 'admin_local');
        if (Number(options.contractVersion) >= 2) {
          db.prepare(`INSERT INTO scoped_viewer_bindings(device_id,student_id,source_device_id,created_at) VALUES(?,?,?,?)
            ON CONFLICT(device_id,student_id) DO UPDATE SET source_device_id=excluded.source_device_id,created_at=excluded.created_at`)
            .run(pairing.device_id, studentId, source?.id || null, now());
          if (fields.length) grantV2(pairing.device_id, studentId, 'student_profile.read', {
            fields, actorId: source?.id || 'admin_local',
          });
          for (const category of categories) {
            grantV2(pairing.device_id, studentId, 'material.read', { category, actorId: source?.id || 'admin_local' });
          }
          db.prepare("UPDATE grants SET expires_at=? WHERE device_id=? AND student_id=? AND scope='cloud_document.read'")
            .run(boundedExpiry, pairing.device_id, studentId);
          db.prepare("UPDATE v2_grants SET expires_at=? WHERE device_id=? AND student_id=? AND scope IN ('student_profile.read','material.read')")
            .run(boundedExpiry, pairing.device_id, studentId);
          const healthObjectScope = [...new Set((Array.isArray(options.healthObjectScope) ? options.healthObjectScope : []).map(String).filter(Boolean))];
          if (healthObjectScope.length) {
            if (!admin) {
              const writeGrant = requireV2Grant(source.id, studentId, 'health_record.write');
              if (healthObjectScope.some(objectId => !writeGrant.objectScope.includes(objectId))) fail(403, '健康资料读取范围超出来源端单独授权');
            }
            grantV2(pairing.device_id, studentId, 'health_record.read', { objectScope: healthObjectScope, actorId: source?.id || 'admin_local' });
          }
        }
      }
      audit(source?.id || 'admin_local', 'viewer.pairing.approve', null, pairing.device_id);
    });
    return { deviceId: pairing.device_id, studentIds: ids, expiresAt: now() + READ_GRANT_LIFETIME_MS };
  }
  function revoke(token, deviceId, studentId, scope) {
    if (!validId(deviceId) || !validId(studentId) || !['report.write', 'cloud_document.read'].includes(scope)) {
      fail(400, '撤销许可参数无效');
    }
    const source = deviceFor(token);
    if (!isAdmin(token) && !(source?.kind === 'source' && hasGrant(source.id, studentId, 'report.write') && scope === 'cloud_document.read')) {
      fail(403, '没有撤销权限');
    }
    return atomic(() => {
      const result = db.prepare('UPDATE grants SET revoked_at=? WHERE device_id=? AND student_id=? AND scope=? AND revoked_at IS NULL')
        .run(now(), deviceId, studentId, scope);
      if (result.changes === 1) audit(isAdmin(token) ? 'admin_local' : source.id, `grant.revoke.${scope}`, studentId, deviceId);
      return { revoked: result.changes === 1 };
    });
  }
  function issueV2Grant(token, input) {
    const studentId = String(input?.cloudStudentId || '');
    const deviceId = String(input?.deviceId || '');
    const scope = String(input?.scope || '');
    const source = deviceFor(token);
    const admin = isAdmin(token);
    if (!admin && !(source?.kind === 'source' && hasGrant(source.id, studentId, 'report.write') && scope.endsWith('.read'))) {
      fail(403, '没有签发该许可的权限');
    }
    if (scope.startsWith('health_record.') && (!Array.isArray(input.objectScope) || input.objectScope.length === 0)) {
      fail(400, '健康资料许可必须明确指定资料范围');
    }
    return atomic(() => grantV2(deviceId, studentId, scope, {
      category: String(input?.category || ''), fields: input?.fields, objectScope: input?.objectScope,
      actorId: admin ? 'admin_local' : source.id,
    }));
  }
  function revokeV2Grant(token, input) {
    const deviceId = String(input?.deviceId || '');
    const studentId = String(input?.cloudStudentId || '');
    const scope = String(input?.scope || '');
    const category = String(input?.category || '');
    const source = deviceFor(token);
    const admin = isAdmin(token);
    if (!V2_SCOPES.includes(scope) || !validId(deviceId) || !validId(studentId)) fail(400, '撤销许可参数无效');
    if (!admin && !(source?.kind === 'source' && hasGrant(source.id, studentId, 'report.write') && scope.endsWith('.read'))) {
      fail(403, '没有撤销权限');
    }
    return atomic(() => {
      const result = db.prepare(`UPDATE v2_grants SET revoked_at=?,policy_version=policy_version+1
        WHERE device_id=? AND student_id=? AND scope=? AND category=? AND revoked_at IS NULL`)
        .run(now(), deviceId, studentId, scope, category);
      if (result.changes) audit(admin ? 'admin_local' : source.id, `grant.v2.revoke.${scope}${category ? `.${category}` : ''}`, studentId, deviceId);
      return { revoked: result.changes === 1 };
    });
  }
  function listV2Grants(token, studentId) {
    if (!isAdmin(token)) fail(401, '管理员凭据无效');
    if (!studentExists(studentId)) fail(404, '学生不存在');
    return db.prepare(`SELECT device_id AS deviceId,scope,category,fields_json AS fieldsJson,purpose,
      object_scope_json AS objectScopeJson,created_at AS createdAt,expires_at AS expiresAt,
      revoked_at AS revokedAt,policy_version AS policyVersion FROM v2_grants
      WHERE student_id=? ORDER BY created_at DESC,device_id,scope,category`).all(studentId).map(row => ({
        ...row, fields: JSON.parse(row.fieldsJson), objectScope: JSON.parse(row.objectScopeJson),
        fieldsJson: undefined, objectScopeJson: undefined,
      }));
  }
  function listGrants(token, studentId) {
    if (!isAdmin(token)) fail(401, '管理员凭据无效');
    if (!studentExists(studentId)) fail(404, '学生不存在');
    return db.prepare(`SELECT g.device_id AS deviceId, d.kind, g.scope,
      g.created_at AS createdAt, g.revoked_at AS revokedAt, g.expires_at AS expiresAt, g.enabled
      FROM grants g JOIN devices d ON d.id=g.device_id
      WHERE g.student_id=? ORDER BY g.created_at DESC,g.device_id`).all(studentId);
  }
  function setOwnWrite(token, studentId, enabled) {
    const source = requireDevice(token, 'source');
    if (typeof enabled !== 'boolean') fail(400, '上传开关无效');
    const known = db.prepare('SELECT 1 FROM grants WHERE device_id=? AND student_id=? AND scope=? AND revoked_at IS NULL')
      .get(source.id, studentId, 'report.write');
    if (!known) fail(403, '该设备没有有效的学生上传许可');
    atomic(() => {
      const result = db.prepare('UPDATE grants SET enabled=? WHERE device_id=? AND student_id=? AND scope=? AND revoked_at IS NULL')
        .run(enabled ? 1 : 0, source.id, studentId, 'report.write');
      if (result.changes !== 1) fail(403, '该设备没有有效的学生上传许可');
      audit(source.id, enabled ? 'report.upload.enable' : 'report.upload.disable', studentId);
    });
    return { studentId, enabled };
  }
  function setOwnUploadScope(token, input) {
    const source = requireDevice(token, 'source');
    const studentId = String(input?.cloudStudentId || '');
    const knownWriteGrant = validId(studentId) && db.prepare(`SELECT 1 FROM grants
      WHERE device_id=? AND student_id=? AND scope='report.write' AND revoked_at IS NULL`).get(source.id, studentId);
    if (!knownWriteGrant) {
      fail(403, '该设备没有有效的学生上传许可');
    }
    const knownV2Grant = db.prepare(`SELECT 1 FROM v2_grants WHERE device_id=? AND student_id=?
      AND scope IN ('student_profile.write','material.write') AND revoked_at IS NULL LIMIT 1`).get(source.id, studentId);
    const knownAutoBinding = db.prepare(`SELECT 1 FROM source_auto_bindings WHERE source_device_id=? AND student_id=?
      AND revoked_at IS NULL LIMIT 1`).get(source.id, studentId);
    if (!knownV2Grant && !knownAutoBinding) {
      fail(403, '旧版上传许可不能直接扩大为新版资料授权，请重新开通');
    }
    const requestedProfileFields = Array.isArray(input?.profileFields) ? input.profileFields : [];
    const profileFields = checkedFields(requestedProfileFields, { requireDisplayName: requestedProfileFields.length > 0 });
    const materialCategories = checkedCategories(input?.materialCategories);
    const authorizationPurpose = String(input?.authorizationPurpose || 'document_sync');
    const authorizationExpiresAt = Number(input?.authorizationExpiresAt);
    if (!['document_sync', 'expert_interpretation'].includes(authorizationPurpose)) fail(400, '授权用途无效');
    if (!Number.isSafeInteger(authorizationExpiresAt) || authorizationExpiresAt <= now() + 5 * 60 * 1000 ||
        authorizationExpiresAt > now() + 365 * 24 * 60 * 60 * 1000) fail(400, '上传授权有效期无效');
    return atomic(() => {
      db.prepare(`UPDATE v2_grants SET revoked_at=?,policy_version=policy_version+1
        WHERE device_id=? AND student_id=? AND scope IN ('student_profile.write','material.write') AND revoked_at IS NULL`)
        .run(now(), source.id, studentId);
      if (profileFields.length) grantV2(source.id, studentId, 'student_profile.write', { fields: profileFields,
        purpose: authorizationPurpose, expiresAt: authorizationExpiresAt, actorId: source.id });
      for (const category of materialCategories) {
        grantV2(source.id, studentId, 'material.write', { category, purpose: authorizationPurpose,
          expiresAt: authorizationExpiresAt, actorId: source.id });
      }
      db.prepare(`UPDATE grants SET expires_at=?,enabled=1 WHERE device_id=? AND student_id=? AND scope='report.write' AND revoked_at IS NULL`)
        .run(authorizationExpiresAt, source.id, studentId);
      audit(source.id, 'source.upload-scope.replace', studentId, source.id);
      return { cloudStudentId: studentId, profileFields, materialCategories, authorizationPurpose, authorizationExpiresAt };
    });
  }
  function setOwnHealthScope(token, input) {
    const source = requireDevice(token, 'source');
    const studentId = String(input?.cloudStudentId || '');
    const objectScope = [...new Set((Array.isArray(input?.objectScope) ? input.objectScope : []).map(String)
      .filter(value => /^[A-Za-z0-9:_-]{8,160}$/.test(value)))].sort();
    if (!validId(studentId) || !hasGrant(source.id, studentId, 'report.write')) fail(403, '该设备没有有效的学生上传许可');
    if (objectScope.length > 200) fail(400, '健康资料范围过大');
    return atomic(() => {
      db.prepare(`UPDATE v2_grants SET revoked_at=?,policy_version=policy_version+1
        WHERE device_id=? AND student_id=? AND scope='health_record.write' AND revoked_at IS NULL`).run(now(), source.id, studentId);
      if (objectScope.length) grantV2(source.id, studentId, 'health_record.write', { objectScope, actorId: source.id });
      audit(source.id, 'source.health-scope.replace', studentId, source.id);
      return { cloudStudentId: studentId, enabled: objectScope.length > 0, objectScope };
    });
  }
  function studentRemovalPreview(token, studentId) {
    if (!isAdmin(token)) fail(401, '管理员凭据无效');
    const student = db.prepare('SELECT id,display_name AS displayName,archived_at AS archivedAt FROM students WHERE id=?').get(studentId);
    if (!student) fail(404, '学生不存在');
    const scalar = (sql, ...params) => Number(db.prepare(sql).get(...(params.length ? params : [studentId]))?.count || 0);
    return {
      ...student,
      reports: scalar('SELECT COUNT(*) AS count FROM reports WHERE student_id=?'),
      documents: scalar('SELECT COUNT(*) AS count FROM documents WHERE student_id=?'),
      activeGrants: scalar('SELECT COUNT(*) AS count FROM grants WHERE student_id=? AND revoked_at IS NULL'),
      activeV2Grants: scalar('SELECT COUNT(*) AS count FROM v2_grants WHERE student_id=? AND revoked_at IS NULL'),
      activeBindings: scalar('SELECT COUNT(*) AS count FROM device_student_bindings WHERE student_id=? AND revoked_at IS NULL'),
      activeRemoteSessions: scalar(`SELECT COUNT(*) AS count FROM remote_agent_sessions
        WHERE (student_id=? OR EXISTS (SELECT 1 FROM json_each(student_ids_json) WHERE value=?))
        AND revoked_at IS NULL AND status NOT IN ('committed','quarantined','revoked')`, studentId, studentId),
      pendingInbox: scalar(`SELECT COUNT(*) AS count FROM cloud_inbox_submissions
        WHERE (student_id=? OR EXISTS (SELECT 1 FROM json_each(student_ids_json) WHERE value=?))
        AND status NOT IN ('committed','quarantined')`, studentId, studentId),
      usedBytes: studentUsedBytes(studentId),
    };
  }
  function archiveStudent(token, studentId, reason = '') {
    if (!isAdmin(token)) fail(401, '管理员凭据无效');
    const student = db.prepare('SELECT id,archived_at AS archivedAt FROM students WHERE id=?').get(studentId);
    if (!student) fail(404, '学生不存在');
    if (student.archivedAt) return { archived: true, duplicate: true, archivedAt: student.archivedAt };
    const archivedAt = now();
    atomic(() => {
      db.prepare('UPDATE students SET archived_at=?,archived_reason=? WHERE id=?').run(archivedAt, String(reason || '').slice(0, 500), studentId);
      db.prepare('UPDATE grants SET revoked_at=? WHERE student_id=? AND revoked_at IS NULL').run(archivedAt, studentId);
      db.prepare('UPDATE v2_grants SET revoked_at=?,policy_version=policy_version+1 WHERE student_id=? AND revoked_at IS NULL').run(archivedAt, studentId);
      db.prepare('UPDATE device_student_bindings SET revoked_at=?,updated_at=? WHERE student_id=? AND revoked_at IS NULL').run(archivedAt, archivedAt, studentId);
      db.prepare('UPDATE source_enrollments SET consumed_at=? WHERE student_id=? AND consumed_at IS NULL').run(archivedAt, studentId);
      db.prepare(`UPDATE remote_agent_sessions SET revoked_at=?,status='revoked',updated_at=?
        WHERE (student_id=? OR EXISTS (SELECT 1 FROM json_each(student_ids_json) WHERE value=?)) AND revoked_at IS NULL`)
        .run(archivedAt, archivedAt, studentId, studentId);
      db.prepare(`UPDATE cloud_inbox_submissions SET status='quarantined',updated_at=?,consumed_at=?,
        quarantined_reason='云端学生已停用',lease_id=NULL,lease_owner_device_id=NULL,lease_expires_at=NULL
        WHERE (student_id=? OR EXISTS (SELECT 1 FROM json_each(student_ids_json) WHERE value=?))
        AND status NOT IN ('committed','quarantined')`).run(archivedAt, archivedAt, studentId, studentId);
      audit('admin_local', 'student.archive', studentId);
    });
    return { archived: true, duplicate: false, archivedAt };
  }
  function restoreStudent(token, studentId) {
    if (!isAdmin(token)) fail(401, '管理员凭据无效');
    const student = db.prepare('SELECT id,archived_at AS archivedAt FROM students WHERE id=?').get(studentId);
    if (!student) fail(404, '学生不存在');
    if (!student.archivedAt) return { restored: true, duplicate: true };
    atomic(() => {
      db.prepare("UPDATE students SET archived_at=NULL,archived_reason='' WHERE id=?").run(studentId);
      audit('admin_local', 'student.restore', studentId);
    });
    return { restored: true, duplicate: false, grantsRestored: false };
  }
  function relinquishViewerStudent(token, studentId) {
    const viewer = requireDevice(token, 'viewer');
    const student = db.prepare('SELECT id FROM students WHERE id=?').get(studentId);
    if (!student) fail(404, '学生不存在');
    const changedAt = now();
    return atomic(() => {
      const legacy = db.prepare("UPDATE grants SET revoked_at=? WHERE device_id=? AND student_id=? AND scope='cloud_document.read' AND revoked_at IS NULL")
        .run(changedAt, viewer.id, studentId).changes;
      const modern = db.prepare("UPDATE v2_grants SET revoked_at=?,policy_version=policy_version+1 WHERE device_id=? AND student_id=? AND scope LIKE '%.read' AND revoked_at IS NULL")
        .run(changedAt, viewer.id, studentId).changes;
      db.prepare('UPDATE device_student_bindings SET revoked_at=?,updated_at=? WHERE device_id=? AND student_id=? AND revoked_at IS NULL')
        .run(changedAt, changedAt, viewer.id, studentId);
      audit(viewer.id, 'viewer.student.relinquish', studentId, viewer.id);
      return { removed: true, duplicate: legacy + modern === 0 };
    });
  }
  function listStudents(token, { includeArchived = false } = {}) {
    if (isAdmin(token)) return db.prepare(`SELECT id, display_name AS displayName, archived_at AS archivedAt
      FROM students WHERE (?=1 OR archived_at IS NULL) ORDER BY archived_at IS NOT NULL,display_name`).all(includeArchived ? 1 : 0);
    const device = requireDevice(token);
    const legacy = db.prepare(`SELECT s.id, s.display_name AS displayName, g.scope, g.expires_at AS expiresAt
      FROM students s JOIN grants g ON g.student_id=s.id
      WHERE g.device_id=? AND s.archived_at IS NULL AND g.revoked_at IS NULL AND (g.scope!='cloud_document.read' OR (g.expires_at IS NOT NULL AND g.expires_at>?)) ORDER BY s.display_name`)
      .all(device.id, now());
    const profiles = new Map(db.prepare(`SELECT g.student_id AS studentId,g.fields_json AS fieldsJson,g.expires_at AS expiresAt,
      c.revision_id AS profileRevisionId FROM v2_grants g LEFT JOIN student_profile_current c ON c.student_id=g.student_id
       JOIN students s ON s.id=g.student_id WHERE g.device_id=? AND s.archived_at IS NULL AND g.scope='student_profile.read' AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>?)`)
      .all(device.id, now()).map(row => [row.studentId, row]));
    return legacy.flatMap(row => {
      const binding = device.kind === 'viewer' ? db.prepare('SELECT source_device_id AS sourceId FROM scoped_viewer_bindings WHERE device_id=? AND student_id=?').get(device.id, row.id) : null;
      if (binding?.sourceId && !hasGrant(binding.sourceId, row.id, 'report.write')) return [];
      const profile = profiles.get(row.id);
      let allowedProfile = profile;
      if (binding && profile) { try { requireV2Grant(device.id, row.id, 'student_profile.read'); } catch { allowedProfile = null; } }
      const visible = binding && !allowedProfile ? { ...row, displayName: '已授权学生' } : row;
      return [allowedProfile ? { ...visible, profileRevisionId: allowedProfile.profileRevisionId || '', profileFields: JSON.parse(allowedProfile.fieldsJson || '[]') } : visible];
    });
  }
  function uploadStudentProfile(token, studentId, input) {
    const source = requireDevice(token, 'source');
    requireGrant(source.id, studentId, 'report.write');
    const grant = requireV2Grant(source.id, studentId, 'student_profile.write');
    const requested = checkedFields(input?.fields?.length ? input.fields : Object.keys(input?.profile || {}));
    if (requested.some(field => !grant.fields.includes(field))) fail(403, '学生基础信息字段超出授权范围');
    const profile = normalizeProfile(input?.profile, requested);
    const fields = PROFILE_FIELDS.filter(field => Object.hasOwn(profile, field));
    const revisionId = profileRevisionId(studentId, profile, fields);
    const contentHash = sha256(stableJson({ profile, fields }));
    const existing = db.prepare('SELECT revision_id FROM student_profile_revisions WHERE revision_id=?').get(revisionId);
    if (!existing) {
      atomic(() => {
        db.prepare(`INSERT INTO student_profile_revisions
          (revision_id,student_id,source_device_id,profile_json,fields_json,content_sha256,created_at)
          VALUES(?,?,?,?,?,?,?)`).run(revisionId, studentId, source.id, JSON.stringify(profile), JSON.stringify(fields), contentHash, now());
        db.prepare(`INSERT INTO student_profile_current(student_id,revision_id,updated_at) VALUES(?,?,?)
          ON CONFLICT(student_id) DO UPDATE SET revision_id=excluded.revision_id,updated_at=excluded.updated_at`)
          .run(studentId, revisionId, now());
        db.prepare('UPDATE students SET display_name=? WHERE id=?').run(profile.displayName, studentId);
        appendSyncEvent(studentId, 'profile.published', 'student_profile', studentId, revisionId);
        audit(source.id, 'student_profile.upload', studentId, revisionId);
      });
    }
    return { cloudStudentId: studentId, profileRevisionId: revisionId, contentSha256: contentHash, duplicate: Boolean(existing), fields };
  }
  function getStudentProfile(token, studentId) {
    const admin = isAdmin(token);
    const viewer = admin ? null : requireDevice(token, 'viewer');
    const grant = admin ? { fields: PROFILE_FIELDS } : requireV2Grant(viewer.id, studentId, 'student_profile.read');
    const row = db.prepare(`SELECT r.*,c.updated_at FROM student_profile_current c JOIN student_profile_revisions r
      ON r.revision_id=c.revision_id WHERE c.student_id=?`).get(studentId);
    if (!row) fail(404, '学生基础信息尚未同步');
    const stored = JSON.parse(row.profile_json);
    const profile = Object.fromEntries(grant.fields.filter(field => Object.hasOwn(stored, field)).map(field => [field, stored[field]]));
    audit(admin ? 'admin_local' : viewer.id, 'student_profile.read', studentId, row.revision_id);
    return { contractVersion: 2, cloudStudentId: studentId, profileRevisionId: row.revision_id,
      profile, fields: Object.keys(profile), updatedAt: row.updated_at, sourceDeviceId: row.source_device_id };
  }
  function getStudentProfileStatus(token, studentId) {
    if (!isAdmin(token)) fail(401, '管理员凭据无效');
    if (!studentExists(studentId)) fail(404, '学生不存在');
    const exists = db.prepare('SELECT 1 FROM student_profile_current WHERE student_id=?').get(studentId);
    return { profile: exists ? getStudentProfile(token, studentId) : null };
  }
  function recordBinding(token, studentId, input) {
    const viewer = requireDevice(token, 'viewer');
    const profile = getStudentProfile(token, studentId);
    const localStudentId = String(input?.localStudentId || '').trim();
    if (!/^[^\x00-\x1f]{1,160}$/.test(localStudentId)) fail(400, '本机学生标识无效');
    if (input?.profileRevisionId !== profile.profileRevisionId) fail(409, '学生基础信息版本已变化，请重新建档');
    const existing = db.prepare('SELECT * FROM device_student_bindings WHERE device_id=? AND student_id=?').get(viewer.id, studentId);
    if (existing && existing.local_student_id !== localStudentId && !existing.revoked_at) fail(409, '该云端学生已绑定另一份本机档案');
    const bindingId = existing?.binding_id || `binding_${crypto.randomUUID().replaceAll('-', '')}`;
    atomic(() => {
      db.prepare(`INSERT INTO device_student_bindings(binding_id,device_id,student_id,local_student_id,profile_revision_id,created_at,updated_at,revoked_at)
        VALUES(?,?,?,?,?,?,?,NULL) ON CONFLICT(device_id,student_id) DO UPDATE SET local_student_id=excluded.local_student_id,
        profile_revision_id=excluded.profile_revision_id,updated_at=excluded.updated_at,revoked_at=NULL`)
        .run(bindingId, viewer.id, studentId, localStudentId, profile.profileRevisionId, existing?.created_at || now(), now());
      audit(viewer.id, existing ? 'student.binding.refresh' : 'student.binding.create', studentId, bindingId);
    });
    return { bindingId, cloudStudentId: studentId, localStudentId, profileRevisionId: profile.profileRevisionId };
  }
  function recordTransferReceipt(token, input) {
    const device = requireDevice(token, 'viewer');
    const studentId = String(input?.cloudStudentId || '');
    if (!studentExists(studentId)) fail(404, '学生不存在');
    const idempotencyKey = String(input?.idempotencyKey || '');
    if (!/^[A-Za-z0-9:_-]{8,200}$/.test(idempotencyKey)) fail(400, '回执幂等键无效');
    if (!['downloaded', 'imported', 'failed', 'quarantined'].includes(input?.status)) fail(400, '回执状态无效');
    const existing = db.prepare('SELECT * FROM transfer_receipts WHERE device_id=? AND idempotency_key=?').get(device.id, idempotencyKey);
    const stable = stableJson({ studentId, objectType: input.objectType, objectId: input.objectId,
      revisionId: input.revisionId || '', action: input.action, status: input.status });
    if (existing && existing.detail_json !== stable) fail(409, '同一回执编号对应不同操作');
    if (!existing) {
      const receiptId = `receipt_${crypto.randomUUID().replaceAll('-', '')}`;
      atomic(() => {
        db.prepare(`INSERT INTO transfer_receipts(receipt_id,device_id,student_id,object_type,object_id,revision_id,action,idempotency_key,status,detail_json,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(receiptId, device.id, studentId, String(input.objectType || ''), String(input.objectId || ''),
          String(input.revisionId || ''), String(input.action || ''), idempotencyKey, input.status, stable, now(), now());
        audit(device.id, `transfer.${input.status}`, studentId, receiptId);
      });
      return { receiptId, duplicate: false, status: input.status };
    }
    return { receiptId: existing.receipt_id, duplicate: true, status: existing.status };
  }
  function listSyncEvents(token, studentId, cursor = '') {
    const viewer = requireDevice(token, 'viewer');
    const scoped = db.prepare('SELECT source_device_id AS sourceId FROM scoped_viewer_bindings WHERE device_id=? AND student_id=?').get(viewer.id, studentId);
    if (scoped) {
      requireGrant(viewer.id, studentId, 'cloud_document.read');
      if (scoped.sourceId && !hasGrant(scoped.sourceId, studentId, 'report.write')) fail(403, '来源设备的授权已停止或到期');
    } else requireV2Grant(viewer.id, studentId, 'student_profile.read');
    if (cursor && (!/^\d+$/.test(cursor) || !Number.isSafeInteger(Number(cursor)))) fail(400, '变化游标无效');
    const rows = db.prepare(`SELECT sequence,event_type AS eventType,object_type AS objectType,object_id AS objectId,
      revision_id AS revisionId,occurred_at AS occurredAt,tombstone FROM sync_events
      WHERE student_id=? AND sequence>? ORDER BY sequence LIMIT 201`).all(studentId, Number(cursor || 0));
    const page = rows.slice(0, 200);
    const events = scoped ? page.filter(event => {
      try {
        if (event.objectType === 'student_profile') requireV2Grant(viewer.id, studentId, 'student_profile.read');
        else if (MATERIAL_CATEGORIES.includes(event.objectType)) requireV2Grant(viewer.id, studentId, 'material.read', event.objectType);
        else return false;
        return true;
      } catch { return false; }
    }) : page;
    return { events, nextCursor: page.length ? String(page.at(-1).sequence) : cursor };
  }
  function checkSourceReports(token, input) {
    const source = requireDevice(token, 'source'), studentId = input?.cloudStudentId;
    requireGrant(source.id, studentId, 'report.write');
    if (!Array.isArray(input.reports) || input.reports.length > 4 || input.reports.some(item => !REPORT_TYPES.has(item.reportType) || !/^[a-f0-9]{64}$/.test(item.contentSha256 || ''))) fail(400, '报告回执核对合同无效');
    const receipts = input.reports.map(item => {
      const row = db.prepare('SELECT id FROM reports WHERE student_id=? AND origin_device_id=? AND report_type=? AND content_sha256=?').get(studentId, source.id, item.reportType, item.contentSha256);
      const withdrawn = row && db.prepare('SELECT 1 FROM report_tombstones WHERE revision_id=?').get(row.id);
      return { ...item, revisionId: row?.id || '', status: !row ? 'missing' : withdrawn ? 'withdrawn' : 'active' };
    });
    return { cloudStudentId: studentId, receipts, checkedAt: now() };
  }
  function uploadReport(token, input) {
    const source = requireDevice(token, 'source');
    const studentId = input?.cloudStudentId;
    requireGrant(source.id, studentId, 'report.write');
    requireScopedSourceMaterial(source.id, studentId, 'learning_report');
    const preference = db.prepare('SELECT enabled FROM grants WHERE device_id=? AND student_id=? AND scope=?')
      .get(source.id, studentId, 'report.write');
    if (!preference?.enabled) fail(403, '该学生已关闭自动上传');
    if (!REPORT_TYPES.has(input.reportType)) fail(400, '报告类型无效');
    if (!['android', 'windows'].includes(input.originPlatform)) fail(400, '报告来源端无效');
    if (!['active', 'published', 'current', 'updated'].includes(input.sourceStatus)) fail(400, '仅接受正式报告');
    if (typeof input.content !== 'string' || !input.content.trim()) fail(400, '报告正文为空');
    const content = Buffer.from(input.content, 'utf8');
    if (content.length > MAX_REPORT_BYTES) fail(413, '报告超过 2MB');
    if (typeof input.publishedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(input.publishedAt)) fail(400, '报告发布时间无效');
    const header = input.content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n/);
    if (!header) fail(400, '报告缺少元数据');
    const statusMatch = header[1].match(/^status:\s*(\S+)/im);
    if (!statusMatch || statusMatch[1].toLowerCase() !== input.sourceStatus) fail(400, '报告状态不一致');
    const typeMatch = header[1].match(/^type:\s*(\S+)/im);
    if (!typeMatch || typeMatch[1] !== input.reportType) fail(400, '报告类型与元数据不一致');
    const studentMatch = header[1].match(/^student_id:\s*(\S+)/im);
    if (studentMatch && (!input.localStudentId || studentMatch[1] !== input.localStudentId)) fail(400, '报告学生归属不一致');
    const updatedMatch = header[1].match(/^updated:\s*(\d{4}-\d{2}-\d{2})/im);
    if (!updatedMatch || updatedMatch[1] !== input.publishedAt.slice(0, 10)) fail(400, '报告更新时间不一致');
    const substantiveLines = input.content.slice(header[0].length).split(/\r?\n/)
      .map(line => line.trim()).filter(line => line && !line.startsWith('#'))
      .filter(line => !line.startsWith('> 本报告是成长模型的呈现输出'))
      .filter(line => !/^- (?:成长模型|能力画像|成长证据|项目贡献)：/u.test(line))
      .filter(line => !/^[-*]?\s*待(?:生成|补充)[。.]?$/u.test(line));
    if (!substantiveLines.some(line => line.replace(/^[-*]\s*/u, '').length >= 4)) fail(400, '报告正文仍是占位内容');
    if (/(?:[A-Za-z]:\\|file:\/\/|(?:^|\s)\/(?:Users|home)\/)/m.test(input.content)) fail(400, '报告包含本机绝对路径');
    const sha = digest(content);
    if (!safeEqual(sha, input.contentSha256)) fail(400, 'SHA-256 不匹配');
    const sourceSha = input.sourceSha256 || sha;
    if (!/^[a-f0-9]{64}$/.test(sourceSha)) fail(400, '原件 SHA-256 无效');
    const existing = db.prepare(`SELECT id FROM reports WHERE student_id=? AND origin_device_id=? AND report_type=? AND content_sha256=?`)
      .get(studentId, source.id, input.reportType, sha);
    if (existing) {
      if (db.prepare('SELECT 1 FROM report_tombstones WHERE revision_id=?').get(existing.id)) fail(410, '该报告修订已撤回，不可重新发布');
      return { revisionId: existing.id, duplicate: true };
    }
    requireStudentCapacity(studentId, content.length);
    const revisionId = `rev_${digest(`${studentId}|${source.id}|${input.reportType}|${sha}`).slice(0, 48)}`;
    const objectName = `${sha}.md`;
    const objectPath = path.join(objectDir, objectName);
    if (!fs.existsSync(objectPath)) {
      const tempPath = path.join(objectDir, `${objectName}.${crypto.randomUUID()}.tmp`);
      try {
        fs.writeFileSync(tempPath, content, { flag: 'wx' });
        fs.renameSync(tempPath, objectPath);
      } finally {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      }
    }
    const filename = String(input.filename || `${input.reportType}.md`).replace(/[\\/\x00-\x1f]/g, '').slice(0, 120);
    atomic(() => {
      const result = db.prepare(`INSERT OR IGNORE INTO reports
        (id,student_id,origin_device_id,origin_platform,report_type,source_sha256,content_sha256,source_status,published_at,received_at,byte_size,filename,object_name)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(revisionId, studentId, source.id, input.originPlatform, input.reportType, sourceSha, sha, input.sourceStatus,
          input.publishedAt, now(), content.length, filename, objectName);
      if (result.changes === 1) audit(source.id, 'report.upload', studentId, revisionId);
    });
    return { revisionId, duplicate: false };
  }
  function listReports(token, studentId, cursor = '') {
    const admin = isAdmin(token);
    const viewer = admin ? null : requireDevice(token, 'viewer');
    if (!admin) requireGrant(viewer.id, studentId, 'cloud_document.read');
    if (!admin) requireScopedViewerMaterial(viewer.id, studentId, 'learning_report');
    const match = String(cursor || '').match(/^(\d+):(rev_[a-f0-9]{48})$/);
    if (cursor && !match) fail(400, '同步游标无效');
    const afterTime = match ? Number(match[1]) : 0;
    const afterId = match ? match[2] : '';
    if (!Number.isSafeInteger(afterTime) || afterTime < 0) fail(400, '同步游标无效');
    const rows = db.prepare(`SELECT id AS revisionId, report_type AS reportType,
      origin_device_id AS originDeviceId, origin_platform AS originPlatform, source_status AS sourceStatus,
      published_at AS publishedAt, received_at AS receivedAt,
      content_sha256 AS contentSha256, byte_size AS byteSize, filename
      FROM reports WHERE student_id=? AND id NOT IN (SELECT revision_id FROM report_tombstones) AND (?='' OR origin_device_id<>?)
      AND (received_at>? OR (received_at=? AND id>?))
      ORDER BY received_at,id LIMIT 201`).all(studentId, viewer?.id || '', viewer?.id || '', afterTime, afterTime, afterId);
    const page = rows.slice(0, 200);
    const last = page.at(-1);
    return { reports: page, nextCursor: rows.length > 200 ? `${last.receivedAt}:${last.revisionId}` : '' };
  }
  function getReport(token, revisionId) {
    const admin = isAdmin(token);
    const viewer = admin ? null : requireDevice(token, 'viewer');
    const row = db.prepare('SELECT * FROM reports WHERE id=?').get(revisionId);
    if (!row) fail(404, '报告不存在');
    if (!admin) {
      requireGrant(viewer.id, row.student_id, 'cloud_document.read');
      requireScopedViewerMaterial(viewer.id, row.student_id, 'learning_report');
    }
    if (db.prepare('SELECT 1 FROM report_tombstones WHERE revision_id=?').get(revisionId)) fail(410, '该报告修订已撤回');
    if (!admin && row.origin_device_id === viewer.id) fail(403, '本机报告无需下载');
    const content = fs.readFileSync(path.join(objectDir, row.object_name));
    if (!safeEqual(digest(content), row.content_sha256)) fail(500, '报告对象校验失败');
    audit(admin ? 'admin_local' : viewer.id, 'report.download', row.student_id, revisionId);
    return { content, contentSha256: row.content_sha256, filename: row.filename,
      cloudStudentId: row.student_id, reportType: row.report_type, originDeviceId: row.origin_device_id };
  }
  function deleteReport(token, revisionId) {
    if (!isAdmin(token)) fail(401, '管理员凭据无效');
    const row = db.prepare('SELECT student_id FROM reports WHERE id=?').get(revisionId);
    if (!row) fail(404, '报告不存在');
    atomic(() => {
      const result = db.prepare('INSERT OR IGNORE INTO report_tombstones VALUES(?,?,?,?)').run(revisionId, row.student_id, now(), 'admin_local');
      if (result.changes) audit('admin_local', 'report.withdraw', row.student_id, revisionId);
    });
    return { revisionId, deleted: true };
  }
  function uploadDocument(token, studentId, displayName, contentType, content) {
    const admin = isAdmin(token);
    const source = admin ? { id: 'admin_local' } : requireDevice(token, 'source');
    if (admin) { if (!studentExists(studentId)) fail(404, '学生不存在'); }
    else { requireGrant(source.id, studentId, 'report.write'); requireScopedSourceMaterial(source.id, studentId, 'learning_material'); }
    const name = String(displayName || '').trim();
    if (!name || name.length > 120 || /[\\/\x00-\x1f]/.test(name)) fail(400, '文件名无效');
    const suffix = DOCUMENT_TYPES.get(contentType);
    if (!suffix || !name.toLowerCase().endsWith(suffix)) fail(400, '仅支持 Markdown、PDF、DOCX');
    if (!Buffer.isBuffer(content) || !content.length || content.length > MAX_DOCUMENT_BYTES) fail(413, '文件大小无效');
    if (suffix === '.pdf' && !content.subarray(0, 5).equals(Buffer.from('%PDF-'))) fail(400, 'PDF 内容与类型不符');
    if (suffix === '.docx' && !content.subarray(0, 2).equals(Buffer.from('PK'))) fail(400, 'DOCX 内容与类型不符');
    requireStudentCapacity(studentId, content.length);
    const sha = digest(content);
    const objectName = `${sha}${suffix}`;
    const objectPath = path.join(objectDir, objectName);
    if (!fs.existsSync(objectPath)) {
      const tempPath = path.join(objectDir, `${objectName}.${crypto.randomUUID()}.tmp`);
      try {
        fs.writeFileSync(tempPath, content, { flag: 'wx' });
        fs.renameSync(tempPath, objectPath);
      } finally {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      }
    }
    const documentId = `doc_${crypto.randomUUID().replaceAll('-', '')}`;
    atomic(() => {
      db.prepare(`INSERT INTO documents(id,student_id,origin_device_id,display_name,content_type,content_sha256,byte_size,object_name,created_at)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(documentId, studentId, source.id, name, contentType, sha, content.length, objectName, now());
      audit(admin ? 'admin_local' : source.id, 'document.upload', studentId, documentId);
    });
    return { documentId, contentSha256: sha, byteSize: content.length };
  }
  function prepareDocument(token, studentId, displayName, contentType) {
    const admin = isAdmin(token);
    const source = admin ? { id: 'admin_local' } : requireDevice(token, 'source');
    if (admin) { if (!studentExists(studentId)) fail(404, '学生不存在'); }
    else { requireGrant(source.id, studentId, 'report.write'); requireScopedSourceMaterial(source.id, studentId, 'learning_material'); }
    const name = String(displayName || '').trim();
    const suffix = DOCUMENT_TYPES.get(contentType);
    if (!name || name.length > 120 || /[\\/\x00-\x1f]/.test(name) || !suffix || !name.toLowerCase().endsWith(suffix)) fail(400, '文档名称或类型无效');
    requireStudentCapacity(studentId, 1);
    const tempPath = path.join(objectDir, `upload-${crypto.randomUUID()}.tmp`);
    return { tempPath, commit({ sha, size, head }) {
      // Recheck authorization and quota after the async transfer, before publishing the index.
      if (admin ? !isAdmin(token) : !deviceFor(token)) fail(401, '上传凭据已失效');
      if (!admin) { requireGrant(source.id, studentId, 'report.write'); requireScopedSourceMaterial(source.id, studentId, 'learning_material'); }
      if (size < 1 || size > MAX_DOCUMENT_BYTES || !/^[a-f0-9]{64}$/.test(sha)) fail(413, '文件大小无效');
      if (suffix === '.pdf' && !head.subarray(0, 5).equals(Buffer.from('%PDF-'))) fail(400, 'PDF 内容与类型不符');
      if (suffix === '.docx' && !head.subarray(0, 2).equals(Buffer.from('PK'))) fail(400, 'DOCX 内容与类型不符');
      const documentId = `doc_${crypto.randomUUID().replaceAll('-', '')}`;
      const objectName = `${sha}${suffix}`;
      let duplicate;
      atomic(() => {
        const existing = db.prepare(`SELECT id,deleted_at FROM documents WHERE student_id=? AND origin_device_id=?
          AND display_name=? AND content_sha256=? AND content_type=? ORDER BY created_at DESC,id DESC LIMIT 1`)
          .get(studentId, source.id, name, sha, contentType);
        if (existing) {
          duplicate = { documentId: existing.id, contentSha256: sha, byteSize: size, duplicate: true, withdrawn: existing.deleted_at != null };
          return; // Never recreate a withdrawn document on replay.
        }
        requireStudentCapacity(studentId, size);
        const target = path.join(objectDir, objectName);
        if (!fs.existsSync(target)) fs.renameSync(tempPath, target);
        db.prepare(`INSERT INTO documents(id,student_id,origin_device_id,display_name,content_type,content_sha256,byte_size,object_name,created_at)
          VALUES(?,?,?,?,?,?,?,?,?)`).run(documentId, studentId, source.id, name, contentType, sha, size, objectName, now());
        audit(source.id, 'document.upload', studentId, documentId);
      });
      return duplicate || { documentId, contentSha256: sha, byteSize: size };
    } };
  }
  function prepareV2Material(token, studentId, metadata) {
    const source = requireDevice(token, 'source');
    const category = String(metadata?.category || '');
    requireGrant(source.id, studentId, 'report.write');
    requireV2Grant(source.id, studentId, 'material.write', category);
    const materialId = String(metadata?.materialId || '');
    const idempotencyKey = String(metadata?.idempotencyKey || '');
    const displayName = String(metadata?.displayName || '').trim();
    const contentType = String(metadata?.contentType || '').split(';')[0];
    const projectId = String(metadata?.projectId || '').trim();
    const scopeFingerprint = String(metadata?.scopeFingerprint || '').trim();
    const suffix = contentType === 'text/plain' && category === 'learning_material' ? '.txt' : DOCUMENT_TYPES.get(contentType);
    if (!/^[A-Za-z0-9:_-]{8,160}$/.test(materialId) || !/^[A-Za-z0-9:_-]{8,200}$/.test(idempotencyKey)) fail(400, '资料标识或幂等键无效');
    if (!displayName || displayName.length > 120 || /[\\/\x00-\x1f]/.test(displayName) || !suffix || !displayName.toLowerCase().endsWith(suffix)) {
      fail(400, '资料名称或类型无效');
    }
    if (projectId && (!/^[A-Za-z0-9:_-]{3,160}$/.test(projectId) || !/^[a-f0-9]{64}$/.test(scopeFingerprint))) {
      fail(400, '项目资料范围无效');
    }
    const tempPath = path.join(objectDir, `material-${crypto.randomUUID()}.tmp`);
    return { tempPath, commit({ sha, size, head }) {
      if (!deviceFor(token)) fail(401, '上传凭据已失效');
      requireGrant(source.id, studentId, 'report.write');
      requireV2Grant(source.id, studentId, 'material.write', category);
      if (size < 1 || size > MAX_DOCUMENT_BYTES || !/^[a-f0-9]{64}$/.test(sha)) fail(413, '资料大小无效');
      if (suffix === '.pdf' && !head.subarray(0, 5).equals(Buffer.from('%PDF-'))) fail(400, 'PDF 内容与类型不符');
      if (suffix === '.docx' && !head.subarray(0, 2).equals(Buffer.from('PK'))) fail(400, 'DOCX 内容与类型不符');
      const revisionId = `material_rev_${digest(`${studentId}|${category}|${materialId}|${projectId}|${scopeFingerprint}|${sha}`).slice(0, 48)}`;
      const documentId = `doc_${crypto.randomUUID().replaceAll('-', '')}`;
      const objectName = `${sha}${suffix}`;
      let duplicate;
      atomic(() => {
        const existing = db.prepare(`SELECT id AS documentId,revision_id AS revisionId,content_sha256 AS contentSha256,byte_size AS byteSize,
          project_id AS projectId,scope_fingerprint AS scopeFingerprint
          FROM documents WHERE student_id=? AND origin_device_id=? AND idempotency_key=?`).get(studentId, source.id, idempotencyKey);
        if (existing) {
          if (existing.contentSha256 !== sha || Number(existing.byteSize) !== Number(size) || existing.projectId !== projectId ||
              existing.scopeFingerprint !== scopeFingerprint) fail(409, '同一资料提交编号对应不同内容或项目范围');
          duplicate = { ...existing, duplicate: true }; return;
        }
        requireStudentCapacity(studentId, size);
        const target = path.join(objectDir, objectName);
        if (!fs.existsSync(target)) fs.renameSync(tempPath, target);
        db.prepare(`INSERT INTO documents(id,student_id,origin_device_id,display_name,content_type,content_sha256,byte_size,object_name,created_at,
          material_category,material_id,revision_id,idempotency_key,project_id,scope_fingerprint) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(documentId, studentId, source.id, displayName, contentType, sha, size, objectName, now(), category, materialId, revisionId, idempotencyKey,
            projectId, scopeFingerprint);
        const previous = db.prepare(`SELECT revision_id FROM material_current WHERE student_id=? AND material_category=?
          AND material_id=? AND project_id=? AND scope_fingerprint=?`).get(studentId, category, materialId, projectId, scopeFingerprint);
        if (previous && previous.revision_id !== revisionId) {
          db.prepare("UPDATE material_index_jobs SET status='superseded',updated_at=? WHERE revision_id=? AND status IN ('pending','processing','retry','ready')")
            .run(now(), previous.revision_id);
          db.prepare('DELETE FROM material_search_fts WHERE revision_id=?').run(previous.revision_id);
          db.prepare('DELETE FROM material_search_documents WHERE revision_id=?').run(previous.revision_id);
        }
        db.prepare(`INSERT INTO material_current(student_id,material_category,material_id,project_id,scope_fingerprint,revision_id,updated_at)
          VALUES(?,?,?,?,?,?,?) ON CONFLICT(student_id,material_category,material_id,project_id,scope_fingerprint)
          DO UPDATE SET revision_id=excluded.revision_id,updated_at=excluded.updated_at`)
          .run(studentId, category, materialId, projectId, scopeFingerprint, revisionId, now());
        db.prepare(`INSERT INTO material_index_jobs(revision_id,status,attempts,available_at,updated_at)
          VALUES(?,'pending',0,?,?) ON CONFLICT(revision_id) DO UPDATE SET
          status=CASE WHEN material_index_jobs.status='ready' THEN 'ready' ELSE 'pending' END,
          available_at=excluded.available_at,updated_at=excluded.updated_at,error_code='',error_message=''`)
          .run(revisionId, now(), now());
        appendSyncEvent(studentId, 'material.published', category, materialId, revisionId);
        audit(source.id, `material.upload.${category}`, studentId, revisionId);
      });
      return duplicate || { documentId, revisionId, materialId, category, projectId, scopeFingerprint,
        contentSha256: sha, byteSize: size, duplicate: false };
    } };
  }
  function prepareHealthRecord(token, studentId, metadata) {
    const source = requireDevice(token, 'source');
    const grantRow = requireV2Grant(source.id, studentId, 'health_record.write');
    const healthRecordId = String(metadata?.healthRecordId || '');
    const idempotencyKey = String(metadata?.idempotencyKey || '');
    const displayName = String(metadata?.displayName || '').trim();
    const contentType = String(metadata?.contentType || '').split(';')[0];
    const suffix = DOCUMENT_TYPES.get(contentType);
    if (!/^[A-Za-z0-9:_-]{8,160}$/.test(healthRecordId) || !grantRow.objectScope.includes(healthRecordId)) {
      fail(403, '健康资料不在单独授权范围内');
    }
    if (!/^[A-Za-z0-9:_-]{8,200}$/.test(idempotencyKey)) fail(400, '健康资料幂等键无效');
    if (!displayName || displayName.length > 120 || /[\\/\x00-\x1f]/.test(displayName) || !suffix || !displayName.toLowerCase().endsWith(suffix)) {
      fail(400, '健康资料名称或类型无效');
    }
    const tempPath = path.join(objectDir, `health-${crypto.randomUUID()}.tmp`);
    return { tempPath, commit({ sha, size, head }) {
      if (!deviceFor(token)) fail(401, '上传凭据已失效');
      const currentGrant = requireV2Grant(source.id, studentId, 'health_record.write');
      if (!currentGrant.objectScope.includes(healthRecordId)) fail(403, '健康资料不在当前单独授权范围内');
      if (size < 1 || size > MAX_DOCUMENT_BYTES || !/^[a-f0-9]{64}$/.test(sha)) fail(413, '健康资料大小无效');
      if (suffix === '.pdf' && !head.subarray(0, 5).equals(Buffer.from('%PDF-'))) fail(400, 'PDF 内容与类型不符');
      if (suffix === '.docx' && !head.subarray(0, 2).equals(Buffer.from('PK'))) fail(400, 'DOCX 内容与类型不符');
      const revisionId = `health_rev_${digest(`${studentId}|${healthRecordId}|${sha}`).slice(0, 48)}`;
      const objectName = `${sha}${suffix}`;
      let duplicate;
      atomic(() => {
        const existing = db.prepare(`SELECT revision_id AS revisionId,health_record_id AS healthRecordId,
          content_sha256 AS contentSha256,byte_size AS byteSize FROM health_records
          WHERE student_id=? AND origin_device_id=? AND idempotency_key=?`).get(studentId, source.id, idempotencyKey);
        if (existing) {
          if (existing.healthRecordId !== healthRecordId || existing.contentSha256 !== sha || Number(existing.byteSize) !== Number(size)) {
            fail(409, '同一健康资料提交编号对应不同内容');
          }
          duplicate = { ...existing, duplicate: true }; return;
        }
        requireStudentCapacity(studentId, size);
        const target = path.join(objectDir, objectName);
        if (!fs.existsSync(target)) fs.renameSync(tempPath, target);
        db.prepare(`INSERT INTO health_records(revision_id,health_record_id,student_id,origin_device_id,display_name,
          content_type,content_sha256,byte_size,object_name,idempotency_key,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(revisionId, healthRecordId, studentId, source.id, displayName,
          contentType, sha, size, objectName, idempotencyKey, now());
        appendSyncEvent(studentId, 'health_record.published', 'health_record', healthRecordId, revisionId);
        audit(source.id, 'health_record.upload', studentId, revisionId);
      });
      return duplicate || { revisionId, healthRecordId, contentSha256: sha, byteSize: size, duplicate: false };
    } };
  }
  function listHealthRecords(token, studentId, cursor = '') {
    const viewer = requireDevice(token, 'viewer');
    const grantRow = requireV2Grant(viewer.id, studentId, 'health_record.read');
    if (cursor && !/^\d+:health_rev_[a-f0-9]{48}$/.test(cursor)) fail(400, '健康资料分页游标无效');
    const [before, beforeRevision] = cursor ? cursor.split(':') : [Number.MAX_SAFE_INTEGER, 'z'];
    const placeholders = grantRow.objectScope.map(() => '?').join(',');
    if (!placeholders) return { records: [], nextCursor: '' };
    const rows = db.prepare(`SELECT revision_id AS revisionId,health_record_id AS healthRecordId,display_name AS displayName,
      content_type AS contentType,content_sha256 AS contentSha256,byte_size AS byteSize,created_at AS createdAt
      FROM health_records WHERE student_id=? AND health_record_id IN (${placeholders}) AND deleted_at IS NULL
      AND (created_at<? OR (created_at=? AND revision_id<?)) ORDER BY created_at DESC,revision_id DESC LIMIT 101`)
      .all(studentId, ...grantRow.objectScope, Number(before), Number(before), beforeRevision);
    const records = rows.slice(0, 100); const last = records.at(-1);
    audit(viewer.id, 'health_record.list', studentId);
    return { records, nextCursor: rows.length > 100 ? `${last.createdAt}:${last.revisionId}` : '' };
  }
  function getHealthRecord(token, revisionId) {
    const viewer = requireDevice(token, 'viewer');
    const row = db.prepare('SELECT * FROM health_records WHERE revision_id=? AND deleted_at IS NULL').get(revisionId);
    if (!row) fail(404, '健康资料修订不存在');
    const grantRow = requireV2Grant(viewer.id, row.student_id, 'health_record.read');
    if (!grantRow.objectScope.includes(row.health_record_id)) fail(403, '健康资料不在单独授权范围内');
    const content = fs.readFileSync(path.join(objectDir, row.object_name));
    if (!safeEqual(digest(content), row.content_sha256)) fail(500, '健康资料对象校验失败');
    audit(viewer.id, 'health_record.download', row.student_id, revisionId);
    return { content, contentSha256: row.content_sha256, contentType: row.content_type, displayName: row.display_name,
      cloudStudentId: row.student_id, healthRecordId: row.health_record_id, revisionId };
  }
  function readableMaterialCategories(deviceId, studentId) {
    return db.prepare(`SELECT category FROM v2_grants WHERE device_id=? AND student_id=? AND scope='material.read'
      AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)`).all(deviceId, studentId, now()).map(row => row.category);
  }
  function materialIndexStatusRow(revisionId) {
    const row = db.prepare(`SELECT j.revision_id AS revisionId,j.status,j.attempts,j.available_at AS availableAt,
      j.updated_at AS updatedAt,j.error_code AS errorCode,j.error_message AS errorMessage,
      s.extraction_status AS extractionStatus,s.page_count AS pageCount,s.indexed_at AS indexedAt
      FROM material_index_jobs j LEFT JOIN material_search_documents s ON s.revision_id=j.revision_id
      WHERE j.revision_id=?`).get(revisionId);
    return row || { revisionId, status: 'not_scheduled', attempts: 0, availableAt: 0, updatedAt: 0,
      errorCode: '', errorMessage: '', extractionStatus: '', pageCount: 0, indexedAt: 0 };
  }
  function getV2MaterialIndexStatus(token, revisionId) {
    const viewer = requireDevice(token, 'viewer');
    const row = db.prepare(`SELECT d.student_id,d.material_category FROM documents d
      JOIN material_current c ON c.revision_id=d.revision_id WHERE d.revision_id=? AND d.deleted_at IS NULL`).get(revisionId);
    if (!row) fail(404, '当前资料修订不存在');
    requireV2Grant(viewer.id, row.student_id, 'material.read', row.material_category);
    return materialIndexStatusRow(revisionId);
  }
  function claimMaterialIndexJob() {
    return atomic(() => {
      const currentTime = now();
      db.prepare(`UPDATE material_index_jobs SET status='retry',available_at=?,claimed_at=NULL,updated_at=?,
        error_code='worker_interrupted',error_message='上次提取进程中断，已自动重试。'
        WHERE status='processing' AND claimed_at IS NOT NULL AND claimed_at<?`).run(currentTime, currentTime, currentTime - 10 * 60 * 1000);
      const row = db.prepare(`SELECT j.revision_id AS revisionId,j.attempts,d.object_name AS objectName,
        d.content_sha256 AS contentSha256,d.byte_size AS byteSize,d.content_type AS contentType,d.display_name AS displayName
        FROM material_index_jobs j JOIN material_current c ON c.revision_id=j.revision_id
        JOIN documents d ON d.revision_id=j.revision_id AND d.deleted_at IS NULL
        WHERE j.status IN ('pending','retry') AND j.available_at<=? ORDER BY j.available_at,j.updated_at,j.revision_id LIMIT 1`).get(currentTime);
      if (!row) return null;
      const changed = db.prepare(`UPDATE material_index_jobs SET status='processing',attempts=attempts+1,claimed_at=?,updated_at=?,
        error_code='',error_message='' WHERE revision_id=? AND status IN ('pending','retry')`).run(currentTime, currentTime, row.revisionId);
      return changed.changes === 1 ? { ...row, attempts: Number(row.attempts) + 1, objectPath: path.join(objectDir, row.objectName) } : null;
    });
  }
  function completeMaterialIndexJob(revisionId, extraction) {
    const text = String(extraction?.text || '').trim();
    if (!text || Buffer.byteLength(text) > 4 * 1024 * 1024) fail(400, '索引正文为空或超过容量限制');
    const extractionStatus = ['partial', 'ocr_complete'].includes(extraction?.status) ? extraction.status : 'complete';
    const pageCount = Number.isSafeInteger(extraction?.pageCount) && extraction.pageCount >= 0 ? extraction.pageCount : 0;
    return atomic(() => {
      const current = db.prepare(`SELECT d.display_name AS displayName,d.content_sha256 AS contentSha256
        FROM material_current c JOIN documents d ON d.revision_id=c.revision_id WHERE c.revision_id=?`).get(revisionId);
      if (!current) {
        db.prepare("UPDATE material_index_jobs SET status='superseded',claimed_at=NULL,updated_at=? WHERE revision_id=?")
          .run(now(), revisionId);
        return { revisionId, status: 'superseded' };
      }
      db.prepare('DELETE FROM material_search_fts WHERE revision_id=?').run(revisionId);
      db.prepare('INSERT INTO material_search_fts(revision_id,display_name,body) VALUES(?,?,?)')
        .run(revisionId, current.displayName, text);
      db.prepare(`INSERT INTO material_search_documents(revision_id,content_sha256,extracted_text,extraction_status,page_count,indexed_at)
        VALUES(?,?,?,?,?,?) ON CONFLICT(revision_id) DO UPDATE SET content_sha256=excluded.content_sha256,
        extracted_text=excluded.extracted_text,extraction_status=excluded.extraction_status,page_count=excluded.page_count,indexed_at=excluded.indexed_at`)
        .run(revisionId, current.contentSha256, text, extractionStatus, pageCount, now());
      db.prepare("UPDATE material_index_jobs SET status='ready',claimed_at=NULL,updated_at=?,error_code='',error_message='' WHERE revision_id=?")
        .run(now(), revisionId);
      return { revisionId, status: 'ready', extractionStatus, pageCount };
    });
  }
  function failMaterialIndexJob(revisionId, error) {
    return atomic(() => {
      const row = db.prepare('SELECT attempts FROM material_index_jobs WHERE revision_id=?').get(revisionId);
      if (!row) return { revisionId, status: 'missing' };
      const retry = Number(row.attempts) < 3;
      const delay = Math.min(15 * 60 * 1000, Math.max(5000, 30000 * (2 ** Math.max(0, Number(row.attempts) - 1))));
      db.prepare(`UPDATE material_index_jobs SET status=?,available_at=?,claimed_at=NULL,updated_at=?,error_code=?,error_message=?
        WHERE revision_id=?`).run(retry ? 'retry' : 'failed', retry ? now() + delay : Number.MAX_SAFE_INTEGER,
        now(), String(error?.code || 'extraction_failed').slice(0, 80), String(error?.message || '资料提取失败').slice(0, 500), revisionId);
      return { revisionId, status: retry ? 'retry' : 'failed' };
    });
  }
  function materialIndexSummary() {
    const rows = db.prepare('SELECT status,COUNT(*) AS count FROM material_index_jobs GROUP BY status').all();
    return Object.fromEntries(rows.map(row => [row.status, Number(row.count)]));
  }
  function checkedRedirectUri(value) {
    let url;
    try { url = new URL(String(value || '')); } catch { fail(400, 'OAuth回调地址无效'); }
    const loopback = url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if ((!loopback && url.protocol !== 'https:') || url.username || url.password || url.hash || String(value).length > 500) fail(400, 'OAuth回调地址无效');
    return url.toString();
  }
  function registerOAuthClient(token, input) {
    const viewer = requireDevice(token, 'viewer');
    const clientName = String(input?.clientName || '').trim();
    const redirectUris = [...new Set((Array.isArray(input?.redirectUris) ? input.redirectUris : []).map(checkedRedirectUri))];
    if (!clientName || clientName.length > 100 || !redirectUris.length || redirectUris.length > 5) fail(400, 'OAuth客户端名称或回调地址无效');
    const clientId = `oauth_client_${crypto.randomUUID().replaceAll('-', '')}`;
    db.prepare('INSERT INTO oauth_clients(client_id,owner_device_id,client_name,redirect_uris_json,created_at) VALUES(?,?,?,?,?)')
      .run(clientId, viewer.id, clientName, JSON.stringify(redirectUris), now());
    audit(viewer.id, 'oauth.client.register', null, clientId);
    return { clientId, clientName, redirectUris, tokenEndpointAuthMethod: 'none', grantTypes: ['authorization_code'],
      responseTypes: ['code'] };
  }
  function authorizeOAuth(token, input) {
    const viewer = requireDevice(token, 'viewer');
    const clientId = String(input?.clientId || '');
    const sessionId = String(input?.sessionId || '');
    const redirectUri = checkedRedirectUri(input?.redirectUri);
    const challenge = String(input?.codeChallenge || '');
    const state = String(input?.state || '');
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(challenge) || input?.codeChallengeMethod !== 'S256' || state.length > 256) {
      fail(400, 'OAuth PKCE参数无效');
    }
    const client = db.prepare('SELECT * FROM oauth_clients WHERE client_id=? AND owner_device_id=? AND revoked_at IS NULL')
      .get(clientId, viewer.id);
    if (!client || !JSON.parse(client.redirect_uris_json).includes(redirectUri)) fail(400, 'OAuth客户端或回调地址无效');
    const session = db.prepare(`SELECT session_id,expires_at FROM remote_agent_sessions
      WHERE session_id=? AND owner_device_id=? AND revoked_at IS NULL AND expires_at>?`).get(sessionId, viewer.id, now());
    if (!session) fail(404, '远程 Agent 会话不存在或已过期');
    const code = randomToken();
    const expiresAt = Math.min(session.expires_at, now() + 5 * 60 * 1000);
    atomic(() => {
      db.prepare('DELETE FROM oauth_authorization_codes WHERE expires_at<=? OR consumed_at IS NOT NULL').run(now());
      db.prepare(`INSERT INTO oauth_authorization_codes(code_hash,client_id,session_id,redirect_uri,code_challenge,scope,created_at,expires_at)
        VALUES(?,?,?,?,?,'edu.cloud.read edu.cloud.submit',?,?)`)
        .run(digest(code), clientId, sessionId, redirectUri, challenge, now(), expiresAt);
      audit(viewer.id, 'oauth.authorization.issue', null, sessionId);
    });
    const redirect = new URL(redirectUri); redirect.searchParams.set('code', code); if (state) redirect.searchParams.set('state', state);
    return { authorizationCode: code, redirectTo: redirect.toString(), expiresAt };
  }
  function exchangeOAuthCode(input) {
    const code = String(input?.code || '');
    const clientId = String(input?.clientId || input?.client_id || '');
    const redirectUri = checkedRedirectUri(input?.redirectUri || input?.redirect_uri);
    const verifier = String(input?.codeVerifier || input?.code_verifier || '');
    if ((input?.grantType || input?.grant_type) !== 'authorization_code' || !code || !clientId || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) {
      fail(400, 'OAuth授权码请求无效');
    }
    const row = db.prepare(`SELECT c.*,s.expires_at AS session_expires_at,s.revoked_at AS session_revoked,
      o.revoked_at AS client_revoked FROM oauth_authorization_codes c
      JOIN remote_agent_sessions s ON s.session_id=c.session_id JOIN oauth_clients o ON o.client_id=c.client_id
      WHERE c.code_hash=? AND c.client_id=?`).get(digest(code), clientId);
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    if (!row || row.consumed_at != null || row.expires_at <= now() || row.session_expires_at <= now() || row.session_revoked != null ||
        row.client_revoked != null || row.redirect_uri !== redirectUri || !safeEqual(row.code_challenge, challenge)) fail(400, 'OAuth授权码无效或已过期');
    const accessToken = randomToken();
    const expiresAt = Math.min(row.session_expires_at, now() + 15 * 60 * 1000);
    atomic(() => {
      const consumed = db.prepare('UPDATE oauth_authorization_codes SET consumed_at=? WHERE code_hash=? AND consumed_at IS NULL')
        .run(now(), digest(code));
      if (consumed.changes !== 1) fail(400, 'OAuth授权码已使用');
      db.prepare(`INSERT INTO oauth_access_tokens(token_hash,client_id,session_id,scope,audience,created_at,expires_at)
        VALUES(?,?,?,?,?,?,?)`).run(digest(accessToken), clientId, row.session_id, row.scope, `${oauthIssuer}/mcp`, now(), expiresAt);
      audit(row.session_id, 'oauth.token.issue', null, clientId);
    });
    return { access_token: accessToken, token_type: 'Bearer', expires_in: Math.max(1, Math.floor((expiresAt - now()) / 1000)),
      scope: row.scope, resource: `${oauthIssuer}/mcp` };
  }
  function revokeOAuthToken(input) {
    const token = String(input?.token || '');
    if (token) db.prepare('UPDATE oauth_access_tokens SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL').run(now(), digest(token));
    return { revoked: true };
  }
  function oauthAuthorizationServerMetadata() {
    return { issuer: oauthIssuer, authorization_endpoint: `${oauthIssuer}/oauth/authorize`, token_endpoint: `${oauthIssuer}/oauth/token`,
      revocation_endpoint: `${oauthIssuer}/oauth/revoke`, response_types_supported: ['code'], grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], scopes_supported: ['edu.cloud.read', 'edu.cloud.submit'] };
  }
  function oauthProtectedResourceMetadata() {
    return { resource: `${oauthIssuer}/mcp`, authorization_servers: [oauthIssuer], bearer_methods_supported: ['header'],
      scopes_supported: ['edu.cloud.read', 'edu.cloud.submit'] };
  }
  function listV2Materials(token, studentId, { category = '', history = false, cursor = '' } = {}) {
    const viewer = requireDevice(token, 'viewer');
    const categories = category ? [category] : readableMaterialCategories(viewer.id, studentId);
    if (!categories.length || categories.some(item => !MATERIAL_CATEGORIES.includes(item))) fail(403, '该设备没有对应资料类别的读取许可');
    for (const item of categories) requireV2Grant(viewer.id, studentId, 'material.read', item);
    if (cursor && !/^\d+:material_rev_[a-f0-9]{48}$/.test(cursor)) fail(400, '资料分页游标无效');
    const [before, beforeRevision] = cursor ? cursor.split(':') : [Number.MAX_SAFE_INTEGER, 'z'];
    const placeholders = categories.map(() => '?').join(',');
    const currentJoin = history ? '' : 'JOIN material_current c ON c.revision_id=d.revision_id';
    const rows = db.prepare(`SELECT d.material_id AS materialId,d.revision_id AS revisionId,d.material_category AS category,
      d.display_name AS displayName,d.content_type AS contentType,d.content_sha256 AS contentSha256,d.byte_size AS byteSize,
      d.origin_device_id AS originDeviceId,d.created_at AS createdAt,COALESCE(j.status,'not_scheduled') AS indexStatus,
      COALESCE(s.extraction_status,'') AS extractionStatus FROM documents d ${currentJoin}
      LEFT JOIN material_index_jobs j ON j.revision_id=d.revision_id
      LEFT JOIN material_search_documents s ON s.revision_id=d.revision_id
      WHERE d.student_id=? AND d.material_category IN (${placeholders}) AND d.revision_id!='' AND d.deleted_at IS NULL
      AND (d.created_at<? OR (d.created_at=? AND d.revision_id<?)) ORDER BY d.created_at DESC,d.revision_id DESC LIMIT 201`)
      .all(studentId, ...categories, Number(before), Number(before), beforeRevision);
    const materials = rows.slice(0, 200);
    const last = materials.at(-1);
    return { materials, nextCursor: rows.length > 200 ? `${last.createdAt}:${last.revisionId}` : '' };
  }
  function getV2Material(token, revisionId) {
    const viewer = requireDevice(token, 'viewer');
    const row = db.prepare(`SELECT * FROM documents WHERE revision_id=? AND deleted_at IS NULL`).get(revisionId);
    if (!row) fail(404, '资料修订不存在');
    requireV2Grant(viewer.id, row.student_id, 'material.read', row.material_category);
    const content = fs.readFileSync(path.join(objectDir, row.object_name));
    if (!safeEqual(digest(content), row.content_sha256)) fail(500, '资料对象校验失败');
    audit(viewer.id, `material.download.${row.material_category}`, row.student_id, revisionId);
    return { content, contentSha256: row.content_sha256, contentType: row.content_type, displayName: row.display_name,
      cloudStudentId: row.student_id, materialId: row.material_id, revisionId, category: row.material_category };
  }
  function issueRemoteAgentSession(token, input) {
    const viewer = requireDevice(token, 'viewer');
    const provider = String(input?.provider || '');
    const studentIds = [...new Set((Array.isArray(input?.cloudStudentIds) ? input.cloudStudentIds : [input?.cloudStudentId])
      .map(String).filter(Boolean))].sort();
    const studentId = studentIds[0] || '';
    const projectId = String(input?.projectId || '').trim();
    const scopeFingerprint = String(input?.scopeFingerprint || '').trim();
    const taskId = String(input?.taskId || '').trim();
    const executionId = String(input?.executionId || '').trim();
    const taskType = String(input?.taskType || '').trim();
    const idempotencyKey = String(input?.idempotencyKey || '').trim();
    if (!['codex', 'workbuddy'].includes(provider)) fail(400, '远程 Agent 仅支持 Codex 或 WorkBuddy');
    if (!studentIds.length || studentIds.length > 50 || studentIds.some(id => !validId(id))) fail(400, '学生范围无效');
    if (projectId && (!/^[A-Za-z0-9:_-]{3,160}$/.test(projectId) || !/^[a-f0-9]{64}$/.test(scopeFingerprint))) {
      fail(400, '项目范围或权限摘要无效');
    }
    if (!/^[A-Za-z0-9:_-]{8,200}$/.test(taskId) || !/^[A-Za-z0-9:_-]{8,200}$/.test(executionId) || !/^[A-Za-z0-9._:-]{3,100}$/.test(taskType) ||
        !/^[A-Za-z0-9:_-]{8,200}$/.test(idempotencyKey)) fail(400, '远程 Agent 任务合同无效');
    const requested = checkedCategories(input?.materialCategories);
    if (!requested.length) fail(400, '至少选择一类远程只读资料');
    for (const scopedStudentId of studentIds) for (const category of requested) {
      requireV2Grant(viewer.id, scopedStudentId, 'material.read', category);
    }
    const requestedLifetime = Number(input?.lifetimeMs || 15 * 60 * 1000);
    const lifetimeMs = Math.max(60 * 1000, Math.min(60 * 60 * 1000,
      Number.isFinite(requestedLifetime) ? Math.floor(requestedLifetime) : 15 * 60 * 1000));
    const sessionId = `agent_session_${crypto.randomUUID().replaceAll('-', '')}`;
    const sessionToken = randomToken();
    const expiresAt = now() + lifetimeMs;
    const prior = db.prepare('SELECT session_id,status FROM remote_agent_sessions WHERE owner_device_id=? AND idempotency_key=?')
      .get(viewer.id, idempotencyKey);
    if (prior) fail(409, `远程 Agent 任务已存在，请查询状态：${prior.session_id}`);
    atomic(() => {
      db.prepare(`INSERT INTO remote_agent_sessions
        (session_id,token_hash,owner_device_id,provider,student_id,student_ids_json,project_id,scope_fingerprint,categories_json,
         task_id,execution_id,task_type,idempotency_key,status,created_at,updated_at,expires_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'issued',?,?,?)`).run(sessionId, digest(sessionToken), viewer.id, provider, studentId,
        JSON.stringify(studentIds), projectId, scopeFingerprint, JSON.stringify(requested), taskId, executionId, taskType, idempotencyKey, now(), now(), expiresAt);
      audit(viewer.id, `remote_agent.session.issue.${provider}`, studentId, sessionId);
    });
    return { sessionId, sessionToken, provider, cloudStudentId: studentId, cloudStudentIds: studentIds, projectId, scopeFingerprint,
      taskId, executionId, taskType, idempotencyKey, status: 'issued', materialCategories: requested, expiresAt };
  }
  function remoteAgentSession(token) {
    if (!token) fail(401, '远程 Agent 会话无效');
    let row = db.prepare(`SELECT * FROM remote_agent_sessions WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?`)
      .get(digest(token), now());
    if (!row) row = db.prepare(`SELECT s.* FROM oauth_access_tokens t
      JOIN oauth_clients c ON c.client_id=t.client_id AND c.revoked_at IS NULL
      JOIN remote_agent_sessions s ON s.session_id=t.session_id
      WHERE t.token_hash=? AND t.revoked_at IS NULL AND t.expires_at>? AND t.audience=?
        AND s.revoked_at IS NULL AND s.expires_at>?`).get(digest(token), now(), `${oauthIssuer}/mcp`, now());
    if (!row) fail(401, '远程 Agent 会话无效或已过期');
    const studentIds = JSON.parse(row.student_ids_json || '[]');
    return { ...row, studentIds: studentIds.length ? studentIds : [row.student_id],
      materialCategories: JSON.parse(row.categories_json || '[]') };
  }
  function revokeRemoteAgentSession(token, sessionId) {
    const viewer = requireDevice(token, 'viewer');
    if (!/^agent_session_[a-f0-9]{32}$/.test(String(sessionId || ''))) fail(400, '远程 Agent 会话标识无效');
    return atomic(() => {
      const result = db.prepare(`UPDATE remote_agent_sessions SET revoked_at=?,status=CASE WHEN status IN ('result_submitted','committed','quarantined') THEN status ELSE 'cancel_requested' END,updated_at=?
        WHERE session_id=? AND owner_device_id=? AND revoked_at IS NULL`).run(now(), now(), sessionId, viewer.id);
      if (result.changes) audit(viewer.id, 'remote_agent.session.revoke', null, sessionId);
      return { revoked: result.changes === 1 };
    });
  }
  function remoteAgentStatusForHost(token, sessionId) {
    const viewer = requireDevice(token, 'viewer');
    const row = db.prepare(`SELECT session_id AS sessionId,provider,student_id AS cloudStudentId,
      project_id AS projectId,scope_fingerprint AS scopeFingerprint,student_ids_json AS cloudStudentIdsJson,
      task_id AS taskId,execution_id AS executionId,task_type AS taskType,
      idempotency_key AS idempotencyKey,status,result_submission_id AS resultSubmissionId,
      created_at AS createdAt,updated_at AS updatedAt,expires_at AS expiresAt,revoked_at AS revokedAt
      FROM remote_agent_sessions WHERE session_id=? AND owner_device_id=?`).get(sessionId, viewer.id);
    if (!row) fail(404, '远程 Agent 任务不存在');
    return { ...row, cloudStudentIds: JSON.parse(row.cloudStudentIdsJson || '[]'), cloudStudentIdsJson: undefined };
  }
  function remoteAgentAcknowledge(token) {
    const session = remoteAgentSession(token);
    if (session.status === 'issued') db.prepare(`UPDATE remote_agent_sessions SET status='running',updated_at=? WHERE session_id=? AND status='issued'`)
      .run(now(), session.session_id);
    const current = db.prepare('SELECT status,updated_at AS updatedAt FROM remote_agent_sessions WHERE session_id=?').get(session.session_id);
    audit(session.session_id, 'remote_agent.task.acknowledge', session.student_id, session.task_id);
    return { sessionId: session.session_id, taskId: session.task_id, executionId: session.execution_id, taskType: session.task_type,
      provider: session.provider, cloudStudentId: session.student_id, cloudStudentIds: session.studentIds, projectId: session.project_id,
      scopeFingerprint: session.scope_fingerprint, status: current.status, updatedAt: current.updatedAt,
      expiresAt: session.expires_at, materialCategories: session.materialCategories };
  }
  function getRemoteAgentStudentProfile(token, studentId) {
    const session = remoteAgentSession(token);
    const selectedStudentId = String(studentId || session.student_id);
    if (!session.studentIds.includes(selectedStudentId)) fail(404, '学生不在远程 Agent 会话范围');
    const grant = requireV2Grant(session.owner_device_id, selectedStudentId, 'student_profile.read');
    const row = db.prepare(`SELECT r.*,c.updated_at FROM student_profile_current c JOIN student_profile_revisions r
      ON r.revision_id=c.revision_id WHERE c.student_id=?`).get(selectedStudentId);
    if (!row) fail(404, '学生基础信息尚未同步');
    const stored = JSON.parse(row.profile_json);
    const profile = Object.fromEntries(grant.fields.filter(field => Object.hasOwn(stored, field)).map(field => [field, stored[field]]));
    audit(session.session_id, 'remote_agent.student_profile.read', selectedStudentId, row.revision_id);
    return { contractVersion: 2, source: 'cloud_copy', cloudStudentId: selectedStudentId,
      profileRevisionId: row.revision_id, profile, fields: Object.keys(profile), updatedAt: row.updated_at };
  }
  function listRemoteAgentMaterials(token, { category = '', cursor = '' } = {}) {
    const session = remoteAgentSession(token);
    const selected = category ? [String(category)] : session.materialCategories;
    if (!selected.length || selected.some(item => !session.materialCategories.includes(item))) fail(403, '资料类别超出远程 Agent 会话范围');
    for (const scopedStudentId of session.studentIds) for (const item of selected) {
      requireV2Grant(session.owner_device_id, scopedStudentId, 'material.read', item);
    }
    if (cursor && !/^\d+:material_rev_[a-f0-9]{48}$/.test(cursor)) fail(400, '资料游标无效');
    const [before, beforeRevision] = cursor ? cursor.split(':') : [Number.MAX_SAFE_INTEGER, 'z'];
    const placeholders = selected.map(() => '?').join(',');
    const studentPlaceholders = session.studentIds.map(() => '?').join(',');
    const projectClause = session.project_id ? 'AND d.project_id=? AND d.scope_fingerprint=?' : "AND d.project_id=''";
    const rows = db.prepare(`SELECT d.material_id AS materialId,d.revision_id AS revisionId,
      d.material_category AS category,d.display_name AS displayName,d.content_type AS contentType,
      d.content_sha256 AS contentSha256,d.byte_size AS byteSize,d.created_at AS createdAt,d.student_id AS cloudStudentId,
      COALESCE(j.status,'not_scheduled') AS indexStatus,COALESCE(s.extraction_status,'') AS extractionStatus
      FROM documents d JOIN material_current c ON c.revision_id=d.revision_id
      LEFT JOIN material_index_jobs j ON j.revision_id=d.revision_id
      LEFT JOIN material_search_documents s ON s.revision_id=d.revision_id
      WHERE d.student_id IN (${studentPlaceholders}) AND d.material_category IN (${placeholders}) AND d.deleted_at IS NULL
      ${projectClause}
      AND (d.created_at<? OR (d.created_at=? AND d.revision_id<?))
      ORDER BY d.created_at DESC,d.revision_id DESC LIMIT 201`).all(...session.studentIds, ...selected,
      ...(session.project_id ? [session.project_id, session.scope_fingerprint] : []),
      Number(before), Number(before), beforeRevision);
    const materials = rows.slice(0, 200);
    const last = materials.at(-1);
    audit(session.session_id, 'remote_agent.material.list', session.student_id, session.project_id || null);
    return { sessionId: session.session_id, provider: session.provider, cloudStudentId: session.student_id, cloudStudentIds: session.studentIds,
      projectId: session.project_id, scopeFingerprint: session.scope_fingerprint, materials,
      nextCursor: rows.length > 200 ? `${last.createdAt}:${last.revisionId}` : '' };
  }
  function getRemoteAgentMaterial(token, revisionId) {
    const session = remoteAgentSession(token);
    const row = db.prepare(`SELECT d.* FROM documents d JOIN material_current c ON c.revision_id=d.revision_id
      WHERE d.revision_id=? AND d.deleted_at IS NULL`).get(revisionId);
    if (!row || !session.studentIds.includes(row.student_id) || !session.materialCategories.includes(row.material_category) ||
        (session.project_id ? row.project_id !== session.project_id || row.scope_fingerprint !== session.scope_fingerprint : Boolean(row.project_id))) {
      fail(404, '资料修订不存在或不在授权范围');
    }
    requireV2Grant(session.owner_device_id, row.student_id, 'material.read', row.material_category);
    const content = fs.readFileSync(path.join(objectDir, row.object_name));
    if (!safeEqual(digest(content), row.content_sha256)) fail(500, '资料对象校验失败');
    audit(session.session_id, 'remote_agent.material.download', session.student_id, revisionId);
    return { content, contentSha256: row.content_sha256, contentType: row.content_type,
      displayName: row.display_name, cloudStudentId: row.student_id, materialId: row.material_id,
      revisionId, category: row.material_category, projectId: session.project_id,
      scopeFingerprint: session.scope_fingerprint };
  }
  function searchRemoteAgentMaterials(token, { query = '', category = '' } = {}) {
    const session = remoteAgentSession(token);
    const normalized = String(query || '').trim();
    if (!normalized || [...normalized].length > 100) fail(400, '搜索关键词必须为1到100个字符');
    const selected = category ? [String(category)] : session.materialCategories;
    if (!selected.length || selected.some(item => !session.materialCategories.includes(item))) fail(403, '资料类别超出远程 Agent 会话范围');
    for (const scopedStudentId of session.studentIds) for (const item of selected) {
      requireV2Grant(session.owner_device_id, scopedStudentId, 'material.read', item);
    }
    const placeholders = selected.map(() => '?').join(',');
    const studentPlaceholders = session.studentIds.map(() => '?').join(',');
    const projectClause = session.project_id ? 'AND d.project_id=? AND d.scope_fingerprint=?' : "AND d.project_id=''";
    const shortOrCjk = [...normalized].length <= 2 || /[\u3400-\u9fff]/u.test(normalized);
    const match = normalized.split(/\s+/u).filter(Boolean).slice(0, 8)
      .map(term => `"${term.replaceAll('"', '""')}"`).join(' AND ');
    const predicate = shortOrCjk ? '(d.display_name LIKE ? ESCAPE \'\\\' OR s.extracted_text LIKE ? ESCAPE \'\\\')' : 'material_search_fts MATCH ?';
    const escaped = normalized.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
    const searchArgs = shortOrCjk ? [`%${escaped}%`, `%${escaped}%`] : [match];
    const rows = db.prepare(`SELECT d.material_id AS materialId,d.revision_id AS revisionId,d.material_category AS category,
      d.display_name AS displayName,d.content_type AS contentType,d.content_sha256 AS contentSha256,
      d.byte_size AS byteSize,d.created_at AS createdAt,d.student_id AS cloudStudentId,
      s.extraction_status AS extractionStatus,s.indexed_at AS indexedAt
      FROM material_search_fts JOIN material_search_documents s ON s.revision_id=material_search_fts.revision_id
      JOIN documents d ON d.revision_id=material_search_fts.revision_id JOIN material_current c ON c.revision_id=d.revision_id
      WHERE d.student_id IN (${studentPlaceholders}) AND d.material_category IN (${placeholders})
      AND d.deleted_at IS NULL ${projectClause} AND ${predicate}
      ORDER BY d.created_at DESC,d.revision_id DESC LIMIT 100`).all(...session.studentIds, ...selected,
      ...(session.project_id ? [session.project_id, session.scope_fingerprint] : []), ...searchArgs);
    const pending = db.prepare(`SELECT COUNT(*) AS count FROM material_current c JOIN documents d ON d.revision_id=c.revision_id
      JOIN material_index_jobs j ON j.revision_id=d.revision_id
      WHERE d.student_id IN (${studentPlaceholders}) AND d.material_category IN (${placeholders})
      ${projectClause} AND j.status!='ready'`).get(...session.studentIds, ...selected,
      ...(session.project_id ? [session.project_id, session.scope_fingerprint] : [])).count;
    audit(session.session_id, 'remote_agent.material.search', session.student_id, session.project_id || null);
    return { sessionId: session.session_id, query: normalized, materials: rows, pendingIndexCount: Number(pending) };
  }
  function submitInboxResult(token, input) {
    const session = remoteAgentSession(token);
    const idempotencyKey = String(input?.idempotencyKey || '');
    if (!/^[A-Za-z0-9:_-]{8,200}$/.test(idempotencyKey)) fail(400, '成果幂等键无效');
    if (String(input?.projectId || '') !== session.project_id || String(input?.scopeFingerprint || '') !== session.scope_fingerprint) {
      fail(409, '成果项目范围与远程 Agent 会话不一致');
    }
    let payload = input?.payload;
    let attachments = [];
    if (session.project_id) {
      payload = normalizeRemoteProjectResult(payload, { taskId: session.task_id, executionId: session.execution_id, taskType: session.task_type,
        projectId: session.project_id, scopeFingerprint: session.scope_fingerprint });
      for (const source of payload.sources) {
        const row = db.prepare(`SELECT student_id,material_id,revision_id,content_sha256,material_category,project_id,scope_fingerprint
          FROM documents WHERE revision_id=? AND deleted_at IS NULL`).get(source.revisionId);
        if (!row || row.material_id !== source.materialId || row.content_sha256 !== source.contentSha256 ||
            !session.studentIds.includes(row.student_id) || !session.materialCategories.includes(row.material_category) ||
            row.project_id !== session.project_id || row.scope_fingerprint !== session.scope_fingerprint) {
          fail(409, '远程成果引用了任务授权范围外的资料');
        }
      }
      attachments = payload.attachments.map((attachment, index) => ({
        attachmentId: `attachment_${digest(`${session.session_id}|${index}|${attachment.contentSha256}|${attachment.displayName}`).slice(0, 32)}`,
        displayName: attachment.displayName, contentType: attachment.contentType, contentSha256: attachment.contentSha256,
        byteSize: attachment.byteSize, bytes: Buffer.from(attachment.contentBase64, 'base64'),
        objectName: `inbox-${attachment.contentSha256}.bin`,
      }));
      payload = { ...payload, attachments: attachments.map(({ bytes, objectName, ...attachment }) => attachment) };
    }
    const payloadJson = stableJson(payload);
    if (!payload || Buffer.byteLength(payloadJson) > 1024 * 1024) fail(400, '成果内容无效或超过限额');
    const contentSha256 = sha256(payloadJson);
    if (session.result_submission_id) {
      const priorResult = db.prepare('SELECT * FROM cloud_inbox_submissions WHERE submission_id=? AND target_device_id=?')
        .get(session.result_submission_id, session.owner_device_id);
      if (priorResult && priorResult.idempotency_key === idempotencyKey && safeEqual(priorResult.content_sha256, contentSha256) &&
          priorResult.project_id === session.project_id && priorResult.scope_fingerprint === session.scope_fingerprint) {
        return { submissionId: priorResult.submission_id, status: priorResult.status, duplicate: true };
      }
      fail(409, '该远程任务已经提交过成果，请查询原成果状态');
    }
    const existing = db.prepare('SELECT * FROM cloud_inbox_submissions WHERE target_device_id=? AND idempotency_key=?')
      .get(session.owner_device_id, idempotencyKey);
    if (existing) {
      if (!safeEqual(existing.content_sha256, contentSha256) || existing.project_id !== session.project_id ||
          existing.scope_fingerprint !== session.scope_fingerprint) fail(409, '同一成果编号的内容或范围不一致');
      return { submissionId: existing.submission_id, status: existing.status, duplicate: true };
    }
    const submissionId = `submission_${crypto.randomUUID().replaceAll('-', '')}`;
    for (const attachment of attachments) {
      const target = path.join(objectDir, attachment.objectName);
      if (!fs.existsSync(target)) {
        const temporary = `${target}.${crypto.randomUUID()}.tmp`;
        fs.writeFileSync(temporary, attachment.bytes, { flag: 'wx' });
        try { fs.renameSync(temporary, target); } catch (error) {
          if (!fs.existsSync(target)) throw error;
          fs.rmSync(temporary, { force: true });
        }
      }
    }
    atomic(() => {
      db.prepare(`INSERT INTO cloud_inbox_submissions
        (submission_id,student_id,student_ids_json,target_device_id,provider,project_id,scope_fingerprint,idempotency_key,
         payload_json,content_sha256,status,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,'available',?,?)`).run(submissionId, session.student_id, JSON.stringify(session.studentIds), session.owner_device_id,
        session.provider, session.project_id, session.scope_fingerprint, idempotencyKey, payloadJson, contentSha256, now(), now());
      const insertAttachment = db.prepare(`INSERT INTO cloud_inbox_attachments
        (submission_id,attachment_id,display_name,content_type,content_sha256,byte_size,object_name,created_at)
        VALUES(?,?,?,?,?,?,?,?)`);
      for (const attachment of attachments) insertAttachment.run(submissionId, attachment.attachmentId, attachment.displayName,
        attachment.contentType, attachment.contentSha256, attachment.byteSize, attachment.objectName, now());
      appendSyncEvent(session.student_id, 'inbox.submitted', 'agent_result', submissionId, '');
      db.prepare(`UPDATE remote_agent_sessions SET status='result_submitted',result_submission_id=?,updated_at=? WHERE session_id=?`)
        .run(submissionId, now(), session.session_id);
      audit(session.session_id, 'inbox.submit', session.student_id, submissionId);
    });
    return { submissionId, status: 'available', duplicate: false };
  }
  function getInboxSubmissionStatus(token, submissionId = '') {
    const session = remoteAgentSession(token);
    const expected = String(submissionId || session.result_submission_id || '');
    if (!/^submission_[a-f0-9]{32}$/.test(expected)) fail(404, '当前任务尚未提交成果');
    if (session.result_submission_id && session.result_submission_id !== expected) fail(403, '成果不属于当前远程任务');
    const row = db.prepare(`SELECT submission_id AS submissionId,status,content_sha256 AS contentSha256,
      created_at AS createdAt,updated_at AS updatedAt,quarantined_reason AS quarantinedReason
      FROM cloud_inbox_submissions WHERE submission_id=? AND target_device_id=?`).get(expected, session.owner_device_id);
    if (!row) fail(404, '成果不存在');
    return { ...row, sessionId: session.session_id, taskId: session.task_id, executionId: session.execution_id,
      projectId: session.project_id, scopeFingerprint: session.scope_fingerprint };
  }
  function listInbox(token, cursor = '') {
    const viewer = requireDevice(token, 'viewer');
    if (cursor && !/^\d+:submission_[a-f0-9]{32}$/.test(cursor)) fail(400, '收件箱游标无效');
    const [before, beforeId] = cursor ? cursor.split(':') : [Number.MAX_SAFE_INTEGER, 'z'];
    const rows = db.prepare(`SELECT i.submission_id AS submissionId,i.student_id AS cloudStudentId,i.provider,
      s.session_id AS sessionId,s.task_id AS taskId,s.execution_id AS executionId,s.task_type AS taskType,
      i.student_ids_json AS cloudStudentIdsJson,i.project_id AS projectId,i.scope_fingerprint AS scopeFingerprint,i.content_sha256 AS contentSha256,
      i.status,i.created_at AS createdAt,i.updated_at AS updatedAt,i.lease_expires_at AS leaseExpiresAt,
      i.quarantined_reason AS quarantinedReason FROM cloud_inbox_submissions i
      LEFT JOIN remote_agent_sessions s ON s.result_submission_id=i.submission_id AND s.owner_device_id=i.target_device_id
      WHERE i.target_device_id=? AND (i.created_at<? OR (i.created_at=? AND i.submission_id<?))
      ORDER BY i.created_at DESC,i.submission_id DESC LIMIT 101`).all(viewer.id, Number(before), Number(before), beforeId);
    const submissions = rows.slice(0, 100).map(row => ({ ...row, cloudStudentIds: JSON.parse(row.cloudStudentIdsJson || '[]'), cloudStudentIdsJson: undefined }));
    const last = submissions.at(-1);
    return { submissions, nextCursor: rows.length > 100 ? `${last.createdAt}:${last.submissionId}` : '' };
  }
  function leaseInboxSubmission(token, submissionId) {
    const viewer = requireDevice(token, 'viewer');
    if (!/^submission_[a-f0-9]{32}$/.test(String(submissionId || ''))) fail(400, '成果标识无效');
    return atomic(() => {
      const row = db.prepare('SELECT * FROM cloud_inbox_submissions WHERE submission_id=? AND target_device_id=?')
        .get(submissionId, viewer.id);
      if (!row) fail(404, '成果不存在');
      if (['committed', 'quarantined'].includes(row.status)) return { submissionId, status: row.status, duplicate: true };
      if (row.status === 'leased' && row.lease_expires_at > now()) fail(409, '成果正在由本机另一流程处理');
      const leaseId = `lease_${crypto.randomUUID().replaceAll('-', '')}`;
      const leaseExpiresAt = now() + 2 * 60 * 1000;
      db.prepare(`UPDATE cloud_inbox_submissions SET status='leased',lease_id=?,lease_owner_device_id=?,
        lease_expires_at=?,updated_at=? WHERE submission_id=?`).run(leaseId, viewer.id, leaseExpiresAt, now(), submissionId);
      audit(viewer.id, 'inbox.lease', row.student_id, submissionId);
      const task = db.prepare(`SELECT session_id AS sessionId,task_id AS taskId,execution_id AS executionId,task_type AS taskType
        FROM remote_agent_sessions WHERE result_submission_id=? AND owner_device_id=?`).get(submissionId, viewer.id) || {};
      const attachments = db.prepare(`SELECT attachment_id AS attachmentId,display_name AS displayName,content_type AS contentType,
        content_sha256 AS contentSha256,byte_size AS byteSize FROM cloud_inbox_attachments WHERE submission_id=? ORDER BY attachment_id`)
        .all(submissionId);
      return { submissionId, status: 'leased', leaseId, leaseExpiresAt, provider: row.provider, ...task,
        cloudStudentId: row.student_id, cloudStudentIds: JSON.parse(row.student_ids_json || '[]'), projectId: row.project_id, scopeFingerprint: row.scope_fingerprint,
        contentSha256: row.content_sha256, payload: JSON.parse(row.payload_json), attachments };
    });
  }
  function getInboxAttachment(token, submissionId, attachmentId, leaseId) {
    const viewer = requireDevice(token, 'viewer');
    const submission = db.prepare(`SELECT status,lease_id,lease_expires_at FROM cloud_inbox_submissions
      WHERE submission_id=? AND target_device_id=?`).get(submissionId, viewer.id);
    if (!submission) fail(404, '成果不存在');
    if (submission.status !== 'leased' || submission.lease_id !== String(leaseId || '') || submission.lease_expires_at <= now()) {
      fail(409, '成果附件租约无效或已过期');
    }
    const row = db.prepare('SELECT * FROM cloud_inbox_attachments WHERE submission_id=? AND attachment_id=?')
      .get(submissionId, attachmentId);
    if (!row) fail(404, '成果附件不存在');
    const content = fs.readFileSync(path.join(objectDir, row.object_name));
    if (!safeEqual(digest(content), row.content_sha256)) fail(500, '成果附件校验失败');
    audit(viewer.id, 'inbox.attachment.download', null, `${submissionId}:${attachmentId}`);
    return { content, contentSha256: row.content_sha256, contentType: row.content_type, displayName: row.display_name };
  }
  function settleInboxSubmission(token, submissionId, input) {
    const viewer = requireDevice(token, 'viewer');
    const status = String(input?.status || '');
    if (!['committed', 'quarantined'].includes(status)) fail(400, '成果处置状态无效');
    return atomic(() => {
      const row = db.prepare('SELECT * FROM cloud_inbox_submissions WHERE submission_id=? AND target_device_id=?')
        .get(submissionId, viewer.id);
      if (!row) fail(404, '成果不存在');
      if (row.status === status) return { submissionId, status, duplicate: true };
      if (['committed', 'quarantined'].includes(row.status)) fail(409, '成果已经完成其他处置');
      if (row.status !== 'leased' || row.lease_id !== String(input?.leaseId || '') || row.lease_expires_at <= now()) {
        fail(409, '成果租约无效或已过期');
      }
      const reason = status === 'quarantined' ? String(input?.reason || '项目范围或权限已变化').slice(0, 500) : '';
      db.prepare(`UPDATE cloud_inbox_submissions SET status=?,updated_at=?,consumed_at=?,
        quarantined_reason=?,lease_id=NULL,lease_owner_device_id=NULL,lease_expires_at=NULL WHERE submission_id=?`)
        .run(status, now(), now(), reason, submissionId);
      db.prepare(`UPDATE remote_agent_sessions SET status=?,updated_at=? WHERE result_submission_id=?`)
        .run(status, now(), submissionId);
      appendSyncEvent(row.student_id, `inbox.${status}`, 'agent_result', submissionId, '');
      audit(viewer.id, `inbox.${status}`, row.student_id, submissionId);
      return { submissionId, status, duplicate: false };
    });
  }
  function listRemoteOperations(token, studentId = '') {
    if (!isAdmin(token)) fail(401, '管理员凭据无效');
    if (studentId && !validId(studentId)) fail(400, '学生标识无效');
    const sessions = db.prepare(`SELECT session_id AS sessionId,provider,student_id AS cloudStudentId,
      student_ids_json AS cloudStudentIdsJson,project_id AS projectId,scope_fingerprint AS scopeFingerprint,
      task_id AS taskId,execution_id AS executionId,task_type AS taskType,status,
      result_submission_id AS resultSubmissionId,created_at AS createdAt,updated_at AS updatedAt,expires_at AS expiresAt,
      revoked_at AS revokedAt FROM remote_agent_sessions WHERE (?='' OR student_id=?)
      ORDER BY updated_at DESC,session_id DESC LIMIT 200`).all(studentId, studentId).map(row => ({
        ...row, cloudStudentIds: JSON.parse(row.cloudStudentIdsJson || '[]'), cloudStudentIdsJson: undefined,
      }));
    const inbox = db.prepare(`SELECT submission_id AS submissionId,student_id AS cloudStudentId,
      student_ids_json AS cloudStudentIdsJson,target_device_id AS targetDeviceId,provider,project_id AS projectId,
      scope_fingerprint AS scopeFingerprint,status,created_at AS createdAt,updated_at AS updatedAt,
      lease_expires_at AS leaseExpiresAt,consumed_at AS consumedAt,quarantined_reason AS quarantinedReason
      FROM cloud_inbox_submissions WHERE (?='' OR student_id=?) ORDER BY updated_at DESC,submission_id DESC LIMIT 200`)
      .all(studentId, studentId).map(row => ({ ...row, cloudStudentIds: JSON.parse(row.cloudStudentIdsJson || '[]'), cloudStudentIdsJson: undefined }));
    return { sessions, inbox, generatedAt: now() };
  }
  function listDocuments(token, studentId, includeTrash = false, cursor = '') {
    const admin = isAdmin(token);
    const viewer = admin ? null : requireDevice(token);
    if (!admin && !hasGrant(viewer.id, studentId, 'cloud_document.read') && !hasGrant(viewer.id, studentId, 'report.write')) {
      fail(403, '该设备没有此学生的许可');
    }
    if (!admin && viewer.kind === 'viewer') requireScopedViewerMaterial(viewer.id, studentId, 'learning_material');
    if (includeTrash && !admin && !hasGrant(viewer.id, studentId, 'report.write')) fail(403, '只有来源设备可查看回收站');
    if (cursor && !/^\d+:doc_[a-f0-9]{32}$/.test(cursor)) fail(400, '文档游标无效');
    const [before, beforeId] = cursor ? cursor.split(':') : [Number.MAX_SAFE_INTEGER, 'z'];
    return db.prepare(`SELECT id AS documentId, display_name AS displayName, content_type AS contentType,
      content_sha256 AS contentSha256, byte_size AS byteSize, origin_device_id AS originDeviceId,
      created_at AS createdAt, deleted_at AS deletedAt
      FROM documents WHERE student_id=? AND ${includeTrash ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL'}
      AND (created_at<? OR (created_at=? AND id<?))
      ORDER BY created_at DESC,id DESC LIMIT 101`).all(studentId, Number(before), Number(before), beforeId);
  }
  function documentRow(documentId) {
    const row = db.prepare('SELECT * FROM documents WHERE id=?').get(documentId);
    if (!row) fail(404, '文档不存在');
    return row;
  }
  function getDocument(token, documentId) {
    const admin = isAdmin(token);
    const viewer = admin ? null : requireDevice(token);
    const row = documentRow(documentId);
    if (row.deleted_at !== null) fail(404, '文档已移入回收站');
    if (!admin && !hasGrant(viewer.id, row.student_id, 'cloud_document.read') && !hasGrant(viewer.id, row.student_id, 'report.write')) {
      fail(403, '该设备没有此学生的许可');
    }
    if (!admin && viewer.kind === 'viewer') requireScopedViewerMaterial(viewer.id, row.student_id, 'learning_material');
    const content = fs.readFileSync(path.join(objectDir, row.object_name));
    if (!safeEqual(digest(content), row.content_sha256)) fail(500, '文档对象校验失败');
    audit(admin ? 'admin_local' : viewer.id, 'document.download', row.student_id, documentId);
    return { content, contentSha256: row.content_sha256, contentType: row.content_type,
      displayName: row.display_name, cloudStudentId: row.student_id };
  }
  function updateDocument(token, documentId, { displayName, deleted }) {
    const admin = isAdmin(token);
    const source = admin ? null : requireDevice(token, 'source');
    const row = documentRow(documentId);
    if (!admin) requireGrant(source.id, row.student_id, 'report.write');
    const name = displayName === undefined ? undefined : String(displayName).trim();
    if (name !== undefined && (!name || name.length > 120 || /[\\/\x00-\x1f]/.test(name))) fail(400, '文件名无效');
    if (deleted !== undefined && typeof deleted !== 'boolean') fail(400, '删除状态无效');
    atomic(() => {
      if (name !== undefined) {
        db.prepare('UPDATE documents SET display_name=? WHERE id=?').run(name, documentId);
        audit(admin ? 'admin_local' : source.id, 'document.rename', row.student_id, documentId);
      }
      if (deleted !== undefined) {
        db.prepare('UPDATE documents SET deleted_at=? WHERE id=?').run(deleted ? now() : null, documentId);
        if (deleted && row.revision_id) {
          db.prepare('DELETE FROM material_current WHERE revision_id=?').run(row.revision_id);
          db.prepare("UPDATE material_index_jobs SET status='superseded',claimed_at=NULL,updated_at=? WHERE revision_id=?")
            .run(now(), row.revision_id);
          db.prepare('DELETE FROM material_search_fts WHERE revision_id=?').run(row.revision_id);
          db.prepare('DELETE FROM material_search_documents WHERE revision_id=?').run(row.revision_id);
          appendSyncEvent(row.student_id, 'material.withdrawn', row.material_category, row.material_id, row.revision_id, true);
        }
        audit(admin ? 'admin_local' : source.id, deleted ? 'document.trash' : 'document.restore', row.student_id, documentId);
      }
    });
    return { documentId, displayName: displayName === undefined ? row.display_name : String(displayName).trim(), deleted: deleted === undefined ? row.deleted_at !== null : deleted };
  }
  return { db, close: () => db.close(), schemaStatus, isAdmin, loginAdmin, logoutAdmin, rotateAdmin, rotateDevice, revokeDevice, recordDenied, verifyBody, verifyBodyHash, prepareDocument, deleteReport, listAudit, studentStorage, verifyViewerProof, createStudent, registerSource, allowWrite, createPairing,
    createSourceEnrollment, redeemSourceEnrollment, autoEnrollSource, approvePairing, revoke, listGrants, setOwnWrite, setOwnUploadScope, setOwnHealthScope, listStudents,
    studentRemovalPreview, archiveStudent, restoreStudent, relinquishViewerStudent, uploadReport, checkSourceReports, listReports, getReport,
    uploadDocument, listDocuments, getDocument, updateDocument,
    issueV2Grant, revokeV2Grant, listV2Grants, uploadStudentProfile, getStudentProfile, getStudentProfileStatus,
    recordBinding, recordTransferReceipt, listSyncEvents, prepareV2Material, listV2Materials, getV2Material, getV2MaterialIndexStatus,
    prepareHealthRecord, listHealthRecords, getHealthRecord,
    claimMaterialIndexJob, completeMaterialIndexJob, failMaterialIndexJob, materialIndexSummary,
    registerOAuthClient, authorizeOAuth, exchangeOAuthCode, revokeOAuthToken, oauthAuthorizationServerMetadata, oauthProtectedResourceMetadata,
    issueRemoteAgentSession, revokeRemoteAgentSession, listRemoteAgentMaterials, searchRemoteAgentMaterials, getRemoteAgentMaterial, getRemoteAgentStudentProfile,
    remoteAgentStatusForHost, remoteAgentAcknowledge, submitInboxResult, getInboxSubmissionStatus, listInbox,
    leaseInboxSubmission, getInboxAttachment, settleInboxSubmission, listRemoteOperations };
}

module.exports = { createService, digest, MAX_REPORT_BYTES, MAX_DOCUMENT_BYTES, CODE_LIFETIME_MS, ADMIN_SESSION_LIFETIME_MS, DEFAULT_MAX_STUDENT_BYTES };
