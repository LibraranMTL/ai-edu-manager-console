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

module.exports = { buildM1ProjectReport };

