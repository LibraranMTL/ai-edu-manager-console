'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('learning companion is a student-scoped page after learning cards and reuses host action definitions', () => {
  const renderer = read('src', 'main.tsx');
  const panel = read('src', 'LearningCompanionPanel.tsx');
  const host = read('electron', 'main.cjs');
  const preload = read('electron', 'preload.cjs');
  assert.match(renderer, /id: 'learning-cards',[\s\S]{0,180}id: 'learning-companion'/);
  assert.match(renderer, /activeSection === 'learning-companion'/);
  assert.match(panel, /学习、互动、测验、核验与计划|AGENT LEARNING COMPANION/);
  assert.match(host, /COMPANION_MODE_GROUPS\.flatMap/);
  assert.match(host, /bridge:getCompanionLearningPage/);
  assert.match(host, /bridge:copyCompanionLearningPrompt/);
  assert.match(preload, /bridge:getCompanionLearningPage/);
  assert.match(preload, /bridge:copyCompanionLearningPrompt/);
});

test('topic adoption stays available during background refresh and has its own duplicate-click guard', () => {
  const panel = read('src', 'TopicSuggestionsPanel.tsx');
  assert.match(panel, /const \[adoptingId, setAdoptingId\]/);
  assert.match(panel, /disabled=\{Boolean\(adoptingId\)\}/);
  assert.doesNotMatch(panel, /onAdopt\([^)]+\)[\s\S]{0,80}disabled=\{busy\}/);
  assert.match(panel, /view === 'favorites' \? saved\?\.versionId : current\?\.id/);
});
