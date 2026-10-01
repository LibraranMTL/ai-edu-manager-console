const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createProjectUploadIntake } = require('../electron/project-upload-intake.cjs');

test('a durable upload intent reuses verified landed bytes after restart and rejects changed retries', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-upload-intake-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-upload-intake-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const project = { id: 'project-1', workspacePath: path.join(root, 'workspace'),
    managerPath: path.join(root, '.edu-manager'), inboxRelativePath: '收件箱' };
  const target = path.join(project.workspacePath, '收件箱', 'a.txt');
  await fs.mkdir(path.dirname(target), { recursive: true });
  const bytes = Buffer.from('persisted original');
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const scope = { uploadId: 'request-1', studentId: 'student-1', deviceId: 'device-1',
    targetPath: target, expectedSha256: sha256 };
  const intake = createProjectUploadIntake(project);
  const prepared = await intake.prepare(scope);
  assert.equal((await intake.pending()).length, 1);
  await fs.writeFile(target, bytes);
  const restarted = createProjectUploadIntake(project);
  const resumed = await restarted.prepare({ ...scope, targetPath: path.join(project.workspacePath, '收件箱', 'a (1).txt') });
  assert.equal(restarted.targetFor(resumed.relativePath), target);
  assert.equal((await restarted.verifyExisting(resumed, { size: bytes.length, sha256 })).sha256, sha256);
  await assert.rejects(restarted.verifyExisting(resumed, { size: bytes.length, sha256: '0'.repeat(64) }),
    { code: 'upload_id_content_conflict' });
  const written = await restarted.recordWritten(resumed, { size: bytes.length, sha256 });
  assert.equal(written.state, 'written');
  assert.equal((await restarted.pending())[0].sha256, sha256);
  const changed = Buffer.from('different bytes');
  await fs.writeFile(target, changed);
  await assert.rejects(restarted.recordWritten(written, { size: changed.length,
    sha256: crypto.createHash('sha256').update(changed).digest('hex') }), { code: 'source_changed' });
  await fs.writeFile(target, bytes);
  await restarted.complete(written);
  assert.deepEqual(await restarted.pending(), []);
  assert.equal(prepared.key, resumed.key);
});

test('startup recovers only hash-verifiable originals and preserves uncertain records for retry', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-upload-intake-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-upload-intake-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const project = { id: 'project-1', workspacePath: path.join(root, 'workspace'),
    managerPath: path.join(root, '.edu-manager'), inboxRelativePath: '收件箱' };
  const intake = createProjectUploadIntake(project);
  const target = path.join(project.workspacePath, '收件箱', 'verified.txt');
  const uncertain = path.join(project.workspacePath, '收件箱', 'uncertain.txt');
  const missing = path.join(project.workspacePath, '收件箱', 'missing.txt');
  const lostAfterWrite = path.join(project.workspacePath, '收件箱', 'lost.txt');
  await fs.mkdir(path.dirname(target), { recursive: true });
  const bytes = Buffer.from('verified original');
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  await intake.prepare({ uploadId: 'verified', targetPath: target, expectedSha256: hash });
  await intake.prepare({ uploadId: 'uncertain', targetPath: uncertain });
  await intake.prepare({ uploadId: 'missing', targetPath: missing });
  const lost = await intake.prepare({ uploadId: 'lost', targetPath: lostAfterWrite });
  await fs.writeFile(target, bytes);
  await fs.writeFile(uncertain, 'no declared hash before crash');
  await fs.writeFile(lostAfterWrite, bytes);
  await intake.recordWritten(lost, { size: bytes.length, sha256: hash });
  await fs.unlink(lostAfterWrite);
  const committed = [];
  const result = await createProjectUploadIntake(project).recoverPending(async (entry, file) => {
    committed.push([entry.uploadId, file.sha256]);
  });
  assert.deepEqual(committed, [['verified', hash]]);
  assert.equal(result.recovered.length, 1);
  assert.equal(result.abandoned.length, 1);
  assert.deepEqual(result.issues.map((issue) => issue.code).sort(), ['source_missing', 'unverified_prepared']);
  assert.deepEqual((await intake.pending()).map((entry) => entry.uploadId).sort(), ['lost', 'uncertain']);
});

test('recovery passes the candidate intent to the commit callback without promoting it', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-upload-intake-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edu-upload-intake-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const project = { id: 'project-1', workspacePath: path.join(root, 'workspace'),
    managerPath: path.join(root, '.edu-manager'), inboxRelativePath: '收件箱' };
  const target = path.join(project.workspacePath, '收件箱', 'candidate.txt');
  await fs.mkdir(path.dirname(target), { recursive: true });
  const bytes = Buffer.from('candidate only');
  const expectedSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const intake = createProjectUploadIntake(project);
  await intake.prepare({ uploadId: 'candidate-1', deviceId: 'local-host', targetPath: target,
    expectedSha256, sourceType: 'staging_import', intent: 'later' });
  await fs.writeFile(target, bytes);
  const seen = [];
  const result = await createProjectUploadIntake(project).recoverPending(async (entry, source) => {
    seen.push({ intent: entry.intent, sourceType: entry.sourceType, sha256: source.sha256 });
  });
  assert.deepEqual(seen, [{ intent: 'later', sourceType: 'staging_import', sha256: expectedSha256 }]);
  assert.equal(result.recovered.length, 1);
  assert.deepEqual(await intake.pending(), []);
});
