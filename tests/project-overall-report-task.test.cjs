'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('M2 report generation uses the unified task center and an internal governed operation', () => {
  const main = read('electron/main.cjs');
  const auto = read('electron/task-auto-dispatch.cjs');
  const service = read('electron/project-report-service.cjs');
  assert.match(auto, /'project_overall_report'/);
  assert.match(main, /project_overall_report:\s*new Set\(\['read_project_report_snapshot'\]\)/);
  assert.match(main, /generate_project_overall_report/);
  assert.match(main, /projectReportService\(\)\.settleUpdate/);
  assert.match(service, /kind:\s*'project_overall_report'/);
  assert.match(service, /taskKey\s*=\s*sha256/);
});

test('M2 exposes read-only version and diff bridges without wiring either read to generation', () => {
  const main = read('electron/main.cjs');
  const preload = read('electron/preload.cjs');
  const panel = read('src/ProjectOverallReportPanel.tsx');
  assert.match(main, /bridge:getProjectOverallReportVersion/);
  assert.match(main, /bridge:compareProjectOverallReportVersions/);
  assert.match(preload, /getProjectOverallReportVersion/);
  assert.match(preload, /compareProjectOverallReportVersions/);
  assert.match(panel, /查看与上版差异/);
  assert.match(panel, /M3 · 结项与交付/);
  assert.doesNotMatch(panel, /useEffect\([^)]*refreshProjectOverallReport/s);
});

test('project changes are coalesced before automatic M2 candidate creation', () => {
  const main = read('electron/main.cjs');
  assert.match(main, /scheduleProjectOverallReportUpdate\(sourceId, reason\)/);
  assert.match(main, /}, 10_000\)/);
  assert.match(main, /trigger:\s*'automatic'/);
});
