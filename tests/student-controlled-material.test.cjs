'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createProjectMaterialHost } = require('../electron/project-material-host.cjs');
const { studentControlledProject, registerStudentControlledBatch,
  finalizeStudentControlledDigest } = require('../electron/student-controlled-material.cjs');

test('student controlled digest keeps a student-scoped synthetic registry and host-authored receipt', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-student-controlled-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const raw = path.join(root, 'raw'), summary = path.join(root, 'summary'), manager = path.join(root, 'manager');
  await fs.mkdir(raw); await fs.mkdir(path.join(root, '摘要库')); await fs.writeFile(path.join(root, '摘要库', 'knowledge.md'), '# Knowledge');
  const source = path.join(raw, 'source.txt'); await fs.writeFile(source, 'fixed source');
  const bytes = await fs.readFile(source), sha1 = crypto.createHash('sha1').update(bytes).digest('hex');
  const student = { id: 'student-a', name: 'A', rootPath: root, rawPath: raw, summaryPath: summary, agentTool: 'workbuddy' };
  const project = studentControlledProject(student, manager);
  assert.equal(project.studentIds[0], 'student-a'); assert.equal(project.knowledgeRootPath, root);
  const batch = { batchId: 'batch-a', files: [{ materialId: 'm1', path: source, relativePath: 'source.txt', sha1 }] };
  const receiptPath = path.join(manager, 'receipt.json');
  const receipt = await finalizeStudentControlledDigest({ student, batch, receiptPath, summaryPath: summary, output: { fullyCommitted: true }, now: () => '2026-10-13T12:00:00.000Z' });
  assert.equal(receipt.processed[0].materialId, 'm1');
  assert.match(await fs.readFile(path.join(summary, 'index.md'), 'utf8'), /controlled-digest:batch-a/);
  assert.equal(JSON.parse(await fs.readFile(receiptPath, 'utf8')).studentId, 'student-a');
});

test('student controlled digest refuses settlement when the frozen original changes', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-student-changed-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const raw = path.join(root, 'raw'), summary = path.join(root, 'summary'); await fs.mkdir(raw); await fs.mkdir(summary);
  const source = path.join(raw, 'source.txt'); await fs.writeFile(source, 'changed');
  await assert.rejects(finalizeStudentControlledDigest({ student: { id: 's', rootPath: root },
    batch: { batchId: 'b', files: [{ materialId: 'm', path: source, sha1: '0'.repeat(40) }] },
    receiptPath: path.join(root, 'receipt.json'), summaryPath: summary, output: { fullyCommitted: true } }), { code: 'SOURCE_CHANGED' });
});

test('student batch is registered once in the controlled material registry without moving its original', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-student-register-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const raw = path.join(root, 'raw'), manager = path.join(root, 'manager');
  await fs.mkdir(raw);
  const source = path.join(raw, 'original.txt'); await fs.writeFile(source, 'student controlled original');
  const project = studentControlledProject({ id: 'student-a', name: 'A', rootPath: root, rawPath: raw }, manager);
  const host = createProjectMaterialHost(project);
  const batch = { batchId: 'batch-register', files: [{ materialId: 'student-material-1', path: source }] };
  const first = await registerStudentControlledBatch(host, batch, 'student-a');
  const repeated = await registerStudentControlledBatch(host, batch, 'student-a');
  assert.equal(first[0].projectMaterialId, repeated[0].projectMaterialId);
  const index = await host.store.read();
  assert.equal(index.materials.length, 1);
  assert.equal(index.materials[0].sources.length, 1);
  assert.equal(index.materials[0].sources[0].studentId, 'student-a');
  assert.equal(index.materials[0].sources[0].type, 'student_controlled_digest');
  assert.equal(await fs.readFile(source, 'utf8'), 'student controlled original');
});

test('main routes supported student digestion through the controlled material pipeline', async () => {
  const main = await fs.readFile(path.join(__dirname, '../electron/main.cjs'), 'utf8');
  assert.match(main, /providerSupportsProfile\(String\(student\.agentTool \|\| ''\), DIGEST_PROFILE\)/);
  assert.match(main, /registerStudentControlledBatch\(host, batch, student\.id\)/);
  assert.match(main, /submitProjectMaterialTask\(refreshed, controlledProject, selected, \{ student, batch/);
  const start = main.indexOf('async function submitProjectMaterialTask(');
  const end = main.indexOf('\nfunction submitCodexTask(', start);
  const submit = main.slice(start, end);
  assert.doesNotMatch(submit, /workbuddyControlledConsent/);
  assert.match(submit, /circuit\.category !== 'authorization'/);
  assert.match(submit, /persistWorkBuddyControlledStatus\(workBuddyRuntime, auth, qualification\)/);
  assert.match(submit, /系统会自动复检，不需要单独检测/);
});
