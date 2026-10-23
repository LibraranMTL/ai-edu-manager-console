const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProjectMaterialHost, isWorkspaceMaterialProject,
  projectMaterialDigestProjection, readProjectMaterialIndexSync } = require('../electron/project-material-host.cjs');
const { createProjectUploadIntake } = require('../electron/project-upload-intake.cjs');
const { stageProjectDirectImport } = require('../electron/project-direct-import.cjs');

const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
function bind(scope, name) {
  const functionStart = main.indexOf(`function ${name}(`);
  assert.ok(functionStart >= 0);
  const start = main.slice(functionStart - 6, functionStart) === 'async ' ? functionStart - 6 : functionStart;
  scope[name] = Function('scope', `with (scope) { return (${main.slice(start, main.indexOf('\n}', functionStart) + 2)}); }`)(scope);
}

test('actual Windows direct-import path adopts in the workspace inbox and is idempotent by source bytes', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-direct-import-host-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-direct-import-host-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const project = { id: 'project-1', name: 'Synthetic', status: 'active', studentIds: [],
    materialStorageMode: 'workspace-v1', inboxRelativePath: '收件箱',
    workspacePath: path.join(root, 'workspace'), managerPath: path.join(root, '.edu-manager'),
    rawPath: path.join(root, 'legacy') };
  fs.mkdirSync(project.workspacePath, { recursive: true });
  fs.mkdirSync(project.rawPath, { recursive: true });
  const source = path.join(root, 'selected.txt');
  fs.writeFileSync(source, 'first original');
  let projects = [project];
  const assets = [];
  const scope = { fs, path, crypto, mainWindow: {}, projectUploadRecoveryIssues: [],
    mutableProject: () => ({ project: projects[0] }), readProjects: () => projects, readProjectMetadata: () => projects,
    writeProjects: (next) => { projects = next; }, normalizeProject: (value) => value,
    normalizeProjectMetadata: (value) => value, ensureProjectWorkspace: (value) => value,
    isWorkspaceMaterialProject, createProjectMaterialHost, createProjectUploadIntake,
    stageProjectDirectImport,
    dialog: { showOpenDialogSync: () => [source] },
    uniqueTargetFile: (dir, filename) => {
      const target = path.join(dir, filename);
      return fs.existsSync(target) ? path.join(dir, `new-${filename}`) : target;
    },
    upsertAssetFromFile: (file, context) => {
      const bytes = fs.readFileSync(file);
      const asset = { assetId: `asset-${assets.length + 1}`, sha1: crypto.createHash('sha1').update(bytes).digest('hex'),
        size: bytes.length, references: [{ id: context.referenceId, spaceType: 'project',
          spaceId: context.projectId, path: file }] };
      assets.push(asset); return asset;
    },
    readProjectDigestState: (value) => projectMaterialDigestProjection(value, readProjectMaterialIndexSync(value)),
    updateProjectRecord: (_id, change) => {
      projects = projects.map((item) => change(item));
      return { project: projects[0], projects };
    },
    mergeUnique: (values) => [...new Set(values)], projectWithNewInputs: (value) => value,
    appendHostTimeline: () => {},
  };
  bind(scope, 'importProjectRawFiles');
  const first = JSON.parse(await scope.importProjectRawFiles(project.id));
  assert.equal(first.ok, true, first.message);
  assert.equal(first.imported, 1);
  assert.equal(fs.readFileSync(path.join(project.workspacePath, '收件箱', 'selected.txt'), 'utf8'), 'first original');
  assert.deepEqual(fs.readdirSync(project.rawPath), []);
  const material = readProjectMaterialIndexSync(project).materials[0];
  assert.equal(material.adoption.state, 'accepted');
  assert.equal(material.sources[0].type, 'direct_import');
  assert.equal(material.links.assets[0].assetId, 'asset-1');
  assert.equal(projects[0].digestState.pendingCount, 1);
  assert.deepEqual(await createProjectUploadIntake(project).pending(), []);
  const repeated = JSON.parse(await scope.importProjectRawFiles(project.id));
  assert.equal(repeated.imported, 0);
  assert.equal(repeated.skipped, 1);
  assert.equal(assets.length, 1);
  assert.deepEqual(fs.readdirSync(path.join(project.workspacePath, '收件箱')), ['selected.txt']);

  const secondSource = path.join(root, 'crash.txt');
  fs.writeFileSync(secondSource, 'landed before restart');
  await stageProjectDirectImport(project, secondSource, path.join(project.workspacePath, '收件箱', 'crash.txt'));
  bind(scope, 'prepareProjectUploadIntakeStartup');
  assert.deepEqual(await scope.prepareProjectUploadIntakeStartup(), []);
  const recovered = readProjectMaterialIndexSync(project).materials.find((item) => item.location.relativePath.endsWith('/crash.txt'));
  assert.equal(recovered.sources[0].type, 'direct_import');
  assert.equal(recovered.links.assets[0].assetId, 'asset-2');
  assert.deepEqual(await createProjectUploadIntake(project).pending(), []);
});
