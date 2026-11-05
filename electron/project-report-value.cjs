'use strict';

const crypto = require('node:crypto');

const MAX_CRITERIA = 20;
const DESCRIPTIVE_STATUSES = new Set([
  'inferred_achieved', 'inferred_partially_achieved', 'inferred_not_achieved',
  'insufficient_evidence', 'conflicted',
]);
const CONFIDENCE = new Set(['low', 'medium', 'high']);
const ITERATION_TYPES = new Set(['problem', 'solution', 'prototype', 'test', 'failure', 'modification', 'retest', 'result']);

function clean(value, max = 300) { return String(value ?? '').trim().slice(0, max); }
function list(value, maxItems = 20, maxLength = 300) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => clean(item, maxLength)).filter(Boolean))].slice(0, maxItems);
}
function invalid(message, code = 'project_success_criteria_invalid') {
  throw Object.assign(new Error(message), { code });
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}
function criterionId(input, index) {
  const supplied = clean(input?.criterionId, 80);
  if (supplied && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,79}$/.test(supplied)) return supplied;
  const seed = JSON.stringify(stable({ title: clean(input?.title, 120), kind: clean(input?.kind), index }));
  return `criterion-${crypto.createHash('sha256').update(seed).digest('hex').slice(0, 20)}`;
}

function normalizeProjectSuccessCriteria(input) {
  if (!Array.isArray(input)) invalid('成功标准必须是列表。');
  if (input.length > MAX_CRITERIA) invalid(`每个项目最多保存 ${MAX_CRITERIA} 条成功标准。`);
  const ids = new Set();
  return input.map((raw, index) => {
    const title = clean(raw?.title, 121);
    if (!title || title.length > 120) invalid('成功标准标题不能为空且不能超过 120 字。');
    const kind = clean(raw?.kind);
    if (!['numeric', 'descriptive'].includes(kind)) invalid('成功标准类型无效。');
    const id = criterionId(raw, index);
    if (ids.has(id)) invalid('成功标准编号不能重复。');
    ids.add(id);
    const base = { criterionId: id, title, kind, conditions: list(raw?.conditions, 20, 301),
      validationMethod: clean(raw?.validationMethod, 301), active: raw?.active !== false };
    if (base.conditions.some((item) => item.length > 300) || base.validationMethod.length > 300) {
      invalid('适用条件和验证方法单项不能超过 300 字。');
    }
    if (kind === 'descriptive') return base;
    const operator = clean(raw?.operator);
    if (!['lte', 'gte', 'between', 'eq'].includes(operator)) invalid('数值标准缺少有效比较方式。');
    const unit = clean(raw?.unit, 40);
    if (operator === 'between') {
      const targetMin = Number(raw?.targetMin), targetMax = Number(raw?.targetMax);
      if (!Number.isFinite(targetMin) || !Number.isFinite(targetMax) || targetMin > targetMax) invalid('数值范围无效。');
      return { ...base, operator, targetMin, targetMax, unit };
    }
    const targetValue = Number(raw?.targetValue);
    if (!Number.isFinite(targetValue)) invalid('数值目标无效。');
    return { ...base, operator, targetValue, unit };
  });
}

function computeNumericCriterion(criterion, observations = []) {
  const active = (Array.isArray(observations) ? observations : []).filter((item) => Number.isFinite(Number(item?.value)));
  if (!active.length) return { criterionId: criterion.criterionId, status: 'pending_validation', basis: 'numeric_validation', evidenceIds: [] };
  const evidenceIds = list(active.map((item) => item.evidenceId), 50, 120);
  const observationsByKey = new Map();
  for (const item of active) {
    const key = clean(item.observationKey, 120);
    if (!key) continue;
    const values = observationsByKey.get(key) || [];
    values.push(Number(item.value)); observationsByKey.set(key, values);
  }
  if (active.some((item) => item?.conflicted === true)
    || [...observationsByKey.values()].some((values) => values.length > 1 && Math.max(...values) !== Math.min(...values))) {
    return { criterionId: criterion.criterionId, status: 'conflicted', basis: 'numeric_validation', evidenceIds };
  }
  const values = active.map((item) => Number(item.value));
  const observedMin = Math.min(...values), observedMax = Math.max(...values);
  let status = 'not_achieved';
  if (criterion.operator === 'lte') status = observedMax <= criterion.targetValue ? 'achieved' : 'not_achieved';
  if (criterion.operator === 'gte') status = observedMin >= criterion.targetValue ? 'achieved' : 'not_achieved';
  if (criterion.operator === 'eq') status = values.every((value) => value === criterion.targetValue) ? 'achieved' : 'not_achieved';
  if (criterion.operator === 'between') {
    const lowerReached = observedMin <= criterion.targetMin;
    const upperReached = observedMax >= criterion.targetMax;
    status = lowerReached && upperReached ? 'achieved' : lowerReached || upperReached ? 'partially_achieved' : 'not_achieved';
  }
  return { criterionId: criterion.criterionId, status, basis: 'numeric_validation', observedMin, observedMax, evidenceIds };
}

function validateDescriptiveInference(raw, { criteria = [], evidenceIds = [] } = {}) {
  const criterionById = new Map(criteria.filter((item) => item.kind === 'descriptive' && item.active !== false).map((item) => [item.criterionId, item]));
  const allowedEvidence = new Set(evidenceIds.map(String));
  const criterionIdValue = clean(raw?.criterionId, 80);
  if (!criterionById.has(criterionIdValue)) invalid('AI 推定引用了不存在或非描述性的成功标准。', 'project_report_candidate_invalid');
  let status = clean(raw?.status);
  if (!DESCRIPTIVE_STATUSES.has(status)) invalid('AI 推定状态无效。', 'project_report_candidate_invalid');
  let supportingEvidenceIds = list(raw?.supportingEvidenceIds, 50, 120);
  let counterEvidenceIds = list(raw?.counterEvidenceIds, 50, 120);
  if ([...supportingEvidenceIds, ...counterEvidenceIds].some((id) => !allowedEvidence.has(id))) {
    invalid('AI 推定引用了当前报告快照之外的证据。', 'project_report_candidate_invalid');
  }
  if (supportingEvidenceIds.length && counterEvidenceIds.length) status = 'conflicted';
  if (!supportingEvidenceIds.length && !counterEvidenceIds.length && status.startsWith('inferred_')) status = 'insufficient_evidence';
  if (!supportingEvidenceIds.length && ['inferred_achieved', 'inferred_partially_achieved'].includes(status)) status = 'insufficient_evidence';
  const confidence = CONFIDENCE.has(clean(raw?.confidence)) ? clean(raw.confidence) : 'low';
  const reasoning = clean(raw?.reasoning, 1200);
  if (!reasoning) invalid('AI 推定必须说明推定依据。', 'project_report_candidate_invalid');
  return { criterionId: criterionIdValue, status, confidence, reasoning,
    supportingEvidenceIds, counterEvidenceIds,
    missingValidation: list(raw?.missingValidation, 20, 300), applicableConditions: list(raw?.applicableConditions, 20, 300),
    modelPolicyVersion: clean(raw?.modelPolicyVersion, 80) || 'project-report-descriptive-inference-v1' };
}

function validateIterationEvents(input, evidenceIds = []) {
  const allowed = new Set(evidenceIds.map(String));
  if (!Array.isArray(input)) return [];
  if (input.length > 50) invalid('迭代时间线最多包含 50 个节点。', 'project_report_candidate_invalid');
  return input.map((raw, index) => {
    const type = clean(raw?.type);
    const ids = list(raw?.evidenceIds, 20, 120);
    const reasonEvidenceIds = list(raw?.reasonEvidenceIds, 20, 120);
    if (!ITERATION_TYPES.has(type) || !ids.length || [...ids, ...reasonEvidenceIds].some((id) => !allowed.has(id))) {
      invalid('迭代时间线包含越界类型或证据。', 'project_report_candidate_invalid');
    }
    return { eventId: clean(raw?.eventId, 80) || `iteration-${index + 1}`, type,
      title: clean(raw?.title, 160), description: clean(raw?.description, 1200), occurredAt: clean(raw?.occurredAt, 40),
      evidenceIds: ids, reason: reasonEvidenceIds.length ? clean(raw?.reason, 600) : '', reasonEvidenceIds,
      reasonStatus: reasonEvidenceIds.length ? 'recorded' : 'missing' };
  });
}

module.exports = { MAX_CRITERIA, DESCRIPTIVE_STATUSES, normalizeProjectSuccessCriteria, computeNumericCriterion,
  validateDescriptiveInference, validateIterationEvents };
