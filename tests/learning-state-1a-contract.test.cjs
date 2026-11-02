'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
const panel = fs.readFileSync(path.join(root, 'src', 'LearningStatePanel.tsx'), 'utf8');

test('Windows renderer exposes the v2 state bridge without task or practice dispatch', () => {
  assert.match(preload, /learningStateAction\(action, studentId, input\)/);
  assert.match(main, /bridge:learningStateAction/);
  assert.doesNotMatch(panel, /dispatchLearningAction|generatePracticeCard|createTask|executeTask/);
});

test('student session can read and submit feedback while teacher endpoint stays read-only', () => {
  assert.match(main, /\['GET', 'POST'\]\.includes\(request\.method\).*\/api\/student-session\/learning-state/);
  assert.match(main, /request\.method === 'GET'.*teacherLearningStateMatch/);
  assert.match(main, /教师端一期仅提供只读状态/);
  assert.match(main, /learningStateRead: true, learningStateFeedback: true/);
});

test('management UI labels evidence provenance and rejects a synthetic total score', () => {
  for (const label of ['学生自述', '外部观察', '系统观察', '系统推断']) assert.match(panel, new RegExp(label));
  assert.match(panel, /不合成总分，不用于诊断、排名或纪律判断/);
  assert.doesNotMatch(panel, /totalScore|综合效率分|综合得分/);
  for (const key of ['goalClarity', 'confidence', 'difficulty', 'recovery', 'workload']) assert.match(panel, new RegExp(key));
});
