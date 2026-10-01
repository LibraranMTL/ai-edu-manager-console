const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createProjectMaterialHost, isWorkspaceMaterialProject,
  projectMaterialDigestProjection, readProjectMaterialIndexSync } = require('../electron/project-material-host.cjs');
const { createProjectUploadIntake } = require('../electron/project-upload-intake.cjs');
const { stageProjectDirectImport } = require('../electron/project-direct-import.cjs');
const { projectStagingProjection } = require('../electron/project-staging-projection.cjs');
const { createProjectMaterialAssetCompatibility } = require('../electron/project-material-asset-compat.cjs');

const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
function bind(scope, name) {
  const functionStart = main.indexOf(`function ${name}(`);
  assert.ok(functionStart >= 0);
  const start = main.slice(functionStart - 6, functionStart) === 'async ' ? functionStart - 6 : functionStart;
  scope[name] = Function('scope', `with (scope) { return (${main.slice(start, main.indexOf('\n}', functionStart) + 2)}); }`)(scope);
}

test('actual Windows candidate import and adoption use one workspace original and one registry state', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-staging-import-host-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-staging-import-host-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const project = { id: 'project-1', name: 'Synthetic', status: 'active', studentIds: [],
    materialStorageMode: 'workspace-v1', inboxRelativePath: '收件箱',
    workspacePath: path.join(root, 'workspace'), managerPath: path.join(root, '.edu-manager'),
    rawPath: path.join(root, 'legacy') };
  fs.mkdirSync(project.workspacePath, { recursive: true });
  fs.mkdirSync(project.rawPath, { recursive: true });
  const source = path.join(root, 'research.txt');
  fs.writeFileSync(source, 'one original');
  let projects = [project];
  const assets = new Map();
  const scope = { fs, path, mainWindow: {}, projectUploadRecoveryIssues: [],
    mutableProject: () => ({ project: projects[0] }), readProjects: () => projects,
    ensureProjectWorkspace: (value) => value,
    normalizeProjectMetadata: (value) => value,
    normalizeProject: (value) => {
      const index = readProjectMaterialIndexSync(value);
      return { ...value, stagingItems: projectStagingProjection(value, index, value.stagingItems || []),
        digestState: projectMaterialDigestProjection(value, index) };
    },
    isWorkspaceMaterialProject, createProjectMaterialHost, createProjectUploadIntake,
    stageProjectDirectImport,
    dialog: { showOpenDialogSync: () => [source] },
    uniqueTargetFile: (dir, filename) => {
      const target = path.join(dir, filename);
      return fs.existsSync(target) ? path.join(dir, `new-${filename}`) : target;
    },
    updateProjectRecord: (_id, change) => {
      projects = projects.map((item) => change(item));
      return { project: projects[0], projects };
    },
    projectWithNewInputs: (value) => value,
    projectMaterialAssetCompatibility: (value, host) => createProjectMaterialAssetCompatibility(value, host, {
      findAsset: (id) => assets.get(id),
      hasProjectAsset: (id) => (projects[0].assetIds || []).includes(id),
      upsertAsset: (file, context) => {
        const bytes = fs.readFileSync(file);
        const sha1 = crypto.createHash('sha1').update(bytes).digest('hex');
        const asset = { assetId: `asset-${sha1.slice(0, 16)}`, sha1, size: bytes.length,
          references: [{ spaceType: 'project', spaceId: value.id, path: file, role: context.role }] };
        assets.set(asset.assetId, asset);
        return asset;
      },
      addProjectAsset: async (id) => { projects = projects.map((item) => ({ ...item,
        assetIds: [...new Set([...(item.assetIds || []), id])] })); },
    }),
    appendHostTimeline: () => {},
  };
  bind(scope, 'importProjectStagingFilesAsync');
  bind(scope, 'decideNewProjectStagingItems');
  const added = JSON.parse(await scope.importProjectStagingFilesAsync(project.id));
  assert.equal(added.ok, true, added.message);
  assert.equal(added.imported, 1);
  const candidate = readProjectMaterialIndexSync(project).materials[0];
  assert.equal(candidate.adoption.state, 'candidate');
  assert.equal(candidate.sources[0].type, 'staging_import');
  assert.equal(added.project.stagingItems[0].id, candidate.materialId);
  assert.equal(added.project.digestState.pendingCount, 0);
  assert.deepEqual(fs.readdirSync(project.rawPath), []);
  assert.deepEqual(fs.readdirSync(path.join(project.workspacePath, '收件箱')), ['research.txt']);
  assert.deepEqual(await createProjectUploadIntake(project).pending(), []);
  const repeat = JSON.parse(await scope.importProjectStagingFilesAsync(project.id));
  assert.equal(repeat.imported, 0);
  assert.equal(repeat.skipped, 1);
  const host = createProjectMaterialHost(project);
  await host.store.mutate((index) => { index.materials[0].recordRevision++; });
  const stale = JSON.parse(await scope.decideNewProjectStagingItems(project.id,
    JSON.stringify([{ id: candidate.materialId, expectedVersion: candidate.version,
      expectedRecordRevision: candidate.recordRevision }]), 'accepted', '过期页面'));
  assert.equal(stale.ok, false);
  assert.equal(stale.failed[0].code, 'version_conflict');
  const current = readProjectMaterialIndexSync(project).materials[0];
  const adopted = JSON.parse(await scope.decideNewProjectStagingItems(project.id,
    JSON.stringify([{ id: current.materialId, expectedVersion: current.version,
      expectedRecordRevision: current.recordRevision }]), 'accepted', '用户采用'));
  assert.equal(adopted.ok, true, adopted.message);
  assert.equal(adopted.project.stagingItems[0].status, 'promoted');
  assert.equal(adopted.project.digestState.pendingCount, 1);
  assert.equal(adopted.compatibilityLinked.length, 1);
  assert.deepEqual(adopted.project.assetIds, [adopted.compatibilityLinked[0].assetId]);
  assert.deepEqual(fs.readdirSync(project.rawPath), []);
  assert.deepEqual(fs.readdirSync(path.join(project.workspacePath, '收件箱')), ['research.txt']);

  const secondPath = path.join(project.workspacePath, '收件箱', 'needs-repair.txt');
  fs.writeFileSync(secondPath, 'another original');
  const second = (await host.store.registerFiles([{ location: {
    kind: 'workspace', rootId: 'workspace', relativePath: '收件箱/needs-repair.txt',
  } }], { intent: 'later' })).result[0];
  scope.projectMaterialAssetCompatibility = () => ({ syncAccepted: async () => {
    throw Object.assign(new Error('old index unavailable'), { code: 'asset_index_corrupt' });
  } });
  const partial = JSON.parse(await scope.decideNewProjectStagingItems(project.id,
    JSON.stringify([{ id: second.materialId, expectedVersion: second.version,
      expectedRecordRevision: second.recordRevision }]), 'accepted', '用户采用'));
  assert.equal(partial.ok, true, partial.message);
  assert.equal(partial.partial, true);
  assert.equal(partial.compatibilityFailed[0].code, 'asset_index_corrupt');
  assert.equal((await host.store.read()).materials.find((item) => item.materialId === second.materialId).adoption.state,
    'accepted');
  assert.equal(fs.readFileSync(secondPath, 'utf8'), 'another original');
});
