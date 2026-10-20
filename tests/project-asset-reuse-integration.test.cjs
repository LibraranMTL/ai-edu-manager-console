const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProjectMaterialHost, isWorkspaceMaterialProject,
  projectMaterialDigestProjection, readProjectMaterialIndexSync } = require('../electron/project-material-host.cjs');
const { grantProjectAssetRoot } = require('../electron/project-external-roots.cjs');
const { selectReusableAssetPath } = require('../electron/project-asset-reuse.cjs');

const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
function bind(scope, name) {
  const functionStart = main.indexOf(`function ${name}(`);
  assert.ok(functionStart >= 0);
  const start = main.slice(functionStart - 6, functionStart) === 'async ' ? functionStart - 6 : functionStart;
  scope[name] = Function('scope', `with (scope) { return (${main.slice(start, main.indexOf('\n}', functionStart) + 2)}); }`)(scope);
}
function inside(root, file) {
  const relative = path.relative(root, file);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

test('actual asset reuse binds workspace and external sources without new legacy raw files or cross-student leakage', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-reuse-host-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-reuse-host-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const project = { id: 'project-1', name: 'Synthetic', status: 'active', studentIds: ['student-1'],
    assetIds: [], materialStorageMode: 'workspace-v1', inboxRelativePath: '收件箱',
    managerPath: path.join(root, '.edu-manager'), workspacePath: path.join(root, 'workspace'),
    rawPath: path.join(root, 'legacy') };
  for (const dir of [project.workspacePath, project.rawPath, path.join(root, 'student-1'), path.join(root, 'student-2')]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const workspaceFile = path.join(project.workspacePath, '参考资料.txt');
  const externalFile = path.join(root, 'student-1', '外部原文.txt');
  const deniedFile = path.join(root, 'student-2', '隐私原文.txt');
  fs.writeFileSync(workspaceFile, 'workspace bytes');
  fs.writeFileSync(externalFile, 'external bytes');
  fs.writeFileSync(deniedFile, 'other student bytes');
  const asset = (assetId, file, ownerStudentId, references) => {
    const bytes = fs.readFileSync(file);
    return { assetId, path: file, ownerStudentId, size: bytes.length,
      sha1: crypto.createHash('sha1').update(bytes).digest('hex'), references };
  };
  const assets = [
    asset('asset-workspace', workspaceFile, '', [{ spaceType: 'project', spaceId: project.id, path: workspaceFile }]),
    asset('asset-external', externalFile, 'student-1', [{ spaceType: 'student', spaceId: 'student-1', path: externalFile }]),
    asset('asset-denied', deniedFile, 'student-2', [{ spaceType: 'student', spaceId: 'student-2', path: deniedFile }]),
  ];
  let projects = [project];
  const scope = { fs, path, crypto, readProjects: () => projects, normalizeProject: (value) => value,
    mutableProject: () => ({ project: projects[0] }), ensureProjectWorkspace: (value) => value,
    assetStore: () => ({ detailsByIds: (ids) => ids.map((id) => assets.find((asset) => asset.assetId === id)).filter(Boolean) }),
    isWorkspaceMaterialProject, createProjectMaterialHost,
    grantProjectAssetRoot, selectReusableAssetPath, canonicalIsPathInside: inside,
    upsertAssetFromFile: (file, context) => {
      const original = assets.find((item) => item.path === file);
      return { ...original, references: [...original.references, { spaceType: 'project',
        spaceId: context.projectId, path: file }] };
    },
    readProjectDigestState: (value) => projectMaterialDigestProjection(value, readProjectMaterialIndexSync(value)),
    writeProjectDigestState: () => { throw new Error('old digest ledger must not be written'); },
    updateProjectRecord: (_id, change) => { projects = projects.map(change); return { project: projects[0], projects }; },
    mergeUnique: (values) => [...new Set(values)], projectWithNewInputs: (value) => value,
    appendHostTimeline: () => {},
  };
  bind(scope, 'importProjectAssets');
  const first = JSON.parse(await scope.importProjectAssets(project.id,
    JSON.stringify(assets.map((item) => item.assetId))));
  assert.equal(first.imported, 2, first.message);
  assert.equal(first.externalCount, 1);
  assert.equal(first.failed[0].code, 'owner_scope_mismatch');
  assert.equal(first.partial, true);
  assert.deepEqual(fs.readdirSync(project.rawPath), []);
  const materials = readProjectMaterialIndexSync(project).materials;
  assert.equal(materials.length, 2);
  assert.deepEqual(materials.map((item) => item.location.kind).sort(), ['external', 'workspace']);
  const external = materials.find((item) => item.location.kind === 'external');
  assert.equal((await createProjectMaterialHost(projects[0]).store.resolve(external.materialId)).path, externalFile);
  assert.equal(projects[0].digestState.pendingCount, 2);
  const repeated = JSON.parse(await scope.importProjectAssets(project.id,
    JSON.stringify(['asset-workspace', 'asset-external'])));
  assert.equal(repeated.imported, 0);
  assert.equal(repeated.skipped, 2);
  assert.equal(readProjectMaterialIndexSync(project).materials.length, 2);
});
