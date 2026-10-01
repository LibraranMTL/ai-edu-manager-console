const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const host = require('../electron/project-material-host.cjs');
const { createProjectPublication, validateProjectPublication } = require('../electron/collaboration-project-publication.cjs');
const source = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
function extract(name) {
  const match = new RegExp(`(?:async )?function ${name}\\(`).exec(source);
  assert.ok(match, name);
  const end = source.slice(match.index + match[0].length).search(/\n(?:async )?function /);
  return source.slice(match.index, end < 0 ? undefined : match.index + match[0].length + end);
}

async function fixture(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'edu-host-material-'));
  const project = { id: 'p1', name: '合成项目', materialStorageMode: 'workspace-v1',
    managerPath: path.join(root, '.edu-manager'), workspacePath: path.join(root, 'workspace'),
    rawPath: path.join(root, 'legacy'), knowledgeRootPath: path.join(root, 'knowledge') };
  for (const dir of [project.workspacePath, project.rawPath, project.knowledgeRootPath]) await fsp.mkdir(dir);
  const service = host.createProjectMaterialHost(project);
  t.after(async () => {
    assert.equal(path.dirname(root), await fsp.realpath(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-host-material-'));
    for (const item of await fsp.readdir(path.join(service.store.directory, 'snapshots')).catch(() => [])) {
      await fsp.chmod(path.join(service.store.directory, 'snapshots', item), 0o600);
    }
    await fsp.rm(root, { recursive: true, force: true });
  });
  async function file(name, text = name, options = {}, rootId = 'workspace') {
    const rootPath = rootId === 'workspace' ? project.workspacePath : project.rawPath;
    await fsp.mkdir(path.dirname(path.join(rootPath, name)), { recursive: true });
    await fsp.writeFile(path.join(rootPath, name), text);
    return (await service.store.registerFiles([{ location: { kind: rootId === 'workspace' ? 'workspace' : 'legacy_raw', rootId, relativePath: name } }], options)).result[0];
  }
  function mainContext() {
    return vm.createContext({ ...host, path, fs,
      projectPathsFor: () => project,
      collectProjectRawFiles: () => { throw new Error('unexpected raw directory scan'); },
      projectDigestStatePath: () => { throw new Error('unexpected legacy state read'); },
      readProjectKnowledgeReview: () => ({ records: [] }),
    });
  }
  return { root, project, service, file, mainContext };
}

test('storage configuration survives normalization and cannot silently downgrade unknown versions', () => {
  assert.equal(host.normalizeMaterialConfiguration({}).materialStorageMode, 'legacy');
  const config = host.normalizeMaterialConfiguration({ materialStorageMode: 'workspace-v1', inboxRelativePath: '新资料',
    materialOrganizationPolicy: { mode: 'automatic', autoMoveRoots: ['新资料'], respectManualClassification: false } });
  assert.equal(config.inboxRelativePath, '新资料');
  assert.equal(config.materialOrganizationPolicy.respectManualClassification, true);
  assert.throws(() => host.normalizeMaterialConfiguration({ materialStorageMode: 'workspace-v2' }), { code: 'unsupported_storage_mode' });
  assert.throws(() => host.normalizeMaterialConfiguration({ materialRegistryVersion: 2 }), { code: 'unsupported_registry_version' });
  assert.throws(() => host.normalizeMaterialConfiguration({ inboxRelativePath: '../private' }), { code: 'invalid_path' });
  assert.throws(() => host.normalizeMaterialConfiguration({ materialOrganizationPolicy: { autoMoveRoots: ['成果'] } }), { code: 'invalid_policy' });
});

test('terminal uploads enter the workspace inbox, keep a stable source event and bind the legacy asset', async (t) => {
  const f = await fixture(t);
  const inbox = path.join(f.project.workspacePath, '收件箱');
  await fsp.mkdir(inbox);
  const target = path.join(inbox, '新资料.txt');
  await fsp.writeFile(target, 'uploaded bytes');
  const first = await f.service.registerTerminalUpload(target, {
    eventId: 'request-1', studentId: 'student-1', deviceId: 'device-1',
  });
  const repeated = await f.service.registerTerminalUpload(target, {
    eventId: 'request-1', studentId: 'student-1', deviceId: 'device-1',
  });
  assert.equal(first.material.materialId, repeated.material.materialId);
  assert.equal(repeated.material.version, 1);
  assert.equal(repeated.material.adoption.state, 'accepted');
  assert.equal(repeated.material.sources.length, 1);
  assert.equal(repeated.material.location.relativePath, '收件箱/新资料.txt');
  const asset = { assetId: 'asset-upload-1', sha1: first.material.sha1,
    references: [{ spaceType: 'project', spaceId: f.project.id, path: target }] };
  await f.service.bindUploadedAsset(first.material.materialId, { ...asset, size: first.material.size });
  assert.equal((await f.service.resolveAsset(asset.assetId)).materialId, first.material.materialId);
  const secondPath = path.join(inbox, '同内容另一文件.txt');
  await fsp.writeFile(secondPath, 'uploaded bytes');
  const second = await f.service.registerTerminalUpload(secondPath, { eventId: 'request-2' });
  assert.notEqual(second.material.materialId, first.material.materialId);
  await f.service.bindUploadedAsset(second.material.materialId, { ...asset, size: second.material.size,
    references: [...asset.references, { spaceType: 'project', spaceId: f.project.id, path: secondPath }] });
  assert.equal((await f.service.store.read()).materials.length, 2);
  await assert.rejects(f.service.resolveAsset(asset.assetId), { code: 'ambiguous_asset' });
  const outside = path.join(f.project.workspacePath, '提交成果', 'b.txt');
  await fsp.mkdir(path.dirname(outside)); await fsp.writeFile(outside, 'manual');
  await assert.rejects(f.service.registerTerminalUpload(outside, { eventId: 'request-2' }), { code: 'invalid_upload_location' });
});

test('product digest queries read registry only, distinguish candidate/adopted and observe atomic updates', async (t) => {
  const f = await fixture(t);
  const item = await f.file('a.txt'); await f.file('candidate.txt', 'private draft', { intent: 'later' });
  const context = f.mainContext();
  vm.runInContext(extract('readProjectDigestState'), context);
  await fsp.rename(f.project.workspacePath, `${f.project.workspacePath}-offline`);
  await fsp.rename(f.project.rawPath, `${f.project.rawPath}-offline`);
  for (let i = 0; i < 10; i++) {
    const state = context.readProjectDigestState(f.project);
    assert.equal(state.rawFileCount, 1); assert.equal(state.pendingCount, 1);
    assert.equal(state.candidateCount, 1); assert.equal(state.pendingFiles[0].materialId, item.materialId);
    assert.equal('path' in state.pendingFiles[0], false);
  }
  await f.service.store.mutate((index) => { index.materials[0].processing = { state: 'completed', processedVersion: 1 }; });
  assert.equal(context.readProjectDigestState(f.project).pendingCount, 0);
  const copy = host.readProjectMaterialIndexSync(f.project); copy.materials.length = 0;
  assert.equal(host.readProjectMaterialIndexSync(f.project).materials.length, 2);
});

test('corrupt or another-project registry fails closed without legacy fallback', async (t) => {
  const f = await fixture(t); await f.file('a.txt');
  assert.throws(() => host.readProjectMaterialIndexSync({ ...f.project, id: 'other-project' }), { code: 'registry_corrupt' });
  await fsp.writeFile(f.service.store.indexPath, '{broken');
  assert.throws(() => host.readProjectMaterialIndexSync(f.project), { code: 'registry_corrupt' });
});

test('legacy asset mapping ignores global path and requires matching project reference and real bytes', async (t) => {
  const f = await fixture(t); const item = await f.file('source.txt', 'source');
  const asset = { assetId: 'asset-1', sha1: item.sha1, path: path.join(f.root, 'foreign-student', 'private.txt'),
    references: [{ spaceType: 'project', spaceId: 'p1', path: path.join(f.project.workspacePath, 'source.txt') }] };
  assert.equal((await f.service.bindLegacyAssets([asset]))[0].ok, true);
  const resolved = await f.service.resolveAsset('asset-1');
  assert.equal(resolved.materialId, item.materialId);
  assert.equal(resolved.path, path.join(f.project.workspacePath, 'source.txt'));
  assert.equal((await f.service.bindLegacyAssets([{ ...asset, assetId: 'foreign', references: [{ ...asset.references[0], spaceId: 'p2' }] }]))[0].code, 'forbidden');
  await assert.rejects(f.service.resolveAsset('foreign'), { code: 'asset_unmapped' });
  await fsp.writeFile(resolved.path, 'new unregistered bytes');
  await assert.rejects(f.service.resolveAsset('asset-1'), { code: 'source_changed' });
});

test('ambiguous identical project files are not arbitrarily merged into one asset identity', async (t) => {
  const f = await fixture(t); const a = await f.file('a.txt', 'same'); await f.file('b.txt', 'same');
  const asset = { assetId: 'same-asset', sha1: a.sha1, references: ['a.txt', 'b.txt'].map((name) => (
    { spaceType: 'project', spaceId: 'p1', path: path.join(f.project.workspacePath, name) })) };
  assert.equal((await f.service.bindLegacyAssets([asset]))[0].code, 'ambiguous_asset');
  await assert.rejects(f.service.resolveAsset(asset.assetId), { code: 'asset_unmapped' });
});

test('multiple old asset aliases can bind one project version atomically and replay idempotently', async (t) => {
  const f = await fixture(t); const item = await f.file('a.txt');
  const assets = ['asset-a', 'asset-b'].map((assetId) => ({ assetId, sha1: item.sha1,
    references: [{ spaceType: 'project', spaceId: 'p1', path: path.join(f.project.workspacePath, 'a.txt') }] }));
  assert.equal((await f.service.bindLegacyAssets(assets)).filter((item) => item.ok).length, 2);
  assert.equal((await f.service.bindLegacyAssets(assets)).filter((item) => item.ok).length, 2);
  assert.equal((await f.service.store.read()).materials[0].links.assets.length, 2);
});

test('asset identity refers to fixed original version after later edits', async (t) => {
  const f = await fixture(t); const a = await f.file('a.txt', 'version one');
  await f.service.store.snapshot(a.materialId, 1);
  await f.service.bindLegacyAssets([{ assetId: 'old-content', sha1: a.sha1,
    references: [{ spaceType: 'project', spaceId: 'p1', path: path.join(f.project.workspacePath, 'a.txt') }] }]);
  await f.file('a.txt', 'version two');
  assert.equal(await fsp.readFile((await f.service.resolveAsset('old-content')).path, 'utf8'), 'version one');
});

test('publication uses only adopted version snapshots; later originals cannot mutate queued bytes', async (t) => {
  const f = await fixture(t); const a = await f.file('a.txt', 'published version');
  await f.file('private.txt', 'candidate must never be sent', { intent: 'later' });
  const context = f.mainContext(); vm.runInContext(extract('projectPublicationFiles'), context);
  const sources = await context.projectPublicationFiles(f.project, { scope: 'whole' });
  assert.equal(sources.length, 1); assert.equal(sources[0].materialId, a.materialId);
  assert.equal(sources[0].relativePath, 'workspace/a.txt');
  await fsp.writeFile(path.join(f.project.workspacePath, 'a.txt'), 'changed after preparation');
  assert.equal(await fsp.readFile(sources[0].sourcePath, 'utf8'), 'published version');
  assert.ok((await f.service.store.read()).materials[0].versions[0].pins.some((value) => value.startsWith('publication:')));
});

test('selected publication cannot expand an empty selection, accept candidates, or substitute versions', async (t) => {
  const f = await fixture(t); const a = await f.file('a.txt'); const draft = await f.file('draft.txt', 'draft', { intent: 'later' });
  await assert.rejects(f.service.publicationSources({ scope: 'selected' }), { code: 'empty_selection' });
  await assert.rejects(f.service.publicationSources({ scope: 'selected', materials: [{ materialId: draft.materialId, version: 1 }] }), { code: 'source_not_adopted' });
  await assert.rejects(f.service.publicationSources({ scope: 'selected', materials: [{ materialId: a.materialId, version: 2 }] }), { code: 'version_conflict' });
  await assert.rejects(f.service.publicationSources({ scope: 'selected', selectedPaths: ['draft.txt'] }), { code: 'source_not_adopted' });
  const selected = await f.service.publicationSources({ scope: 'selected', materials: [{ materialId: a.materialId, version: 1 }] });
  assert.equal(selected.length, 1);
});

test('same-named workspace/legacy documents retain distinct package paths and explicit selection', async (t) => {
  const f = await fixture(t); await f.file('a.txt', 'work'); await f.file('a.txt', 'legacy', {}, 'legacy');
  assert.equal(new Set((await f.service.publicationSources()).map((item) => item.relativePath)).size, 2);
  await assert.rejects(f.service.publicationSources({ scope: 'selected', selectedPaths: ['a.txt'] }), { code: 'ambiguous_selection' });
  const context = f.mainContext(); vm.runInContext(extract('projectPublicationFiles'), context);
  const result = await context.projectPublicationFiles(f.project, { scope: 'selected', selectedPaths: ['legacy/a.txt'] });
  assert.equal(result.length, 1); assert.equal(result[0].relativePath, 'legacy/a.txt');
});

test('new-mode publication baselines do not leak unselected staging metadata', async (t) => {
  const f = await fixture(t); const context = f.mainContext();
  vm.runInContext(extract('projectPublicationWorkspaceBaseline'), context);
  vm.runInContext(extract('projectPublicationDigestBaseline'), context);
  const project = { ...f.project, stagingItems: [{ filename: 'private-name' }] };
  assert.equal(context.projectPublicationWorkspaceBaseline(project).length, 0);
  const sources = [{ kind: 'raw_material', relativePath: 'workspace/a.txt', sha1: 'a'.repeat(40), processed: true },
    { kind: 'raw_material', relativePath: 'workspace/b.txt', sha1: 'b'.repeat(40), processed: false }];
  assert.equal(context.projectPublicationDigestBaseline(project, sources).length, 1);
});

test('publication transport preserves path-neutral material identity and rejects hash/version mismatch', () => {
  const make = (sourceMaterial) => createProjectPublication({ sourceNodeId: 'n1', sourceProjectId: 'p1', targetNodeId: 'n2',
    project: { name: 'Synthetic' }, entries: [{ kind: 'raw_material', relativePath: 'workspace/a.txt', sha256: 'a'.repeat(64), sourceMaterial }] });
  const publication = make({ materialId: 'm1', version: 2, sha256: 'a'.repeat(64), path: 'D:\\private' });
  assert.deepEqual(publication.entries[0].sourceMaterial, { materialId: 'm1', version: 2, sha256: 'a'.repeat(64) });
  assert.equal(validateProjectPublication(publication).ok, true);
  assert.equal(validateProjectPublication(make({ materialId: 'm1', version: 0, sha256: 'a'.repeat(64) })).ok, false);
  assert.equal(validateProjectPublication(make({ materialId: 'm1', version: 1, sha256: 'b'.repeat(64) })).ok, false);
});

test('old digest command/receipt routes reject new-mode projects before any legacy mutation', async (t) => {
  const f = await fixture(t); const context = f.mainContext();
  context.mutableProject = () => ({ project: f.project });
  context.readProjects = () => [f.project]; context.normalizeProject = (item) => item;
  context.ensureProjectWorkspace = () => { throw new Error('unsafe legacy workspace mutation'); };
  for (const name of ['getProjectDigestCommand', 'applyProjectDigestReceiptText', 'syncProjectDigestResult', 'registerProjectDigestBatch', 'writeProjectDigestState']) {
    vm.runInContext(extract(name), context);
  }
  assert.equal(JSON.parse(context.getProjectDigestCommand('p1')).code, 'controlled_adapter_required');
  assert.equal(JSON.parse(context.applyProjectDigestReceiptText('p1', '消化完成')).code, 'strict_receipt_required');
  assert.equal(JSON.parse(context.syncProjectDigestResult('p1')).code, 'strict_receipt_required');
  assert.equal(context.registerProjectDigestBatch(f.project).code, 'controlled_adapter_required');
  assert.throws(() => context.writeProjectDigestState(f.project, { status: 'completed' }), /受控批次/);
  assert.equal(fs.existsSync(f.project.managerPath), false);
});

async function publicationFixture(t, changeDuringPreparation) {
  const f = await fixture(t);
  await f.file('a.txt', 'source to publish');
  await f.file('private.txt', 'private', { intent: 'later' });
  let projects = [{ ...f.project, status: 'active', studentIds: ['s1'] }, { id: 'p2', description: 'old' }];
  const sent = [];
  const context = f.mainContext();
  Object.assign(context, require('../electron/collaboration-project-publication.cjs'), {
    app: { getPath: () => f.root },
    readProjects: () => structuredClone(projects),
    writeProjects: (value) => { projects = structuredClone(value); },
    normalizeProject: (value) => value, normalizeProjectMetadata: (value) => value,
    ensureProjectWorkspace: (value) => value,
    readCollaborationState: () => ({ enabled: true, node: { nodeId: 'n1' } }),
    projectPublicationPeerOptions: () => [{ peerNodeId: 'n2', targetStudentIds: ['remote-s1'] }],
    isDeepStrictEqual: require('node:util').isDeepStrictEqual,
    sha256CollaborationFile: (file) => require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
    writeJsonAtomic: (file, value) => fs.writeFileSync(file, JSON.stringify(value)),
    safeReadJson: (file, fallback) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback,
    collaborationProjectPublicationPath: () => path.join(f.root, 'publication-store.json'),
    collaborationTransport: () => ({ sendPackage: (options) => {
      sent.push(options.files.map((file) => ({ ...file, bytes: fs.readFileSync(file.sourcePath) })));
      return { packageId: 'synthetic-package' };
    } }),
    queueDirectCollaborationDelivery: () => ({ queued: true }),
  });
  for (const name of ['projectPublicationFiles', 'projectPublicationWorkspaceBaseline', 'projectPublicationDigestBaseline', 'publishCollaborationProjectLocked']) {
    vm.runInContext(extract(name), context);
  }
  const prepare = context.projectPublicationFiles;
  context.projectPublicationFiles = async (...args) => {
    const result = await prepare(...args);
    changeDuringPreparation?.(projects);
    return result;
  };
  const result = JSON.parse(await context.publishCollaborationProjectLocked(JSON.stringify({ projectId: 'p1', targetNodeId: 'n2' })));
  return { f, result, projects, sent };
}

test('real product publish path packages adopted source identity and preserves concurrent metadata edits', async (t) => {
  const { result, projects, sent } = await publicationFixture(t, (projects) => {
    projects[0].description = 'edited while snapshotting'; projects[1].description = 'other project new data';
  });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.rawCount, 1); assert.equal(sent.length, 1);
  const raw = sent[0].filter((file) => file.objectType === 'project_raw_material');
  assert.equal(raw.length, 1); assert.equal(raw[0].bytes.toString(), 'source to publish');
  assert.ok(result.publication.entries.find((entry) => entry.kind === 'raw_material').sourceMaterial.materialId);
  assert.equal(projects[0].description, 'edited while snapshotting');
  assert.equal(projects[1].description, 'other project new data');
  assert.equal(JSON.stringify(result.publication).includes('private.txt'), false);
});

test('scope revocation during asynchronous preparation prevents any package being sent', async (t) => {
  const { result, sent } = await publicationFixture(t, (projects) => { projects[0].studentIds = []; });
  assert.equal(result.code, 'publication_scope_changed');
  assert.equal(sent.length, 0);
});

test('asset registration with both student and project context keeps the project reference scoped to its project', async (t) => {
  const f = await fixture(t); const item = await f.file('a.txt', 'source');
  let assets = [];
  const context = vm.createContext({ fs, path, crypto: require('node:crypto'),
    sha1File: () => item.sha1, readAssetIndex: () => assets, writeAssetIndex: (value) => { assets = value; },
    readStudentsIndex: () => [], normalizeAssetReference: (value) => value,
    mergeAssetReferences: require('../electron/asset-statistics.cjs').mergeAssetReferences,
    materialTypeForFile: () => 'text' });
  vm.runInContext(extract('mergeUnique'), context);
  vm.runInContext(extract('upsertAssetFromFile'), context);
  const asset = context.upsertAssetFromFile(path.join(f.project.workspacePath, 'a.txt'), {
    spaceType: 'project', projectId: 'p1', projectName: '项目', studentId: 's1', studentName: '学生' });
  assert.equal(asset.references[0].spaceId, 'p1');
  assert.equal(asset.references[0].spaceName, '项目');
  assert.equal(asset.ownerStudentId, 's1');
  assert.equal((await f.service.bindLegacyAssets([asset]))[0].ok, true);
});
