const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildEducationClaimHistoryView,
  canRoleReviewEducationClaim,
  normalizeEducationGovernanceEvent,
  resolveEducationParticipationPolicy,
} = require('../electron/education-governance.cjs');

test('P1 age-stage policy gives minors an understandable notice and correction path', () => {
  const primary = resolveEducationParticipationPolicy({ grade: '四年级' });
  const junior = resolveEducationParticipationPolicy({ grade: '初二' });
  const senior = resolveEducationParticipationPolicy({ age: 17 });
  assert.equal(primary.ageBand, 'middle_childhood');
  assert.equal(primary.guardianConfirmation, 'required');
  assert.equal(junior.studentDecision, 'assent_and_correction');
  assert.equal(senior.studentDecision, 'primary_acknowledgement');
});

test('P1 profile review excludes agents and follows the age-stage role boundary', () => {
  const policy = resolveEducationParticipationPolicy({ grade: '初二' });
  assert.equal(canRoleReviewEducationClaim({ reviewerRole: 'agent', scope: 'event', participationPolicy: policy }), false);
  assert.equal(canRoleReviewEducationClaim({ reviewerRole: 'student', scope: 'profile', participationPolicy: policy }), false);
  assert.equal(canRoleReviewEducationClaim({ reviewerRole: 'parent', scope: 'profile', participationPolicy: policy }), true);
  assert.equal(canRoleReviewEducationClaim({ reviewerRole: 'teacher', scope: 'event', participationPolicy: policy }), true);
});

test('P1 correction, appeal, superseded decision and revisions remain in one history view', () => {
  const events = [
    normalizeEducationGovernanceEvent({ id: 'event-correction-1', claimId: 'claim-synthetic-a', type: 'correction', actorRole: 'student', actorId: 'student-synthetic-a', reason: '原观察缺少上下文', occurredAt: '2026-07-20T00:00:00.000Z' }),
    normalizeEducationGovernanceEvent({ id: 'event-appeal-1', claimId: 'claim-synthetic-a', type: 'appeal', actorRole: 'parent', actorId: 'parent-synthetic-a', reason: '申请补充教师记录', occurredAt: '2026-07-20T01:00:00.000Z' }),
    normalizeEducationGovernanceEvent({ id: 'event-supersede-1', claimId: 'claim-synthetic-a', type: 'supersede', actorRole: 'teacher', actorId: 'teacher-synthetic-a', reason: '使用新增证据修订', occurredAt: '2026-07-21T00:00:00.000Z', replacementClaimId: 'claim-synthetic-b' }),
  ];
  const view = buildEducationClaimHistoryView({
    claim: { id: 'claim-synthetic-a', status: 'superseded' },
    revisions: [{ revisionId: 'r1', status: 'confirmed', value: '第一版', updatedAt: '2026-07-19T00:00:00.000Z' }],
    events,
  });
  assert.equal(view.corrections.length, 1);
  assert.equal(view.appeals.length, 1);
  assert.equal(view.decisions.length, 1);
  assert.equal(view.supersededBy, 'claim-synthetic-b');
  assert.equal(view.revisions[0].retained, true);
  assert.equal(view.historyRetained, true);
});
