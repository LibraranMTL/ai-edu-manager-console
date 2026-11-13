'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { DatabaseSync } = require('node:sqlite');
const { createProjectStateStore, migrateLegacyProjects, MAX_PAGE_SIZE } = require('../electron/project-state-store.cjs');
const { createProjectStateIoClient } = require('../electron/project-state-io-client.cjs');

function fixture(count = 3) {
  return [{
    id: 'project-alpha', name: 'Alpha 项目', type: '学习项目', status: 'active', updatedAt: '2026-10-21T00:00:00.000Z',
    studentIds: ['student-1'], studentNames: ['学生一'], assetIds: ['asset-1'],
    workspaceScanSnapshot: { '资料/a.md': { size: 12, mtimeMs: 4 } },
    stagingItems: Array.from({ length: count }, (_, index) => ({
      id: `stage-${index}`, filename: `资料-${index}.md`, path: `D:/资料/${index}.md`, sourcePath: `D:/来源/${index}.md`,
      status: index % 2 ? 'screened' : 'collected', reviewStatus: 'pending', sha1: String(index).padStart(40, 'a'),
      sha256: String(index).padStart(64, 'b'), size: index + 10, updatedAt: `2026-10-21T00:00:0${index}.000Z`,
      governanceAction: index === 1 ? '人工核对' : '',
    })),
  }];
}

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-project-store-'));
  const legacyJsonPath = path.join(root, 'projects.json');
  const dbPath = path.join(root, 'project-state.sqlite3');
  fs.writeFileSync(legacyJsonPath, JSON.stringify({ version: 1, projects: fixture() }), 'utf8');
  return { root, legacyJsonPath, dbPath };
}

test('project initialization worker releases SQLite before announcing completion', async () => {
  const paths = setup();
  let worker;
  try {
    worker = new Worker(path.join(__dirname, '../electron/project-state-worker.cjs'), {
      workerData: { dbPath: paths.dbPath, legacyJsonPath: paths.legacyJsonPath },
    });
    const result = await new Promise((resolve, reject) => {
      worker.once('message', resolve);
      worker.once('error', reject);
    });
    assert.equal(result.ok, true);
    // This mirrors the main-process handoff: the durable connection opens as
    // soon as the completion message arrives.  It must never wait on a native
    // SQLite lock still owned by the initialization Worker.
    const store = createProjectStateStore({ ...paths, quickCheck: false });
    store.initialize();
    assert.equal(store.listMetadata().length, 1);
    store.close();
  } finally {
    await worker?.terminate().catch(() => {});
    fs.rmSync(paths.root, { recursive: true, force: true });
  }
});

test('concurrent project migration never replaces an opened winning database', async () => {
  const paths = setup(), workers = [];
  try {
    const jobs = Array.from({ length: 4 }, () => {
      const worker = new Worker(path.join(__dirname, '../electron/project-state-worker.cjs'), { workerData: paths });
      workers.push(worker);
      return new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
    });
    const results = await Promise.all(jobs);
    assert.ok(results.every(result => result.ok && result.projectCount === 1), JSON.stringify(results));
    const store = createProjectStateStore(paths); store.initialize();
    assert.equal(store.get('project-alpha').stagingItems.length, 3);
    assert.equal(store.integrityCheck().ok, true); store.close();
    assert.equal(JSON.parse(fs.readFileSync(paths.legacyJsonPath, 'utf8')).projects.length, 1);
  } finally {
    await Promise.all(workers.map(worker => worker.terminate().catch(() => {})));
    fs.rmSync(paths.root, { recursive: true, force: true });
  }
});

test('migration collision preserves an existing database with different source provenance', () => {
  const paths = setup();
  try {
    migrateLegacyProjects(paths);
    const oldSource = fs.readFileSync(paths.legacyJsonPath, 'utf8');
    fs.writeFileSync(paths.legacyJsonPath, JSON.stringify({ version: 1, projects: [{ id: 'other', name: 'other' }] }));
    assert.throws(() => migrateLegacyProjects(paths), { code: 'project_migration_conflict' });
    const store = createProjectStateStore(paths); store.initialize();
    assert.equal(store.get('project-alpha').stagingItems.length, 3); assert.equal(store.get('other'), null);
    assert.equal(store.integrityCheck().ok, true); store.close();
    assert.notEqual(fs.readFileSync(paths.legacyJsonPath, 'utf8'), oldSource);
  } finally { fs.rmSync(paths.root, { recursive: true, force: true }); }
});

test('unsupported hard links fail closed with source backup and allow a later retry', () => {
  const paths = setup(), originalLink = fs.linkSync;
  try {
    const source = fs.readFileSync(paths.legacyJsonPath);
    fs.linkSync = () => { throw Object.assign(new Error('hard links unavailable'), { code: 'ENOTSUP' }); };
    let failure;
    try { migrateLegacyProjects(paths); } catch (error) { failure = error; }
    assert.equal(failure?.code, 'project_migration_hardlink_unsupported'); assert.match(failure.message, /原始项目索引和备份已保留/); assert.ok(failure.backupPath);
    assert.deepEqual(fs.readFileSync(paths.legacyJsonPath), source);
    assert.deepEqual(fs.readFileSync(failure.backupPath), source);
    assert.equal(fs.existsSync(paths.dbPath), false);
    assert.equal(fs.readdirSync(paths.root).some(name => name.includes('.migrating-')), false);
    fs.linkSync = originalLink;
    const result = migrateLegacyProjects(paths); assert.equal(result.projectCount, 1);
    const store = createProjectStateStore(paths); store.initialize();
    assert.equal(store.get('project-alpha').stagingItems.length, 3); assert.equal(store.integrityCheck().ok, true); store.close();
  } finally { fs.linkSync = originalLink; fs.rmSync(paths.root, { recursive: true, force: true }); }
});

for (const oldVersion of [1, 2]) test(`synthetic schema v${oldVersion} upgrade backs up and can restore the old database`, () => {
  const paths = setup();
  try {
    const initial = createProjectStateStore(paths); initial.initialize(); initial.close();
    const db = new DatabaseSync(paths.dbPath);
    db.exec(`DROP TABLE IF EXISTS project_staging_search_rows;
      ${oldVersion === 1 ? `DROP TRIGGER IF EXISTS project_staging_counts_ai; DROP TRIGGER IF EXISTS project_staging_counts_ad;
        DROP TRIGGER IF EXISTS project_staging_counts_au; DROP TABLE IF EXISTS project_staging_counts;` : ''}
      PRAGMA user_version=${oldVersion};`);
    db.close();
    const upgraded = createProjectStateStore(paths); upgraded.initialize();
    assert.equal(upgraded.get('project-alpha').stagingItems.length, 3); assert.equal(upgraded.integrityCheck().ok, true); upgraded.close();
    const backup = fs.readdirSync(paths.root).find(name => name.includes(`.pre-schema-v${oldVersion + 1}-`));
    assert.ok(backup); const saved = new DatabaseSync(path.join(paths.root, backup), { readOnly: true });
    assert.equal(saved.prepare('PRAGMA user_version').get().user_version, oldVersion);
    assert.equal(saved.prepare('SELECT COUNT(*) AS n FROM project_staging_items').get().n, 3); saved.close();
    const restoredPath = path.join(paths.root, `restored-v${oldVersion}.sqlite3`);
    fs.copyFileSync(path.join(paths.root, backup), restoredPath);
    const restored = createProjectStateStore({ dbPath: restoredPath, legacyJsonPath: paths.legacyJsonPath }); restored.initialize();
    assert.equal(restored.get('project-alpha').stagingItems.length, 3); assert.equal(restored.integrityCheck().ok, true); restored.close();
  } finally { fs.rmSync(paths.root, { recursive: true, force: true }); }
});

test('migrates project json without modifying the source and preserves detached collections', () => {
  const paths = setup();
  try {
    const before = fs.readFileSync(paths.legacyJsonPath, 'utf8');
    const result = migrateLegacyProjects(paths);
    assert.equal(result.projectCount, 1);
    assert.equal(result.stagingCount, 3);
    assert.equal(fs.readFileSync(paths.legacyJsonPath, 'utf8'), before);
    assert.ok(fs.existsSync(result.backupPath));
    const store = createProjectStateStore(paths); store.initialize();
    const metadata = store.listMetadata();
    assert.equal(metadata[0].stagingItems.length, 0);
    assert.deepEqual(metadata[0].studentIds, ['student-1']);
    assert.deepEqual(metadata[0].assetIds, ['asset-1']);
    const project = store.get('project-alpha');
    assert.equal(project.stagingItems.length, 3);
    assert.deepEqual(project.workspaceScanSnapshot['资料/a.md'], { size: 12, mtimeMs: 4 });
    store.close();
  } finally { fs.rmSync(paths.root, { recursive: true, force: true }); }
});

test('pages and filters project staging items without returning the full collection', () => {
  const paths = setup();
  try {
    const store = createProjectStateStore(paths); store.initialize();
    const first = store.listStaging({ projectId: 'project-alpha', pageSize: 2 });
    assert.equal(first.items.length, 2);
    assert.equal(first.total, 3);
    assert.ok(first.nextCursor);
    const second = store.listStaging({ projectId: 'project-alpha', pageSize: 2, cursor: first.nextCursor });
    assert.equal(second.items.length, 1);
    assert.equal(second.nextCursor, '');
    const filtered = store.listStaging({ projectId: 'project-alpha', status: 'screened', query: '资料-1' });
    assert.equal(filtered.total, 1);
    assert.equal(filtered.items[0].id, 'stage-1');
    assert.ok(MAX_PAGE_SIZE <= 100);
    store.close();
  } finally { fs.rmSync(paths.root, { recursive: true, force: true }); }
});

test('replaceAll updates project rows transactionally and keeps non-empty sha256 values', () => {
  const paths = setup();
  try {
    const store = createProjectStateStore(paths); store.initialize();
    const projects = store.readAll();
    projects[0].description = '更新后的描述';
    projects[0].stagingItems[0].sha256 = '';
    store.replaceAll(projects);
    assert.equal(store.get('project-alpha').description, '更新后的描述');
    const preserved = store.listStaging({ projectId: 'project-alpha', query: '资料-0' }).items[0];
    assert.equal(preserved.sha256, fixture()[0].stagingItems[0].sha256);
    store.close();
  } finally { fs.rmSync(paths.root, { recursive: true, force: true }); }
});

test('upsert only replaces the targeted project and preserves unrelated rows', () => {
  const paths = setup();
  try {
    const store = createProjectStateStore(paths); store.initialize();
    const second = {
      ...fixture(1)[0], id: 'project-beta', name: 'Beta 项目',
      stagingItems: [{ ...fixture(1)[0].stagingItems[0], id: 'beta-stage', filename: 'beta.md' }],
    };
    store.upsert(second);
    const alphaBefore = store.get('project-alpha');
    const changed = { ...alphaBefore, description: '单记录更新', stagingItems: alphaBefore.stagingItems.slice(0, 2) };
    store.upsert(changed);
    assert.equal(store.get('project-alpha').description, '单记录更新');
    assert.equal(store.get('project-alpha').stagingItems.length, 2);
    assert.equal(store.get('project-beta').name, 'Beta 项目');
    assert.equal(store.get('project-beta').stagingItems[0].id, 'beta-stage');
    assert.equal(store.listMetadata().length, 2);
    assert.equal(store.remove('project-beta'), 1);
    assert.equal(store.get('project-beta'), null);
    store.close();
  } finally { fs.rmSync(paths.root, { recursive: true, force: true }); }
});

test('patchProjectMetadata updates one project row without touching staging, scan or FTS rows', () => {
  const paths = setup();
  try {
    const store = createProjectStateStore(paths); store.initialize();
    const before = store.get('project-alpha');
    const updated = store.patchProjectMetadata('project-alpha', {
      materialAutomation: { lastStatus: 'succeeded', lastMessage: 'done' },
      updatedAt: '2026-10-23T00:00:00.000Z',
    }, before.revision);
    assert.equal(updated.revision, before.revision + 1);
    assert.equal(updated.materialAutomation.lastStatus, 'succeeded');
    const after = store.get('project-alpha');
    assert.equal(after.stagingItems.length, before.stagingItems.length);
    assert.deepEqual(after.workspaceScanSnapshot, before.workspaceScanSnapshot);
    assert.equal(store.listStaging({ projectId: 'project-alpha', query: '资料-1' }).total, 1);
    assert.throws(() => store.patchProjectMetadata('project-alpha', { stagingItems: [] }),
      error => error.code === 'project_metadata_patch_forbidden');
    assert.throws(() => store.patchProjectMetadata('project-alpha', { description: 'stale' }, before.revision),
      error => error.code === 'project_revision_conflict');
    store.close();
    const db = new DatabaseSync(paths.dbPath, { readOnly: true });
    assert.equal(Number(db.prepare('SELECT COUNT(*) count FROM project_staging_search WHERE project_id=?').get('project-alpha').count), 3);
    assert.equal(Number(db.prepare('SELECT COUNT(*) count FROM project_workspace_scan_entries WHERE project_id=?').get('project-alpha').count), 1);
    db.close();
  } finally { fs.rmSync(paths.root, { recursive: true, force: true }); }
});

test('metadata graph updates preserve staging and scan rows and full reads require a declared purpose', () => {
  const paths = setup();
  try {
    const store = createProjectStateStore(paths); store.initialize();
    const before = store.getMetadata('project-alpha');
    const updated = store.upsertProjectMetadata({ ...before, name: 'Alpha 新名称', assetIds: ['asset-1', 'asset-2'] }, before.revision);
    assert.equal(updated.name, 'Alpha 新名称');
    assert.deepEqual(updated.assetIds, ['asset-1', 'asset-2']);
    assert.equal(store.listStaging({ projectId: 'project-alpha' }).total, 3);
    assert.equal(store.listWorkspaceScanEntries({ projectId: 'project-alpha', pageSize: 100 }).total, 1);
    assert.equal(store.getTaskProjection('project-alpha').id, 'project-alpha');
    assert.throws(() => store.readFullProjectSnapshot('project-alpha'), error => error.code === 'project_full_read_forbidden');
    assert.equal(store.readFullProjectSnapshot('project-alpha', { purpose: 'diagnostic' }).stagingItems.length, 3);
    store.close();
  } finally { fs.rmSync(paths.root, { recursive: true, force: true }); }
});

test('bounded staging and workspace scan mutations never write more than 100 rows', () => {
  const paths = setup();
  try {
    fs.writeFileSync(paths.legacyJsonPath, JSON.stringify({ version: 1, projects: fixture(130) }), 'utf8');
    const store = createProjectStateStore(paths); store.initialize();
    const staged = store.mutateStagingBatch({ projectId: 'project-alpha', selection: 'filter',
      patch: { reviewStatus: 'accepted', reviewNote: 'bounded' } });
    assert.equal(staged.affected, 100);
    assert.equal(store.stagingSummary('project-alpha').byReviewStatus.accepted, 100);
    const scan = store.upsertWorkspaceScanBatch({ projectId: 'project-alpha',
      entries: Array.from({ length: 120 }, (_, index) => ({ path: `资料/${index}.md`, value: { size: index } })) });
    assert.equal(scan.affected, 100);
    assert.equal(Object.keys(store.get('project-alpha').workspaceScanSnapshot).length, 101);
    assert.deepEqual(store.integrityCheck(), { ok: true, integrity: 'ok', foreignKeyErrors: [] });
    assert.equal(store.replaceProjectSnapshot(fixture()[0], { purpose: 'restore' }).id, 'project-alpha');
    assert.throws(() => store.replaceProjectSnapshot(fixture()[0]),
      error => error.code === 'project_full_replace_forbidden');
    store.close();
  } finally { fs.rmSync(paths.root, { recursive: true, force: true }); }
});

test('project state IO worker owns bounded writes and returns limited projections', async () => {
  const paths = setup();
  const bootstrap = createProjectStateStore(paths); bootstrap.initialize(); bootstrap.close();
  const client = createProjectStateIoClient(paths);
  try {
    const patched = await client.request('patch_metadata', { projectId: 'project-alpha',
      patch: { materialAutomation: { lastStatus: 'succeeded' } } });
    assert.equal(patched.materialAutomation.lastStatus, 'succeeded');
    assert.equal(patched.stagingItems.length, 0);
    const mutated = await client.request('mutate_staging_batch', { projectId: 'project-alpha',
      itemIds: ['stage-0', 'stage-1'], patch: { reviewStatus: 'accepted' } });
    assert.equal(mutated.affected, 2);
    assert.ok(mutated.items.length <= MAX_PAGE_SIZE);
    const metadata = await client.request('upsert_metadata', { project: {
      ...patched, assetIds: ['asset-1', 'asset-worker'], studentIds: ['student-1'], studentNames: ['学生一'],
    }, expectedRevision: mutated.revision });
    assert.deepEqual(metadata.assetIds, ['asset-1', 'asset-worker']);
    assert.equal((await client.request('integrity')).ok, true);
  } finally {
    await client.close();
    fs.rmSync(paths.root, { recursive: true, force: true });
  }
});
