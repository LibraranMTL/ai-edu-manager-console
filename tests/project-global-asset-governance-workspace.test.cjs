const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
function bind(scope, name) {
  const start = main.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  scope[name] = Function('scope', `with (scope) { return (${main.slice(start, main.indexOf('\n}', start) + 2)}); }`)(scope);
}

test('global asset advice never merges workspace project document identities by shared SHA-1', (t) => {
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
    { assetId: 'new-project-asset', filename: 'new.txt', path: absent, sha1: 'same-sha1',
      references: [{ spaceType: 'project', spaceId: 'new-project', path: absent, role: 'project_raw' }] },
    { assetId: 'legacy-asset', filename: 'legacy.txt', path: kept, sha1: 'same-sha1',
      references: [{ spaceType: 'project', spaceId: 'legacy-project', path: kept, role: 'project_raw' }] },
  ];
  let saved = null;
  const reportPath = path.join(root, 'report.md');
  const scope = { fs, path,
    readAssetIndex: () => assets,
    writeAssetIndex: (value) => { saved = value; },
    readProjects: () => [{ id: 'new-project', materialStorageMode: 'workspace-v1' },
      { id: 'legacy-project', materialStorageMode: 'legacy' }],
    normalizeProjectMetadata: (value) => value,
    isWorkspaceMaterialProject: (value) => value.materialStorageMode === 'workspace-v1',
    assetGovernanceReportPath: () => reportPath,
    assetIndexSummary: () => ({ ok: true }),
    mdCell: (value) => String(value || ''), appendHostTimeline: () => {} };
  bind(scope, 'analyzeAssetGovernance');
  const result = JSON.parse(scope.analyzeAssetGovernance());
  assert.equal(result.ok, true, result.message);
  assert.equal(saved[0].recommendedKeepAssetId, '');
  assert.equal(saved[1].recommendedKeepAssetId, '');
  assert.match(saved[0].governanceAction, /项目资料登记中核对来源/);
  assert.doesNotMatch(saved[1].governanceAction, /合并/);
  assert.match(fs.readFileSync(reportPath, 'utf8'), /不能按SHA-1合并身份/);
});

test('legacy-only asset duplicate advice remains available', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-project-asset-governance-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-project-asset-governance-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const kept = path.join(root, 'kept.txt');
  fs.writeFileSync(kept, 'same bytes');
  let saved = [];
  const scope = { fs, path,
    readAssetIndex: () => [{ assetId: 'a', filename: 'a.txt', path: kept, sha1: 'same-sha1', references: [] },
      { assetId: 'b', filename: 'b.txt', path: path.join(root, 'missing.txt'), sha1: 'same-sha1', references: [] }],
    writeAssetIndex: (value) => { saved = value; }, readProjects: () => [],
    normalizeProjectMetadata: (value) => value, isWorkspaceMaterialProject: () => false,
    assetGovernanceReportPath: () => path.join(root, 'report.md'),
    assetIndexSummary: () => ({ ok: true }), mdCell: (value) => String(value || ''), appendHostTimeline: () => {} };
  bind(scope, 'analyzeAssetGovernance');
  assert.equal(JSON.parse(scope.analyzeAssetGovernance()).ok, true);
  assert.equal(saved[0].recommendedKeepAssetId, 'a');
  assert.match(saved[1].governanceAction, /合并/);
});
