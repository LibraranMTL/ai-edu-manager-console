const assert = require('node:assert/strict');
const test = require('node:test');

const { normalizeProjectStudentEvidencePayload } = require('../electron/project-student-evidence-adapter.cjs');

test('standard education manager evidence payload remains compatible', () => {
  const result = normalizeProjectStudentEvidencePayload({
    format: 'edu-manager-project-student-evidence',
    projectId: 'project-1',
    students: [{ studentId: 'student-1', ability: '研究能力', observation: '完成资料核对', confidence: 'high', sourcePaths: ['a.md'] }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.sourceFormat, 'edu_manager_standard');
  assert.equal(result.suggestions[0].observation, '完成资料核对');
  assert.deepEqual(result.suggestions[0].sourcePaths, ['a.md']);
});

test('QClaw nested evidence payload is aggregated into one review draft per student', () => {
  const result = normalizeProjectStudentEvidencePayload({
    project: { projectId: 'project-2', projectName: '测试项目' },
    students: [{
      studentId: 'student-2',
      studentName: '学生甲',
      evidence: [
        { competencyName: '资料检索', observation: '完成检索', confidence: 'high', sourceFiles: [{ path: 'search.md' }] },
        { competencyName: '项目规划', observation: '完成规划', confidence: 'medium', sourceFiles: [{ path: 'plan.md' }, { path: 'search.md' }], evidenceGaps: '缺少教师反馈' },
      ],
      summary: { overallConfidence: 'medium', overallObservation: '项目持续推进。' },
    }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.projectId, 'project-2');
  assert.equal(result.sourceFormat, 'qclaw_nested');
  assert.equal(result.evidenceCount, 2);
  assert.equal(result.suggestions[0].ability, '资料检索、项目规划');
  assert.match(result.suggestions[0].observation, /项目持续推进/);
  assert.match(result.suggestions[0].observation, /缺少教师反馈/);
  assert.deepEqual(result.suggestions[0].sourcePaths, ['search.md', 'plan.md']);
  assert.equal(result.suggestions[0].status, 'draft');
});

test('invalid Agent payload returns an actionable reason', () => {
  const result = normalizeProjectStudentEvidencePayload({ students: [] });
  assert.equal(result.ok, false);
  assert.match(result.message, /projectId/);
});
