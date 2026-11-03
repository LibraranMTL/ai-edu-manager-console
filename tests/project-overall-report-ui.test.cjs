'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Windows bridge exposes read, explicit refresh and citation drilldown for M1', () => {
  const preload = read('electron/preload.cjs');
  const main = read('electron/main.cjs');
  for (const name of ['getProjectOverallReport', 'refreshProjectOverallReport', 'getProjectReportCitation']) {
    assert.match(preload, new RegExp(`${name}\\(`));
    assert.match(main, new RegExp(`bridge:${name}`));
  }
  assert.match(main, /if \(!fs\.existsSync\(projectReportDatabasePath\(\)\)\)[\s\S]{0,800}emptyProjectReportProjection/);
  assert.match(main, /readProjectMaterialIndexSync/);
});

test('project detail mounts a customer-facing report panel with four summaries and source actions', () => {
  const app = read('src/main.tsx');
  const panel = read('src/ProjectOverallReportPanel.tsx');
  const reportCss = read('src/project-overall-report.css');
  const materials = read('src/ProjectMaterialsPanel.tsx');
  assert.match(app, /ProjectOverallReportPanel/);
  assert.match(app, /projectPageMode === 'detail'/);
  for (const label of ['项目状态', '最近更新', '主要成果', '建议下一步', '查看来源', '添加项目资料', '阶段进展']) {
    assert.match(panel, new RegExp(label));
  }
  for (const technicalLabel of ['导出 Markdown', '导出 HTML', '查看依据', '已绑定', '第 \$\{report\.dataGeneration\} 代']) {
    assert.doesNotMatch(panel, new RegExp(technicalLabel));
  }
  assert.match(panel, /originalFileName\(item\.title\)/);
  assert.match(panel, /citationLocation\(citation\)/);
  assert.doesNotMatch(panel, /title=\{item\.title\}/);
  assert.match(reportCss, /-webkit-line-clamp:2/);
  assert.match(panel, /useEffect\(\(\) => \{ void load\(\); \}, \[load\]\)/,
    'mounting the panel must call only the read loader');
  assert.doesNotMatch(panel, /useEffect\(\(\) => \{[^}]*refresh/,
    'mounting the panel must not generate or refresh a report');
  assert.match(app, /querySelector\('\[data-project-report-materials\]'\)/);
  assert.match(materials, /data-project-report-materials/);
});

test('existing project detail separates report and materials into accessible top-level tabs', () => {
  const app = read('src/main.tsx');
  const css = read('src/styles.css');
  assert.match(app, /type ProjectDetailTab = 'report' \| 'materials'/);
  assert.match(app, /useState<ProjectDetailTab>\('report'\)/);
  assert.match(app, /role="tablist" aria-label="项目详情视图"/);
  assert.match(app, /role="tab"[\s\S]{0,260}项目综合报告/);
  assert.match(app, /role="tab"[\s\S]{0,260}项目资料中心/);
  assert.match(app, /aria-selected=\{projectDetailTab === 'report'\}/);
  assert.match(app, /aria-selected=\{projectDetailTab === 'materials'\}/);
  assert.match(app, /projectDetailTab === 'report'[\s\S]{0,700}<ProjectOverallReportPanel/);
  assert.match(app, /projectDetailTab === 'materials'[\s\S]{0,700}<ProjectMaterialsPanel/);
  assert.match(app, /openProjectMaterialsView/);
  assert.match(app, /setProjectDetailTab\('report'\)/,
    'opening an existing project starts from the report tab');
  assert.match(css, /\.project-detail-tabs/);
  assert.match(css, /\.project-detail-tab\[aria-selected="true"\]/);
  assert.match(css, /\.project-detail-tab-panel/);
});

