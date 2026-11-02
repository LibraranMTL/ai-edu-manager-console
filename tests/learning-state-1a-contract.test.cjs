'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');
const panel = fs.readFileSync(path.join(root, 'src', 'LearningStatePanel.tsx'), 'utf8');
const analysis = fs.readFileSync(path.join(root, 'electron', 'learning-state-analysis.cjs'), 'utf8');

test('Windows renderer exposes the v3 state bridge and delegates actions through the governed loop', () => {
  assert.match(preload, /learningStateAction\(action, studentId, input\)/);
  assert.match(main, /bridge:learningStateAction/);
  assert.match(panel, /dispatchLearningAction/);
  assert.match(main, /createLearningActionLoop/);
  assert.match(main, /generateForAction/);
  assert.match(main, /kind: 'student_learning_action'/);
  assert.doesNotMatch(panel, /generatePracticeCard|createTask|executeTask/);
});

test('practice review drives the versioned two-root rule and feeds the original action without claiming mastery', () => {
  assert.match(main, /reconcileLearningStateFromPracticeReview/);
  assert.match(main, /createLearningStateAnalysisService/);
  assert.match(main, /recordPracticeActionFeedback/);
  assert.match(analysis, /independentRootThreshold:\s*2/);
  assert.match(analysis, /windowDays:\s*14/);
  assert.match(analysis, /masteryConclusion:\s*null/);
  assert.match(renderer, /selectedTask\.kind === 'student_learning_action'.*行动已完成/s);
});

test('student session can read and submit feedback while teacher endpoint stays read-only', () => {
  assert.match(main, /\['GET', 'POST'\]\.includes\(request\.method\).*\/api\/student-session\/learning-state/);
  assert.match(main, /request\.method === 'GET'.*teacherLearningStateMatch/);
  assert.match(main, /教师端一期仅提供只读状态/);
  assert.match(main, /learningStateRead: true, learningStateFeedback: true/);
  assert.match(main, /roleReport = projectLearningRoleReport\(snapshot, \{ role, studentId \}\)/);
  assert.doesNotMatch(main, /api\/parent\/.+learning-state/);
});

test('management UI labels evidence provenance and rejects a synthetic total score', () => {
  for (const label of ['学生自述', '外部观察', '系统观察', '系统推断']) assert.match(panel, new RegExp(label));
  assert.match(panel, /不合成总分，不用于诊断、排名或纪律判断/);
  assert.doesNotMatch(panel, /totalScore|综合效率分|综合得分/);
  for (const key of ['goalClarity', 'confidence', 'difficulty', 'recovery', 'workload']) assert.match(panel, new RegExp(key));
});

test('learning state lives in the learning report navigation rather than the growth model tabs', () => {
  assert.match(renderer, /\{ id: 'learning-reports', label: '学情报告', section: 'reports' \},\s*\{ id: 'learning-state', label: '学习状态', section: 'reports' \}/);
  assert.match(renderer, /activePageTab === 'learning-state'.*<LearningStatePanel/s);
  const growthTabs = renderer.match(/aria-label="成长模型视图">([\s\S]*?)<\/div>/)?.[1] || '';
  assert.doesNotMatch(growthTabs, /学习状态/);
});
