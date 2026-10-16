const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { buildDigestBatch } = require('../electron/digest-batch.cjs');
const { validateDigestResult } = require('../electron/digest-result.cjs');
const {
  canReuseStudentDigestBatch,
  digestUserStatus,
  shouldAutoAccept,
  shouldRecoverDigestExecution,
} = require('../electron/digest-orchestrator.cjs');

const HASH_A = 'a'.repeat(40);
const HASH_B = 'b'.repeat(40);

function batch() {
  return buildDigestBatch({
    scope: { type: 'student', id: 's1' },
    batchId: 'digest-1',
    files: [
      { id: 'm1', relativePath: 'a.pdf', sha1: HASH_A },
      { id: 'm2', relativePath: 'b.pdf', sha1: HASH_B },
    ],
  });
}

test('strict student result confirms only matching files and keeps partial remainder', () => {
  const current = batch();
  const result = validateDigestResult({
    batch: current,
    currentFiles: current.files,
    requireMaterialId: true,
    receipt: { status: 'partial', studentId: 's1', digestBatchId: 'digest-1', processed: [{ materialId: 'm1', relativePath: 'a.pdf', sha1: HASH_A }] },
  });
  assert.equal(result.ok, true);
  assert.equal(result.fullyCompleted, false);
  assert.deepEqual(result.confirmed.map((file) => file.materialId), ['m1']);
  assert.deepEqual(result.remaining.map((file) => file.materialId), ['m2']);
});

test('an Agent whole-batch initialization failure cannot be mistaken for partial completion', () => {
  const current = batch();
  const receipt = {
    protocolVersion: '1.2',
    status: 'completed',
    message: '用户粘贴 Agent 执行结果。',
    data: {
      items: [
        { 本批消化未完成: '本地工具初始化失败，无法读取 `AGENT.md` 和批次清单，失败回执也无法写入。' },
        { 已处理文件: '0 个。知识库、原始资料和正式教育档案均未修改。需恢复本地文件访问环境后重试本批次。' },
      ],
      schema: 'edu-manager.digest-result.v1',
      studentId: 's1',
      digestBatchId: 'digest-1',
    },
    schema: 'edu-manager.digest-result.v1',
    studentId: 's1',
    digestBatchId: 'digest-1',
  };
  const result = validateDigestResult({
    batch: current,
    currentFiles: current.files,
    receipt,
    assumeAllOnCompletion: true,
    inferredArtifacts: ['D:/knowledge/index.md'],
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'batch_execution_failed');
  assert.equal(result.retryable, true);
  assert.equal(result.remaining.length, 2);
  assert.match(result.message, /初始化失败|未处理/);
});

test('a real partial result still settles identified files when another file fails', () => {
  const current = batch();
  const result = validateDigestResult({
    batch: current,
    currentFiles: current.files,
    receipt: {
      status: 'partial',
      studentId: 's1',
      digestBatchId: 'digest-1',
      processed: [{ materialId: 'm1', relativePath: 'a.pdf', sha1: HASH_A }],
      failed: [{ materialId: 'm2', relativePath: 'b.pdf', sha1: HASH_B, message: '单文件读取失败，稍后重试' }],
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.code, 'partial');
  assert.deepEqual(result.confirmed.map((file) => file.materialId), ['m1']);
  assert.deepEqual(result.remaining.map((file) => file.materialId), ['m2']);
});

test('permissive result ignores batch drift but rejects changed source content and duplicate entries', () => {
  const current = batch();
  const oldBatch = validateDigestResult({ batch: current, currentFiles: current.files, requireMaterialId: true, receipt: { status: 'completed', studentId: 's1', digestBatchId: 'old', processed: [{ materialId: 'm1', relativePath: 'a.pdf', sha1: HASH_A }] } });
  assert.equal(oldBatch.ok, true);
  assert.match(oldBatch.compatibility.warnings.join('；'), /批次号/);
  assert.equal(validateDigestResult({ batch: current, currentFiles: [{ ...current.files[0], sha1: HASH_B }, current.files[1]], requireMaterialId: true, receipt: { status: 'completed', studentId: 's1', digestBatchId: 'digest-1', processed: [{ materialId: 'm1', relativePath: 'a.pdf', sha1: HASH_A }] } }).code, 'no_matching_files');
  const duplicate = validateDigestResult({ batch: current, currentFiles: current.files, requireMaterialId: true, receipt: { status: 'completed', studentId: 's1', digestBatchId: 'digest-1', processed: [{ materialId: 'm1', relativePath: 'a.pdf', sha1: HASH_A }, { materialId: 'm1', relativePath: 'a.pdf', sha1: HASH_A }] } });
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.rejected.length, 1);
});

test('result completes matched files and silently excludes artifacts outside knowledge roots', () => {
  const current = batch();
  const knowledgeRoot = path.resolve('D:/knowledge/student-s1');
  const receipt = {
    status: 'completed',
    studentId: 's1',
    digestBatchId: 'digest-1',
    processed: [
      { materialId: 'm1', relativePath: 'a.pdf', sha1: HASH_A, artifacts: [path.join(knowledgeRoot, '摘要库', 'a.md')] },
      { materialId: 'm2', relativePath: 'b.pdf', sha1: HASH_B, artifacts: [path.join(knowledgeRoot, '概念库', 'b.md')] },
    ],
  };
  const completed = validateDigestResult({ batch: current, currentFiles: current.files, requireMaterialId: true, allowedArtifactRoots: [knowledgeRoot], receipt });
  assert.equal(completed.ok, true);
  assert.equal(completed.fullyCompleted, true);
  assert.equal(completed.confirmed.length, 2);
  assert.equal(completed.remaining.length, 0);

  const escaped = validateDigestResult({
    batch: current,
    currentFiles: current.files,
    requireMaterialId: true,
    allowedArtifactRoots: [knowledgeRoot],
    receipt: { ...receipt, processed: [{ ...receipt.processed[0], artifacts: [path.resolve('D:/outside/a.md')] }] },
  });
  assert.equal(escaped.ok, true);
  assert.equal(escaped.confirmed.length, 1);
  assert.deepEqual(escaped.confirmed[0].artifacts, []);
  assert.deepEqual(escaped.remaining.map((file) => file.materialId), ['m2']);
});

test('only validated digest tasks auto-accept and user states stay simple', () => {
  assert.equal(shouldAutoAccept({ kind: 'student_digest', completionPolicy: 'auto_after_validation' }, { valid: true }), true);
  assert.equal(shouldAutoAccept({ kind: 'growth_publish', completionPolicy: 'auto_after_validation' }, { valid: true }), false);
  assert.equal(shouldAutoAccept({ kind: 'project_digest', completionPolicy: 'manual_review' }, { valid: true }), false);
  assert.equal(digestUserStatus('waiting_result', 'submitted', 2, 2), 'waiting_result');
  assert.equal(digestUserStatus('waiting_result', 'pending', 2, 0), 'pending');
  assert.equal(digestUserStatus('succeeded', 'partial', 1), 'partial');
  assert.equal(digestUserStatus('failed', 'failed', 1), 'needs_help');
  assert.equal(digestUserStatus('failed', 'digesting', 0), 'needs_help');
  assert.equal(digestUserStatus('reviewing', 'completed', 0), 'completed');
  assert.equal(digestUserStatus('waiting_result', 'partial', 1), 'partial');
  assert.equal(digestUserStatus('succeeded', 'idle', 1), 'pending');
});

test('stale active tasks cannot hide new pending materials or reuse an unrelated batch', () => {
  const batch = {
    batchId: 'batch-old',
    status: 'partial',
    files: [{ materialId: 'old-1' }],
  };
  const state = { status: 'pending', digestBatchId: '' };
  const materials = [{ id: 'new-1', status: 'pending_digest', digestBatchId: '' }];
  assert.equal(canReuseStudentDigestBatch(batch, state, materials), false);
  assert.equal(shouldRecoverDigestExecution(
    { status: 'waiting_result', executionId: 'qclaw-old' },
    { pendingCount: 1, submittedCount: 0, state },
  ), true);
});

test('a live strict batch is reused only while every frozen file remains submitted in that batch', () => {
  const batch = {
    batchId: 'batch-live',
    status: 'submitted',
    files: [{ materialId: 'm1' }, { materialId: 'm2' }],
  };
  const state = { status: 'submitted', digestBatchId: 'batch-live' };
  const materials = [
    { id: 'm1', status: 'submitted', digestBatchId: 'batch-live' },
    { id: 'm2', status: 'digesting', digestBatchId: 'batch-live' },
  ];
  assert.equal(canReuseStudentDigestBatch(batch, state, materials), true);
  assert.equal(canReuseStudentDigestBatch(batch, state, materials.slice(0, 1)), false);
  assert.equal(shouldRecoverDigestExecution(
    { status: 'waiting_result', executionId: 'qclaw-live' },
    { pendingCount: 1, submittedCount: 2, state },
  ), false);
});
