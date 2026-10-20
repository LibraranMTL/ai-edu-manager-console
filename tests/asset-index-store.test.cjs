const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAssetIndexStore } = require('../electron/asset-index-store.cjs');

function fixture(legacy = { version: 1, assets: [] }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-assets-'));
  const legacyJsonPath = path.join(root, 'asset-index.json');
  fs.writeFileSync(legacyJsonPath, JSON.stringify(legacy), 'utf8');
  const store = createAssetIndexStore({
    dbPath: path.join(root, 'asset-index.sqlite3'), legacyJsonPath,
    now: () => Date.parse('2026-10-19T08:00:00.000Z'),
  });
  return { root, legacyJsonPath, store, close() { try { store.close(); } catch {} fs.rmSync(root, { recursive: true, force: true }); } };
}

test('legacy migration merges content identities and preserves aliases and paths', () => {
  const value = fixture({ version: 1, assets: [
    { assetId: 'legacy-b', sha1: 'a'.repeat(40), filename: '副本.pdf', path: 'D:\\资料\\副本.pdf', ownerStudentId: 's1', ownerStudentName: '学生甲', uploadedAt: '2026-10-18T00:00:00.000Z', references: [
      { id: 'r2', spaceType: 'student', spaceId: 's1', role: 'raw', path: 'D:\\资料\\副本.pdf', linkedAt: '2026-10-18T00:00:00.000Z' },
    ] },
    { assetId: `asset-${'a'.repeat(16)}`, sha1: 'a'.repeat(40), filename: '原件.pdf', path: 'D:\\资料\\原件.pdf', ownerStudentId: 's1', ownerStudentName: '学生甲', uploadedAt: '2026-10-17T00:00:00.000Z', references: [
      { id: 'r1', spaceType: 'student', spaceId: 's1', role: 'raw', path: 'D:\\资料\\原件.pdf', linkedAt: '2026-10-17T00:00:00.000Z' },
    ] },
  ] });
  try {
    const summary = value.store.summary({ studentId: 's1' });
    assert.equal(summary.total, 1);
    assert.equal(summary.duplicateGroups, 1);
    const detail = value.store.getAssetDetail('legacy-b');
    assert.equal(detail.assetId, `asset-${'a'.repeat(16)}`);
    assert.deepEqual(detail.aliases, ['legacy-b']);
    assert.equal(detail.references.length, 2);
    assert.ok(fs.existsSync(value.legacyJsonPath));
    assert.equal(fs.readdirSync(value.root).filter(name => name.startsWith('asset-index.pre-sqlite-') && name.endsWith('.json') && !name.endsWith('.manifest.json')).length, 1);
  } finally { value.close(); }
});

test('upsert is idempotent, keeps first linkedAt, and supports scoped pagination and detail loading', () => {
  const value = fixture();
  try {
    value.store.upsertAsset({ assetId: 'asset-1', sha1: '1'.repeat(40), filename: '甲.pdf', path: 'D:\\甲.pdf', ownerStudentId: 's1', sourceName: '上传', updatedAt: '2026-10-19T01:00:00.000Z' }, [
      { id: 'first', spaceType: 'student', spaceId: 's1', studentId: 's1', role: 'raw', path: 'D:\\甲.pdf', linkedAt: '2026-10-18T01:00:00.000Z' },
    ]);
    value.store.upsertAsset({ assetId: 'different-id', sha1: '1'.repeat(40), filename: '甲.pdf', path: 'D:\\甲.pdf', ownerStudentId: 's1', sourceName: '重建', updatedAt: '2026-10-19T02:00:00.000Z' }, [
      { id: 'later', spaceType: 'student', spaceId: 's1', studentId: 's1', role: 'raw', path: 'D:\\甲.pdf', linkedAt: '2026-10-19T02:00:00.000Z' },
    ]);
    value.store.upsertAsset({ assetId: 'asset-2', sha1: '2'.repeat(40), filename: '乙.txt', path: 'D:\\乙.txt', ownerStudentId: 's2', sourceName: '扫描', updatedAt: '2026-10-19T03:00:00.000Z' });
    const scoped = value.store.listAssets({ studentId: 's1', pageSize: 1 });
    assert.equal(scoped.total, 1);
    assert.equal(scoped.items.length, 1);
    assert.equal(Object.hasOwn(scoped.items[0], 'references'), false);
    const detail = value.store.getAssetDetail('different-id');
    assert.equal(detail.assetId, 'asset-1');
    assert.equal(detail.references.length, 1);
    assert.equal(detail.references[0].linkedAt, '2026-10-18T01:00:00.000Z');
    assert.deepEqual(value.store.queryDetails({ studentId: 's1' }).map(asset => asset.assetId), ['asset-1']);
    assert.deepEqual(value.store.detailsByIds(['different-id', 'asset-2']).map(asset => asset.assetId), ['asset-1', 'asset-2']);
    assert.deepEqual([...value.store.detailBatches(1)].map(batch => batch.length), [1, 1]);
  } finally { value.close(); }
});

test('search uses hashes and text without returning unbounded records', () => {
  const value = fixture();
  try {
    for (let index = 0; index < 125; index += 1) value.store.upsertAsset({
      assetId: `asset-${index}`, sha1: index.toString(16).padStart(40, '0'), filename: `化学实验-${index}.pdf`,
      path: `D:\\化学\\${index}.pdf`, ownerStudentId: 's1', sourceName: '学生原始资料库', updatedAt: `2026-10-19T00:${String(index % 60).padStart(2, '0')}:00.000Z`,
    });
    const first = value.store.searchAssets({ query: '化学实验', studentId: 's1', pageSize: 100 });
    assert.equal(first.total, 125);
    assert.equal(first.items.length, 100);
    assert.ok(first.nextCursor);
    const second = value.store.searchAssets({ query: '化学实验', studentId: 's1', pageSize: 100, cursor: first.nextCursor });
    assert.equal(second.items.length, 25);
    const exact = value.store.searchAssets({ query: (7).toString(16).padStart(40, '0') });
    assert.equal(exact.total, 1);
  } finally { value.close(); }
});

test('malformed legacy JSON fails closed without creating the authoritative database', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-assets-bad-'));
  const legacyJsonPath = path.join(root, 'asset-index.json');
  const dbPath = path.join(root, 'asset-index.sqlite3');
  fs.writeFileSync(legacyJsonPath, '{bad json', 'utf8');
  const store = createAssetIndexStore({ dbPath, legacyJsonPath });
  assert.throws(() => store.initialize(), error => error.code === 'asset_migration_failed');
  assert.equal(fs.existsSync(dbPath), false);
  assert.equal(fs.readFileSync(legacyJsonPath, 'utf8'), '{bad json');
  fs.rmSync(root, { recursive: true, force: true });
});

test('online backup and snapshot import preserve aliases, references, and allow path remapping', async () => {
  const source = fixture();
  const destination = fixture();
  try {
    source.store.upsertAsset({ assetId: 'old-id', sha1: 'b'.repeat(40), filename: '资料.pdf', path: String.raw`D:\旧目录\资料.pdf`, ownerStudentId: 's1' }, [
      { id: 'ref-1', spaceType: 'student', spaceId: 's1', role: 'raw', path: String.raw`D:\旧目录\资料.pdf` },
    ], ['older-id']);
    const snapshot = path.join(source.root, 'backup.sqlite3');
    await source.store.backupTo(snapshot);
    const result = destination.store.importSnapshot(snapshot, asset => ({
      ...asset,
      path: asset.path.replace('D:\\旧目录', 'E:\\新目录'),
      references: asset.references.map(ref => ({ ...ref, path: ref.path.replace('D:\\旧目录', 'E:\\新目录') })),
    }));
    assert.equal(result.assetCount, 1);
    const restored = destination.store.getAssetDetail('older-id');
    assert.equal(restored.path, 'E:\\新目录\\资料.pdf');
    assert.equal(restored.references[0].path, 'E:\\新目录\\资料.pdf');
  } finally { source.close(); destination.close(); }
});
