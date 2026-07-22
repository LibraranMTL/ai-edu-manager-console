const assert = require('node:assert/strict');
const test = require('node:test');

const {
  EDUCATION_DOMAIN_PROTOCOL_VERSION,
  canPublishEducationClaim,
  validateEducationClaim,
} = require('../electron/education-domain-protocol.cjs');

const evidence = (overrides = {}) => ({
  id: 'evidence-synthetic-001',
  sourceUri: 'fixture://student-a/work-001',
  sourceType: 'learning_artifact',
  actorRole: 'student',
  excerpt: '虚构作品中包含两种解法。',
  observedAt: '2026-07-01T00:00:00.000Z',
  ...overrides,
});

const claim = (overrides = {}) => ({
  id: 'claim-synthetic-001',
  subjectId: 'student-synthetic-a',
  predicate: 'used_multiple_solution_methods',
  value: '在本次虚构作品中使用两种解法',
  status: 'candidate',
  epistemicType: 'observation',
  scope: 'event',
  evidence: [evidence()],
  synthetic: true,
  ...overrides,
});

test('education protocol keeps facts, reports, observations, inferences and recommendations explicit', () => {
  const result = validateEducationClaim(claim());
  assert.equal(result.ok, true);
  assert.equal(result.claim.protocolVersion, EDUCATION_DOMAIN_PROTOCOL_VERSION);
  assert.equal(result.claim.epistemicType, 'observation');
  assert.equal(EDUCATION_DOMAIN_PROTOCOL_VERSION, 'edu-manager.education-domain.v1');
});

test('minor profile confirmation follows the frozen reviewer role decision', () => {
  const result = canPublishEducationClaim(claim({
    scope: 'profile',
    studentContext: { grade: '初二' },
    participation: { studentAcknowledged: true },
    evidence: [
      evidence(),
      evidence({ id: 'evidence-synthetic-002', sourceUri: 'fixture://student-a/source-2' }),
    ],
    counterEvidenceReviewed: true,
    review: { status: 'approved', reviewerRole: 'student', reviewerId: 'student-synthetic-a', reviewedAt: '2026-07-02T00:00:00.000Z' },
  }));
  assert.equal(result.publishable, false);
  assert.ok(result.errors.some((item) => item.code === 'REVIEWER_ROLE_NOT_ALLOWED'));
});

test('confirmed education claims require auditable human review', () => {
  const missingReview = canPublishEducationClaim(claim());
  assert.equal(missingReview.publishable, false);
  assert.ok(missingReview.errors.some((item) => item.code === 'HUMAN_REVIEW_REQUIRED'));

  const reviewed = canPublishEducationClaim(claim({
    review: {
      status: 'approved',
      reviewerRole: 'teacher',
      reviewerId: 'teacher-synthetic-001',
      reviewedAt: '2026-07-02T00:00:00.000Z',
    },
  }));
  assert.equal(reviewed.publishable, true);
});

test('profile claims need independent sources and counter-evidence review', () => {
  const weak = canPublishEducationClaim(claim({ scope: 'profile' }));
  assert.equal(weak.publishable, false);
  assert.ok(weak.errors.some((item) => item.code === 'PROFILE_REQUIRES_MULTIPLE_SOURCES'));
  assert.ok(weak.errors.some((item) => item.code === 'COUNTER_EVIDENCE_REVIEW_REQUIRED'));

  const strong = canPublishEducationClaim(claim({
    scope: 'profile',
    evidence: [
      evidence(),
      evidence({
        id: 'evidence-synthetic-002',
        sourceUri: 'fixture://student-a/teacher-observation-002',
        sourceType: 'teacher_assessment',
        actorRole: 'teacher',
      }),
    ],
    counterEvidenceReviewed: true,
    review: {
      status: 'approved',
      reviewerRole: 'teacher',
      reviewerId: 'teacher-synthetic-001',
      reviewedAt: '2026-07-02T00:00:00.000Z',
    },
  }));
  assert.equal(strong.publishable, true);
  assert.ok(strong.warnings.some((item) => item.code === 'TEACHER_ASSESSMENT_DISPLAY_LABEL'));
});

test('permanent student labels and agent-only facts are prohibited', () => {
  const permanent = validateEducationClaim(claim({ scope: 'permanent' }));
  assert.equal(permanent.ok, false);
  assert.ok(permanent.errors.some((item) => item.code === 'PERMANENT_STUDENT_LABEL_FORBIDDEN'));

  const agentOnlyFact = validateEducationClaim(claim({
    epistemicType: 'fact',
    evidence: [evidence({ sourceType: 'agent_inference', actorRole: 'agent' })],
  }));
  assert.equal(agentOnlyFact.ok, false);
  assert.ok(agentOnlyFact.errors.some((item) => item.code === 'AGENT_INFERENCE_IS_NOT_FACT'));
});

test('recommendations expire and cannot become profile conclusions', () => {
  const invalid = validateEducationClaim(claim({ epistemicType: 'recommendation', scope: 'profile' }));
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.some((item) => item.code === 'RECOMMENDATION_EXPIRY_REQUIRED'));
  assert.ok(invalid.errors.some((item) => item.code === 'RECOMMENDATION_NOT_PROFILE'));

  const valid = validateEducationClaim(claim({ epistemicType: 'recommendation', expiresAt: '2026-08-01T00:00:00.000Z' }));
  assert.equal(valid.ok, true);
});
