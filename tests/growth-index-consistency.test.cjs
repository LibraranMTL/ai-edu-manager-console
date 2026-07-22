const assert = require('node:assert/strict');
const test = require('node:test');

const {
  growthIndexNeedsRebuild,
  growthSourceFingerprint,
  legacyReportCandidate,
} = require('../electron/growth-index-consistency.cjs');

test('growth fingerprint changes when evidence status or project state changes', () => {
  const review = { candidates: [{ id: 'e1', status: 'pending', ability: '研究能力', updatedAt: '2026-07-20' }] };
  const projects = [{ id: 'p1', status: 'active', updatedAt: '2026-07-20' }];
  const first = growthSourceFingerprint(review, projects);
  const second = growthSourceFingerprint({ candidates: [{ ...review.candidates[0], status: 'confirmed' }] }, projects);
  const third = growthSourceFingerprint(review, [{ ...projects[0], status: 'published' }]);
  assert.notEqual(first, second);
  assert.notEqual(first, third);
  assert.equal(growthIndexNeedsRebuild({ version: 2, sourceFingerprint: first }, first), false);
  assert.equal(growthIndexNeedsRebuild({ version: 2, sourceFingerprint: first }, second), true);
});

test('legacy learning report becomes pending source-linked candidate only', () => {
  const candidate = legacyReportCandidate({
    studentId: 'student-1',
    reportId: 'profile',
    title: '整体画像',
    sourcePath: 'D:/student/学情报告/整体画像.md',
    content: '# 整体画像\n\n## 学习优势\n\n能够持续整理实验数据，并在教师反馈后修正分析方法。',
  });
  assert.ok(candidate);
  assert.equal(candidate.status, 'pending');
  assert.equal(candidate.confidence, '历史报告待核验');
  assert.match(candidate.sourcePath, /整体画像\.md$/);
});

test('placeholder report does not create fake growth evidence', () => {
  assert.equal(legacyReportCandidate({ studentId: 'student-1', sourcePath: 'x.md', content: '# 报告\n\n待补充。' }), null);
});

