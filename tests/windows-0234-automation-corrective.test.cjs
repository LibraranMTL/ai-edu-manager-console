'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('0.23.4 corrective keeps the public-course baseline and integrates the five automation modules', () => {
  const packageJson = JSON.parse(read('package.json'));
  const main = read('electron', 'main.cjs');
  const projectAutomation = read('electron', 'project-material-automation.cjs');
  assert.equal(packageJson.version, '0.23.4');
  for (const file of [
    'workbuddy-runtime-status.cjs',
    'automation-feature-flags.cjs',
    'digest-artifact-repair.cjs',
    'project-history-backfill.cjs',
    'task-backlog-convergence.cjs',
  ]) assert.equal(fs.existsSync(path.join(root, 'electron', file)), true, file);
  assert.match(main, /createWorkBuddyRuntimeStatusProbe/);
  assert.match(main, /planDigestArtifactRepair/);
  assert.match(main, /planConvergenceSlice/);
  assert.match(projectAutomation, /resolveAutomationFeatureFlags/);
  assert.match(main, /syncPublicCourses/);
  assert.equal(fs.existsSync(path.join(root, 'electron', 'public-course-sync.cjs')), true);
});

test('historical project backfill remains explicit opt-in in the corrective candidate', () => {
  const flags = read('electron', 'automation-feature-flags.cjs');
  assert.match(flags, /EDU_ENABLE_PROJECT_HISTORY_BACKFILL/);
  assert.doesNotMatch(flags, /projectHistoryBackfill:\s*true/);
});

test('host keeps public-course sync while local platform authoring UI stays hidden', () => {
  const ui = read('src', 'main.tsx');
  const main = read('electron', 'main.cjs');
  assert.match(ui, /LOCAL_PLATFORM_COURSE_AUTHORING_VISIBLE = false/);
  assert.match(ui, /平台精选课程由云端课程发布管理维护/);
  assert.match(ui, /LOCAL_PLATFORM_COURSE_AUTHORING_VISIBLE && platformCourseEditAllowed/);
  assert.match(ui, /LOCAL_PLATFORM_COURSE_AUTHORING_VISIBLE && platformCoursePublishAllowed/);
  assert.match(main, /syncPublicCourses/);
  assert.match(main, /createStudentCourseProjection/);
});
