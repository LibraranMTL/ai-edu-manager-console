const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  frontmatterValueFromFile,
  reportContentFingerprint,
  validateReportDraftForAutoPublish,
} = require('../electron/report-auto-publication.cjs');

test('file frontmatter reader reads the header of reports larger than its prefix limit', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'report-frontmatter-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, '每周行动建议.md');
  fs.writeFileSync(file, `---\nstatus: published\nupdated: 2026-09-09\n---\n\n${'行动建议。'.repeat(2400)}`, 'utf8');
  assert.ok(fs.statSync(file).size > 8192);
  assert.equal(frontmatterValueFromFile(file, 'status', 8192), 'published');
});

const growthIndex = {
  sourceFingerprint: 'growth-fp-1',
  evidence: [
    { id: 'confirmed-1', status: 'confirmed', sourcePath: 'D:/student/knowledge/a.md' },
    { id: 'watching-1', status: 'watching', sourcePath: 'D:/student/knowledge/b.md' },
    { id: 'rejected-1', status: 'rejected', sourcePath: 'D:/student/knowledge/c.md' },
  ],
};

function draft(body) {
  return `---\nstudent_id: student-a\ngrowth_fingerprint: growth-fp-1\nupdated: 2026-07-24\nstatus: pending_review\n---\n\n${body}`;
}

test('confirmed evidence publishes automatically when student, fingerprint and source match', () => {
  const result = validateReportDraftForAutoPublish({
    content: draft('## 学习优势\n\n能够持续整理实验记录。[依据:confirmed-1]'),
    studentId: 'student-a',
    expectedFingerprint: 'growth-fp-1',
    growthIndex,
    sourceAccessible: () => true,
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.citedEvidenceIds, ['confirmed-1']);
});

test('watching evidence must remain explicit observation language', () => {
  const invalid = validateReportDraftForAutoPublish({
    content: draft('## 学习特点\n\n已经完全掌握实验设计。[依据:watching-1]'),
    studentId: 'student-a',
    expectedFingerprint: 'growth-fp-1',
    growthIndex,
    sourceAccessible: () => true,
  });
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join('；'), /观察项不能写成正式定论/);

  const valid = validateReportDraftForAutoPublish({
    content: draft('## 学习特点\n\n实验设计能力仍在继续观察。[依据:watching-1]'),
    studentId: 'student-a',
    expectedFingerprint: 'growth-fp-1',
    growthIndex,
    sourceAccessible: () => true,
  });
  assert.equal(valid.valid, true);
});

test('watching evidence accepts equivalent cautious wording in conclusion sections', () => {
  for (const wording of ['待确认', '待核验', '不能据此形成正式结论']) {
    const result = validateReportDraftForAutoPublish({
      content: draft(`## 关键证据\n\n实验设计能力${wording}。[依据:watching-1]`),
      studentId: 'student-a',
      expectedFingerprint: 'growth-fp-1',
      growthIndex,
      sourceAccessible: () => true,
    });
    assert.equal(result.valid, true, wording);
  }
});

test('watching evidence can support actions and source ledgers without becoming a formal conclusion', () => {
  const result = validateReportDraftForAutoPublish({
    content: draft([
      '## 下一阶段目标',
      '',
      '补充三次实验记录并复核设计步骤。[依据:watching-1]',
      '',
      '## 建议行动',
      '',
      '安排每周一次的实验复盘。[依据:watching-1]',
      '',
      '## 依据来源',
      '',
      '| 证据 ID | 状态 |',
      '| --- | --- |',
      '| watching-1 [依据:watching-1] | watching |',
    ].join('\n')),
    studentId: 'student-a',
    expectedFingerprint: 'growth-fp-1',
    growthIndex,
    sourceAccessible: () => true,
  });
  assert.equal(result.valid, true);
});

test('watching evidence remains blocked when an action section ends and a claim section begins', () => {
  const result = validateReportDraftForAutoPublish({
    content: draft([
      '## 建议行动',
      '',
      '安排更多训练。[依据:watching-1]',
      '',
      '## 主要问题',
      '',
      '已经形成严重拖延习惯。[依据:watching-1]',
    ].join('\n')),
    studentId: 'student-a',
    expectedFingerprint: 'growth-fp-1',
    growthIndex,
    sourceAccessible: () => true,
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join('；'), /观察项不能写成正式定论/);
});

test('scope, stale fingerprint, missing source and rejected evidence block publication', () => {
  const result = validateReportDraftForAutoPublish({
    content: draft('## 结论\n\n形成稳定能力。[依据:rejected-1]'),
    studentId: 'student-b',
    expectedFingerprint: 'new-fp',
    growthIndex,
    sourceAccessible: () => false,
  });
  const message = result.errors.join('；');
  assert.match(message, /学生范围/);
  assert.match(message, /成长模型已变化/);
  assert.match(message, /证据状态不可用于报告/);
  assert.match(message, /来源不可访问/);
});

test('conservative no-change report can publish without inventing evidence', () => {
  const result = validateReportDraftForAutoPublish({
    content: draft('## 本期说明\n\n本周期无实质变化，继续积累资料。'),
    studentId: 'student-a',
    expectedFingerprint: 'growth-fp-1',
    growthIndex,
    sourceAccessible: () => true,
  });
  assert.equal(result.valid, true);
  assert.equal(result.conservative, true);
});

test('content fingerprint ignores frontmatter-only changes', () => {
  assert.equal(
    reportContentFingerprint('---\nupdated: 2026-07-24\n---\n\n相同正文'),
    reportContentFingerprint('---\nupdated: 2026-07-25\n---\n\n相同正文'),
  );
});
