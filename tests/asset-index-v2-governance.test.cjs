const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createAssetIndexStore } = require('../electron/asset-index-store.cjs');
const { createAssetDuplicateGovernance } = require('../electron/asset-duplicate-governance.cjs');

function tempStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-assets-v2-'));
  const dbPath = path.join(root, 'asset-index.sqlite3');
  const legacyJsonPath = path.join(root, 'asset-index.json');
  fs.writeFileSync(legacyJsonPath, JSON.stringify({ version: 1, assets: [] }));
  const store = createAssetIndexStore({ dbPath, legacyJsonPath });
  store.initialize();
  return { root, dbPath, legacyJsonPath, store };
}

function hashes(content) {
  return {
    sha1: crypto.createHash('sha1').update(content).digest('hex'),
    sha256: crypto.createHash('sha256').update(content).digest('hex'),
  };
}

test('v1 schema upgrades in place, keeps a snapshot, and backfills consistent SHA-256', () => {
  const value = tempStore();
  const fingerprint = hashes('v1-content');
  value.store.upsertAsset({ assetId: 'asset-v1', sha1: fingerprint.sha1, filename: 'v1.txt', path: 'D:\\v1.txt' }, [
    { id: 'ref-v1', spaceType: 'student', spaceId: 's1', studentId: 's1', role: 'raw', path: 'D:\\v1.txt', contentSha256: fingerprint.sha256 },
  ]);
  value.store.close();
  const raw = new DatabaseSync(value.dbPath);
  raw.exec(`DROP TRIGGER IF EXISTS asset_refs_summary_au;
    DROP TRIGGER IF EXISTS asset_refs_summary_ad; DROP TRIGGER IF EXISTS asset_refs_summary_ai;
    DROP TRIGGER IF EXISTS assets_summary_au; DROP TRIGGER IF EXISTS assets_summary_ai;
    DROP TRIGGER IF EXISTS asset_summary_rows_ad; DROP TRIGGER IF EXISTS asset_summary_rows_au;
    DROP TRIGGER IF EXISTS asset_summary_rows_ai;
    DROP TABLE IF EXISTS asset_student_memberships; DROP TABLE IF EXISTS asset_summary_rows;
    DROP TABLE IF EXISTS asset_summary_facets; DROP TABLE IF EXISTS asset_summary_totals;
    DROP INDEX IF EXISTS asset_refs_asset_state_path;
    DROP INDEX IF EXISTS asset_refs_space_state_asset;
    DROP INDEX IF EXISTS asset_refs_student_state_asset;
    DROP TABLE asset_duplicate_entries; DROP TABLE asset_duplicate_operations;
    ALTER TABLE asset_references DROP COLUMN quarantine_operation_id;
    ALTER TABLE asset_references DROP COLUMN state;
    ALTER TABLE asset_scan_runs DROP COLUMN current_scope_name;
    ALTER TABLE asset_scan_runs DROP COLUMN current_scope_id;
    ALTER TABLE asset_scan_runs DROP COLUMN current_scope_type;
    ALTER TABLE asset_scan_runs DROP COLUMN phase_processed;
    ALTER TABLE asset_scan_runs DROP COLUMN phase_total;
    UPDATE assets SET sha256=''; PRAGMA user_version=1;`);
  raw.close();
  const upgraded = createAssetIndexStore({ dbPath: value.dbPath, legacyJsonPath: value.legacyJsonPath });
  try {
    const store = upgraded.initialize();
    assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, 4);
    assert.equal(store.getAssetDetail('asset-v1').sha256, fingerprint.sha256);
    assert.equal(store.getAssetDetail('asset-v1').references[0].state, 'active');
    assert.equal(store.getAssetDetail('asset-v1').references[0].availabilityState, 'unchecked');
    assert.equal(store.summary().sha256ReadyCount, 1);
    assert.equal(fs.readdirSync(value.root).filter(name => name.includes('.pre-schema-v2-')).length, 1);
    assert.equal(fs.readdirSync(value.root).filter(name => name.includes('.pre-schema-v3-')).length, 1);
    assert.equal(fs.readdirSync(value.root).filter(name => name.includes('.pre-schema-v4-')).length, 1);
  } finally {
    upgraded.close();
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});

test('empty fingerprints never overwrite known SHA-256 and conflicts are stopped', () => {
  const value = tempStore();
  try {
    value.store.upsertAsset({ assetId: 'asset-1', sha1: '1'.repeat(40), sha256: 'a'.repeat(64), filename: 'known.txt', path: 'D:\\known.txt' }, [
      { id: 'r1', spaceType: 'student', spaceId: 's1', role: 'raw', path: 'D:\\known.txt', contentSha256: 'a'.repeat(64) },
    ]);
    value.store.upsertAsset({ assetId: 'asset-1', sha1: '1'.repeat(40), sha256: '', filename: 'known.txt', path: 'D:\\known.txt' }, [
      { id: 'r2', spaceType: 'student', spaceId: 's1', role: 'raw', path: 'D:\\known.txt', contentSha256: '' },
    ]);
    const preserved = value.store.getAssetDetail('asset-1');
    assert.equal(preserved.sha256, 'a'.repeat(64));
    assert.equal(preserved.references[0].contentSha256, 'a'.repeat(64));
    assert.throws(() => value.store.upsertAsset({ assetId: 'other', sha1: '1'.repeat(40), sha256: 'b'.repeat(64) }), error => error.code === 'asset_fingerprint_conflict');
    assert.equal(value.store.getAssetDetail('asset-1').governanceStatus, 'fingerprint_conflict');
  } finally {
    value.store.close();
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});

test('same-space duplicate can be quarantined and restored while cross-space assets stay protected', async () => {
  const value = tempStore();
  const studentRoot = path.join(value.root, 'student');
  const first = path.join(studentRoot, 'first.txt');
  const second = path.join(studentRoot, 'second.txt');
  fs.mkdirSync(studentRoot);
  fs.writeFileSync(first, 'same-content');
  fs.writeFileSync(second, 'same-content');
  const fingerprint = hashes('same-content');
  value.store.upsertAsset({ assetId: 'asset-dup', ...fingerprint, filename: 'first.txt', size: 12, path: first }, [
    { id: 'r1', spaceType: 'student', spaceId: 's1', studentId: 's1', role: 'student_raw_scanned', path: first, contentSha256: fingerprint.sha256 },
    { id: 'r2', spaceType: 'student', spaceId: 's1', studentId: 's1', role: 'student_raw_scanned', path: second, contentSha256: fingerprint.sha256 },
  ]);
  const governance = createAssetDuplicateGovernance({
    store: value.store,
    quarantineRoot: path.join(value.root, 'quarantine'),
    authorizedRoots: () => [{ spaceType: 'student', spaceId: 's1', path: studentRoot }],
  });
  try {
    const preview = await governance.prepare({ assetIds: ['asset-dup'] });
    assert.equal(preview.summary.eligibleCount, 1);
    const secondPreview = await governance.prepare({ assetIds: ['asset-dup'] });
    assert.equal(secondPreview.summary.eligibleCount, 1);
    assert.notEqual(secondPreview.entries[0].entryId, preview.entries[0].entryId);
    const result = await governance.apply(preview.operationId, preview.entries.map(item => item.entryId));
    assert.equal(result.status, 'completed');
    const entry = result.entries[0];
    assert.equal(fs.existsSync(entry.sourcePath), false);
    assert.equal(fs.existsSync(entry.quarantinePath), true);
    assert.equal(value.store.getAssetDetail('asset-dup').references.filter(ref => ref.state === 'active').length, 1);
    const restored = await governance.restore(preview.operationId, [entry.entryId]);
    assert.equal(restored.status, 'restored');
    assert.equal(fs.existsSync(entry.sourcePath), true);

    const projectRoot = path.join(value.root, 'project');
    const third = path.join(projectRoot, 'third.txt');
    fs.mkdirSync(projectRoot); fs.writeFileSync(third, 'same-content');
    value.store.upsertAsset({ assetId: 'asset-dup', ...fingerprint, filename: 'first.txt', size: 12, path: first }, [
      { id: 'r3', spaceType: 'project', spaceId: 'p1', role: 'project_raw_scanned', path: third, contentSha256: fingerprint.sha256 },
    ]);
    const protectedGovernance = createAssetDuplicateGovernance({
      store: value.store,
      quarantineRoot: path.join(value.root, 'quarantine-2'),
      authorizedRoots: () => [
        { spaceType: 'student', spaceId: 's1', path: studentRoot },
        { spaceType: 'project', spaceId: 'p1', path: projectRoot },
      ],
    });
    const protectedPreview = await protectedGovernance.prepare({ assetIds: ['asset-dup'] });
    assert.equal(protectedPreview.summary.eligibleCount, 0);
    assert.match(protectedPreview.summary.blocked[0].reason, /跨学生或项目空间/);
  } finally {
    value.store.close();
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});

test('duplicate history is paged and failed isolation can be revalidated into a new preview', async () => {
  const value = tempStore();
  const studentRoot = path.join(value.root, 'student-retry');
  const first = path.join(studentRoot, 'first.txt');
  const second = path.join(studentRoot, 'second.txt');
  fs.mkdirSync(studentRoot);
  fs.writeFileSync(first, 'retry-content');
  fs.writeFileSync(second, 'retry-content');
  const fingerprint = hashes('retry-content');
  value.store.upsertAsset({ assetId: 'asset-retry', ...fingerprint, filename: 'first.txt', size: 13, path: first }, [
    { id: 'retry-r1', spaceType: 'student', spaceId: 's1', studentId: 's1', role: 'student_raw_scanned', path: first, contentSha256: fingerprint.sha256 },
    { id: 'retry-r2', spaceType: 'student', spaceId: 's1', studentId: 's1', role: 'student_raw_scanned', path: second, contentSha256: fingerprint.sha256 },
  ]);
  const governance = createAssetDuplicateGovernance({
    store: value.store,
    quarantineRoot: path.join(value.root, 'quarantine-retry'),
    authorizedRoots: () => [{ spaceType: 'student', spaceId: 's1', path: studentRoot }],
  });
  try {
    const preview = await governance.prepare({ assetIds: ['asset-retry'] });
    const entry = preview.entries[0];
    fs.rmSync(entry.keepPath);
    const failed = await governance.apply(preview.operationId, [entry.entryId]);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.entries[0].status, 'failed');
    fs.writeFileSync(entry.keepPath, 'retry-content');
    const history = governance.history({ pageSize: 1 });
    assert.equal(history.ok, true);
    assert.equal(history.items.length, 1);
    assert.equal(history.items[0].failedCount, 1);
    const retried = await governance.retry(preview.operationId);
    assert.notEqual(retried.operationId, preview.operationId);
    assert.equal(retried.summary.eligibleCount, 1);
    assert.equal(retried.filter.retryOfOperationId, preview.operationId);
  } finally {
    value.store.close();
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});
