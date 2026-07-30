const assert = require('node:assert/strict');
const test = require('node:test');

const {
  nextKnowledgeReviewState,
  nextStagingReviewState,
  projectCompletionIssues,
  reconcileDigestControlState,
  normalizeProjectDigestReceipt,
  validateDigestReceipt,
} = require('../electron/project-integrity.cjs');

test('digest control state repairs impossible active and completed states', () => {
  assert.deepEqual(
    reconcileDigestControlState({ status: 'digesting', digestBatchId: '', submittedFiles: [] }, 0),
    {
      status: 'idle',
      digestBatchId: '',
      submittedFiles: [],
      message: '检测到无待处理文件的失效消化状态，已自动收口。',
    },
  );
  const pending = reconcileDigestControlState({ status: 'completed', lastDigestAt: '2026-07-20T00:00:00.000Z' }, 2);
  assert.equal(pending.status, 'pending');
  assert.match(pending.message, /2 份/);
});

test('digest receipt accepts batch and schema drift while keeping changed source files pending', () => {
  const current = {
    status: 'submitted',
    digestBatchId: 'batch-1',
    submittedFiles: [
      { relativePath: 'a.pdf', sha1: 'aaa' },
      { relativePath: 'b.pdf', sha1: 'bbb' },
    ],
  };
  const request = { projectId: 'p1', digestBatchId: 'batch-1' };
  const rawFiles = [
    { relativePath: 'a.pdf', sha1: 'aaa', path: 'raw/a.pdf' },
    { relativePath: 'b.pdf', sha1: 'changed', path: 'raw/b.pdf' },
  ];
  const result = validateDigestReceipt({
    projectId: 'p1',
    current,
    request,
    rawFiles,
    receipt: {
      status: 'completed',
      projectId: 'p1',
      digestBatchId: 'batch-1',
      digestedFiles: [
        { relativePath: 'a.pdf', sha1: 'aaa' },
        { relativePath: 'b.pdf', sha1: 'bbb' },
        { relativePath: 'outside.pdf', sha1: 'xxx' },
      ],
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.fullyCompleted, false);
  assert.deepEqual(result.confirmed.map((file) => file.relativePath), ['a.pdf']);
  assert.deepEqual(result.remaining.map((file) => file.relativePath), ['b.pdf']);
  assert.equal(result.rejected.length, 2);

  const staleBatch = validateDigestReceipt({
    projectId: 'p1', current, request, rawFiles,
    receipt: { status: 'completed', projectId: 'p1', digestBatchId: 'batch-old', digestedFiles: [{ relativePath: 'a.pdf', sha1: 'aaa' }] },
  });
  assert.equal(staleBatch.ok, true);
  assert.deepEqual(staleBatch.confirmed.map((file) => file.relativePath), ['a.pdf']);
  assert.equal(staleBatch.compatibility.ignoredReceiptBatch, true);

  const incompatibleSchema = validateDigestReceipt({
    projectId: 'p1', current, request, rawFiles,
    receipt: {
      status: 'completed',
      batchId: 'agent-generated-batch',
      processedFiles: [{ path: 'a.pdf', result: 'success' }],
    },
  });
  assert.equal(incompatibleSchema.ok, true);
  assert.deepEqual(incompatibleSchema.confirmed.map((file) => file.relativePath), ['a.pdf']);
});

test('QClaw digestStats envelope closes from file coverage even when accounting is only advisory', () => {
  const submittedFiles = [
    { relativePath: 'a.pdf', sha1: 'a'.repeat(40) },
    { relativePath: 'duplicate.pdf', sha1: 'a'.repeat(40) },
    { relativePath: 'tool-output.json', sha1: 'b'.repeat(40) },
  ];
  const receipt = {
    projectId: 'p1',
    digestBatchId: 'batch-1',
    digestStatus: 'partial',
    digestFiles: submittedFiles.map((file) => ({ ...file })),
    digestStats: { totalFiles: 3, actuallyDigested: 1, skipped: 2 },
  };
  const normalized = normalizeProjectDigestReceipt(receipt, submittedFiles);
  assert.equal(normalized.receipt.status, 'partial');
  assert.equal(normalized.receipt.digestedFiles.length, 3);
  assert.deepEqual(normalized.compatibility, {
    mode: 'qclaw_digest_stats_permissive',
    sourceStatus: 'partial',
    totalFiles: 3,
    actuallyDigested: 1,
    skipped: 2,
  });
  const validation = validateDigestReceipt({
    projectId: 'p1',
    current: { status: 'digesting', digestBatchId: 'batch-1', submittedFiles },
    request: { projectId: 'p1', digestBatchId: 'batch-1' },
    receipt,
    rawFiles: submittedFiles.map((file) => ({ ...file, path: `raw/${file.relativePath}` })),
  });
  assert.equal(validation.ok, true);
  assert.equal(validation.fullyCompleted, true);
  assert.equal(validation.confirmed.length, 3);
  assert.equal(validation.compatibility.skipped, 2);
});

test('QClaw digestStats count drift no longer blocks uniquely matched files', () => {
  const submittedFiles = [
    { relativePath: 'a.pdf', sha1: 'a'.repeat(40) },
    { relativePath: 'b.pdf', sha1: 'b'.repeat(40) },
  ];
  const base = {
    projectId: 'p1',
    digestBatchId: 'batch-1',
    digestStatus: 'partial',
    digestFiles: submittedFiles.map((file) => ({ ...file })),
    digestStats: { totalFiles: 2, actuallyDigested: 1, skipped: 1 },
  };
  assert.equal(normalizeProjectDigestReceipt({
    ...base,
    digestStats: { totalFiles: 2, actuallyDigested: 1, skipped: 0 },
  }, submittedFiles).receipt.status, 'partial');
  assert.equal(normalizeProjectDigestReceipt({
    ...base,
    digestFiles: [{ ...submittedFiles[0] }, { ...submittedFiles[1], sha1: 'c'.repeat(40) }],
  }, submittedFiles).receipt.status, 'partial');
  const reconciled = validateDigestReceipt({
    projectId: 'p1',
    current: { status: 'digesting', digestBatchId: 'batch-1', submittedFiles },
    request: { projectId: 'p1', digestBatchId: 'batch-1' },
    receipt: { ...base, digestStats: { totalFiles: 2, actuallyDigested: 1, skipped: 0 } },
    rawFiles: submittedFiles,
  });
  assert.equal(reconciled.ok, true);
  assert.equal(reconciled.fullyCompleted, true);
});

test('staging review restores discarded items and freezes promoted items', () => {
  assert.deepEqual(nextStagingReviewState({ status: 'discarded' }, 'accepted'), { ok: true, status: 'selected' });
  assert.deepEqual(nextStagingReviewState({ status: 'discarded' }, 'pending'), { ok: true, status: 'collected' });
  const blocked = nextStagingReviewState({ status: 'promoted' }, 'rejected');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.status, 'promoted');
});

test('knowledge review cannot silently overwrite a published record', () => {
  assert.equal(nextKnowledgeReviewState('ai_generated', 'verified').ok, true);
  assert.equal(nextKnowledgeReviewState('verified', 'published').ok, true);
  assert.equal(nextKnowledgeReviewState('published', 'verified').ok, false);
  assert.equal(nextKnowledgeReviewState('published', 'invalid').ok, true);
});

test('archive and publish gates report every unresolved invariant', () => {
  const archive = projectCompletionIssues({
    stage: 'archive',
    projectStatus: 'pending_archive',
    students: [],
    digestState: { status: 'digesting', pendingCount: 2 },
    stagingStatuses: ['selected', 'discarded'],
    knowledgeStatuses: ['pending_review', 'verified'],
  });
  assert.equal(archive.issues.length, 4);

  const publish = projectCompletionIssues({
    stage: 'publish',
    projectStatus: 'archived',
    students: [{ id: 's1' }, { id: 's2' }],
    studentEvidence: [{ studentId: 's1', status: 'verified', sourcePaths: ['evidence.md'] }],
    digestState: { status: 'completed', pendingCount: 0 },
    stagingStatuses: ['analyzed', 'discarded'],
    knowledgeStatuses: ['verified', 'published'],
  });
  assert.deepEqual(publish.issues, ['1 名学生缺少已确认且有来源的个人成长证据']);
});
