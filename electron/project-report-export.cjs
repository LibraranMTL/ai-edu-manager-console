'use strict';

const { markdownToHtml } = require('./report-export.cjs');
const {
  displayChanges, displayDisclaimer, displayGap, displayNextAction, displayStatement, displayStatus,
  friendlyMaterialTitle, reportTypeLabel,
} = require('./project-report-presentation.cjs');

function text(value) { return String(value ?? '').trim(); }
function line(value) { return text(value).replace(/[\r\n]+/g, ' '); }
function html(value) { return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

function projectReportMarkdown(report = {}) {
  const sections = Array.isArray(report.sections) ? report.sections : [];
  const typeLabel = text(report.reportTypeLabel) || reportTypeLabel(report.reportType);
  const output = [
    `# ${line(report.project?.name) || '项目进展与成果'}`,
    '',
    `- 报告类型：${typeLabel}`,
    `- 当前阶段：${line(report.summary?.currentStage) || '待核对'}`,
    `- 资料截止：${line(report.asOf) || '待核对'}`,
    `- 项目目标：${line(report.project?.objective) || '还没有填写'}`,
    '',
    '## 项目摘要',
    '',
    `- 最近更新：${line(report.summary?.displayChanges || displayChanges(report.summary?.changes)) || '无'}`,
    `- 建议下一步：${line(report.summary?.displayNextAction || displayNextAction(report.summary?.nextAction)) || '无'}`,
  ];
  const results = Array.isArray(report.summary?.representativeResults) ? report.summary.representativeResults : [];
  output.push('', '## 主要成果', '');
  if (!results.length) output.push('- 当前可见范围内暂无主要成果。');
  for (const item of results) output.push(`- **${line(item.displayTitle || friendlyMaterialTitle(item.title)) || '未命名成果'}**：${line(item.displayStatement || displayStatement(item.statement))}`);
  for (const section of sections) {
    output.push('', `## ${line(section.title) || '报告栏目'}`, '');
    const items = Array.isArray(section.items) ? section.items : [];
    if (!items.length) output.push('- 当前可见范围内暂无内容。');
    for (const item of items) output.push(`- [${line(item.displayStatus || displayStatus(item.status)) || '待确认'}] ${line(item.displayStatement || displayStatement(item.statement))}`);
  }
  const goalEvaluations = Array.isArray(report.goalEvaluations) ? report.goalEvaluations : [];
  output.push('', '## 目标与成功标准矩阵', '');
  if (!goalEvaluations.length) output.push('- 尚未设置结构化成功标准。');
  const statusNames = { achieved: '数值验证 · 已达到', partially_achieved: '数值验证 · 部分达到', not_achieved: '数值验证 · 未达到',
    pending_validation: '证据不足', inferred_achieved: 'AI推定 · 达到', inferred_partially_achieved: 'AI推定 · 部分达到',
    inferred_not_achieved: 'AI推定 · 未达到', insufficient_evidence: '证据不足', conflicted: '资料矛盾' };
  for (const item of goalEvaluations) {
    const confidence = item.basis === 'ai_inference' ? ` · ${item.confidence === 'high' ? '高' : item.confidence === 'medium' ? '中' : '低'}置信` : '';
    output.push(`- **${line(item.criterion?.title) || '成功标准'}**：[${statusNames[item.status] || item.status}${confidence}] ${line(item.reasoning || '')}`);
  }
  const timeline = Array.isArray(report.iterationEvents) ? report.iterationEvents : [];
  output.push('', '## 探究与迭代时间线', '');
  if (!timeline.length) output.push('- 暂无带证据的迭代节点。');
  for (const item of timeline) output.push(`- ${line(item.occurredAt) || '时间待补充'} · ${line(item.title) || line(item.type)}：${line(item.description)}${item.reasonStatus === 'recorded' ? `（修改原因：${line(item.reason)}）` : '（修改原因待补充）'}`);
  if (report.nextActionDraft) output.push('', '## 下一行动', '', `- ${line(report.nextActionDraft.title)}`, `- 原因：${line(report.nextActionDraft.reason)}`,
    `- 建议负责人：${line(report.nextActionDraft.suggestedOwner)}`, `- 建议时间：${line(report.nextActionDraft.suggestedTiming)}`,
    `- 完成证据：${line(report.nextActionDraft.completionEvidence)}`, report.nextActionDraft.source === 'ai_inference' ? '- 来源：AI推定' : '- 来源：主机规则');
  const contributions = Array.isArray(report.personalContributions) ? report.personalContributions : [];
  if (contributions.length) {
    output.push('', '## 已确认个人贡献', '');
    for (const item of contributions) output.push(`- ${line(item.ability)}：${line(item.observation)}`);
  }
  output.push('', '## 待确认事项', '');
  const gaps = Array.isArray(report.gaps) ? report.gaps : [];
  if (!gaps.length) output.push('- 当前没有待确认事项。');
  const displayGaps = Array.isArray(report.displayGaps) ? report.displayGaps : gaps.map(displayGap);
  for (const gap of displayGaps) output.push(`- ${line(gap)}`);
  output.push('', '> ' + (line(report.displayDisclaimer || displayDisclaimer(report.disclaimer, report.reportType)) || '本报告根据当前项目资料整理。'), '');
  return output.join('\n');
}

function projectReportHtml(report = {}) {
  const markdown = projectReportMarkdown(report);
  const title = `${line(report.project?.name) || '项目'} · ${text(report.reportTypeLabel) || reportTypeLabel(report.reportType)}`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${html(title)}</title><style>
@page{size:A4;margin:18mm}*{box-sizing:border-box}body{margin:0;color:#172033;font-family:"Microsoft YaHei","PingFang SC",sans-serif;line-height:1.75;font-size:11pt}
header{padding:0 0 10mm;border-bottom:2px solid #7546e8;margin-bottom:8mm}header span{color:#7546e8;font-weight:700}h1{margin:2mm 0;font-size:24pt}main h1{display:none}h2{margin:7mm 0 2mm;padding-left:3mm;border-left:3px solid #7546e8;font-size:15pt}p,li{overflow-wrap:anywhere}blockquote{margin:4mm 0;padding:3mm 4mm;background:#f5f1ff;border-left:3px solid #9d7af0;color:#4c566b}
</style></head><body><header><span>AI教育管家 · 项目报告</span><h1>${html(title)}</h1><small>内容按当前可见范围生成，不包含内部路径和系统标识。</small></header><main>${markdownToHtml(markdown)}</main></body></html>`;
}

module.exports = { projectReportMarkdown, projectReportHtml };
