const assert = require('node:assert/strict');
const test = require('node:test');

const {
  EDUCATION_OBJECT_SCHEMAS,
  EDUCATION_SCHEMA_VERSION,
  normalizeEducationObject,
  validateEducationObject,
} = require('../electron/education-domain-schemas.cjs');

test('P1 freezes five education object schemas with stable IDs and paths', () => {
  assert.equal(EDUCATION_SCHEMA_VERSION, 'edu-manager.education-domain.v1');
  assert.deepEqual(Object.keys(EDUCATION_OBJECT_SCHEMAS), ['Student', 'LearningProject', 'GrowthEvidence', 'LearningReport', 'EducationPolicy']);

  const student = normalizeEducationObject('Student', { id: 'student-synthetic-a', name: '虚构学生 A', grade: '初二', rootPath: 'D:/fixtures/student-a' });
  const project = normalizeEducationObject('LearningProject', { id: 'project-synthetic-a', name: '虚构项目', studentIds: [student.id], status: 'active', projectRootPath: 'D:/fixtures/project-a', knowledgeRootPath: 'D:/fixtures/project-a/wiki' });
  const evidence = normalizeEducationObject('GrowthEvidence', { id: 'evidence-synthetic-a', studentId: student.id, title: '虚构作品证据', status: 'candidate', sourceUri: 'fixture://student-a/work', sourcePath: 'D:/fixtures/student-a/work.md' });
  const report = normalizeEducationObject('LearningReport', { id: 'report-synthetic-a', studentId: student.id, reportType: 'weekly_action', status: 'draft', sourceClaimIds: ['claim-synthetic-a'], filePath: 'D:/fixtures/student-a/每周行动建议.md' });
  const policy = normalizeEducationObject('EducationPolicy', { id: 'policy-synthetic-a', version: '1', effectiveAt: '2026-07-21T00:00:00.000Z', reviewerRoles: ['student', 'parent', 'teacher', 'administrator'] });

  assert.equal(student.id, 'student-synthetic-a');
  assert.equal(project.workspacePath, 'D:/fixtures/project-a');
  assert.equal(evidence.originalSourcePath, 'D:/fixtures/student-a/work.md');
  assert.equal(report.presentationOnly, true);
  assert.equal(policy.knowledgeEngine, 'llm-wiki-local');
  assert.equal(policy.minimumDependencyDeployment, true);
});

test('P1 schema validation rejects incomplete records without changing source objects', () => {
  const source = { id: 'project-synthetic-a', name: '虚构项目', studentIds: [], status: 'active' };
  const before = JSON.stringify(source);
  const result = validateEducationObject('LearningProject', source);
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'MISSING_PROJECT_STUDENT');
  assert.equal(JSON.stringify(source), before);
});
