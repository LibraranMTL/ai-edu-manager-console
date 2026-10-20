'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { createAssetIndexStore } = require('../electron/asset-index-store.cjs');

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function timed(samples, fn) {
  fn();
  const values = [];
  for (let index = 0; index < samples; index += 1) {
    const start = performance.now();
    fn();
    values.push(performance.now() - start);
  }
  return { samples: values.map(value => Number(value.toFixed(3))), p95Ms: Number(percentile(values, 0.95).toFixed(3)) };
}

function benchmark(count) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `edu-asset-benchmark-${count}-`));
  const dbPath = path.join(root, 'asset-index.sqlite3');
  const legacyJsonPath = path.join(root, 'asset-index.json');
  fs.writeFileSync(legacyJsonPath, '{"version":1,"assets":[]}', 'utf8');
  const store = createAssetIndexStore({ dbPath, legacyJsonPath });
  try {
    store.initialize();
    const db = store.db;
    const insertAsset = db.prepare(`INSERT INTO assets(
      asset_id,sha1,sha256,filename,byte_size,asset_type,canonical_path,
      owner_student_id,owner_student_name,source_path,source_name,source_type,
      status,uploaded_at,created_at,updated_at,record_json
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insertReference = db.prepare(`INSERT INTO asset_references(
      reference_id,asset_id,space_type,space_id,space_name,workspace_id,student_id,
      device_id,content_sha256,logical_path,role,path,source,linked_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const started = performance.now();
    db.exec('BEGIN IMMEDIATE');
    for (let index = 0; index < count; index += 1) {
      const id = `asset-${String(index).padStart(10, '0')}`;
      const studentId = `student-${index % 100}`;
      const filename = `资料-${index % 10000}.pdf`;
      const updatedAt = new Date(1_700_000_000_000 + index * 1000).toISOString();
      const sha1 = index.toString(16).padStart(40, '0');
      const sha256 = index.toString(16).padStart(64, '0');
      const filePath = `D:\\合成资料\\${studentId}\\${filename}-${index}`;
      insertAsset.run(id, sha1, sha256, filename, 1024 + (index % 8192), index % 5 ? 'pdf' : 'text', filePath,
        studentId, `学生${index % 100}`, '', `来源${index % 12}`, 'benchmark', 'active', updatedAt, updatedAt, updatedAt,
        JSON.stringify({ assetId: id, sha1, sha256, filename, path: filePath, ownerStudentId: studentId, updatedAt }));
      insertReference.run(`ref-${index}`, id, 'student', studentId, `学生${index % 100}`, '', studentId,
        `device-${index % 8}`, sha256, `raw/${filename}`, 'raw', filePath, 'benchmark', updatedAt);
    }
    db.exec('COMMIT');
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const populatedMs = performance.now() - started;
    const coldSummaryStarted = performance.now();
    store.summary();
    const coldSummaryMs = performance.now() - coldSummaryStarted;
    const summary = timed(7, () => store.summary());
    const firstPage = timed(7, () => store.listAssets({ pageSize: 50 }));
    const studentPage = timed(7, () => store.listAssets({ studentId: 'student-42', pageSize: 50 }));
    const health = Object.values(db.prepare('PRAGMA integrity_check').get())[0];
    return { count, populatedMs: Number(populatedMs.toFixed(1)), databaseBytes: fs.statSync(dbPath).size,
      coldSummaryMs: Number(coldSummaryMs.toFixed(3)),
      summary, firstPage, studentPage, integrityCheck: health };
  } finally {
    try { store.close(); } catch {}
    const resolvedRoot = path.resolve(root);
    if (path.dirname(resolvedRoot) === path.resolve(os.tmpdir()) && path.basename(resolvedRoot).startsWith('edu-asset-benchmark-')) {
      fs.rmSync(resolvedRoot, { recursive: true, force: true });
    }
  }
}

const counts = process.argv.slice(2).map(Number).filter(value => Number.isSafeInteger(value) && value > 0);
const report = { generatedAt: new Date().toISOString(), platform: process.platform, node: process.version,
  results: (counts.length ? counts : [100000, 1000000]).map(benchmark) };
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
