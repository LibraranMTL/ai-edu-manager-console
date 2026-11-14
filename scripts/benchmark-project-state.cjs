'use strict';

// Synthetic data only. The fixture lives under the system temp directory and
// is removed after each run; no user project or student material is opened.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { DatabaseSync } = require('node:sqlite');
const { createProjectStateStore } = require('../electron/project-state-store.cjs');

function p95(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * .95) - 1)];
}
function measured(samples, operation, warmups = 5) {
  // Release gates measure steady-state interaction latency.  A separate
  // coldSummary measurement above keeps cold-open cost visible, while these
  // warmups prevent SQLite page hydration / antivirus first-touch noise from
  // being mistaken for a repeatable row-update regression.
  for (let index = 0; index < warmups; index += 1) operation();
  const values = [];
  for (let index = 0; index < samples; index += 1) {
    const started = performance.now(); operation(); values.push(performance.now() - started);
  }
  return { warmups, p95Ms: Number(p95(values).toFixed(3)), samples: values.map(value => Number(value.toFixed(3))) };
}

function benchmark(count) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `edu-project-state-benchmark-${count}-`));
  const dbPath = path.join(root, 'project-state.sqlite3');
  const legacyJsonPath = path.join(root, 'projects.json');
  fs.writeFileSync(legacyJsonPath, '{"version":1,"projects":[]}', 'utf8');
  const bootstrap = createProjectStateStore({ dbPath, legacyJsonPath, quickCheck: false });
  bootstrap.initialize(); bootstrap.close();
  const db = new DatabaseSync(dbPath);
  const projectId = `project-${count}`;
  const insert = db.prepare(`INSERT INTO project_staging_items(
    item_id,project_id,filename,path,source_path,status,review_status,sha1,sha256,byte_size,updated_at,revision,payload_json
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertSearch = db.prepare('INSERT INTO project_staging_search(item_id,project_id,filename,path,source,governance) VALUES(?,?,?,?,?,?)');
  const insertSearchRow = db.prepare('INSERT INTO project_staging_search_rows(item_id,project_id,search_rowid) VALUES(?,?,?)');
  const populatedAt = performance.now();
  db.exec('BEGIN IMMEDIATE');
  db.prepare(`INSERT INTO projects(project_id,name,type,status,updated_at,revision,payload_json,legacy_metadata_json)
    VALUES(?,?,?,?,?,?,?,?)`).run(projectId, '合成性能项目', 'benchmark', 'active', '2026-10-21T00:00:00.000Z', 1,
      JSON.stringify({ id: projectId, name: '合成性能项目', type: 'benchmark', status: 'active' }), '{}');
  for (let index = 0; index < count; index += 1) {
    const id = `item-${String(index).padStart(10, '0')}`;
    const filename = `合成资料-${index}.txt`;
    const filePath = `D:\\合成项目\\${filename}`;
    const status = index % 5 ? 'collected' : 'analyzed';
    const review = index % 7 ? 'pending' : 'accepted';
    const updatedAt = new Date(1_700_000_000_000 + index * 1000).toISOString();
    const payload = { id, filename, path: filePath, sourcePath: filePath, status, reviewStatus: review, updatedAt };
    insert.run(id, projectId, filename, filePath, filePath, status, review,
      index.toString(16).padStart(40, '0'), index.toString(16).padStart(64, '0'), 1024 + index % 4096,
      updatedAt, 1, JSON.stringify(payload));
    const searchResult = insertSearch.run(id, projectId, filename, filePath, filePath, '');
    insertSearchRow.run(id, projectId, Number(searchResult.lastInsertRowid));
  }
  db.exec('COMMIT; PRAGMA wal_checkpoint(TRUNCATE)');
  const populatedMs = performance.now() - populatedAt;
  db.close();

  const store = createProjectStateStore({ dbPath, legacyJsonPath, quickCheck: false });
  try {
    const coldStarted = performance.now(); const coldSummary = store.stagingSummary(projectId);
    const coldSummaryMs = performance.now() - coldStarted;
    const summary = measured(7, () => store.stagingSummary(projectId));
    const firstPage = measured(7, () => store.listStaging({ projectId, pageSize: 50 }));
    const filteredPage = measured(7, () => store.listStaging({ projectId, status: 'collected', pageSize: 50 }));
    const search = measured(7, () => store.listStaging({ projectId, query: '合成资料', pageSize: 50 }));
    const first = store.listStaging({ projectId, pageSize: 50 });
    const secondPage = measured(7, () => store.listStaging({ projectId, pageSize: 50, cursor: first.nextCursor }));
    if (coldSummary.total !== count || first.total !== count || first.items.length !== 50) throw new Error('Project benchmark coverage mismatch');
    const beforeMetadataPatch = new DatabaseSync(dbPath, { readOnly: true });
    const untouchedBefore = {
      staging: Number(beforeMetadataPatch.prepare('SELECT COUNT(*) count FROM project_staging_items WHERE project_id=?').get(projectId).count),
      scan: Number(beforeMetadataPatch.prepare('SELECT COUNT(*) count FROM project_workspace_scan_entries WHERE project_id=?').get(projectId).count),
      fts: Number(beforeMetadataPatch.prepare('SELECT COUNT(*) count FROM project_staging_search WHERE project_id=?').get(projectId).count),
    };
    beforeMetadataPatch.close();
    const walPath = `${dbPath}-wal`;
    const walBefore = fs.existsSync(walPath) ? fs.statSync(walPath).size : 0;
    let metadataSequence = 0;
    const metadataPatch = measured(20, () => store.patchProjectMetadata(projectId, {
      materialAutomation: { lastStatus: 'succeeded', lastMessage: `benchmark-${metadataSequence++}` },
      updatedAt: new Date(1_800_000_000_000 + metadataSequence).toISOString(),
    }));
    const walAfterMetadataPatch = fs.existsSync(walPath) ? fs.statSync(walPath).size : 0;
    let stagingSequence = 0;
    const stagingMutation = measured(20, () => store.mutateStagingBatch({ projectId,
      itemIds: Array.from({ length: 100 }, (_, index) => `item-${String(index).padStart(10, '0')}`),
      patch: { reviewStatus: stagingSequence++ % 2 ? 'accepted' : 'pending' },
    }));
    let ftsSequence = 0;
    const ftsMutation = measured(20, () => store.mutateStagingBatch({ projectId,
      itemIds: Array.from({ length: 20 }, (_, index) => `item-${String(index).padStart(10, '0')}`),
      patch: { reviewNote: `benchmark-fts-${ftsSequence++}` },
    }));
    const untouchedAfter = {
      staging: store.stagingSummary(projectId).total,
      scan: Object.keys(store.get(projectId, { includeStaging: false, includeScan: true }).workspaceScanSnapshot).length,
      fts: null,
    };
    const checkpoint = store.checkpoint('TRUNCATE');
    store.close();
    const verify = new DatabaseSync(dbPath, { readOnly: true });
    untouchedAfter.fts = Number(verify.prepare('SELECT COUNT(*) count FROM project_staging_search WHERE project_id=?').get(projectId).count);
    const integrityCheck = Object.values(verify.prepare('PRAGMA integrity_check').get())[0];
    const foreignKeyErrors = verify.prepare('PRAGMA foreign_key_check').all().length; verify.close();
    return { count, populatedMs: Number(populatedMs.toFixed(1)), databaseBytes: fs.statSync(dbPath).size,
      coldSummaryMs: Number(coldSummaryMs.toFixed(3)), summary, firstPage, filteredPage, search, secondPage,
      metadataPatch, stagingMutation, ftsMutation,
      metadataUntouched: JSON.stringify(untouchedBefore) === JSON.stringify(untouchedAfter),
      untouchedBefore, untouchedAfter, metadataWalGrowthBytes: Math.max(0, walAfterMetadataPatch - walBefore),
      checkpoint, walBytesAfterCheckpoint: fs.existsSync(walPath) ? fs.statSync(walPath).size : 0,
      integrityCheck, foreignKeyErrors };
  } finally {
    try { store.close(); } catch {}
    const resolved = path.resolve(root), temp = path.resolve(os.tmpdir());
    if (path.dirname(resolved) === temp && path.basename(resolved).startsWith('edu-project-state-benchmark-')) {
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  }
}

function main(args = process.argv.slice(2)) {
  const counts = args.map(Number).filter(value => Number.isSafeInteger(value) && value > 0);
  const report = { schema: 'edu-manager.project-state-benchmark.v1', generatedAt: new Date().toISOString(),
    machine: { cpu: os.cpus()[0]?.model || '', logicalCpus: os.cpus().length, memoryGiB: Number((os.totalmem() / 1024 ** 3).toFixed(2)) },
    targets: { summaryP95Ms: 200, pageP95Ms: 500, searchP95Ms: 250,
      metadataPatchP95Ms: 20, stagingMutationP95Ms: 250, ftsMutation20P95Ms: 250,
      metadataWalGrowthBytes: 1_000_000,
      idleWalBytes: 64 * 1024 * 1024 },
    results: (counts.length ? counts : [100_000, 1_000_000]).map(benchmark) };
  report.passed = report.results.every(result => result.integrityCheck === 'ok' && result.coldSummaryMs <= 200
    && result.summary.p95Ms <= 200 && result.firstPage.p95Ms <= 500 && result.filteredPage.p95Ms <= 500
    && result.search.p95Ms <= 250 && result.secondPage.p95Ms <= 500
    && result.metadataPatch.p95Ms <= 20 && result.stagingMutation.p95Ms <= 250
    && result.ftsMutation.p95Ms <= 250
    && result.metadataUntouched && result.metadataWalGrowthBytes < 1_000_000
    && result.walBytesAfterCheckpoint <= 64 * 1024 * 1024 && result.foreignKeyErrors === 0);
  const output = args.find(value => value.startsWith('--output='));
  if (output) fs.writeFileSync(path.resolve(output.slice('--output='.length)), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (args.includes('--assert-targets') && !report.passed) process.exitCode = 1;
}

if (require.main === module) main();
module.exports = { benchmark };
