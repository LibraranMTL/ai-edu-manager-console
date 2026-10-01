const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { stageProjectDirectImport } = require('../electron/project-direct-import.cjs');
const { createProjectUploadIntake } = require('../electron/project-upload-intake.cjs');
const { createProjectMaterialHost, projectMaterialDigestProjection } = require('../electron/project-material-host.cjs');

test('local direct import publishes a stable copy in the workspace inbox and resumes without a second file', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-project-direct-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-project-direct-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const project = { id: 'project-1', workspacePath: path.join(root, 'workspace'),
    managerPath: path.join(root, '.edu-manager'), inboxRelativePath: '收件箱' };
  const source = path.join(root, 'source.txt');
  const target = path.join(project.workspacePath, '收件箱', 'source.txt');
  await fs.mkdir(project.workspacePath);
  await fs.writeFile(source, 'local original');
  const first = await stageProjectDirectImport(project, source, target);
  assert.equal(await fs.readFile(target, 'utf8'), 'local original');
  assert.equal(first.entry.sourceType, 'direct_import');
  assert.equal(first.entry.state, 'written');
  assert.equal((await createProjectUploadIntake(project).pending()).length, 1);
  const second = await stageProjectDirectImport(project, source,
    path.join(project.workspacePath, '收件箱', 'source (1).txt'));
  assert.equal(second.target, target);
  assert.equal(second.uploadId, first.uploadId);
  assert.deepEqual((await fs.readdir(path.dirname(target))).sort(), ['source.txt']);
  await first.intake.complete(first.entry);
  assert.deepEqual(await createProjectUploadIntake(project).pending(), []);
});

test('known local import event can skip a second copy without creating a new journal', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-project-direct-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-project-direct-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const project = { id: 'project-1', workspacePath: path.join(root, 'workspace'),
    managerPath: path.join(root, '.edu-manager'), inboxRelativePath: '收件箱' };
  const source = path.join(root, 'source.txt');
  await fs.mkdir(project.workspacePath);
  await fs.writeFile(source, 'local original');
  const result = await stageProjectDirectImport(project, source,
    path.join(project.workspacePath, '收件箱', 'source.txt'),
    { findExisting: async () => ({ materialId: 'material-1' }) });
  assert.equal(result.alreadyImported, true);
  assert.deepEqual(await fs.readdir(path.join(project.workspacePath, '收件箱')), []);
  assert.deepEqual(await createProjectUploadIntake(project).pending(), []);
});

test('research staging shares the inbox intake but retains a distinct candidate intent across restart', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-project-direct-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-project-direct-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const project = { id: 'project-1', workspacePath: path.join(root, 'workspace'),
    managerPath: path.join(root, '.edu-manager'), inboxRelativePath: '收件箱' };
  const source = path.join(root, 'source.txt');
  await fs.mkdir(project.workspacePath);
  await fs.writeFile(source, 'research original');
  const first = await stageProjectDirectImport(project, source,
    path.join(project.workspacePath, '收件箱', 'source.txt'),
    { sourceType: 'staging_import', intent: 'later' });
  assert.match(first.uploadId, /^staging-/);
  assert.equal(first.entry.intent, 'later');
  assert.equal(first.entry.sourceType, 'staging_import');
  const intake = createProjectUploadIntake(project);
  const [pending] = await intake.pending();
  assert.equal(pending.intent, 'later');
  assert.equal(pending.sourceType, 'staging_import');
  assert.equal((await intake.verifyExisting(pending, first.fingerprint)).sha256, first.fingerprint.sha256);
  const hostProject = { ...project, rawPath: path.join(root, 'legacy-raw'),
    materialStorageMode: 'workspace-v1' };
  const host = createProjectMaterialHost(hostProject);
  const registered = await host.registerTerminalUpload(first.target, { eventId: first.uploadId,
    deviceId: 'local-host', sourceType: pending.sourceType, intent: pending.intent });
  assert.equal(registered.material.adoption.state, 'candidate');
  assert.equal(registered.material.sources[0].type, 'staging_import');
  const digest = projectMaterialDigestProjection(hostProject, await host.store.read());
  assert.equal(digest.candidateCount, 1);
  assert.equal(digest.pendingCount, 0);
  await assert.rejects(intake.prepare({ uploadId: first.uploadId, deviceId: 'local-host',
    targetPath: first.target, expectedSha256: first.fingerprint.sha256,
    sourceType: 'staging_import', intent: 'active' }), { code: 'upload_id_content_conflict' });
  await intake.complete(first.entry);
});

test('capture import keeps student, session and item scope in its durable intake', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-project-direct-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-project-direct-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const project = { id: 'project-1', workspacePath: path.join(root, 'workspace'),
    managerPath: path.join(root, '.edu-manager'), inboxRelativePath: '收件箱' };
  const source = path.join(root, 'screenshot.png');
  await fs.mkdir(project.workspacePath);
  await fs.writeFile(source, 'synthetic screenshot bytes');
  const options = { sourceType: 'capture_import', intent: 'active', studentId: 'student-1',
    captureSessionId: 'session-1', captureItemId: 'item-1' };
  const first = await stageProjectDirectImport(project, source,
    path.join(project.workspacePath, '收件箱', 'screenshot.png'), options);
  assert.match(first.uploadId, /^capture-/);
  const [pending] = await createProjectUploadIntake(project).pending();
  assert.equal(pending.studentId, 'student-1');
  assert.equal(pending.captureSessionId, 'session-1');
  assert.equal(pending.captureItemId, 'item-1');
  assert.equal(pending.sourceType, 'capture_import');
  await assert.rejects(createProjectUploadIntake(project).prepare({
    uploadId: 'wrong-capture-intent', studentId: 'student-1', deviceId: 'local-host',
    targetPath: first.target, expectedSha256: first.fingerprint.sha256,
    sourceType: 'capture_import', intent: 'later', captureSessionId: 'session-1', captureItemId: 'item-1',
  }), { code: 'invalid_intent' });
  await assert.rejects(createProjectUploadIntake(project).prepare({
    uploadId: first.uploadId, studentId: 'student-1', deviceId: 'local-host',
    targetPath: first.target, expectedSha256: first.fingerprint.sha256,
    sourceType: 'capture_import', intent: 'active', captureSessionId: 'session-1', captureItemId: 'item-2',
  }), { code: 'upload_id_content_conflict' });
  const second = await stageProjectDirectImport(project, source,
    path.join(project.workspacePath, '收件箱', 'screenshot (1).png'), options);
  assert.equal(second.target, first.target);
  assert.equal(second.uploadId, first.uploadId);
  await first.intake.complete(first.entry);
});

test('conversation delivery keeps student, delivery and source asset identity in its durable intake', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-project-direct-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-project-direct-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const project = { id: 'project-1', workspacePath: path.join(root, 'workspace'),
    managerPath: path.join(root, '.edu-manager'), inboxRelativePath: '收件箱' };
  const source = path.join(root, 'conversation.md');
  await fs.mkdir(project.workspacePath);
  await fs.writeFile(source, 'synthetic conversation bytes');
  const options = { sourceType: 'conversation_delivery', intent: 'active', studentId: 'student-1',
    conversationDeliveryId: 'delivery-1', conversationAssetId: 'asset-1' };
  const first = await stageProjectDirectImport(project, source,
    path.join(project.workspacePath, '收件箱', 'conversation.md'), options);
  assert.match(first.uploadId, /^conversation-/);
  const [pending] = await createProjectUploadIntake(project).pending();
  assert.equal(pending.studentId, 'student-1');
  assert.equal(pending.conversationDeliveryId, 'delivery-1');
  assert.equal(pending.conversationAssetId, 'asset-1');
  await assert.rejects(createProjectUploadIntake(project).prepare({
    uploadId: first.uploadId, studentId: 'student-1', deviceId: 'local-host', targetPath: first.target,
    expectedSha256: first.fingerprint.sha256, sourceType: 'conversation_delivery', intent: 'active',
    conversationDeliveryId: 'delivery-1', conversationAssetId: 'asset-2',
  }), { code: 'upload_id_content_conflict' });
  await assert.rejects(createProjectUploadIntake(project).prepare({
    uploadId: 'wrong-intent', studentId: 'student-1', deviceId: 'local-host', targetPath: first.target,
    sourceType: 'conversation_delivery', intent: 'later',
    conversationDeliveryId: 'delivery-1', conversationAssetId: 'asset-1',
  }), { code: 'invalid_intent' });
  await first.intake.complete(first.entry);
});

test('conversation submission keeps the project interaction identity across a restarted intake', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-project-direct-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-project-direct-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const project = { id: 'project-1', workspacePath: path.join(root, 'workspace'),
    managerPath: path.join(root, '.edu-manager'), inboxRelativePath: '收件箱' };
  await fs.mkdir(project.workspacePath);
  const source = path.join(root, 'conversation.md');
  await fs.writeFile(source, 'synthetic Agent conversation');
  const options = { sourceType: 'conversation_submission', intent: 'active', studentId: 'student-1',
    conversationAssetId: 'asset-1', conversationInteractionId: 'interaction-1' };
  const first = await stageProjectDirectImport(project, source,
    path.join(project.workspacePath, '收件箱', 'conversation.md'), options);
  assert.match(first.uploadId, /^conversation-submission-/);
  const [pending] = await createProjectUploadIntake(project).pending();
  assert.equal(pending.studentId, 'student-1');
  assert.equal(pending.conversationAssetId, 'asset-1');
  assert.equal(pending.conversationInteractionId, 'interaction-1');
  await assert.rejects(createProjectUploadIntake(project).prepare({
    uploadId: first.uploadId, studentId: 'student-1', deviceId: 'local-host', targetPath: first.target,
    expectedSha256: first.fingerprint.sha256, sourceType: 'conversation_submission', intent: 'active',
    conversationAssetId: 'asset-1', conversationInteractionId: 'interaction-2',
  }), { code: 'upload_id_content_conflict' });
  await first.intake.complete(first.entry);
});

test('direct import refuses a linked inbox before writing any copy', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-project-direct-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-project-direct-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const project = { id: 'project-1', workspacePath: path.join(root, 'workspace'),
    managerPath: path.join(root, '.edu-manager'), inboxRelativePath: '收件箱' };
  const outside = path.join(root, 'outside');
  await fs.mkdir(project.workspacePath);
  await fs.mkdir(outside);
  try { await fs.symlink(outside, path.join(project.workspacePath, '收件箱'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) return t.skip('创建目录链接需要系统授权'); throw error; }
  const source = path.join(root, 'source.txt');
  await fs.writeFile(source, 'original');
  await assert.rejects(stageProjectDirectImport(project, source,
    path.join(project.workspacePath, '收件箱', 'source.txt')), { code: 'linked_path' });
  assert.deepEqual(await fs.readdir(outside), []);
});
