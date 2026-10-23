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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-project-capture-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-project-capture-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const project = { id: 'project-1', name: 'Synthetic', materialStorageMode: 'workspace-v1',
    workspacePath: path.join(root, 'workspace'), rawPath: path.join(root, 'raw'),
    managerPath: path.join(root, 'manager'), knowledgeRootPath: path.join(root, 'knowledge'),
    inboxRelativePath: '收件箱', studentIds: ['student-1'] };
  await fs.mkdir(project.workspacePath);
  await fs.mkdir(project.rawPath);
  await fs.mkdir(project.knowledgeRootPath);
  const student = { id: 'student-1', name: 'Synthetic Student' };
  const source = path.join(root, 'capture.png');
  await fs.writeFile(source, 'synthetic screenshot');
  const session = { id: 'session-1', studentId: student.id, sourceName: 'Test Capture', status: 'completed',
    items: [{ id: 'item-1', path: source, filename: 'capture.png' }] };
  let currentProject = project;
  let savedSession = null;
  const assetCalls = [];
  const scope = { path, fs: fsSync, createProjectMaterialHost, createProjectUploadIntake,
    stageProjectDirectImport, projectUploadRecoveryIssues: [],
    captureCenterRootPath: () => path.join(root, 'capture-center'),
    isPathInside: (base, child) => {
      const relative = path.relative(base, child);
      return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`)
        && !path.isAbsolute(relative));
    },
    uniqueTargetFile: (dir, name) => {
      const initial = path.join(dir, name);
      return fsSync.existsSync(initial) ? path.join(dir, `another-${name}`) : initial;
    },
    upsertAssetFromFile: (file, metadata) => {
      assetCalls.push(metadata);
      const bytes = fsSync.readFileSync(file);
      return { assetId: `asset-${crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 12)}`,
        sha1: crypto.createHash('sha1').update(bytes).digest('hex'), size: bytes.length,
        references: [{ spaceType: 'project', spaceId: project.id, path: file, role: metadata.role }] };
    },
    updateProjectRecord: (_id, change) => {
      currentProject = change(currentProject);
      return { project: currentProject, projects: [currentProject] };
    },
    projectWithNewInputs: (value) => value,
    readProjectDigestState: () => ({ status: 'pending' }),
    mergeUnique: (items) => [...new Set(items)],
    persistCaptureSession: (value) => { savedSession = structuredClone(value); },
    appendHostTimeline: () => {}, notifyCaptureChanged: () => {},
    captureSessionSummary: (value) => ({ id: value.id, status: value.status }),
    readCaptureStore: () => ({ sessions: [{ id: session.id }] }),
    readCaptureSessionDetail: () => session,
    readStudentsIndex: () => [student],
    readProjects: () => [currentProject], readProjectMetadata: () => [currentProject],
    normalizeProjectMetadata: (value) => value,
    findStudent: (id) => String(id) === student.id ? student : null,
    writeProjects: (projects) => { currentProject = projects.find((item) => item.id === project.id); },
    mutableProject: () => ({ project: currentProject }),
    ensureProjectWorkspace: (value) => value,
    isWorkspaceMaterialProject: (value) => value?.materialStorageMode === 'workspace-v1',
  };
  bind(scope, 'promoteWorkspaceCaptureSession');
  bind(scope, 'semanticCaptureTarget');
  bind(scope, 'registerWorkspaceCaptureTimelineBundle');
  bind(scope, 'registerCaptureTimelineBundle');
  bind(scope, 'promoteCaptureSession');
  bind(scope, 'prepareProjectUploadIntakeStartup');
  return { root, project, student, source, session, scope,
    currentProject: () => currentProject, savedSession: () => savedSession, assetCalls };
}

test('new-mode screen capture promotes to workspace inbox with stable source and no legacy raw copy', async (t) => {
  const f = await fixture(t);
  const result = JSON.parse(await f.scope.promoteWorkspaceCaptureSession(f.session, f.student, f.project));
  assert.equal(result.ok, true, result.message);
  assert.equal(result.imported, 1);
  assert.equal(f.savedSession().status, 'promoted');
  const host = createProjectMaterialHost(f.project);
  const index = await host.store.read();
  assert.equal(index.materials.length, 1);
  assert.equal(index.materials[0].adoption.state, 'accepted');
  assert.equal(index.materials[0].location.relativePath, '收件箱/capture.png');
  assert.equal(index.materials[0].sources[0].type, 'capture_import');
  assert.equal(index.materials[0].sources[0].studentId, f.student.id);
  assert.equal(index.materials[0].links.assets.length, 1);
  assert.deepEqual(f.currentProject().assetIds, [index.materials[0].links.assets[0].assetId]);
  assert.deepEqual(await fs.readdir(f.project.rawPath), []);
  assert.equal(await fs.readFile(path.join(f.project.workspacePath, '收件箱', 'capture.png'), 'utf8'),
    'synthetic screenshot');
  assert.deepEqual(await createProjectUploadIntake(f.project).pending(), []);
  const retry = JSON.parse(await f.scope.promoteWorkspaceCaptureSession(f.session, f.student, f.project));
  assert.equal(retry.ok, true);
  assert.equal(retry.deduplicated, 1);
  assert.equal((await host.store.read()).materials.length, 1);
  assert.deepEqual(await fs.readdir(path.join(f.project.workspacePath, '收件箱')), ['capture.png']);
});

test('partial capture promotion retains successful originals and retries missing items without duplicate bytes', async (t) => {
  const f = await fixture(t);
  const missing = path.join(f.root, 'later.png');
  f.session.items.push({ id: 'item-2', path: missing, filename: 'later.png' });
  const partial = JSON.parse(await f.scope.promoteWorkspaceCaptureSession(f.session, f.student, f.project));
  assert.equal(partial.ok, false);
  assert.equal(partial.partial, true);
  assert.equal(partial.imported, 1);
  assert.equal(f.savedSession().status, 'completed');
  await fs.writeFile(missing, 'later screenshot');
  const retry = JSON.parse(await f.scope.promoteWorkspaceCaptureSession(f.session, f.student, f.project));
  assert.equal(retry.ok, true, retry.message);
  assert.equal(retry.deduplicated, 1);
  assert.equal(f.savedSession().status, 'promoted');
  assert.equal((await createProjectMaterialHost(f.project).store.read()).materials.length, 2);
  assert.deepEqual((await fs.readdir(path.join(f.project.workspacePath, '收件箱'))).sort(),
    ['capture.png', 'later.png']);
});

test('real capture promotion entry dispatches a new-mode project to the workspace intake', async (t) => {
  const f = await fixture(t);
  f.session.projectId = f.project.id;
  const result = JSON.parse(await f.scope.promoteCaptureSession(f.session.id, 'project_raw'));
  assert.equal(result.ok, true, result.message);
  assert.equal(result.session.status, 'promoted');
  assert.equal(result.materials.length, 1);
  assert.equal(result.materials[0].materialId,
    (await createProjectMaterialHost(f.project).store.read()).materials[0].materialId);
  assert.deepEqual(await fs.readdir(f.project.rawPath), []);
});

test('capture promotion rejects a student who is no longer linked to the target project', async (t) => {
  const f = await fixture(t);
  f.session.projectId = f.project.id;
  f.project.studentIds = [];
  const result = JSON.parse(await f.scope.promoteCaptureSession(f.session.id, 'project_raw'));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'project_scope_changed');
  assert.deepEqual(await fs.readdir(f.project.rawPath), []);
  assert.equal((await createProjectMaterialHost(f.project).store.read()).materials.length, 0);
});

test('new-mode timeline worker prepares outside raw and registers ready window in workspace', async (t) => {
  const f = await fixture(t);
  f.session.projectId = f.project.id;
  const target = f.scope.semanticCaptureTarget(f.session);
  assert.equal(target.ok, true);
  assert.equal(target.workspaceMaterial, true);
  assert.ok(f.scope.isPathInside(f.scope.captureCenterRootPath(), target.rawDir));
  assert.equal(f.scope.isPathInside(f.project.rawPath, target.rawDir), false);
  const windowId = `capture-window-${'a'.repeat(20)}`;
  const source = path.join(target.rawDir, '屏幕学习会话', `${windowId}.md`);
  await fs.mkdir(path.dirname(source), { recursive: true });
  await fs.writeFile(source, 'ready timeline window v1');
  const bundle = path.join(f.scope.captureCenterRootPath(), 'bundle.md');
  await fs.writeFile(bundle, 'timeline bundle');
  const result = { ok: true, state: 'completed', publishedBundlePath: bundle,
    publishedWindowPaths: [{ windowId, path: source, segmentIds: ['segment-1'] }],
    bundle: { bundleId: 'bundle-1', candidateSummary: 'summary', processingWindows: [{ windowId }] },
    segmentCount: 1, keyFrameCount: 1 };
  await f.scope.registerCaptureTimelineBundle(result, f.session);
  const host = createProjectMaterialHost(f.project);
  const first = await host.store.read();
  assert.equal(first.materials.length, 1);
  assert.equal(first.materials[0].adoption.state, 'accepted');
  assert.equal(first.materials[0].sources[0].captureSessionId, f.session.id);
  assert.equal(first.materials[0].sources[0].captureItemId, windowId);
  assert.equal(first.materials[0].links.assets.length, 1);
  assert.equal(f.savedSession().captureWindowPaths[0].path, source);
  assert.equal(await fs.readFile(path.join(f.project.workspacePath, '收件箱', `${windowId}.md`), 'utf8'),
    'ready timeline window v1');
  assert.deepEqual(await fs.readdir(f.project.rawPath), []);
  assert.deepEqual(await createProjectUploadIntake(f.project).pending(), []);
  const revision = first.revision;
  await f.scope.registerCaptureTimelineBundle(result, f.session);
  assert.equal((await host.store.read()).revision, revision);
  assert.equal((await host.store.read()).materials.length, 1);

  await fs.writeFile(source, 'ready timeline window v2');
  await f.scope.registerCaptureTimelineBundle(result, f.session);
  const updated = await host.store.read();
  assert.equal(updated.materials.length, 2);
  assert.deepEqual(updated.materials.map((item) => item.adoption.state).sort(), ['accepted', 'excluded']);
  assert.equal(updated.materials.find((item) => item.adoption.state === 'accepted').sha256,
    crypto.createHash('sha256').update('ready timeline window v2').digest('hex'));
  assert.deepEqual(await fs.readdir(f.project.rawPath), []);
});

test('timeline bundle refuses missing windows and resumes a partially bound intake', async (t) => {
  const f = await fixture(t);
  f.session.projectId = f.project.id;
  const target = f.scope.semanticCaptureTarget(f.session);
  const ids = [`capture-window-${'b'.repeat(20)}`, `capture-window-${'c'.repeat(20)}`];
  const sources = ids.map((id) => path.join(target.rawDir, '屏幕学习会话', `${id}.md`));
  await fs.mkdir(path.dirname(sources[0]), { recursive: true });
  await fs.writeFile(sources[0], 'window one');
  const bundle = path.join(f.scope.captureCenterRootPath(), 'bundle.md');
  await fs.writeFile(bundle, 'bundle');
  const result = { ok: true, state: 'completed', publishedBundlePath: bundle,
    publishedWindowPaths: ids.map((windowId, index) => ({ windowId, path: sources[index], segmentIds: [] })),
    bundle: { bundleId: 'bundle-2', processingWindows: ids.map((windowId) => ({ windowId })) } };
  await assert.rejects(f.scope.registerCaptureTimelineBundle(result, f.session),
    { code: 'capture_window_incomplete' });
  assert.equal((await createProjectMaterialHost(f.project).store.read()).materials.length, 0);
  await fs.writeFile(sources[1], 'window two');
  const original = f.scope.upsertAssetFromFile;
  let failOnce = true;
  f.scope.upsertAssetFromFile = (file, metadata) => {
    if (failOnce && file.endsWith(`${ids[1]}.md`)) {
      failOnce = false;
      throw Object.assign(new Error('synthetic binding interruption'), { code: 'synthetic_failure' });
    }
    return original(file, metadata);
  };
  await assert.rejects(f.scope.registerCaptureTimelineBundle(result, f.session),
    { code: 'synthetic_failure' });
  assert.equal(f.savedSession(), null);
  assert.equal((await createProjectUploadIntake(f.project).pending()).length, 1);
  await f.scope.registerCaptureTimelineBundle(result, f.session);
  const index = await createProjectMaterialHost(f.project).store.read();
  assert.equal(index.materials.length, 2);
  assert.ok(index.materials.every((item) => item.links.assets.length === 1));
  assert.deepEqual(await createProjectUploadIntake(f.project).pending(), []);
  assert.equal(f.savedSession().status, 'promoted');
  assert.deepEqual(await fs.readdir(f.project.rawPath), []);
});

test('startup recovery completes a written capture intake with original student and session identity', async (t) => {
  const f = await fixture(t);
  const staged = await stageProjectDirectImport(f.project, f.source,
    path.join(f.project.workspacePath, '收件箱', 'capture.png'), {
      sourceType: 'capture_import', intent: 'active', studentId: f.student.id,
      captureSessionId: f.session.id, captureItemId: f.session.items[0].id,
    });
  assert.equal((await createProjectUploadIntake(f.project).pending()).length, 1);
  const issues = await f.scope.prepareProjectUploadIntakeStartup();
  assert.deepEqual(issues, []);
  assert.deepEqual(await createProjectUploadIntake(f.project).pending(), []);
  const index = await createProjectMaterialHost(f.project).store.read();
  assert.equal(index.materials.length, 1);
  assert.equal(index.materials[0].sources[0].eventId, staged.uploadId);
  assert.equal(index.materials[0].sources[0].type, 'capture_import');
  assert.equal(index.materials[0].sources[0].studentId, f.student.id);
  assert.equal(f.assetCalls[0].captureSessionId, f.session.id);
  assert.equal(f.assetCalls[0].captureItemId, f.session.items[0].id);
  assert.deepEqual(f.currentProject().assetIds, [index.materials[0].links.assets[0].assetId]);
});

test('startup recovery keeps timeline window identity and asset role', async (t) => {
  const f = await fixture(t);
  const windowId = `capture-window-${'d'.repeat(20)}`;
  const source = path.join(f.root, `${windowId}.md`);
  await fs.writeFile(source, 'ready window');
  await stageProjectDirectImport(f.project, source,
    path.join(f.project.workspacePath, '收件箱', `${windowId}.md`), {
      sourceType: 'capture_import', intent: 'active', studentId: f.student.id,
      captureSessionId: f.session.id, captureItemId: windowId,
    });
  assert.deepEqual(await f.scope.prepareProjectUploadIntakeStartup(), []);
  const index = await createProjectMaterialHost(f.project).store.read();
  assert.equal(index.materials[0].sources[0].captureItemId, windowId);
  assert.equal(index.materials[0].sources[0].captureSessionId, f.session.id);
  assert.equal(f.assetCalls[0].sourceType, 'capture_processing_window');
  assert.equal(f.assetCalls[0].captureWindowId, windowId);
  assert.equal(f.assetCalls[0].role, 'project_raw_capture_bundle');
});
