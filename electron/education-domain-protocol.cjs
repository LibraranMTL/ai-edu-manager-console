const {
  KnowledgeEngineContractError,
  assertPortableId,
  normalizeClaim,
} = require('./knowledge-engine-contract.cjs');
const {
  canRoleReviewEducationClaim,
  resolveEducationParticipationPolicy,
} = require('./education-governance.cjs');

const EDUCATION_DOMAIN_PROTOCOL_VERSION = 'edu-manager.education-domain.v1';

const EPISTEMIC_TYPES = new Set(['fact', 'report', 'observation', 'inference', 'recommendation']);
const EVIDENCE_SOURCE_TYPES = new Set([
  'student_self_report',
  'parent_observation',
  'teacher_assessment',
  'learning_artifact',
  'system_record',
  'agent_inference',
]);
const ACTOR_ROLES = new Set(['student', 'parent', 'teacher', 'agent', 'system', 'administrator']);
const CLAIM_SCOPES = new Set(['event', 'context', 'period', 'profile', 'permanent']);
const HUMAN_REVIEWER_ROLES = new Set(['student', 'parent', 'teacher', 'administrator']);

function issue(code, message, path = '') {
  return { code, message, path };
}

function normalizeEducationEvidence(input = {}, index = 0) {
  const evidence = {
    ...input,
    id: assertPortableId(input.id, `evidence[${index}].id`),
    sourceUri: String(input.sourceUri || '').trim(),
    sourceType: String(input.sourceType || ''),
    actorRole: String(input.actorRole || ''),
    excerpt: String(input.excerpt || ''),
    observedAt: String(input.observedAt || ''),
  };
  if (!evidence.sourceUri) throw new KnowledgeEngineContractError('MISSING_SOURCE', `evidence[${index}].sourceUri 不能为空。`);
  if (!EVIDENCE_SOURCE_TYPES.has(evidence.sourceType)) {
    throw new KnowledgeEngineContractError('INVALID_EVIDENCE_SOURCE_TYPE', `不支持的教育证据类型：${evidence.sourceType || 'missing'}。`);
  }
  if (!ACTOR_ROLES.has(evidence.actorRole)) {
    throw new KnowledgeEngineContractError('INVALID_ACTOR_ROLE', `不支持的证据主体角色：${evidence.actorRole || 'missing'}。`);
  }
  return evidence;
}

function validateEducationClaim(input = {}) {
  const errors = [];
  const warnings = [];
  let claim;
  try {
    claim = normalizeClaim({
      ...input,
      evidence: Array.isArray(input.evidence)
        ? input.evidence.map((item, index) => normalizeEducationEvidence(item, index))
        : [],
    });
  } catch (error) {
    return { ok: false, errors: [issue(error.code || 'INVALID_CLAIM', error.message)], warnings, claim: null };
  }

  claim.protocolVersion = EDUCATION_DOMAIN_PROTOCOL_VERSION;
  claim.epistemicType = String(input.epistemicType || 'observation');
  claim.scope = String(input.scope || 'event');
  claim.validFrom = String(input.validFrom || '');
  claim.validTo = String(input.validTo || '');
  claim.expiresAt = String(input.expiresAt || '');
  claim.review = {
    status: String(input.review?.status || 'pending'),
    reviewerRole: String(input.review?.reviewerRole || ''),
    reviewerId: String(input.review?.reviewerId || ''),
    reviewedAt: String(input.review?.reviewedAt || ''),
  };
  claim.counterEvidence = Array.isArray(input.counterEvidence) ? input.counterEvidence : [];
  claim.counterEvidenceReviewed = input.counterEvidenceReviewed === true;
  claim.participation = input.participation && typeof input.participation === 'object' ? { ...input.participation } : {};
  claim.participationPolicy = resolveEducationParticipationPolicy(input.studentContext || {});

  if (!EPISTEMIC_TYPES.has(claim.epistemicType)) {
    errors.push(issue('INVALID_EPISTEMIC_TYPE', `不支持的知识类型：${claim.epistemicType}。`, 'epistemicType'));
  }
  if (!CLAIM_SCOPES.has(claim.scope)) {
    errors.push(issue('INVALID_CLAIM_SCOPE', `不支持的结论范围：${claim.scope}。`, 'scope'));
  }
  if (claim.scope === 'permanent') {
    errors.push(issue('PERMANENT_STUDENT_LABEL_FORBIDDEN', '不得把能力、性格、行为或风险结论发布为永久学生标签。', 'scope'));
  }
  if (claim.status === 'confirmed') {
    if (claim.review.status !== 'approved' || !HUMAN_REVIEWER_ROLES.has(claim.review.reviewerRole)) {
      errors.push(issue('HUMAN_REVIEW_REQUIRED', '教育 Claim 正式确认前必须由明确的人类角色审核。', 'review'));
    }
    if (!claim.review.reviewerId || !claim.review.reviewedAt) {
      errors.push(issue('INCOMPLETE_REVIEW_AUDIT', '正式确认必须记录 reviewerId 和 reviewedAt。', 'review'));
    }
    if (!canRoleReviewEducationClaim({ reviewerRole: claim.review.reviewerRole, scope: claim.scope, participationPolicy: claim.participationPolicy })) {
      errors.push(issue('REVIEWER_ROLE_NOT_ALLOWED', '当前角色不能独立确认该范围的教育结论。', 'review.reviewerRole'));
    }
    if (claim.scope === 'profile' && claim.participationPolicy.studentDecision.includes('assent') && claim.participation.studentAcknowledged !== true) {
      warnings.push(issue('STUDENT_ACKNOWLEDGEMENT_RECOMMENDED', '画像级结论应向学生作适龄说明，并记录其知情、异议或纠正意见。', 'participation.studentAcknowledged'));
    }
  }

  const sourceUris = new Set(claim.evidence.map((item) => item.sourceUri));
  if (claim.scope === 'profile' && claim.status === 'confirmed') {
    if (claim.evidence.length < 2 || sourceUris.size < 2) {
      errors.push(issue('PROFILE_REQUIRES_MULTIPLE_SOURCES', '画像级结论至少需要两条相互独立的来源。', 'evidence'));
    }
    if (!claim.counterEvidenceReviewed) {
      errors.push(issue('COUNTER_EVIDENCE_REVIEW_REQUIRED', '画像级结论发布前必须明确检查反例和冲突证据。', 'counterEvidenceReviewed'));
    }
  }

  const agentEvidence = claim.evidence.filter((item) => item.sourceType === 'agent_inference');
  if (claim.epistemicType === 'fact' && agentEvidence.length === claim.evidence.length && agentEvidence.length > 0) {
    errors.push(issue('AGENT_INFERENCE_IS_NOT_FACT', '仅由 Agent 推断产生的内容不能发布为事实。', 'epistemicType'));
  }
  if (claim.epistemicType === 'inference' && claim.status === 'confirmed') {
    warnings.push(issue('INFERENCE_MUST_REMAIN_LABELED', '经人工确认的推断仍必须显示为“推断”，不能改写为事实。', 'epistemicType'));
  }
  if (claim.epistemicType === 'recommendation') {
    if (!claim.expiresAt) errors.push(issue('RECOMMENDATION_EXPIRY_REQUIRED', '建议必须设置复核或失效时间。', 'expiresAt'));
    if (claim.scope === 'profile') errors.push(issue('RECOMMENDATION_NOT_PROFILE', '建议不能作为学生画像结论发布。', 'scope'));
  }
  if (claim.epistemicType === 'observation' && !claim.validFrom && !claim.evidence.some((item) => item.observedAt)) {
    errors.push(issue('OBSERVATION_TIME_REQUIRED', '观察必须包含发生时间或有效期起点。', 'validFrom'));
  }
  if (claim.validFrom && claim.validTo && new Date(claim.validFrom).getTime() > new Date(claim.validTo).getTime()) {
    errors.push(issue('INVALID_VALIDITY_RANGE', 'validFrom 不能晚于 validTo。', 'validFrom'));
  }

  if (claim.evidence.some((item) => item.sourceType === 'student_self_report')) {
    warnings.push(issue('SELF_REPORT_DISPLAY_LABEL', '学生自述是有效来源，但展示时必须标明“学生自述”。', 'evidence'));
  }
  if (claim.evidence.some((item) => item.sourceType === 'teacher_assessment')) {
    warnings.push(issue('TEACHER_ASSESSMENT_DISPLAY_LABEL', '教师评价必须与直接行为记录分开展示。', 'evidence'));
  }

  return { ok: errors.length === 0, errors, warnings, claim };
}

function canPublishEducationClaim(input = {}) {
  const validation = validateEducationClaim({ ...input, status: 'confirmed' });
  return {
    ...validation,
    publishable: validation.ok,
  };
}

module.exports = {
  ACTOR_ROLES,
  CLAIM_SCOPES,
  EDUCATION_DOMAIN_PROTOCOL_VERSION,
  EPISTEMIC_TYPES,
  EVIDENCE_SOURCE_TYPES,
  HUMAN_REVIEWER_ROLES,
  canPublishEducationClaim,
  normalizeEducationEvidence,
  validateEducationClaim,
};
