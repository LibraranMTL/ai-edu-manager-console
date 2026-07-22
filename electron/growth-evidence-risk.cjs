const GROWTH_EVIDENCE_RISK_SCHEMA = 'edu-manager.growth-evidence-risk.v1';

const SENSITIVE_PATTERN = /身份证|证件|住址|地址|电话|手机号|健康|医疗|病史|心理|诊断|收入|家庭关系|敏感|identity|medical|health|diagnosis|psycholog/i;
const AGENT_PATTERN = /agent|ai|模型|智能体/i;
const LOW_CONFIDENCE_PATTERN = /low|低|不确定|待确认|unknown/i;
const SUBJECTIVE_SOURCE_TYPES = new Set(['student_self_report', 'parent_observation', 'teacher_assessment']);

function completeReview(item = {}) {
  const review = item.review && typeof item.review === 'object' ? item.review : {};
  return review.status === 'approved'
    && ['student', 'parent', 'teacher', 'administrator'].includes(String(review.reviewerRole || item.reviewerRole || ''))
    && Boolean(String(review.reviewerId || item.reviewerId || ''))
    && Boolean(String(review.reviewedAt || item.reviewedAt || ''));
}

function classifyGrowthEvidenceRisk(item = {}, options = {}) {
  const reasons = [];
  const sourcePath = String(item.sourceUri || item.sourcePath || '').trim();
  const sourceType = String(item.sourceType || '');
  const combined = [item.title, item.content, item.ability, item.predicate, item.note].map((value) => String(value || '')).join('\n');
  const generatedBy = String(item.generatedBy || '');
  const legacyReviewIds = new Set((options.legacyReviewIds || []).map(String));
  const status = String(item.status || 'pending');
  const actionable = status === 'pending' || (status === 'confirmed' && !completeReview(item));
  let level = 'low';

  if (!sourcePath) {
    level = 'high';
    reasons.push({ code: 'missing_source', label: '缺少可追溯来源' });
  }
  if (SENSITIVE_PATTERN.test(combined)) {
    level = 'high';
    reasons.push({ code: 'sensitive_content', label: '可能包含敏感信息' });
  }
  if (item.conflict === true || (Array.isArray(item.conflictWith) && item.conflictWith.length)) {
    level = 'high';
    reasons.push({ code: 'conflict', label: '存在冲突证据' });
  }
  if (sourceType === 'agent_inference' || AGENT_PATTERN.test(generatedBy)) {
    level = 'high';
    reasons.push({ code: 'agent_inference', label: '属于 Agent 推断' });
  }
  if (legacyReviewIds.has(String(item.id || ''))) {
    level = 'high';
    reasons.push({ code: 'legacy_review_audit_missing', label: '历史确认缺少审核记录' });
  }

  if (level !== 'high' && SUBJECTIVE_SOURCE_TYPES.has(sourceType)) {
    level = 'medium';
    reasons.push({ code: 'subjective_source', label: '来源属于主体陈述或评价' });
  }
  if (level !== 'high' && LOW_CONFIDENCE_PATTERN.test(String(item.confidence || ''))) {
    level = 'medium';
    reasons.push({ code: 'low_confidence', label: '可信度尚待观察' });
  }
  if (level === 'low' && !String(item.projectId || '').trim()) {
    level = 'medium';
    reasons.push({ code: 'no_project_context', label: '未关联学习项目' });
  }
  if (level === 'low' && (!String(item.ability || '').trim() || /待标注/.test(String(item.ability)))) {
    level = 'medium';
    reasons.push({ code: 'ability_unlabeled', label: '尚未标注能力维度' });
  }
  if (level === 'low' && item.migratedFrom) {
    level = 'medium';
    reasons.push({ code: 'legacy_import', label: '来自历史兼容导入' });
  }
  if (!reasons.length) reasons.push({ code: 'traceable_project_evidence', label: '来源完整且已关联项目' });

  return {
    schema: GROWTH_EVIDENCE_RISK_SCHEMA,
    evidenceId: String(item.id || ''),
    level,
    label: level === 'high' ? '需单独确认' : level === 'medium' ? '建议继续观察' : '低风险',
    actionable,
    requiresIndividualReview: actionable && level === 'high',
    defaultHidden: actionable && level === 'low',
    suggestedAction: !actionable ? 'none' : level === 'low' ? 'confirm' : level === 'medium' ? 'watch' : 'individual_review',
    reasons,
  };
}

function buildGrowthEvidenceBatchPlan(items = [], options = {}) {
  const assessments = items.map((item) => classifyGrowthEvidenceRisk(item, options));
  const byId = new Map(items.map((item) => [String(item.id || ''), item]));
  const confirmIds = assessments.filter((item) => item.actionable && item.suggestedAction === 'confirm').map((item) => item.evidenceId);
  const watchIds = assessments.filter((item) => item.actionable && item.suggestedAction === 'watch').map((item) => item.evidenceId);
  const individualIds = assessments.filter((item) => item.requiresIndividualReview).map((item) => item.evidenceId);
  return {
    schema: 'edu-manager.growth-evidence-batch-plan.v1',
    assessments,
    confirmIds,
    watchIds,
    individualIds,
    summary: {
      total: items.length,
      actionable: assessments.filter((item) => item.actionable).length,
      low: assessments.filter((item) => item.actionable && item.level === 'low').length,
      medium: assessments.filter((item) => item.actionable && item.level === 'medium').length,
      high: assessments.filter((item) => item.actionable && item.level === 'high').length,
      batchProcessable: confirmIds.length + watchIds.length,
      individuallyReviewed: individualIds.length,
      alreadyProcessed: assessments.filter((item) => !item.actionable && byId.has(item.evidenceId)).length,
    },
  };
}

module.exports = {
  GROWTH_EVIDENCE_RISK_SCHEMA,
  buildGrowthEvidenceBatchPlan,
  classifyGrowthEvidenceRisk,
  completeReview,
};
