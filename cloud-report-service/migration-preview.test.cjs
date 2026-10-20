'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { previewCloudV2Migration } = require('./migration-preview.cjs');
const { createService } = require('./service.cjs');

test('migration preview is read-only and identifies a legacy v1 database', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-cloud-migration-preview-'));
  const dbPath = path.join(root, 'cloud-reports.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE students(id TEXT PRIMARY KEY,display_name TEXT,created_at INTEGER);
    CREATE TABLE devices(id TEXT PRIMARY KEY,kind TEXT,token_hash TEXT,created_at INTEGER);
    CREATE TABLE grants(device_id TEXT,student_id TEXT,scope TEXT,revoked_at INTEGER,created_at INTEGER);
    CREATE TABLE documents(id TEXT PRIMARY KEY,student_id TEXT,origin_device_id TEXT,display_name TEXT,content_type TEXT,
      content_sha256 TEXT,byte_size INTEGER,object_name TEXT,created_at INTEGER,deleted_at INTEGER);`);
  db.close();
  const before = fs.statSync(dbPath).size;
  const preview = previewCloudV2Migration(dbPath);
  assert.equal(preview.mode, 'read-only');
  assert.equal(preview.targetContractVersion, 2);
  assert.ok(preview.missingTables.includes('v2_grants'));
  assert.ok(preview.missingColumns.includes('documents.revision_id'));
  assert.deepEqual(preview.destructiveChanges, []);
  assert.equal(fs.statSync(dbPath).size, before);
  const verify = new DatabaseSync(dbPath, { readOnly: true });
  assert.equal(verify.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name='v2_grants'").get().count, 0);
  verify.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test('service records the v2 migration status without disabling v1 compatibility', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-cloud-schema-status-'));
  const service = createService({ dataDir: root, adminToken: 'test-admin-token-at-least-24-characters' });
  assert.deepEqual(service.schemaStatus().contractVersion, 2);
  assert.equal(service.schemaStatus().legacyContractSupported, true);
  assert.equal(service.schemaStatus().applied, true);
  service.close();
  fs.rmSync(root, { recursive: true, force: true });
});
