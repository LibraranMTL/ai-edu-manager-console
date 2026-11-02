'use strict';

const { sha256, stableJson } = require('./project-report-snapshot.cjs');

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
    ? `项目目标：${snapshot.project.objective}` : '项目尚未登记明确目标。', evidenceIds));
  claims.push(claim('project-stage', 'stage_change', `当前登记状态：${statusLabel(snapshot.project.status)}。`, evidenceIds));
  claims.push(claim('registered-evidence', 'stage_change',
    `截至 ${snapshot.asOf}，已登记 ${snapshot.coverage.materials.total} 份项目资料，其中 ${snapshot.coverage.materials.unavailable} 份不可用。`, registryEvidenceIds));
  const representativeResults = [];
  for (const evidenceId of snapshot.representativeEvidenceIds || []) {
    const evidence = byId.get(evidenceId);
    if (!evidence || evidence.availability !== 'active') continue;
    representativeResults.push({ title: evidence.title || evidence.sourceId, evidenceId, citationId: evidence.citationId,
      statement: `已登记并采用：${evidence.title || evidence.sourceId}（版本 ${evidence.revision}）。` });
    claims.push(claim(`representative-${evidence.sourceId}`, 'representative_results', representativeResults.at(-1).statement, [evidenceId]));
  }
  const gaps = [];
  let nextAction = '';
  if (!snapshot.project.objective) { gaps.push('尚未登记明确项目目标。'); nextAction = '补充项目目标和完成标准。'; }
  else if (!snapshot.coverage.materials.total) { gaps.push('尚无已登记项目资料。'); nextAction = '添加能证明当前阶段的项目资料。'; }
  else if (snapshot.coverage.materials.unavailable || snapshot.coverage.materials.pending) {
    gaps.push(`有 ${snapshot.coverage.materials.unavailable + snapshot.coverage.materials.pending} 份资料不可用或尚未采用。`); nextAction = '恢复或确认待处理资料后重新构建阶段摘要。';
  } else if (!snapshot.coverage.knowledge.total) { gaps.push('现有资料尚未形成可核查知识记录。'); nextAction = '处理已采用资料，并确认可复核的摘要或测试记录。'; }
  else { gaps.push('M1 只确认登记事实，目标达成仍需结构化测试或明确评价。'); nextAction = '补充可比较的测试记录或已确认评价，再核对目标达成。'; }
  claims.push(claim('next-action', 'gaps_next', nextAction, [...evidenceIds, ...registryEvidenceIds], { kind: 'suggestion', status: 'recommended' }));
  const personalContributions = (snapshot.confirmedContributions || []).map((item) => ({ ...item,
    claimKey: `confirmed-contribution-${sha256(`${snapshot.projectId}\n${item.studentId}\n${stableJson(item.evidenceIds)}`).slice(0, 20)}` }));
  const report = { reportType: 'stage_summary', policyVersion: snapshot.policyVersion,
    summary: { currentStage: statusLabel(snapshot.project.status), changes: '首次阶段摘要；M1 不推断目标达成。', representativeResults, nextAction },
    claims, gaps, personalContributions,
    disclaimer: '这是基于已登记来源生成的项目阶段摘要，不是完整项目总体报告，也不代表学生能力或知识掌握。' };
  report.contentFingerprint = sha256(report);
  return report;
}

const M2_POLICY_VERSION = 'project-report-m2-v1';
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
    ? `项目目标：${snapshot.project.objective}` : '项目尚未登记明确目标。', metadata ? [metadata.evidenceId] : []));
  claims.push(claim('project-deliverables', 'project_overview', snapshot.project.deliverables?.length
    ? `预期交付物：${snapshot.project.deliverables.join('、')}。` : '项目尚未约定明确交付物。', metadata ? [metadata.evidenceId] : [], { status: snapshot.project.deliverables?.length ? 'fact' : 'pending' }));
  claims.push(claim('project-stage', 'stage_change', `当前登记状态：${statusLabel(snapshot.project.status)}。`, metadata ? [metadata.evidenceId] : []));
  claims.push(claim('registered-evidence', 'stage_change', `截至 ${snapshot.asOf}，已登记 ${snapshot.coverage.materials.total} 份项目资料，${snapshot.coverage.materials.analyzed} 份进入本次快照。`, registry ? [registry.evidenceId] : []));
  for (const evidence of representative.slice(0, 3)) claims.push(claim(`iteration-${evidence.sourceId}`, 'exploration_iteration',
    `已采用 ${evidence.title || evidence.sourceId}（版本 ${evidence.revision}）；修改原因和效果仍以测试或反馈为准。`, [evidence.evidenceId], { status: 'observed' }));
  const outcomeEvidence = [...representative.map((item) => item.evidenceId), ...knowledge.slice(0, 3).map((item) => item.evidenceId)];
  claims.push(claim('objective-attainment', 'outcomes', outcomeEvidence.length
    ? '已有成果或摘要记录，但尚无结构化可比测试足以确认目标达成。' : '尚未看到能核对目标达成的成果或测试记录。', outcomeEvidence,
  { kind: 'judgement', status: 'pending' }));
  claims.push(claim('team-results', 'team_contribution', representative.length
    ? `团队当前有 ${representative.length} 项可核查代表材料；团队成果不自动等同于个人贡献。` : '团队当前没有可核查的代表材料。',
  representative.map((item) => item.evidenceId), { status: representative.length ? 'observed' : 'pending' }));
  const gaps = [];
  if (!snapshot.project.objective) gaps.push('尚未登记明确项目目标。');
  if (!snapshot.coverage.materials.total) gaps.push('尚无已登记项目资料。');
  if (snapshot.coverage.materials.unavailable || snapshot.coverage.materials.pending) gaps.push(`有 ${snapshot.coverage.materials.unavailable + snapshot.coverage.materials.pending} 份资料不可用或尚未采用。`);
  if (!knowledge.length) gaps.push('尚未看到可复核的项目知识或测试摘要。');
  if (!gaps.length) gaps.push('目标达成仍需结构化测试、适用条件或已确认评价。');
  const nextAction = !snapshot.project.objective ? '补充项目目标和完成标准。'
    : !snapshot.coverage.materials.total ? '添加能证明当前阶段的项目资料。'
      : !knowledge.length ? '处理已采用资料，并确认可复核的摘要或测试记录。' : '补充可比较的测试记录，并核对未覆盖条件。';
  claims.push(claim('next-action', 'gaps_next', nextAction, [metadata?.evidenceId, registry?.evidenceId].filter(Boolean), { kind: 'suggestion', status: 'recommended' }));
  for (const evidence of representative.slice(0, 3)) claims.push(claim(`showcase-${evidence.sourceId}`, 'showcase',
    `代表材料：${evidence.title || evidence.sourceId}（版本 ${evidence.revision}）；选择理由是其已采用且处于当前证据快照。`, [evidence.evidenceId]));
  const candidateClaims = validateM2Candidate(snapshot, candidate);
  const merged = new Map(claims.map((item) => [item.claimKey, item]));
  for (const item of candidateClaims) merged.set(item.claimKey, item);
  const finalClaims = [...merged.values()];
  const sections = REPORT_SECTIONS.map(([key, title]) => ({ key, title, items: finalClaims.filter((item) => item.section === key) }));
  const changes = compareReportClaims(previousReport, finalClaims);
  const representativeResults = representative.slice(0, 3).map((evidence) => ({ title: evidence.title || evidence.sourceId,
    evidenceId: evidence.evidenceId, citationId: evidence.citationId,
    statement: `已登记并采用：${evidence.title || evidence.sourceId}（版本 ${evidence.revision}）。` }));
  const report = { reportType: 'overall', policyVersion: M2_POLICY_VERSION,
    summary: { currentStage: statusLabel(snapshot.project.status),
      changes: previousReport ? `新增 ${changes.added.length}、修订 ${changes.revised.length}、撤回 ${changes.withdrawn.length} 项判断。` : '首次七栏项目总体报告。',
      representativeResults, nextAction },
    sections, claims: finalClaims, changes, gaps,
    personalContributions: (snapshot.confirmedContributions || []).map((item) => ({ ...item,
      claimKey: `confirmed-contribution-${sha256(`${snapshot.projectId}\n${item.studentId}\n${stableJson(item.evidenceIds)}`).slice(0, 20)}` })),
    disclaimer: '这是基于固定证据快照生成的项目总体报告；待验证项不是达成结论，团队成果不自动等同于个人贡献。' };
  report.contentFingerprint = sha256(report);
  return report;
}

module.exports = { M2_POLICY_VERSION, REPORT_SECTIONS, buildM1ProjectReport, buildM2ProjectReport, compareReportClaims, validateM2Candidate };

