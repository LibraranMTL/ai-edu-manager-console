'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('project detail primary entry locks the trusted student and project without adding a tab', () => {
  const ui = read('src', 'main.tsx');
  const preload = read('electron', 'preload.cjs');
  const host = read('electron', 'main.cjs');
  assert.match(ui, /className="material-source-panel project-mentor-entry"/);
  assert.match(ui, /showProjectMentor\?: \(studentId: string, projectId: string\)/);
  assert.match(preload, /showProjectMentor\(studentId, projectId\).*bridge:showProjectMentor/);
  assert.match(host, /ipcMain\.handle\('bridge:showProjectMentor'/);
  assert.match(host, /event\.sender !== mainWindow\.webContents/);
  assert.match(host, /availableCompanionProject\(student\.id, projectId\)/);
  assert.match(host, /lockedProjectId: project\.id/);
  assert.doesNotMatch(ui, /ProjectDetailTab[^\n]+project-mentor|project-mentor[^\n]+ProjectDetailTab/);
});

test('shared popover manually renders six stages and only the selected stage actions', () => {
  const renderer = read('electron', 'companion-popover-renderer.js');
  const html = read('electron', 'companion-popover.html');
  const host = read('electron', 'main.cjs');
  assert.match(renderer, /activeMentorStage = 'define'/);
  assert.match(renderer, /const stage=stages\.find\(item=>item\.id===activeMentorStage\)/);
  assert.match(renderer, /\(stage\?\.actions\|\|\[\]\)\.forEach/);
  assert.match(renderer, /command==='mentor-stage'/);
  for (const stageId of ['define', 'compare', 'plan', 'research', 'review', 'showcase']) {
    assert.match(html, new RegExp(`\\.mentor-stage-${stageId}\\{`));
  }
  assert.match(renderer, /stageButton\.setAttribute\('aria-pressed'/);
  assert.match(host, /projectMentorStages: PROJECT_MENTOR_STAGES/);
  assert.match(host, /mode === 'project-mentor'/);
  assert.doesNotMatch(renderer, /localStorage|sessionStorage/);
});

test('wide toolbar has a direct project button and narrow toolbar degrades to learning entry', () => {
  const html = read('electron', 'quick-capture.html');
  const renderer = read('electron', 'companion-popover-renderer.js');
  const host = read('electron', 'main.cjs');
  assert.match(html, /data-action="project-mentor"/);
  assert.match(html, /@media\(max-width:270px\)\{\.project-mentor-shortcut\{display:none!important\}\}/);
  assert.match(renderer, /项目导师 · 6 阶段 24 动作/);
  assert.match(renderer, /open-project-mentor/);
  assert.match(host, /QUICK_CAPTURE_MIN_WIDTH = 252/);
  assert.match(host, /QUICK_CAPTURE_PREFERRED_WIDTH = 288/);
});

test('project mentor validates scope again, rejects feature-off mode and keeps failed copies unprepared', () => {
  const host = read('electron', 'main.cjs');
  assert.match(host, /EDU_PROJECT_MENTOR_COPY_V1 !== '0'/);
  assert.match(host, /project\.status === 'sealed'/);
  assert.match(host, /项目范围已变化，请返回项目页面确认/);
  assert.match(host, /if \(result\.ok\) quickCapturePreparedPrompts\.set/);
  assert.doesNotMatch(host, /quickCapturePreparedPrompts\.set\(packet\.promptId, packet\);\s*const result = copyCompanionText/);
  assert.match(host, /projectSummaryRevision\(project\)/);
});

test('student changes close the old scope and target refresh preserves mentor stage state', () => {
  const host = read('electron', 'main.cjs');
  const renderer = read('electron', 'companion-popover-renderer.js');
  assert.match(host, /quickCaptureStudentId !== String\(student\?\.id \|\| ''\)[\s\S]{0,180}closeQuickCapturePopover\(\)/);
  assert.match(host, /saveCompanionSettings\(\{ selectedTargetId: id \}\)/);
  assert.doesNotMatch(renderer, /function render\(next\)[\s\S]{0,160}activeMentorStage\s*=/);
  assert.match(renderer, /projectRevision:state\.projectMentorProject\?\.projectRevision/);
});
