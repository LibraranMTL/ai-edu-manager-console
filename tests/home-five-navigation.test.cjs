'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const entries = require('../shared/home-entries.json');
const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');

test('home exposes exactly the five approved navigation entries in order', () => {
  assert.deepEqual(entries.map((entry) => entry.title), [
    '本周行动建议', '每日固定动作', '项目进展', '推荐选题', '推荐比赛',
  ]);
  assert.equal(new Set(entries.map((entry) => entry.id)).size, 5);
});

test('home entry clicks are navigation-only and daily action targets its report section', () => {
  const start = ui.indexOf('const navigateHomeEntry =');
  const end = ui.indexOf('\n  const activeBackgroundWork', start);
  const handler = ui.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.match(handler, /setLearningReportAnchor\('每日固定动作'\)/);
  assert.match(handler, /setSelectedLearningReportId\('daily'\)/);
  assert.match(handler, /setProjectPageMode\('list'\)/);
  assert.match(handler, /setActiveSection\('topic-suggestions'\)/);
  assert.match(handler, /setActiveSection\('competition-recommendations'\)/);
  assert.doesNotMatch(handler, /startDigest|updateLearningReports|refreshTopic|refreshGuidance|generate|scan|Agent|bridge\(\)/i);
});

test('legacy home primary action no longer starts business work', () => {
  const start = ui.indexOf('const runHomePrimaryAction =');
  const end = ui.indexOf('\n  const navigateHomeEntry =', start);
  const handler = ui.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.doesNotMatch(handler, /startDigestWorkflowFromPage|updateLearningReports|generate|scan|bridge\(\)/i);
});

test('home renders the shared entry catalog and report body supports section navigation', () => {
  assert.match(ui, /homeEntryCatalog\.map/);
  assert.match(ui, /data-learning-report-body/);
  assert.match(ui, /scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\)/);
});
