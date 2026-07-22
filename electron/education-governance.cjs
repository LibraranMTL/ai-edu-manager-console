const { KnowledgeEngineContractError, assertPortableId } = require('./knowledge-engine-contract.cjs');

const EDUCATION_GOVERNANCE_SCHEMA = 'edu-manager.education-governance-event.v1';
const EDUCATION_GOVERNANCE_EVENT_TYPES = new Set(['correction', 'appeal', 'review_decision', 'supersede', 'revoke']);
const REVIEW_DECISION_ROLES = new Set(['student', 'parent', 'teacher', 'administrator']);

function gradeBand(grade) {
  const value = String(grade || '').trim();
  if (/幼儿|学前|一年级|二年级|小一|小二/.test(value)) return 'early_childhood';
  if (/三年级|四年级|五年级|六年级|小三|小四|小五|小六/.test(value)) return 'middle_childhood';
  if (/初一|初二|初三|七年级|八年级|九年级/.test(value)) return 'early_adolescence';
  if (/高一|高二|高三|十年级|十一年级|十二年级/.test(value)) return 'late_adolescence';
  return 'unknown_minor';
}

function resolveEducationParticipationPolicy({ age, grade } = {}) {
  const numericAge = Number(age);
  let ageBand = Number.isFinite(numericAge) && numericAge >= 0
    ? numericAge < 8 ? 'early_childhood'
      : numericAge < 12 ? 'middle_childhood'
        : numericAge < 16 ? 'early_adolescence'
          : numericAge < 18 ? 'late_adolescence'
            : 'adult'
    : gradeBand(grade);
  if (!ageBand) ageBand = 'unknown_minor';
  const policies = {
    early_childhood: { studentNotice: 'simple_explanation', studentDecision: 'invite_expression', guardianConfirmation: 'required', profileDecisionRoles: ['parent', 'teacher', 'administrator'] },
    middle_childhood: { studentNotice: 'age_appropriate_explanation', studentDecision: 'assent', guardianConfirmation: 'required', profileDecisionRoles: ['parent', 'teacher', 'administrator'] },
    early_adolescence: { studentNotice: 'full_summary_and_sources', studentDecision: 'assent_and_correction', guardianConfirmation: 'required_for_profile', profileDecisionRoles: ['parent', 'teacher', 'administrator'] },
    late_adolescence: { studentNotice: 'full_summary_and_sources', studentDecision: 'primary_acknowledgement', guardianConfirmation: 'required_for_high_risk_profile', profileDecisionRoles: ['student', 'parent', 'teacher', 'administrator'] },
    adult: { studentNotice: 'full_disclosure', studentDecision: 'self_decision', guardianConfirmation: 'not_required', profileDecisionRoles: ['student', 'administrator'] },
    unknown_minor: { studentNotice: 'age_appropriate_explanation', studentDecision: 'invite_expression', guardianConfirmation: 'required_for_profile', profileDecisionRoles: ['parent', 'teacher', 'administrator'] },
  };
  return { ageBand, ...policies[ageBand] };
}

function canRoleReviewEducationClaim({ reviewerRole, scope, participationPolicy } = {}) {
  const role = String(reviewerRole || '');
  if (!REVIEW_DECISION_ROLES.has(role)) return false;
  if (String(scope || '') !== 'profile') return true;
  const allowed = Array.isArray(participationPolicy?.profileDecisionRoles)
    ? participationPolicy.profileDecisionRoles
    : ['parent', 'teacher', 'administrator'];
  return allowed.includes(role);
}

function normalizeEducationGovernanceEvent(input = {}) {
  const type = String(input.type || '');
  if (!EDUCATION_GOVERNANCE_EVENT_TYPES.has(type)) {
    throw new KnowledgeEngineContractError('INVALID_GOVERNANCE_EVENT_TYPE', `不支持的教育治理事件：${type || 'missing'}。`);
  }
  const event = {
    schema: EDUCATION_GOVERNANCE_SCHEMA,
    ...input,
    id: assertPortableId(input.id, 'governanceEvent.id'),
    claimId: assertPortableId(input.claimId, 'governanceEvent.claimId'),
    type,
    actorRole: String(input.actorRole || ''),
    actorId: String(input.actorId || ''),
    reason: String(input.reason || ''),
    occurredAt: String(input.occurredAt || new Date().toISOString()),
    status: String(input.status || 'submitted'),
    replacementClaimId: input.replacementClaimId ? assertPortableId(input.replacementClaimId, 'governanceEvent.replacementClaimId') : '',
  };
  if (!event.actorRole || !event.actorId) throw new KnowledgeEngineContractError('MISSING_GOVERNANCE_ACTOR', '治理事件必须记录 actorRole 和 actorId。');
  if (!event.reason) throw new KnowledgeEngineContractError('MISSING_GOVERNANCE_REASON', '治理事件必须记录理由或依据。');
  if (type === 'supersede' && !event.replacementClaimId) throw new KnowledgeEngineContractError('MISSING_REPLACEMENT_CLAIM', 'supersede 事件必须记录 replacementClaimId。');
  return event;
}

function buildEducationClaimHistoryView({ claim, revisions = [], events = [] } = {}) {
  const claimId = assertPortableId(claim?.id, 'claim.id');
  const normalizedEvents = events.map(normalizeEducationGovernanceEvent).filter((event) => event.claimId === claimId);
  const normalizedRevisions = revisions.map((item, index) => ({
    revisionId: String(item.revisionId || item.revision || `revision-${index + 1}`),
    claimId,
    status: String(item.status || ''),
    updatedAt: String(item.updatedAt || ''),
    value: item.value,
    retained: true,
  }));
  return {
    schema: 'edu-manager.education-claim-history-view.v1',
    claimId,
    currentStatus: String(claim.status || ''),
    supersededBy: String(claim.supersededBy || normalizedEvents.find((event) => event.type === 'supersede')?.replacementClaimId || ''),
    revisions: normalizedRevisions,
    corrections: normalizedEvents.filter((event) => event.type === 'correction'),
    appeals: normalizedEvents.filter((event) => event.type === 'appeal'),
    decisions: normalizedEvents.filter((event) => ['review_decision', 'supersede', 'revoke'].includes(event.type)),
    historyRetained: true,
  };
}

module.exports = {
  EDUCATION_GOVERNANCE_EVENT_TYPES,
  EDUCATION_GOVERNANCE_SCHEMA,
  REVIEW_DECISION_ROLES,
  buildEducationClaimHistoryView,
  canRoleReviewEducationClaim,
  normalizeEducationGovernanceEvent,
  resolveEducationParticipationPolicy,
};
