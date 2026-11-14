'use strict';

const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const REQUIRED_TABLES = Object.freeze([
  'student_profile_revisions', 'student_profile_current', 'v2_grants', 'device_student_bindings',
  'transfer_receipts', 'sync_events', 'remote_agent_sessions', 'cloud_inbox_submissions', 'schema_migrations',
  'material_current', 'material_index_jobs', 'material_search_documents', 'material_search_fts',
  'oauth_clients', 'oauth_authorization_codes', 'oauth_access_tokens',
  'source_auto_bindings', 'health_records', 'cloud_inbox_attachments',
]);
const REQUIRED_COLUMNS = Object.freeze({
  devices: ['public_key', 'revoked_at'],
  grants: ['expires_at', 'enabled'],
  documents: ['material_category', 'material_id', 'revision_id', 'idempotency_key', 'project_id', 'scope_fingerprint'],
  remote_agent_sessions: ['task_id', 'execution_id', 'task_type', 'idempotency_key', 'status', 'result_submission_id', 'updated_at', 'student_ids_json'],
  cloud_inbox_submissions: ['student_ids_json'],
  health_records: ['health_record_id', 'revision_id', 'idempotency_key', 'deleted_at'],
  cloud_inbox_attachments: ['submission_id', 'attachment_id', 'content_sha256', 'object_name'],
});

function safeCount(db, table) {
  try { return Number(db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get().count || 0); }
  catch { return null; }
}

function previewCloudV2Migration(dbPath) {
  if (!dbPath || !fs.existsSync(dbPath)) throw new Error('SQLite database path does not exist');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    const missingTables = REQUIRED_TABLES.filter(table => !tables.has(table));
    const missingColumns = [];
    for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
      if (!tables.has(table)) continue;
      const current = new Set(db.prepare(`PRAGMA table_info("${table}")`).all().map(column => column.name));
      for (const column of columns) if (!current.has(column)) missingColumns.push(`${table}.${column}`);
    }
    const counts = {};
    for (const table of ['students', 'devices', 'grants', 'reports', 'documents']) if (tables.has(table)) counts[table] = safeCount(db, table);
    const risks = [];
    if ((counts.documents || 0) > 0 && missingColumns.some(item => item.startsWith('documents.'))) {
      risks.push('legacy_documents_require_v2_metadata_defaults');
    }
    if ((counts.grants || 0) > 0 && missingTables.includes('v2_grants')) risks.push('legacy_grants_remain_v1_until_explicit_v2_authorization');
    if ((counts.devices || 0) > 0 && missingColumns.includes('devices.public_key')) risks.push('legacy_devices_require_key_registration_before_signed_requests');
    return { mode: 'read-only', database: 'cloud-reports.sqlite', targetContractVersion: 2,
      migrationId: 'cloud-contract-v2', missingTables, missingColumns, counts, risks,
      safeToStart: true, destructiveChanges: [], generatedAt: new Date().toISOString() };
  } finally { db.close(); }
}

if (require.main === module) {
  try { process.stdout.write(`${JSON.stringify(previewCloudV2Migration(process.argv[2]), null, 2)}\n`); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}

module.exports = { previewCloudV2Migration, REQUIRED_TABLES, REQUIRED_COLUMNS };
