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

test('project detail mounts a stage-summary panel with four questions and explicit evidence actions', () => {
  const app = read('src/main.tsx');
  const panel = read('src/ProjectOverallReportPanel.tsx');
  const materials = read('src/ProjectMaterialsPanel.tsx');
  assert.match(app, /ProjectOverallReportPanel/);
  assert.match(app, /projectPageMode === 'detail'/);
  for (const label of ['当前阶段', '本次变化', '代表成果', '下一步行动', '查看依据', '添加资料', '阶段摘要']) {
    assert.match(panel, new RegExp(label));
  }
  assert.match(panel, /useEffect\(\(\) => \{ void load\(\); \}, \[load\]\)/,
    'mounting the panel must call only the read loader');
  assert.doesNotMatch(panel, /useEffect\(\(\) => \{[^}]*refresh/,
    'mounting the panel must not generate or refresh a report');
  assert.match(app, /querySelector\('\[data-project-report-materials\]'\)/);
  assert.match(materials, /data-project-report-materials/);
});

