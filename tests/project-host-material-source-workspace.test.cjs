const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createProjectMaterialHost } = require('../electron/project-material-host.cjs');
const { createProjectUploadIntake } = require('../electron/project-upload-intake.cjs');
const { stageProjectDirectImport } = require('../electron/project-direct-import.cjs');

const main = fsSync.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
function bind(scope, name) {
  const start = main.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  const begin = main.slice(start - 6, start) === 'async ' ? start - 6 : start;
  scope[name] = Function('scope', `with (scope) { return (${main.slice(begin, main.indexOf('\n}', start) + 2)}); }`)(scope);
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-host-source-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-host-source-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const project = { id: 'project-1', name: 'Synthetic project', materialStorageMode: 'workspace-v1',
    workspacePath: path.join(root, 'workspace'), rawPath: path.join(root, 'raw'),
    managerPath: path.join(root, 'manager'), inboxRelativePath: '收件箱', studentIds: ['student-1'] };
  const student = { id: 'student-1', name: 'Synthetic student', materialSources: [] };
  const source = path.join(root, 'source.txt');
  await fs.mkdir(project.workspacePath);
  await fs.mkdir(project.rawPath);
  await fs.writeFile(source, 'synthetic host source bytes');
  let currentProject = project;
  const assetCalls = [];
  const scope = {
    fs: fsSync, path, crypto, projectUploadRecoveryIssues: [],
    createProjectMaterialHost, createProjectUploadIntake, stageProjectDirectImport,
    readProjects: () => [currentProject], readProjectMetadata: () => [currentProject], normalizeProject: (value) => value,
    normalizeProjectMetadata: (value) => value,
    isWorkspaceMaterialProject: (value) => value?.materialStorageMode === 'workspace-v1',
    findStudentByKey: (id) => String(id) === student.id ? student : null,
    findStudent: (id) => String(id) === student.id ? student : null,
    ensureProjectWorkspace: (value) => value,
    sanitizeName: (value) => value,
    mainWindow: {},
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [source] }) },
    normalizeMaterialSources: () => [], findSourceForPath: () => null,
    assertUploadFileAllowed: () => {},
    sha1File: (file) => crypto.createHash('sha1').update(fsSync.readFileSync(file)).digest('hex'),
    uniqueTargetFile: (dir, name) => {
      const candidate = path.join(dir, name);
      return fsSync.existsSync(candidate) ? path.join(dir, `copy-${name}`) : candidate;
    },
    upsertAssetFromFile: (file, metadata) => {
      assetCalls.push(metadata);
      const bytes = fsSync.readFileSync(file);
      return { assetId: `asset-${crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 12)}`,
        sha1: crypto.createHash('sha1').update(bytes).digest('hex'), size: bytes.length,
        references: [{ spaceType: 'project', spaceId: project.id, path: file, role: metadata.role }] };
    },
    updateProjectRecord: (_id, change) => { currentProject = change(currentProject); return { project: currentProject }; },
    writeProjects: (projects) => { currentProject = projects.find((item) => item.id === project.id); },
    projectWithNewInputs: (value) => value,
    readProjectDigestState: () => ({ status: 'pending' }),
    mergeUnique: (items) => [...new Set(items)],
    notify: () => {}, getHostServiceStatus: () => '{}',
  };
  bind(scope, 'importWorkspaceMaterialSourceFiles');
  bind(scope, 'importMaterialSourceFiles');
  bind(scope, 'importFiles');
  bind(scope, 'prepareProjectUploadIntakeStartup');
  return { root, project, student, source, scope, assetCalls,
    setProject: (value) => { currentProject = value; }, currentProject: () => currentProject };
}

test('host material source import uses workspace original and skips duplicate bytes', async (t) => {
  const f = await fixture(t);
  const target = JSON.stringify({ type: 'project', id: f.project.id });
  const first = JSON.parse(await f.scope.importMaterialSourceFiles(f.student.id,
    JSON.stringify([f.source]), target));
  assert.equal(first.imported, 1);
  assert.equal(first.records[0].sourceType, 'host_material_source');
  assert.ok(first.records[0].materialId);
  const again = JSON.parse(await f.scope.importMaterialSourceFiles(f.student.id,
    JSON.stringify([f.source]), target));
  assert.equal(again.skipped, 1);
  assert.deepEqual(await fs.readdir(f.project.rawPath), []);
  assert.equal((await fs.readdir(path.join(f.project.workspacePath, '收件箱'))).length, 1);
  const index = await createProjectMaterialHost(f.project).store.read();
  assert.equal(index.materials.length, 1);
  assert.equal(index.materials[0].sources[0].type, 'host_material_source');
  assert.equal(index.materials[0].adoption.state, 'accepted');
  assert.deepEqual(await createProjectUploadIntake(f.project).pending(), []);
  assert.ok(f.currentProject().assetIds.includes(first.records[0].assetId));
});

test('Windows host manual file picker imports a project original through the same intake', async (t) => {
  const f = await fixture(t);
  const receipt = new Promise((resolve) => {
    f.scope.notify = (channel, payload) => {
      if (channel === 'onNativeImportResult') resolve(payload);
    };
  });
  assert.equal(f.scope.importFiles(f.student.id, JSON.stringify({ type: 'project', id: f.project.id })), true);
  const result = await receipt;
  assert.equal(result.imported, 1);
  const index = await createProjectMaterialHost(f.project).store.read();
  assert.equal(index.materials.length, 1);
  assert.equal(index.materials[0].sources[0].type, 'host_manual_import');
  assert.equal(f.assetCalls[0].sourceType, 'host_manual_import');
  assert.equal(f.assetCalls[0].sourcePath, f.source);
  assert.deepEqual(await fs.readdir(f.project.rawPath), []);
  assert.deepEqual(await createProjectUploadIntake(f.project).pending(), []);
});

test('Windows host manual picker refuses project unbinding while its dialog is open', async (t) => {
  const f = await fixture(t);
  f.scope.dialog.showOpenDialog = async () => {
    f.setProject({ ...f.currentProject(), studentIds: [] });
    return { canceled: false, filePaths: [f.source] };
  };
  const receipt = new Promise((resolve) => {
    f.scope.notify = (channel, payload) => {
      if (channel === 'onNativeImportResult') resolve(payload);
    };
  });
  f.scope.importFiles(f.student.id, JSON.stringify({ type: 'project', id: f.project.id }));
  const result = await receipt;
  assert.equal(result.imported, 0);
  assert.deepEqual(await fs.readdir(f.project.rawPath), []);
  assert.equal((await createProjectMaterialHost(f.project).store.read()).materials.length, 0);
});

test('host material source import resumes after asset binding interruption', async (t) => {
  const f = await fixture(t);
  const original = f.scope.upsertAssetFromFile;
  let interrupt = true;
  f.scope.upsertAssetFromFile = (...args) => {
    if (interrupt) { interrupt = false; throw new Error('synthetic interruption'); }
    return original(...args);
  };
  const first = await f.scope.importWorkspaceMaterialSourceFiles(f.student, f.project, [f.source], []);
  assert.equal(first.failed, 1);
  assert.equal((await createProjectUploadIntake(f.project).pending()).length, 1);
  const retried = await f.scope.importWorkspaceMaterialSourceFiles(f.student, f.project, [f.source], []);
  assert.equal(retried.imported, 1);
  assert.equal((await createProjectMaterialHost(f.project).store.read()).materials.length, 1);
  assert.deepEqual(await createProjectUploadIntake(f.project).pending(), []);
});

test('host source duplicate check does not hide a missing registered original', async (t) => {
  const f = await fixture(t);
  const first = await f.scope.importWorkspaceMaterialSourceFiles(f.student, f.project, [f.source], []);
  assert.equal(first.imported, 1);
  await fs.rm(first.records[0].path);
  const restored = await f.scope.importWorkspaceMaterialSourceFiles(f.student, f.project, [f.source], []);
  assert.equal(restored.imported, 1);
  assert.equal(restored.skipped, 0);
  assert.equal(await fs.readFile(restored.records[0].path, 'utf8'), 'synthetic host source bytes');
});

test('host material source import rejects student unbinding after staging', async (t) => {
  const f = await fixture(t);
  const original = f.scope.stageProjectDirectImport;
  f.scope.stageProjectDirectImport = async (...args) => {
    const staged = await original(...args);
    f.setProject({ ...f.currentProject(), studentIds: [] });
    return staged;
  };
  const result = await f.scope.importWorkspaceMaterialSourceFiles(f.student, f.project, [f.source], []);
  assert.equal(result.failed, 1);
  assert.equal((await createProjectMaterialHost(f.project).store.read()).materials.length, 0);
  assert.equal((await createProjectUploadIntake(f.project).pending()).length, 1);
});

test('host material source intake can recover after host restart', async (t) => {
  const f = await fixture(t);
  const staged = await stageProjectDirectImport(f.project, f.source,
    path.join(f.project.workspacePath, '收件箱', 'source.txt'), {
      sourceType: 'host_material_source', intent: 'active', studentId: f.student.id,
      hostSourcePath: f.source, hostSourceName: 'Synthetic source directory',
    });
  assert.deepEqual(await f.scope.prepareProjectUploadIntakeStartup(), []);
  const index = await createProjectMaterialHost(f.project).store.read();
  assert.equal(index.materials.length, 1);
  assert.equal(index.materials[0].sources[0].eventId, staged.uploadId);
  assert.equal(index.materials[0].sources[0].type, 'host_material_source');
  assert.equal(f.assetCalls[0].sourceType, 'host_material_source');
  assert.equal(f.assetCalls[0].sourcePath, f.source);
  assert.equal(f.assetCalls[0].sourceName, 'Synthetic source directory');
});

test('host manual import intake recovers its original source identity', async (t) => {
  const f = await fixture(t);
  const staged = await stageProjectDirectImport(f.project, f.source,
    path.join(f.project.workspacePath, '收件箱', 'source.txt'), {
      sourceType: 'host_manual_import', intent: 'active', studentId: f.student.id,
      hostSourcePath: f.source, hostSourceName: '主机手动导入',
    });
  assert.deepEqual(await f.scope.prepareProjectUploadIntakeStartup(), []);
  const index = await createProjectMaterialHost(f.project).store.read();
  assert.equal(index.materials[0].sources[0].eventId, staged.uploadId);
  assert.equal(index.materials[0].sources[0].type, 'host_manual_import');
  assert.equal(f.assetCalls[0].sourcePath, f.source);
  assert.equal(f.assetCalls[0].sourceName, '主机手动导入');
});
