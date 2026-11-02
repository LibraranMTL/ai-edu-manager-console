'use strict';

const { markdownToHtml } = require('./report-export.cjs');

function text(value) { return String(value ?? '').trim(); }
function line(value) { return text(value).replace(/[\r\n]+/g, ' '); }
function html(value) { return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

function projectReportMarkdown(report = {}) {
  const sections = Array.isArray(report.sections) ? report.sections : [];
  const output = [
    `# ${line(report.project?.name) || '项目综合报告'}`,
    '',
    `- 报告类型：${report.reportType === 'completion' ? '结项报告' : '阶段报告'}`,
    `- 当前阶段：${line(report.summary?.currentStage) || '待核对'}`,
    `- 资料截止：${line(report.asOf) || '待核对'}`,
    `- 项目目标：${line(report.project?.objective) || '尚未登记'}`,
    '',
    '## 首屏摘要',
    '',
    `- 本次变化：${line(report.summary?.changes) || '无'}`,
    `- 下一步行动：${line(report.summary?.nextAction) || '无'}`,
  ];
  const results = Array.isArray(report.summary?.representativeResults) ? report.summary.representativeResults : [];
  output.push('', '## 代表成果', '');
  if (!results.length) output.push('- 当前授权范围内暂无代表成果。');
  for (const item of results) output.push(`- **${line(item.title) || '未命名成果'}**：${line(item.statement)}`);
  for (const section of sections) {
    output.push('', `## ${line(section.title) || '报告栏目'}`, '');
    const items = Array.isArray(section.items) ? section.items : [];
    if (!items.length) output.push('- 当前授权和证据范围内暂无内容。');
    for (const item of items) output.push(`- [${line(item.status) || '待核对'}] ${line(item.statement)}`);
  }
  const contributions = Array.isArray(report.personalContributions) ? report.personalContributions : [];
  if (contributions.length) {
    output.push('', '## 已确认个人贡献', '');
    for (const item of contributions) output.push(`- ${line(item.ability)}：${line(item.observation)}`);
  }
  output.push('', '## 缺口与待验证项', '');
  const gaps = Array.isArray(report.gaps) ? report.gaps : [];
  if (!gaps.length) output.push('- 当前投影没有待验证项。');
  for (const gap of gaps) output.push(`- ${line(gap)}`);
  output.push('', '> ' + (line(report.disclaimer) || '本报告仅反映当前授权范围内的固定证据快照。'), '');
  return output.join('\n');
}

function projectReportHtml(report = {}) {
  const markdown = projectReportMarkdown(report);
  const title = `${line(report.project?.name) || '项目'} · ${report.reportType === 'completion' ? '结项报告' : '项目综合报告'}`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${html(title)}</title><style>
@page{size:A4;margin:18mm}*{box-sizing:border-box}body{margin:0;color:#172033;font-family:"Microsoft YaHei","PingFang SC",sans-serif;line-height:1.75;font-size:11pt}
header{padding:0 0 10mm;border-bottom:2px solid #7546e8;margin-bottom:8mm}header span{color:#7546e8;font-weight:700}h1{margin:2mm 0;font-size:24pt}main h1{display:none}h2{margin:7mm 0 2mm;padding-left:3mm;border-left:3px solid #7546e8;font-size:15pt}p,li{overflow-wrap:anywhere}blockquote{margin:4mm 0;padding:3mm 4mm;background:#f5f1ff;border-left:3px solid #9d7af0;color:#4c566b}
</style></head><body><header><span>AI教育管家 · 项目报告</span><h1>${html(title)}</h1><small>导出内容已按当前读者权限重新投影；不包含内部路径和系统标识。</small></header><main>${markdownToHtml(markdown)}</main></body></html>`;
}

module.exports = { projectReportMarkdown, projectReportHtml };
