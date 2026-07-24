const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  discoverDigestReceipts,
  discoverSingleFileMarkdownReceipt,
  mergeDigestReceipts,
} = require('../electron/digest-receipt-compat.cjs');
const { validateDigestResult } = require('../electron/digest-result.cjs');
const { normalizeMaterialStatus } = require('../electron/material-status.cjs');

function batch() {
  return {
    batchId: 'batch-current',
    scope: { type: 'student', id: 'student-1' },
    files: [
      { materialId: 'm1', relativePath: 'a.jpg', sha1: 'a'.repeat(40) },
      { materialId: 'm2', relativePath: 'b.md', sha1: 'b'.repeat(40) },
    ],
  };
}

test('legacy material states migrate to canonical terminal states', () => {
  assert.equal(normalizeMaterialStatus('digested'), 'processed');
  assert.equal(normalizeMaterialStatus('pending'), 'pending_digest');
  assert.equal(normalizeMaterialStatus('empty_file'), 'invalid');
});

test('receipt discovery uses structured content instead of one exact filename', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-p4-receipt-'));
  try {
    fs.writeFileSync(path.join(dir, 'qclaw-digest-part-01.json'), JSON.stringify({
      digestBatchId: 'batch-current',
      status: 'partial',
      processed: [{ materialId: 'm1', relativePath: 'a.jpg', sha1: 'a'.repeat(40), status: 'completed' }],
    }));
    fs.writeFileSync(path.join(dir, 'digest-state-late.json'), JSON.stringify({
      digestBatchId: 'batch-old',
      status: 'completed',
      processed: [{ materialId: 'old', relativePath: 'old.txt', sha1: 'c'.repeat(40) }],
    }));
    fs.writeFileSync(path.join(dir, '第二段消化结果.json'), JSON.stringify({
      digestBatchId: 'batch-current',
      status: 'partial',
      processed: [{ materialId: 'm2', relativePath: 'b.md', sha1: 'b'.repeat(40), status: 'completed' }],
    }));
    fs.writeFileSync(path.join(dir, 'unrelated.json'), JSON.stringify({ hello: 'world' }));
    const found = discoverDigestReceipts({ managerDir: dir, batchId: 'batch-current' });
    assert.equal(found.candidates.length, 2);
    assert.equal(found.stale.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('multiple QClaw receipt fragments merge without weakening file identity checks', () => {
  const current = batch();
  const merged = mergeDigestReceipts([
    {
      digestBatchId: current.batchId,
      status: 'partial',
      processed: [{ materialId: 'm1', relativePath: 'a.jpg', sha1: 'a'.repeat(40), status: 'completed' }],
    },
    {
      digestBatchId: current.batchId,
      status: 'completed',
      failed: [{ materialId: 'm2', relativePath: 'b.md', sha1: 'b'.repeat(40), status: 'failed', reason: '空文件（0 字节）' }],
    },
  ], current);
  const validation = validateDigestResult({
    batch: current,
    receipt: merged,
    currentFiles: current.files,
    requireMaterialId: true,
  });
  assert.equal(validation.ok, true);
  assert.equal(validation.confirmed.length, 1);
  assert.equal(validation.invalid.length, 1);
  assert.equal(validation.remaining.length, 0);
});

test('a late old-batch receipt is never merged into the current batch', () => {
  const current = batch();
  const merged = mergeDigestReceipts([{
    digestBatchId: 'batch-old',
    status: 'completed',
    processed: [{ materialId: 'm1', relativePath: 'a.jpg', sha1: 'a'.repeat(40) }],
  }], current);
  assert.equal(merged.processed.length, 1);
  const validation = validateDigestResult({
    batch: current,
    receipt: { ...merged, digestBatchId: 'batch-old' },
    currentFiles: current.files,
    requireMaterialId: true,
  });
  assert.equal(validation.ok, false);
  assert.equal(validation.code, 'batch_id_mismatch');
});

test('a fresh single-file Markdown receipt plus a knowledge artifact is converted into an auditable strict receipt', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-p4-markdown-receipt-'));
  try {
    const rawRoot = path.join(root, '原始资料库');
    const knowledgeRoot = path.join(root, '项目知识空间');
    fs.mkdirSync(rawRoot, { recursive: true });
    fs.mkdirSync(path.join(knowledgeRoot, '知识贡献'), { recursive: true });
    fs.mkdirSync(path.join(knowledgeRoot, '综合汇总库'), { recursive: true });
    const submittedAt = new Date(Date.now() - 5000).toISOString();
    const artifact = path.join(knowledgeRoot, '知识贡献', '作品实体.md');
    const receipt = path.join(knowledgeRoot, '综合汇总库', '消化回执_作品实体.md');
    fs.writeFileSync(artifact, '已生成项目作品实体。', 'utf8');
    fs.writeFileSync(receipt, '# 消化回执\n\n来源项目：测试项目\n\n状态：已完成', 'utf8');
    const found = discoverSingleFileMarkdownReceipt({
      batch: {
        batchId: 'batch-markdown',
        submittedAt,
        scope: { type: 'project', id: 'project-1', name: '测试项目' },
        files: [{ materialId: 'material-1', relativePath: 'source.jpg', sha1: 'a'.repeat(40) }],
      },
      knowledgeRoot,
      rawRoot,
    });
    assert.ok(found);
    assert.equal(found.payload.status, 'completed');
    assert.equal(found.payload.projectId, 'project-1');
    assert.equal(found.payload.digestBatchId, 'batch-markdown');
    assert.equal(found.payload.digestedFiles[0].relativePath, 'source.jpg');
    assert.deepEqual(found.payload.digestedFiles[0].artifacts, [artifact]);
    assert.equal(found.payload.compatibility.sourceReceiptPath, receipt);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Markdown completion inference refuses multi-file batches and receipt-only output', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-p4-markdown-refuse-'));
  try {
    fs.writeFileSync(path.join(root, '消化回执.md'), '# 消化回执\n测试项目 已完成', 'utf8');
    const baseBatch = {
      batchId: 'batch-refuse',
      submittedAt: new Date(Date.now() - 5000).toISOString(),
      scope: { type: 'project', id: 'project-2', name: '测试项目' },
      files: [{ materialId: 'm1', relativePath: 'a.jpg', sha1: 'a'.repeat(40) }],
    };
    assert.equal(discoverSingleFileMarkdownReceipt({ batch: baseBatch, knowledgeRoot: root }), null);
    fs.writeFileSync(path.join(root, '知识实体.md'), '知识内容', 'utf8');
    assert.equal(discoverSingleFileMarkdownReceipt({
      batch: { ...baseBatch, files: [...baseBatch.files, { materialId: 'm2', relativePath: 'b.jpg', sha1: 'b'.repeat(40) }] },
      knowledgeRoot: root,
    }), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
