'use strict';

const path = require('node:path');

function text(value) { return String(value ?? '').trim(); }

const STATUS_LABELS = Object.freeze({
  fact: '已记录', observed: '已看到', pending: '待确认', achieved: '已完成',
  partially_achieved: '部分完成', not_achieved: '未完成', recommended: '建议下一步',
  withdrawn: '已移除', verified: '已确认', published: '已确认',
});

const REPORT_TYPE_LABELS = Object.freeze({
  stage_summary: '阶段进展', overall: '项目进展与成果', completion: '结项成果报告',
});

function reportTypeLabel(value) { return REPORT_TYPE_LABELS[text(value)] || '项目进展与成果'; }
function displayStatus(value) { return STATUS_LABELS[text(value)] || text(value); }

function formatCustomerDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return text(value);
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric',
  }).format(date);
}

function friendlyMaterialTitle(value) {
  const original = text(value).replaceAll('\\', '/');
  const base = path.posix.basename(original) || original;
  const withoutExtension = base.replace(/\.[a-z0-9]{1,8}$/i, '');
  return withoutExtension.replace(/_/g, ' ').replace(/\s+/g, ' ').trim() || '未命名资料';
}

function stageStatement(value) {
  return ({
    '进行中': '项目目前正在进行。',
    '已暂停': '项目目前已暂停。',
    '已完成待归档': '项目已完成，正在准备归档。',
    '已归档': '项目已经归档。',
    '已发布': '项目成果已经发布。',
    '状态待核对': '项目状态还需要确认。',
  })[value] || `项目状态：${value}。`;
}

function displayStatement(value) {
  const source = text(value);
  if (!source) return source;
  if (source === '项目尚未登记明确目标。') return '项目目标还没有填写。';
  if (source === '项目尚未约定明确交付物。') return '项目还没有填写计划成果。';
  if (source === '已有成果或摘要记录，但尚无结构化可比测试足以确认目标达成。') {
    return '已有成果记录，但还缺少可对比的测试结果，暂时不能确认目标是否完成。';
  }
  if (source === '尚未看到能核对目标达成的成果或测试记录。') return '还没有找到能够确认项目目标是否完成的成果或测试记录。';
  if (source === '团队当前没有可核查的代表材料。') return '目前还没有可查看的团队成果。';

  let match = source.match(/^当前登记状态：(.+?)。$/);
  if (match) return stageStatement(match[1]);
  match = source.match(/^截至 (.+?)，已登记 (\d+) 份项目资料，其中 (\d+) 份不可用。$/);
  if (match) {
    const unavailable = Number(match[3]);
    return `截至 ${formatCustomerDate(match[1])}，本报告参考了 ${match[2]} 份项目资料${unavailable ? `，其中 ${unavailable} 份暂时无法使用` : ''}。`;
  }
  match = source.match(/^截至 (.+?)，已登记 (\d+) 份项目资料，(\d+) 份进入本次快照。$/);
  if (match) {
    return match[2] === match[3]
      ? `截至 ${formatCustomerDate(match[1])}，本报告参考了 ${match[2]} 份项目资料。`
      : `截至 ${formatCustomerDate(match[1])}，本报告参考了 ${match[3]} 份项目资料，项目中共有 ${match[2]} 份资料。`;
  }
  match = source.match(/^截至 (.+?)，本报告参考了 (\d+) 份项目资料(?:，其中 (\d+) 份暂时无法使用)?。$/);
  if (match) {
    return `截至 ${formatCustomerDate(match[1])}，本报告参考了 ${match[2]} 份项目资料${Number(match[3] || 0) ? `，其中 ${match[3]} 份暂时无法使用` : ''}。`;
  }
  match = source.match(/^已采用 (.+?)（版本 (.+?)）；修改原因和效果仍以测试或反馈为准。$/);
  if (match) return `已使用《${friendlyMaterialTitle(match[1])}》第 ${match[2]} 版；修改效果还需要测试或反馈确认。`;
  match = source.match(/^已使用《(.+?)》第 (.+?) 版；修改效果还需要测试或反馈确认。$/);
  if (match) return `已使用《${friendlyMaterialTitle(match[1])}》第 ${match[2]} 版；修改效果还需要测试或反馈确认。`;
  match = source.match(/^代表材料：(.+?)（版本 (.+?)）；选择理由是其已采用且处于当前证据快照。$/);
  if (match) return `主要成果：《${friendlyMaterialTitle(match[1])}》第 ${match[2]} 版。`;
  match = source.match(/^已登记并采用：(.+?)（版本 (.+?)）。$/);
  if (match) return `已纳入项目：《${friendlyMaterialTitle(match[1])}》第 ${match[2]} 版。`;
  match = source.match(/^已纳入项目：《(.+?)》第 (.+?) 版。$/);
  if (match) return `已纳入项目：《${friendlyMaterialTitle(match[1])}》第 ${match[2]} 版。`;
  match = source.match(/^主要成果：《(.+?)》第 (.+?) 版。$/);
  if (match) return `主要成果：《${friendlyMaterialTitle(match[1])}》第 ${match[2]} 版。`;
  match = source.match(/^团队当前有 (\d+) 项可核查代表材料；团队成果不自动等同于个人贡献。$/);
  if (match) return `目前有 ${match[1]} 份可查看的团队成果；每位成员的具体贡献还需要单独确认。`;
  match = source.match(/^登记目标范围 (.+?)；当前实测 (.+?)，(.+)$/);
  if (match) {
    return `目标要求为 ${match[1]}；实际测试结果为 ${match[2]}，${match[3]}`
      .replace('已覆盖登记目标范围。', '已达到目标要求。')
      .replace('只覆盖登记目标范围的一侧，尚未完全达成。', '只达到部分目标要求，尚未完全完成。')
      .replace('尚未覆盖登记目标范围。', '尚未达到目标要求。');
  }
  if (source.startsWith('预期交付物：')) return source.replace('预期交付物：', '计划完成：');
  return source;
}

function displayChanges(value) {
  const source = text(value);
  if (source === '尚未构建阶段摘要。') return '尚未生成项目报告。';
  if (source === '首次阶段摘要；M1 不推断目标达成。') return '首次生成阶段进展报告。';
  if (source === '首次七栏项目总体报告。') return '首次生成项目进展与成果报告。';
  if (source === '根据结项时固定证据生成唯一结项版本。') return '首次生成结项成果报告。';
  if (source === '已冻结结项时的证据、判断与缺口，形成唯一结项版本。') return '项目结项时的成果、说明和待确认事项已保留在本报告中。';
  if (source === '授权已变化，需要明确更新总体报告。') return '项目成员或可见范围有变化，需要更新报告。';
  const match = source.match(/^新增 (\d+)、修订 (\d+)、撤回 (\d+) 项判断。$/);
  if (match) return `新增内容 ${match[1]} 项、调整内容 ${match[2]} 项、移除内容 ${match[3]} 项。`;
  return source;
}

function displayNextAction(value) {
  const source = text(value);
  const replacements = new Map([
    ['补充项目目标和完成标准。', '请先补充项目目标和完成标准。'],
    ['先补充项目目标和完成标准。', '请先补充项目目标和完成标准。'],
    ['添加能证明当前阶段的项目资料。', '添加能够说明当前进展的项目资料。'],
    ['添加能证明当前阶段的资料，然后构建阶段摘要。', '添加能够说明当前进展的项目资料，然后更新报告。'],
    ['恢复或确认待处理资料后重新构建阶段摘要。', '恢复或确认待处理资料后更新报告。'],
    ['处理已采用资料，并确认可复核的摘要或测试记录。', '整理现有资料，并补充可以查看的项目摘要或测试记录。'],
    ['补充可比较的测试记录或已确认评价，再核对目标达成。', '补充可对比的测试记录或已确认评价，再检查项目目标是否完成。'],
    ['补充可比较的测试记录，并核对未覆盖条件。', '补充可对比的测试记录，并检查尚未覆盖的条件。'],
    ['保留当前缺口，后续订正以补充说明关联本结项版。', '保留当前待确认事项，后续可通过补充说明进行订正。'],
    ['保留结项依据和固定版本，供后续复核与展示。', '保留结项报告和来源，方便后续查看与展示。'],
  ]);
  return replacements.get(source) || source;
}

function displayGap(value) {
  const source = text(value);
  const replacements = new Map([
    ['尚未登记明确项目目标。', '项目目标还没有填写。'],
    ['尚无固定证据快照。', '还没有可用于生成报告的项目资料。'],
    ['尚无已登记项目资料。', '还没有添加项目资料。'],
    ['现有资料尚未形成可核查知识记录。', '现有资料还没有形成可复用的项目内容。'],
    ['尚未看到可复核的项目知识或测试摘要。', '还没有形成可以查看的项目摘要或测试记录。'],
    ['M1 只确认登记事实，目标达成仍需结构化测试或明确评价。', '当前报告只汇总已记录的信息；是否完成目标还需要测试结果或明确评价。'],
    ['目标达成仍需结构化测试、适用条件或已确认评价。', '是否完成目标还需要测试结果、适用条件或已确认评价。'],
    ['项目成员或授权已变化，旧总体报告已停止展示。', '项目成员或可见范围有变化，原报告已停止显示。'],
  ]);
  if (replacements.has(source)) return replacements.get(source);
  const match = source.match(/^有 (\d+) 份资料不可用或尚未采用。$/);
  if (match) return `有 ${match[1]} 份项目资料暂时无法使用或尚未纳入报告。`;
  return source;
}

function displayDisclaimer(value, reportType = '') {
  const source = text(value);
  if (source.includes('不是完整项目总体报告')) return '本报告根据当前项目资料整理，仅用于查看阶段进展，不代表学生能力或知识掌握情况。';
  if (source.includes('待验证项不是达成结论')) return '本报告根据当前项目资料整理；“待确认”内容不代表项目目标已经完成，团队成果也不等同于个人贡献。';
  if (source.includes('归档成功后冻结唯一结项版本')) return '这是项目结项时保留的成果报告；后续订正会作为补充说明，不会改写本报告。';
  if (source.includes('归档成功后基于固定证据快照')) return '这是项目结项时保留的成果报告；后续订正会作为补充说明，不会改写本报告。';
  if (source.includes('固定证据快照')) return reportType === 'completion'
    ? '这是项目结项时保留的成果报告。' : '本报告根据当前项目资料整理。';
  return source;
}

function displayChangeReason(value) {
  return ({
    '出现新的已授权依据或项目登记事实。': '新增了项目资料或项目信息。',
    '同一判断的状态或表述发生实质修订。': '内容或状态有调整。',
    '判断所依赖的证据发生变化。': '支持这项内容的项目资料有变化。',
    '原判断在当前证据快照中已撤回或不再适用。': '当前报告不再显示这项内容。',
  })[text(value)] || text(value);
}

function displayAvailability(value) {
  return ({ active: '可查看', pending: '待确认', missing: '暂时不可用', unavailable: '暂时不可用', withdrawn: '已移除' })[text(value)] || text(value);
}

function displaySourceType(value) {
  return ({ project_material: '项目资料', project_metadata: '项目信息', project_material_registry: '项目资料清单',
    project_knowledge: '项目内容', project_contribution_confirmation: '成员贡献确认' })[text(value)] || '项目来源';
}

module.exports = {
  displayAvailability, displayChangeReason, displayChanges, displayDisclaimer, displayGap, displayNextAction,
  displaySourceType, displayStatement, displayStatus, formatCustomerDate, friendlyMaterialTitle, reportTypeLabel,
};
