const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createArchiveAccess } = require('../electron/archive-access.cjs');
const {
  discoverDigestReceipts,
  mergeDigestReceipts,
} = require('../electron/digest-receipt-compat.cjs');
const { validateDigestResult } = require('../electron/digest-result.cjs');
const {
  buildKnowledgeGovernanceRun,
  persistKnowledgeGovernanceRun,
} = require('../electron/knowledge-governance-pipeline.cjs');

test('P4 closes a split receipt into governed, source-linked, read-only archive context', () => {
  const studentRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-p4-closure-'));
  try {
    const rawRoot = path.join(studentRoot, '原始资料');
    const knowledgeRoot = path.join(studentRoot, '知识资产');
    const managerDir = path.join(studentRoot, '.edu-manager');
    fs.mkdirSync(rawRoot, { recursive: true });
    fs.mkdirSync(knowledgeRoot, { recursive: true });
    fs.mkdirSync(managerDir, { recursive: true });

    const lessonFile = path.join(rawRoot, '第一课.md');
    const emptyFile = path.join(rawRoot, '空白.md');
    fs.writeFileSync(lessonFile, '一次函数学习记录', 'utf8');
    fs.writeFileSync(emptyFile, '', 'utf8');
    const lessonSha1 = 'a'.repeat(40);
    const emptySha1 = 'b'.repeat(40);
    const artifact = path.join(knowledgeRoot, '一次函数摘要.md');
    fs.writeFileSync(artifact, '来源：第一课.md\n学生已经掌握一次函数的基本概念。', 'utf8');

    const batch = {
      batchId: 'student-digest-e2e',
      scope: { type: 'student', id: 'student-e2e' },
      files: [
        { materialId: 'material-lesson', relativePath: '第一课.md', sha1: lessonSha1, path: lessonFile },
        { materialId: 'material-empty', relativePath: '空白.md', sha1: emptySha1, path: emptyFile },
      ],
    };
    fs.writeFileSync(path.join(managerDir, 'qclaw-part-a.json'), JSON.stringify({
      digestBatchId: batch.batchId,
      status: 'partial',
      processed: [{
        materialId: 'material-lesson',
        relativePath: '第一课.md',
        sha1: lessonSha1,
        status: 'completed',
        artifacts: [artifact],
      }],
    }), 'utf8');
    fs.writeFileSync(path.join(managerDir, '任意名称的第二段结果.json'), JSON.stringify({
      digestBatchId: batch.batchId,
      status: 'completed',
      failed: [{
        materialId: 'material-empty',
        relativePath: '空白.md',
        sha1: emptySha1,
        status: 'failed',
        reason: '空文件（0 字节）',
      }],
    }), 'utf8');

    const discovered = discoverDigestReceipts({ managerDir, batchId: batch.batchId });
    assert.equal(discovered.candidates.length, 2);
    const merged = mergeDigestReceipts(discovered.candidates, batch);
    const validation = validateDigestResult({
      batch,
      receipt: merged,
      currentFiles: batch.files,
      requireMaterialId: true,
      allowedArtifactRoots: [knowledgeRoot],
    });
    assert.equal(validation.ok, true);
    assert.equal(validation.confirmed.length, 1);
    assert.equal(validation.invalid.length, 1);
    assert.equal(validation.remaining.length, 0);

    const governance = buildKnowledgeGovernanceRun({
      scopeType: 'student',
      scopeId: 'student-e2e',
      scopeName: '端到端测试学生',
      batchId: batch.batchId,
      knowledgeRoot,
      resolvedFiles: validation.confirmed,
      artifacts: [artifact],
    });
    assert.equal(governance.status, 'completed');
    assert.equal(governance.analysis.coverage, 100);
    const persisted = persistKnowledgeGovernanceRun(managerDir, governance);
    assert.equal(fs.existsSync(persisted.latestPath), true);

    const archive = createArchiveAccess({
      descriptors: [{
        scopeType: 'student',
        scopeId: 'student-e2e',
        root: studentRoot,
        excludedRoots: [rawRoot, managerDir],
      }],
    });
    const bundle = archive.buildContextBundle({
      query: '一次函数',
      scopeType: 'student',
      scopeId: 'student-e2e',
    });
    assert.equal(bundle.resources.length, 1);
    assert.match(bundle.resources[0].uri, /^edu:\/\/student\/student-e2e\/knowledge\//);
    assert.match(bundle.resources[0].excerpt, /基本概念/);
    assert.doesNotMatch(bundle.resources[0].relativePath, /原始资料|\.edu-manager/);
  } finally {
    fs.rmSync(studentRoot, { recursive: true, force: true });
  }
});
