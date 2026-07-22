const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { buildDigestBatch } = require('../electron/digest-batch.cjs');
const { validateDigestResult } = require('../electron/digest-result.cjs');
const { buildGrowthIndexV2 } = require('../electron/growth-model.cjs');
const { mapGrowthIndexV2ToDomainSnapshot } = require('../electron/education-growth-compatibility.cjs');
const { validateSectionedDraft, publishReviewedReport } = require('../electron/learning-report-workflow.cjs');

function sha1(file) {
  return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
}

test('uploaded material can flow through digest, growth index and published learning report', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-full-flow-'));
  const student = { id: '1783487923864-测试学生', name: '测试学生' };
  const rawDir = path.join(root, '原始资料库');
  const knowledgeDir = path.join(root, '知识库');
  const growthDir = path.join(root, '成长模型');
  const reportDir = path.join(root, '学情报告');
  const sourcePath = path.join(rawDir, '数学探究记录.txt');
  const summaryPath = path.join(knowledgeDir, '摘要库', '数学探究摘要.md');
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  fs.writeFileSync(sourcePath, '学生比较三种解题方法并记录验证过程。', 'utf8');
  fs.writeFileSync(summaryPath, '# 数学探究摘要\n\n学生能够比较方法并用证据验证结论。\n', 'utf8');

  try {
    const uploadRecord = {
      id: 'upload-flow-1',
      studentId: student.id,
      filename: path.basename(sourcePath),
      path: sourcePath,
      status: 'pending_digest',
      sha1: sha1(sourcePath),
    };
    assert.equal(fs.existsSync(uploadRecord.path), true);

    const batch = buildDigestBatch({
      scope: { type: 'student', id: student.id, name: student.name },
      batchId: 'student-digest-flow-1',
      files: [{ id: uploadRecord.id, path: uploadRecord.path, relativePath: uploadRecord.filename, sha1: uploadRecord.sha1 }],
      output: { knowledgeRoot: knowledgeDir },
    });
    const digest = validateDigestResult({
      batch,
      currentFiles: batch.files,
      requireMaterialId: true,
      allowedArtifactRoots: [knowledgeDir],
      receipt: {
        status: 'completed',
        studentId: student.id,
        digestBatchId: batch.batchId,
        processed: [{ materialId: uploadRecord.id, relativePath: uploadRecord.filename, sha1: uploadRecord.sha1, artifacts: [summaryPath] }],
      },
    });
    assert.equal(digest.ok, true);
    assert.equal(digest.fullyCompleted, true);
    assert.equal(digest.confirmed[0].artifacts[0], summaryPath);

    const evidence = {
      id: 'evidence-flow-1',
      studentId: student.id,
      title: '比较并验证多种解题方法',
      content: '学生比较三种方法并使用过程记录验证结论。',
      ability: '数学推理',
      status: 'confirmed',
      confidence: '教师确认',
      sourcePath: summaryPath,
      createdAt: '2026-07-22T08:00:00.000Z',
      updatedAt: '2026-07-22T08:00:00.000Z',
    };
    const index = buildGrowthIndexV2({ student, growthDir, review: { candidates: [evidence] }, now: new Date('2026-07-22T09:00:00.000Z') });
    assert.equal(index.summary.evidenceCount, 1);
    assert.equal(index.summary.confirmedCount, 1);
    assert.equal(index.abilities[0].name, '数学推理');

    const domain = mapGrowthIndexV2ToDomainSnapshot({ student, index, sourcePath: path.join(growthDir, 'growth-index.json') });
    assert.match(domain.profile.id, /^student-[a-f0-9]{20}$/);
    assert.equal(domain.profile.legacyId, student.id);
    assert.equal(domain.claims[0].id, evidence.id);

    const sections = ['一句话画像', '学习优势', '当前短板', '兴趣与动力', '学习习惯与执行力', '适合的学习方式', '家长沟通注意点', '依据来源'];
    const body = sections.map((section) => `## ${section}\n\n${section === '学习优势' ? '已确认能力：数学推理。' : section === '依据来源' ? `成长证据：${evidence.id}；来源：${summaryPath}` : '基于当前已确认成长证据生成。'}`).join('\n\n');
    const draft = `---\nupdated: 2026-07-22\nstatus: pending_review\n---\n\n${body}\n`;
    assert.equal(validateSectionedDraft(draft, sections).valid, true);
    const draftPath = path.join(reportDir, '整体画像.draft.md');
    const publishedPath = path.join(reportDir, '整体画像.md');
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(draftPath, draft, 'utf8');
    const published = publishReviewedReport({ draftPath, publishPath: publishedPath, updated: '2026-07-22', type: 'learning_profile' });
    assert.equal(published.ok, true);
    const report = fs.readFileSync(publishedPath, 'utf8');
    assert.match(report, /^status: published$/m);
    assert.match(report, /数学推理/);
    assert.match(report, /evidence-flow-1/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
