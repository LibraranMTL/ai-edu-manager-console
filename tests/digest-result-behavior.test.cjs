const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { buildDigestBatch } = require('../electron/digest-batch.cjs');
const { validateDigestResult } = require('../electron/digest-result.cjs');
const { digestUserStatus, shouldAutoAccept } = require('../electron/digest-orchestrator.cjs');

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

test('strict result rejects stale hash, wrong batch and duplicate entries', () => {
  const current = batch();
  assert.equal(validateDigestResult({ batch: current, currentFiles: current.files, requireMaterialId: true, receipt: { status: 'completed', studentId: 's1', digestBatchId: 'old', processed: [{ materialId: 'm1', relativePath: 'a.pdf', sha1: HASH_A }] } }).code, 'batch_id_mismatch');
  assert.equal(validateDigestResult({ batch: current, currentFiles: [{ ...current.files[0], sha1: HASH_B }, current.files[1]], requireMaterialId: true, receipt: { status: 'completed', studentId: 's1', digestBatchId: 'digest-1', processed: [{ materialId: 'm1', relativePath: 'a.pdf', sha1: HASH_A }] } }).code, 'no_matching_files');
  const duplicate = validateDigestResult({ batch: current, currentFiles: current.files, requireMaterialId: true, receipt: { status: 'completed', studentId: 's1', digestBatchId: 'digest-1', processed: [{ materialId: 'm1', relativePath: 'a.pdf', sha1: HASH_A }, { materialId: 'm1', relativePath: 'a.pdf', sha1: HASH_A }] } });
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.rejected.length, 1);
});

test('strict result completes the exact batch and rejects artifacts outside knowledge roots', () => {
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
  assert.equal(escaped.ok, false);
  assert.equal(escaped.code, 'no_matching_files');
  assert.match(escaped.rejected[0].reason, /超出允许/);
});

test('only validated digest tasks auto-accept and user states stay simple', () => {
  assert.equal(shouldAutoAccept({ kind: 'student_digest', completionPolicy: 'auto_after_validation' }, { valid: true }), true);
  assert.equal(shouldAutoAccept({ kind: 'growth_publish', completionPolicy: 'auto_after_validation' }, { valid: true }), false);
  assert.equal(shouldAutoAccept({ kind: 'project_digest', completionPolicy: 'manual_review' }, { valid: true }), false);
  assert.equal(digestUserStatus('waiting_result', 'submitted', 2), 'waiting_result');
  assert.equal(digestUserStatus('succeeded', 'partial', 1), 'partial');
  assert.equal(digestUserStatus('failed', 'failed', 1), 'needs_help');
  assert.equal(digestUserStatus('failed', 'digesting', 0), 'needs_help');
  assert.equal(digestUserStatus('reviewing', 'completed', 0), 'completed');
  assert.equal(digestUserStatus('waiting_result', 'partial', 1), 'partial');
  assert.equal(digestUserStatus('succeeded', 'idle', 1), 'pending');
});
