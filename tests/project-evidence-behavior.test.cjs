const assert = require('node:assert/strict');
const test = require('node:test');

const { verifiedStudentEvidenceForPublication } = require('../electron/project-evidence.cjs');

const project = {
  studentEvidence: [
    { studentId: 'student-a', ability: '数据分析', status: 'verified', sourcePaths: ['a.xlsx'] },
    { studentId: 'student-b', ability: '团队协作', status: 'draft', sourcePaths: ['meeting.md'] },
    { studentId: 'student-c', ability: '研究能力', status: 'published', sourcePaths: ['report.pdf'] },
  ],
};

test('only the matching student verified evidence can be published', () => {
  assert.equal(verifiedStudentEvidenceForPublication(project, 'student-a')?.ability, '数据分析');
  assert.equal(verifiedStudentEvidenceForPublication(project, 'student-b'), null);
  assert.equal(verifiedStudentEvidenceForPublication(project, 'student-c')?.ability, '研究能力');
  assert.equal(verifiedStudentEvidenceForPublication(project, 'student-d'), null);
});

test('another student evidence is never used as a fallback', () => {
  const result = verifiedStudentEvidenceForPublication(project, 'student-b');
  assert.notEqual(result?.studentId, 'student-a');
  assert.equal(result, null);
});
