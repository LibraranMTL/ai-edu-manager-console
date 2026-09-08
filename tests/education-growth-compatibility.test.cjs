const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  mapGrowthEvidenceReviewToEducationClaims,
  mapGrowthIndexV2ToDomainSnapshot,
  sourceUriFromLegacyPath,
} = require('../electron/education-growth-compatibility.cjs');

const student = { id: 'student-synthetic-a', name: '虚构学生 A' };

test('legacy confirmed evidence without reviewer audit remains a candidate compatibility view', () => {
  const review = {
    version: 1,
    candidates: [{
      id: 'legacy-evidence-001',
      studentId: student.id,
      title: '独立完成虚构实验设计',
      content: '在一次虚构项目中独立完成实验设计。',
      status: 'confirmed',
      ability: '科学研究',
      confidence: '历史确认',
      sourcePath: 'D:\\fixtures\\student-a\\实验记录.md',
      createdAt: '2026-07-10T00:00:00.000Z',
    }],
  };
  const before = JSON.stringify(review);
  const mapped = mapGrowthEvidenceReviewToEducationClaims({ student, review, sourcePath: 'D:/fixtures/成长证据审核.json' });
  assert.equal(JSON.stringify(review), before);
  assert.equal(mapped.readOnly, true);
  assert.equal(mapped.claims[0].id, 'legacy-evidence-001');
  assert.equal(mapped.claims[0].legacy.legacyStatus, 'confirmed');
  assert.equal(mapped.claims[0].status, 'candidate');
  assert.equal(mapped.claims[0].evidence[0].originalSourcePath, 'D:\\fixtures\\student-a\\实验记录.md');
  assert.match(mapped.claims[0].evidence[0].sourceUri, /^file:\/\/\/D:\/fixtures/);
  assert.ok(mapped.issues.some((item) => item.code === 'LEGACY_REVIEW_AUDIT_MISSING'));
  assert.equal(mapped.summary.requiresLegacyReviewAudit, 1);
  assert.equal(mapped.reviewQueue.length, 1);
  assert.equal(mapped.reviewQueue[0].evidenceId, 'legacy-evidence-001');
  assert.deepEqual(mapped.reviewQueue[0].actions, ['confirm', 'watch', 'reject']);
  assert.equal(mapped.growthEvidence[0].schema, 'edu-manager.growth-evidence.v1');
  assert.equal(mapped.historyViews[0].historyRetained, true);
});

test('legacy confirmed evidence with complete human audit can map to confirmed', () => {
  const mapped = mapGrowthEvidenceReviewToEducationClaims({
    student,
    review: { version: 1, candidates: [{
      id: 'legacy-evidence-002',
      studentId: student.id,
      title: '虚构教师观察',
      content: '在指定项目情境中完成两次修订。',
      status: 'confirmed',
      ability: '反思改进',
      confidence: '教师确认',
      sourcePath: 'fixture://student-a/teacher-note',
      createdAt: '2026-07-10T00:00:00.000Z',
      review: { status: 'approved', reviewerRole: 'teacher', reviewerId: 'teacher-synthetic-001', reviewedAt: '2026-07-11T00:00:00.000Z' },
    }] },
  });
  assert.equal(mapped.claims[0].status, 'confirmed');
  assert.equal(mapped.validation[0].ok, true);
  assert.equal(mapped.claims[0].evidence[0].sourceType, 'teacher_assessment');
  assert.equal(mapped.reviewQueue.length, 0);
});

test('growth-index maps IDs and paths without promoting derived ability aggregates to claims', () => {
  const index = {
    version: 2,
    schema: 'edu-manager.growth-model.v2',
    studentId: student.id,
    studentName: student.name,
    updatedAt: '2026-07-13T00:00:00.000Z',
    sourceFiles: { evidenceReview: 'D:/fixtures/成长证据审核.json' },
    migration: { legacyEvidenceImported: 1 },
    evidence: [{ id: 'evidence-index-001', title: '虚构作品证据', content: '完成虚构作品。', status: 'watching', ability: '创作表达', projectId: 'project-synthetic-001', projectName: '虚构项目', sourcePath: 'fixture://student-a/work', updatedAt: '2026-07-12T00:00:00.000Z' }],
    projects: [{ projectId: 'project-synthetic-001', projectName: '虚构项目', contributionId: 'contribution-synthetic-001', evidenceIds: ['evidence-index-001'], status: 'published', publishedAt: '2026-07-13T00:00:00.000Z' }],
    abilities: [{ abilityId: 'ability-synthetic-001', name: '创作表达', maturity: 'emerging', trend: 'stable', confidence: 'watching', evidenceIds: ['evidence-index-001'] }],
  };
  const before = JSON.stringify(index);
  const mapped = mapGrowthIndexV2ToDomainSnapshot({ student, index, sourcePath: 'D:/fixtures/growth-index.json' });
  assert.equal(JSON.stringify(index), before);
  assert.equal(mapped.profile.id, student.id);
  assert.equal(mapped.claims[0].id, 'evidence-index-001');
  assert.equal(mapped.projects[0].id, 'project-synthetic-001');
  assert.equal(mapped.projects[0].schema, 'edu-manager.learning-project.v1');
  assert.deepEqual(mapped.projects[0].evidenceIds, ['evidence-index-001']);
  assert.equal(mapped.abilityViews[0].publishableClaim, false);
  assert.equal(mapped.abilityViews[0].derived, true);
  assert.equal(mapped.originalSourceFiles.evidenceReview, 'D:/fixtures/成长证据审核.json');
});

test('legacy student IDs containing Chinese characters get a stable portable protocol identity', () => {
  const legacyStudent = { id: '1783487923864-包书源', name: '包书源' };
  const review = {
    candidates: [{
      id: 'legacy-evidence-cn-001',
      studentId: legacyStudent.id,
      title: '项目证据',
      content: '完成项目成果。',
      status: 'pending',
      sourcePath: 'D:/fixtures/work.md',
    }],
  };
  const mapped = mapGrowthEvidenceReviewToEducationClaims({ student: legacyStudent, review });
  assert.match(mapped.profile.id, /^student-[a-f0-9]{20}$/);
  assert.equal(mapped.profile.legacyId, legacyStudent.id);
  assert.equal(mapped.profile.idRemapped, true);
  assert.equal(mapped.domainStudent.id, mapped.profile.id);
  assert.equal(mapped.growthEvidence[0].studentId, mapped.profile.id);
  assert.ok(mapped.idMappings.some((item) => item.type === 'Student' && item.legacyId === legacyStudent.id));
  assert.equal(mapGrowthEvidenceReviewToEducationClaims({ student: legacyStudent, review }).profile.id, mapped.profile.id);
});

test('compatibility mapping rejects cross-student evidence and indexes', () => {
  assert.throws(
    () => mapGrowthEvidenceReviewToEducationClaims({ student, review: { candidates: [{ id: 'e1', studentId: 'student-synthetic-b' }] } }),
    (error) => error.code === 'CROSS_STUDENT_EVIDENCE',
  );
  assert.throws(
    () => mapGrowthIndexV2ToDomainSnapshot({ student, index: { studentId: 'student-synthetic-b' } }),
    (error) => error.code === 'CROSS_STUDENT_INDEX',
  );
});

test('legacy paths become explicit source URIs without changing the original path field', () => {
  assert.equal(sourceUriFromLegacyPath('fixture://student-a/work', 'e1'), 'fixture://student-a/work');
  assert.equal(sourceUriFromLegacyPath('', 'e1'), 'legacy-review://growth-evidence/e1');
  assert.match(sourceUriFromLegacyPath('relative/成长证据.md', 'e1'), /^legacy-path:\/\/\//);
});

test('Electron read responses expose compatibility views without replacing legacy payloads', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /mapGrowthEvidenceReviewToEducationClaims\(\{ student: normalized, review, sourcePath: growthEvidenceReviewPath\(normalized\) \}\)/);
  assert.match(main, /mapGrowthIndexV2ToDomainSnapshot\(\{ student: normalized, index, sourcePath:/);
  assert.match(main, /\{ ok: true, automatic, review, protocolCompatibility, riskAssessment, path:/);
  assert.match(main, /\{ ok: true, index, protocolCompatibility, path:/);
  assert.match(main, /item\.reviewerRole = item\.review\.reviewerRole/);
  assert.match(main, /item\.reviewHistory = \[/);
  assert.match(main, /reviewerId: 'system-risk-policy'/);
  assert.match(main, /并记录本机人工审核/);
});
