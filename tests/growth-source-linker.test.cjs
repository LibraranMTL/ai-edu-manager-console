const assert = require('node:assert/strict');
const test = require('node:test');

const {
  governedStudentGrowthCandidates,
  mergeGrowthCandidates,
  projectStudentGrowthCandidates,
  summarizeArtifactText,
} = require('../electron/growth-source-linker.cjs');

function run(scopeId = 'student-a') {
  return {
    runId: 'governance-1',
    batchId: 'batch-1',
    scope: { type: 'student', id: scopeId },
    completedAt: '2026-07-24T02:00:00.000Z',
    artifacts: [
      { id: 'a1', path: 'D:/student/knowledge/实验总结.md', exists: true, riskLevel: 'low', decision: 'accepted_internal', sourceMaterialIds: ['m1'] },
      { id: 'a2', path: 'D:/student/knowledge/待核对.md', exists: true, riskLevel: 'medium', decision: 'monitor', sourceMaterialIds: ['m2'] },
      { id: 'a3', path: 'D:/student/knowledge/无来源.md', exists: true, riskLevel: 'low', decision: 'accepted_internal', sourceMaterialIds: [] },
    ],
  };
}

test('only source-linked low-risk student knowledge becomes a watching observation', () => {
  const candidates = governedStudentGrowthCandidates({
    studentId: 'student-a',
    run: run(),
    contentForArtifact: () => '# 实验总结\n\n能够整理实验步骤并记录结果。',
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].status, 'watching');
  assert.equal(candidates[0].epistemicType, 'observation');
  assert.equal(candidates[0].systemVerification.decision, 'system_verified_observation');
  assert.deepEqual(candidates[0].systemVerification.sourceMaterialIds, ['m1']);
});

test('governance scope mismatch never creates cross-student evidence', () => {
  assert.deepEqual(governedStudentGrowthCandidates({ studentId: 'student-b', run: run('student-a') }), []);
  assert.deepEqual(governedStudentGrowthCandidates({ studentId: 'student-a', run: { ...run(), scope: { type: 'project', id: 'project-a' } } }), []);
});

test('idempotent merge preserves confirmed or rejected human decisions', () => {
  const incoming = governedStudentGrowthCandidates({ studentId: 'student-a', run: run() })[0];
  const first = mergeGrowthCandidates({ candidates: [] }, [incoming]);
  const second = mergeGrowthCandidates(first.review, [incoming]);
  assert.equal(first.added, 1);
  assert.equal(second.changed, false);

  const confirmedReview = { candidates: [{ ...incoming, status: 'confirmed', content: '人工确认内容' }] };
  const merged = mergeGrowthCandidates(confirmedReview, [{ ...incoming, content: '更新后的系统摘要' }]);
  assert.equal(merged.review.candidates[0].status, 'confirmed');
});

test('artifact summary strips frontmatter and headings', () => {
  assert.equal(
    summarizeArtifactText('---\nstatus: draft\n---\n# 标题\n\n第一条结论。\n\n第二条结论。'),
    '第一条结论。 第二条结论。',
  );
});

test('project evidence becomes an observation without fabricating confirmation', () => {
  const candidates = projectStudentGrowthCandidates({
    studentId: 'student-a',
    projects: [{
      id: 'project-a',
      name: '实验项目',
      studentIds: ['student-a', 'student-b'],
      studentEvidence: [{
        studentId: 'student-a',
        status: 'verified',
        ability: '实验设计',
        observation: '能够独立整理实验步骤。',
        sourcePaths: ['D:/project/evidence.md'],
        updatedAt: '2026-07-24T02:00:00.000Z',
      }],
    }],
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].status, 'watching');
  assert.equal(candidates[0].projectId, 'project-a');
  assert.equal(candidates[0].systemVerification.decision, 'project_evidence_observation');
});
