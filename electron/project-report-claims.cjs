'use strict';

const { sha256, stableJson } = require('./project-report-snapshot.cjs');
const { computeNumericCriterion, validateDescriptiveInference, validateIterationEvents } = require('./project-report-value.cjs');

function text(value) { return String(value ?? '').trim(); }
function statusLabel(status) { return ({ active: '进行中', paused: '已暂停', completed: '已完成待归档', archived: '已归档', published: '已发布' })[text(status)] || '状态待核对'; }
function claim(key, section, statement, evidenceIds, options = {}) {
  return { claimKey: key, section, subjectType: options.subjectType || 'project', subjectId: options.subjectId || '',
    kind: options.kind || 'fact', status: options.status || 'fact', statement, evidenceIds: [...new Set(evidenceIds || [])],
    audience: options.audience || ['admin', 'student', 'teacher'] };
}

function buildM1ProjectReport(snapshot) {
  if (!snapshot?.projectId || !snapshot?.inputFingerprint) throw Object.assign(new Error('项目报告快照无效。'), { code: 'project_report_snapshot_invalid' });
  const metadataEvidence = snapshot.evidence.find((item) => item.sourceType === 'project_metadata');
  const registryEvidence = snapshot.evidence.find((item) => item.sourceType === 'project_material_registry');
  const byId = new Map(snapshot.evidence.map((item) => [item.evidenceId, item]));
  const evidenceIds = metadataEvidence ? [metadataEvidence.evidenceId] : [];
  const registryEvidenceIds = registryEvidence ? [registryEvidence.evidenceId] : [];
  const claims = [];
  claims.push(claim('project-overview', 'project_overview', snapshot.project.objective
    ? `项目目标：${snapshot.project.objective}` : '项目目标还没有填写。', evidenceIds));
  claims.push(claim('project-stage', 'stage_change', `项目状态：${statusLabel(snapshot.project.status)}。`, evidenceIds));
  claims.push(claim('registered-evidence', 'stage_change',
    `截至 ${snapshot.asOf}，本报告参考了 ${snapshot.coverage.materials.total} 份项目资料，其中 ${snapshot.coverage.materials.unavailable} 份暂时无法使用。`, registryEvidenceIds));
  const representativeResults = [];
  for (const evidenceId of snapshot.representativeEvidenceIds || []) {
    const evidence = byId.get(evidenceId);
    if (!evidence || evidence.availability !== 'active') continue;
    representativeResults.push({ title: evidence.title || evidence.sourceId, evidenceId, citationId: evidence.citationId,
      statement: `已纳入项目：《${evidence.title || evidence.sourceId}》第 ${evidence.revision} 版。` });
    claims.push(claim(`representative-${evidence.sourceId}`, 'representative_results', representativeResults.at(-1).statement, [evidenceId]));
  }
  const gaps = [];
  let nextAction = '';
  if (!snapshot.project.objective) { gaps.push('项目目标还没有填写。'); nextAction = '请先补充项目目标和完成标准。'; }
  else if (!snapshot.coverage.materials.total) { gaps.push('还没有添加项目资料。'); nextAction = '添加能够说明当前进展的项目资料。'; }
  else if (snapshot.coverage.materials.unavailable || snapshot.coverage.materials.pending) {
    gaps.push(`有 ${snapshot.coverage.materials.unavailable + snapshot.coverage.materials.pending} 份项目资料暂时无法使用或尚未纳入报告。`); nextAction = '恢复或确认待处理资料后更新报告。';
  } else if (!snapshot.coverage.knowledge.total) { gaps.push('现有资料还没有形成可复用的项目内容。'); nextAction = '整理现有资料，并补充可以查看的项目摘要或测试记录。'; }
  else { gaps.push('当前报告只汇总已记录的信息；是否完成目标还需要测试结果或明确评价。'); nextAction = '补充可对比的测试记录或已确认评价，再检查项目目标是否完成。'; }
  claims.push(claim('next-action', 'gaps_next', nextAction, [...evidenceIds, ...registryEvidenceIds], { kind: 'suggestion', status: 'recommended' }));
  const personalContributions = (snapshot.confirmedContributions || []).map((item) => ({ ...item,
    claimKey: `confirmed-contribution-${sha256(`${snapshot.projectId}\n${item.studentId}\n${stableJson(item.evidenceIds)}`).slice(0, 20)}` }));
  const report = { reportType: 'stage_summary', policyVersion: snapshot.policyVersion,
    summary: { currentStage: statusLabel(snapshot.project.status), changes: '首次生成阶段进展报告。', representativeResults, nextAction },
    claims, gaps, personalContributions,
    disclaimer: '本报告根据当前项目资料整理，仅用于查看阶段进展，不代表学生能力或知识掌握情况。' };
  report.contentFingerprint = sha256(report);
  return report;
}

const PROJECT_REPORT_VALUE_ENABLED = process.env.EDU_PROJECT_REPORT_VALUE_V1 !== '0';
const M2_POLICY_VERSION = PROJECT_REPORT_VALUE_ENABLED ? 'project-report-m2-v2' : 'project-report-m2-v1';
const M3_POLICY_VERSION = 'project-report-m3-v1';
const REPORT_SECTIONS = Object.freeze([
  ['project_overview', '项目概况'], ['stage_change', '阶段与本期变化'], ['exploration_iteration', '探究与迭代'],
  ['outcomes', '成果与目标达成'], ['team_contribution', '团队成果与个人贡献'], ['gaps_next', '缺口与下一步'],
  ['showcase', '展示材料'],
]);
const REPORT_SECTION_KEYS = new Set(REPORT_SECTIONS.map(([key]) => key));

function validateM2Candidate(snapshot, candidate = {}) {
  const evidence = new Set((snapshot.evidence || []).map((item) => item.evidenceId));
  const claims = Array.isArray(candidate.claims) ? candidate.claims : [];
  if (claims.length > 200) throw Object.assign(new Error('项目报告候选判断数量超限。'), { code: 'project_report_candidate_invalid' });
  return claims.map((item) => {
    const claimKey = text(item?.claimKey), section = text(item?.section), statement = text(item?.statement);
    const evidenceIds = [...new Set(Array.isArray(item?.evidenceIds) ? item.evidenceIds.map(text).filter(Boolean) : [])];
    if (!claimKey || claimKey.length > 160 || !REPORT_SECTION_KEYS.has(section) || !statement || statement.length > 2000
      || evidenceIds.some((id) => !evidence.has(id))) {
      throw Object.assign(new Error('项目报告候选包含越界判断或依据。'), { code: 'project_report_candidate_invalid' });
    }
    let validatedStatement = statement;
    let validatedStatus = text(item.status) || 'pending';
    if (section === 'outcomes' && ['achieved', 'partially_achieved', 'not_achieved'].includes(validatedStatus)) {
      const measurement = item?.measurement || {};
      const values = ['requiredMin', 'requiredMax', 'observedMin', 'observedMax'].map((key) => Number(measurement[key]));
      const unit = text(measurement.unit);
      if (measurement.kind !== 'range' || values.some((value) => !Number.isFinite(value)) || !unit
        || values[0] > values[1] || values[2] > values[3]) {
        throw Object.assign(new Error('目标达成判断缺少可比较的结构化测量。'), { code: 'project_report_candidate_invalid' });
      }
      const [requiredMin, requiredMax, observedMin, observedMax] = values;
      const lowerReached = observedMin <= requiredMin, upperReached = observedMax >= requiredMax;
      validatedStatus = lowerReached && upperReached ? 'achieved' : lowerReached || upperReached ? 'partially_achieved' : 'not_achieved';
      const suffix = validatedStatus === 'achieved' ? '已覆盖登记目标范围。'
        : validatedStatus === 'partially_achieved' ? '只覆盖登记目标范围的一侧，尚未完全达成。' : '尚未覆盖登记目标范围。';
      validatedStatement = `登记目标范围 ${requiredMin} 至 ${requiredMax} ${unit}；当前实测 ${observedMin} 至 ${observedMax} ${unit}，${suffix}`;
    }
    return claim(claimKey, section, validatedStatement, evidenceIds, {
      kind: ['fact', 'judgement', 'suggestion'].includes(text(item.kind)) ? text(item.kind) : 'judgement',
      status: validatedStatus, audience: ['admin', 'student', 'teacher'],
    });
  });
}

function validateParticipationItems(input, allowedEvidenceIds, kind) {
  const allowed = new Set(allowedEvidenceIds);
  const items = Array.isArray(input) ? input : [];
  if (items.length > 50) throw Object.assign(new Error('参与分层候选数量超限。'), { code: 'project_report_candidate_invalid' });
  return items.map((item) => {
    const evidenceIds = [...new Set((Array.isArray(item?.evidenceIds) ? item.evidenceIds : []).map(text).filter(Boolean))];
    if (!evidenceIds.length || evidenceIds.some((id) => !allowed.has(id))) throw Object.assign(
      new Error('参与分层引用了当前快照之外的证据。'), { code: 'project_report_candidate_invalid' });
    if (kind === 'ai' && !text(item.generatedBy || item.receiptId)) throw Object.assign(
      new Error('AI 辅助项缺少明确生成记录。'), { code: 'project_report_candidate_invalid' });
    if (kind === 'student_choice' && item.confirmed !== true) throw Object.assign(
      new Error('学生选择与修改尚未确认。'), { code: 'project_report_candidate_invalid' });
    return { title: text(item.title).slice(0, 160), description: text(item.description).slice(0, 800), evidenceIds,
      ...(kind === 'ai' ? { generatedBy: text(item.generatedBy).slice(0, 80), receiptId: text(item.receiptId).slice(0, 120) } : {}),
      ...(kind === 'student_choice' ? { confirmed: true } : {}) };
  });
}

function compareReportClaims(previousReport, currentClaims) {
  const before = new Map((previousReport?.claims || []).map((item) => [item.claimKey, item]));
  const after = new Map((currentClaims || []).map((item) => [item.claimKey, item]));
  const changes = { added: [], revised: [], withdrawn: [], unchanged: [] };
  for (const [claimKey, item] of after) {
    const prior = before.get(claimKey);
    const entry = { claimKey, section: item.section, statement: item.statement, status: item.status,
      evidenceIds: item.evidenceIds || [], audience: item.audience || [] };
    if (!prior) { changes.added.push({ ...entry, reason: '出现新的已授权依据或项目登记事实。' }); continue; }
    const priorShape = stableJson({ statement: prior.statement, status: prior.status, evidenceIds: prior.evidenceIds || [] });
    const nextShape = stableJson({ statement: item.statement, status: item.status, evidenceIds: item.evidenceIds || [] });
    if (priorShape === nextShape) changes.unchanged.push(entry);
    else changes.revised.push({ ...entry, previousStatement: prior.statement,
      reason: stableJson(prior.evidenceIds || []) === stableJson(item.evidenceIds || []) ? '同一判断的状态或表述发生实质修订。' : '判断所依赖的证据发生变化。' });
  }
  for (const [claimKey, item] of before) if (!after.has(claimKey)) changes.withdrawn.push({
    claimKey, section: item.section, previousStatement: item.statement, statement: '当前版本不再包含此判断。',
    status: 'withdrawn', evidenceIds: item.evidenceIds || [], audience: item.audience || [], reason: '原判断在当前证据快照中已撤回或不再适用。',
  });
  return changes;
}

function buildM2ProjectReport(snapshot, previousReport = null, candidate = {}) {
  if (!snapshot?.projectId || !snapshot?.inputFingerprint) throw Object.assign(new Error('项目报告快照无效。'), { code: 'project_report_snapshot_invalid' });
  const byType = (type) => (snapshot.evidence || []).filter((item) => item.sourceType === type && item.availability === 'active');
  const metadata = byType('project_metadata')[0];
  const registry = byType('project_material_registry')[0];
  const activeEvidence = new Map((snapshot.evidence || []).filter((item) => item.availability === 'active').map((item) => [item.evidenceId, item]));
  const representative = (snapshot.representativeEvidenceIds || []).map((id) => activeEvidence.get(id)).filter(Boolean);
  const knowledge = byType('project_knowledge');
  const claims = [];
  claims.push(claim('project-overview', 'project_overview', snapshot.project.objective
    ? `项目目标：${snapshot.project.objective}` : '项目目标还没有填写。', metadata ? [metadata.evidenceId] : []));
  claims.push(claim('project-deliverables', 'project_overview', snapshot.project.deliverables?.length
    ? `计划完成：${snapshot.project.deliverables.join('、')}。` : '项目还没有填写计划成果。', metadata ? [metadata.evidenceId] : [], { status: snapshot.project.deliverables?.length ? 'fact' : 'pending' }));
  claims.push(claim('project-stage', 'stage_change', `项目状态：${statusLabel(snapshot.project.status)}。`, metadata ? [metadata.evidenceId] : []));
  claims.push(claim('registered-evidence', 'stage_change', `截至 ${snapshot.asOf}，本报告参考了 ${snapshot.coverage.materials.analyzed} 份项目资料。`, registry ? [registry.evidenceId] : []));
  for (const evidence of representative.slice(0, 3)) claims.push(claim(`iteration-${evidence.sourceId}`, 'exploration_iteration',
    `已使用《${evidence.title || evidence.sourceId}》第 ${evidence.revision} 版；修改效果还需要测试或反馈确认。`, [evidence.evidenceId], { status: 'observed' }));
  const outcomeEvidence = [...representative.map((item) => item.evidenceId), ...knowledge.slice(0, 3).map((item) => item.evidenceId)];
  claims.push(claim('objective-attainment', 'outcomes', outcomeEvidence.length
    ? '已有成果记录，但还缺少可对比的测试结果，暂时不能确认目标是否完成。' : '还没有找到能够确认项目目标是否完成的成果或测试记录。', outcomeEvidence,
  { kind: 'judgement', status: 'pending' }));
  claims.push(claim('team-results', 'team_contribution', representative.length
    ? `目前有 ${representative.length} 份可查看的团队成果；每位成员的具体贡献还需要单独确认。` : '目前还没有可查看的团队成果。',
  representative.map((item) => item.evidenceId), { status: representative.length ? 'observed' : 'pending' }));
  const gaps = [];
  if (!snapshot.project.objective) gaps.push('项目目标还没有填写。');
  if (!snapshot.coverage.materials.total) gaps.push('还没有添加项目资料。');
  if (snapshot.coverage.materials.unavailable || snapshot.coverage.materials.pending) gaps.push(`有 ${snapshot.coverage.materials.unavailable + snapshot.coverage.materials.pending} 份项目资料暂时无法使用或尚未纳入报告。`);
  if (!knowledge.length) gaps.push('还没有形成可以查看的项目摘要或测试记录。');
  if (!gaps.length) gaps.push('是否完成目标还需要测试结果、适用条件或已确认评价。');
  const nextAction = !snapshot.project.objective ? '请先补充项目目标和完成标准。'
    : !snapshot.coverage.materials.total ? '添加能够说明当前进展的项目资料。'
      : !knowledge.length ? '整理现有资料，并补充可以查看的项目摘要或测试记录。' : '补充可对比的测试记录，并检查尚未覆盖的条件。';
  claims.push(claim('next-action', 'gaps_next', nextAction, [metadata?.evidenceId, registry?.evidenceId].filter(Boolean), { kind: 'suggestion', status: 'recommended' }));
  for (const evidence of representative.slice(0, 3)) claims.push(claim(`showcase-${evidence.sourceId}`, 'showcase',
    `主要成果：《${evidence.title || evidence.sourceId}》第 ${evidence.revision} 版。`, [evidence.evidenceId]));
  const candidateClaims = validateM2Candidate(snapshot, candidate);
  const merged = new Map(claims.map((item) => [item.claimKey, item]));
  for (const item of candidateClaims) merged.set(item.claimKey, item);
  const finalClaims = [...merged.values()];
  const sections = REPORT_SECTIONS.map(([key, title]) => ({ key, title, items: finalClaims.filter((item) => item.section === key) }));
  const changes = compareReportClaims(previousReport, finalClaims);
  const representativeResults = representative.slice(0, 3).map((evidence) => ({ title: evidence.title || evidence.sourceId,
    evidenceId: evidence.evidenceId, citationId: evidence.citationId,
    statement: `已纳入项目：《${evidence.title || evidence.sourceId}》第 ${evidence.revision} 版。` }));
  const criteria = Array.isArray(snapshot.project.successCriteria) ? snapshot.project.successCriteria.filter((item) => item?.active !== false) : [];
  const allowedEvidenceIds = (snapshot.evidence || []).map((item) => item.evidenceId);
  const numericCriterionIds = new Set(criteria.filter((item) => item.kind === 'numeric').map((item) => item.criterionId));
  const numericObservations = Array.isArray(candidate.numericObservations) ? candidate.numericObservations : [];
  if (numericObservations.some((item) => !numericCriterionIds.has(text(item?.criterionId)) || !allowedEvidenceIds.includes(text(item?.evidenceId)))) {
    throw Object.assign(new Error('数值验证引用了当前快照之外的标准或证据。'), { code: 'project_report_candidate_invalid' });
  }
  const observationByCriterion = new Map(numericObservations
    .reduce((entries, item) => {
      const key = text(item?.criterionId), current = entries.get(key) || []; current.push(item); entries.set(key, current); return entries;
    }, new Map()));
  const inferenceByCriterion = new Map((Array.isArray(candidate.descriptiveInferences) ? candidate.descriptiveInferences : [])
    .map((item) => validateDescriptiveInference(item, { criteria, evidenceIds: allowedEvidenceIds }))
    .map((item) => [item.criterionId, item]));
  const previousInferenceByCriterion = new Map((previousReport?.goalEvaluations || []).filter((item) => item.basis === 'ai_inference'
    && [...(item.supportingEvidenceIds || []), ...(item.counterEvidenceIds || [])].every((id) => allowedEvidenceIds.includes(id)))
    .map((item) => [item.criterionId, item]));
  const goalEvaluations = criteria.map((criterion) => criterion.kind === 'numeric'
    ? { criterion, ...computeNumericCriterion(criterion, observationByCriterion.get(criterion.criterionId) || []) }
    : { criterion, basis: 'ai_inference', ...(inferenceByCriterion.get(criterion.criterionId) || previousInferenceByCriterion.get(criterion.criterionId) || {
      criterionId: criterion.criterionId, status: 'insufficient_evidence', confidence: 'low',
      reasoning: '当前报告快照中没有足以形成推定结论的证据。', supportingEvidenceIds: [], counterEvidenceIds: [],
      missingValidation: [criterion.validationMethod || '补充与成功标准直接对应的验证记录。'].filter(Boolean),
      applicableConditions: criterion.conditions || [], modelPolicyVersion: 'project-report-descriptive-inference-v1',
    }) });
  const iterationEvents = validateIterationEvents(candidate.iterationEvents || [], allowedEvidenceIds);
  const inferenceRun = { status: Array.isArray(candidate.descriptiveInferences) ? 'complete' : 'incomplete',
    preservedPrevious: [...previousInferenceByCriterion.keys()].filter((id) => !inferenceByCriterion.has(id)),
    message: Array.isArray(candidate.descriptiveInferences) ? '本次 AI 推定已完成主机范围校验。' : '本次 AI 推定未完成；保留仍在授权范围内的上一安全版本。' };
  const participation = {
    teamOutcomes: representative.map((item) => ({ evidenceId: item.evidenceId, title: item.title || item.sourceId })),
    confirmedPersonalContributions: (snapshot.confirmedContributions || []).map((item) => ({ ...item })),
    aiAssistance: validateParticipationItems(candidate.aiAssistance, allowedEvidenceIds, 'ai'),
    studentConfirmedChoices: validateParticipationItems(candidate.studentConfirmedChoices, allowedEvidenceIds, 'student_choice'),
    humanOrTestValidation: validateParticipationItems(candidate.humanOrTestValidation, allowedEvidenceIds, 'human'),
    unattributed: validateParticipationItems(candidate.unattributed, allowedEvidenceIds, 'unattributed'),
  };
  const nextActionDraft = candidate.nextActionDraft && typeof candidate.nextActionDraft === 'object' ? {
    actionKey: text(candidate.nextActionDraft.actionKey) || 'current-next-action',
    title: text(candidate.nextActionDraft.title).slice(0, 160) || nextAction,
    reason: text(candidate.nextActionDraft.reason).slice(0, 600) || gaps[0] || '补足当前项目证据缺口。',
    suggestedOwner: text(candidate.nextActionDraft.suggestedOwner).slice(0, 80) || '项目成员',
    suggestedTiming: text(candidate.nextActionDraft.suggestedTiming).slice(0, 80) || '本周',
    completionEvidence: text(candidate.nextActionDraft.completionEvidence).slice(0, 600) || '提交可核验的测试、观察或成果记录。',
    source: goalEvaluations.some((item) => item.basis === 'ai_inference' && item.status.startsWith('inferred_')) ? 'ai_inference' : 'host_rule',
  } : { actionKey: 'current-next-action', title: nextAction, reason: gaps[0] || '补足当前项目证据缺口。',
    suggestedOwner: '项目成员', suggestedTiming: '本周', completionEvidence: '提交可核验的测试、观察或成果记录。', source: 'host_rule' };
  const report = { reportType: 'overall', policyVersion: M2_POLICY_VERSION,
    summary: { currentStage: statusLabel(snapshot.project.status),
      changes: previousReport ? `新增内容 ${changes.added.length} 项、调整内容 ${changes.revised.length} 项、移除内容 ${changes.withdrawn.length} 项。` : '首次生成项目进展与成果报告。',
      representativeResults, nextAction },
    sections, claims: finalClaims, changes, gaps,
    ...(PROJECT_REPORT_VALUE_ENABLED ? { goalEvaluations, iterationEvents, participation, nextActionDraft, inferenceRun } : {}),
    personalContributions: (snapshot.confirmedContributions || []).map((item) => ({ ...item,
      claimKey: `confirmed-contribution-${sha256(`${snapshot.projectId}\n${item.studentId}\n${stableJson(item.evidenceIds)}`).slice(0, 20)}` })),
    disclaimer: '本报告根据当前项目资料整理；“待确认”内容不代表项目目标已经完成，团队成果也不等同于个人贡献。' };
  report.contentFingerprint = sha256(report);
  return report;
}

function buildM3CompletionReport(snapshot, previousReport = null, receipt = {}) {
  if (snapshot?.project?.status !== 'archived') throw Object.assign(
    new Error('项目尚未完成归档，不能发布结项版本。'), { code: 'project_report_archive_receipt_invalid' });
  const base = buildM2ProjectReport(snapshot, previousReport, {});
  const report = {
    ...base,
    reportType: 'completion',
    policyVersion: M3_POLICY_VERSION,
    summary: {
      ...base.summary,
      currentStage: '已结项归档',
      changes: previousReport ? '项目结项时的成果、说明和待确认事项已保留在本报告中。' : '首次生成结项成果报告。',
      nextAction: base.gaps.length ? '保留当前待确认事项，后续可通过补充说明进行订正。' : '保留结项报告和来源，方便后续查看与展示。',
    },
    completion: {
      completedAt: text(receipt.committedAt) || snapshot.asOf,
      archiveTransactionId: text(receipt.transactionId),
      frozenInputFingerprint: snapshot.inputFingerprint,
    },
    disclaimer: '这是项目结项时保留的成果报告；后续订正会作为补充说明，不会改写本报告。',
  };
  report.contentFingerprint = sha256(report);
  return report;
}

module.exports = { M2_POLICY_VERSION, M3_POLICY_VERSION, REPORT_SECTIONS, buildM1ProjectReport, buildM2ProjectReport,
  buildM3CompletionReport, compareReportClaims, validateM2Candidate };

