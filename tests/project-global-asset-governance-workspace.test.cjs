const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
function bind(scope, name) {
  const asyncStart = main.indexOf(`async function ${name}(`);
  const start = asyncStart >= 0 ? asyncStart : main.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  scope[name] = Function('scope', `with (scope) { return (${main.slice(start, main.indexOf('\n}', start) + 2)}); }`)(scope);
}

test('global asset advice never merges workspace project document identities by shared SHA-1', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-project-asset-governance-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-project-asset-governance-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const kept = path.join(root, 'kept.txt');
  fs.writeFileSync(kept, 'same bytes');
  const absent = path.join(root, 'missing.txt');
  const assets = [
    { assetId: 'new-project-asset', filename: 'new.txt', path: absent, sha1: 'new-sha1',
      references: [{ spaceType: 'project', spaceId: 'new-project', path: absent, role: 'project_raw' }] },
    { assetId: 'legacy-asset', filename: 'legacy.txt', path: kept, sha1: 'legacy-sha1',
      references: [{ spaceType: 'project', spaceId: 'legacy-project', path: kept, role: 'project_raw' }] },
  ];
  const saved = new Map();
  const reportPath = path.join(root, 'report.md');
  const scope = { fs, path,
    assetStore: () => ({ detailBatches: function *() { yield assets; },
      patchAsset: (id, value) => saved.set(id, value), summary: () => ({ duplicateGroups: 0 }) }),
    readProjects: () => [{ id: 'new-project', materialStorageMode: 'workspace-v1' },
      { id: 'legacy-project', materialStorageMode: 'legacy' }],
    readProjectMetadata: () => [{ id: 'new-project', materialStorageMode: 'workspace-v1' },
      { id: 'legacy-project', materialStorageMode: 'legacy' }], normalizeProjectMetadata: (value) => value,
    isWorkspaceMaterialProject: (value) => value.materialStorageMode === 'workspace-v1',
    assetGovernanceReportPath: () => reportPath,
    assetIndexSummary: () => ({ ok: true }),
    mdCell: (value) => String(value || ''), appendHostTimeline: () => {} };
  bind(scope, 'analyzeAssetGovernance');
  const result = JSON.parse(await scope.analyzeAssetGovernance());
  assert.equal(result.ok, true, result.message);
  assert.equal(saved.get('new-project-asset').recommendedKeepAssetId, '');
  assert.equal(saved.get('legacy-asset').recommendedKeepAssetId, '');
  assert.match(saved.get('new-project-asset').governanceAction, /项目资料登记中核对来源/);
  assert.doesNotMatch(saved.get('legacy-asset').governanceAction, /合并/);
  assert.match(fs.readFileSync(reportPath, 'utf8'), /不能仅按指纹清理原件/);
});

test('same-content physical paths remain references rather than duplicate asset rows', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-project-asset-governance-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-project-asset-governance-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const kept = path.join(root, 'kept.txt');
  fs.writeFileSync(kept, 'same bytes');
  const second = path.join(root, 'copy.txt');
  fs.writeFileSync(second, 'same bytes');
  const assets = [{ assetId: 'a', filename: 'a.txt', path: kept, sha1: 'same-sha1', references: [
    { spaceType: 'student', spaceId: 's1', role: 'raw', path: kept },
    { spaceType: 'student', spaceId: 's1', role: 'raw', path: second },
  ] }];
  const saved = new Map();
  const scope = { fs, path,
    assetStore: () => ({ detailBatches: function *() { yield assets; },
      patchAsset: (id, value) => saved.set(id, value), summary: () => ({ duplicateGroups: 1 }) }),
    readProjects: () => [], readProjectMetadata: () => [],
    normalizeProjectMetadata: (value) => value, isWorkspaceMaterialProject: () => false,
    assetGovernanceReportPath: () => path.join(root, 'report.md'),
    assetIndexSummary: () => ({ ok: true }), mdCell: (value) => String(value || ''), appendHostTimeline: () => {} };
  bind(scope, 'analyzeAssetGovernance');
  assert.equal(JSON.parse(await scope.analyzeAssetGovernance()).ok, true);
  assert.equal(saved.get('a').duplicateAssetCount, 2);
  assert.doesNotMatch(saved.get('a').governanceAction, /合并/);
  assert.match(fs.readFileSync(scope.assetGovernanceReportPath(), 'utf8'), /多路径内容组 \| 1/);
});
