'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildLearningWorkbenchProjection } = require('../electron/learning-workbench.cjs');

test('learning workbench keeps unknown dimensions and never creates a composite score', () => {
  const projection = buildLearningWorkbenchProjection({ student: { id: 'a', name: 'A' }, learningState: {}, fiveDimensions: { dimensions: {
    goals: { status: 'insufficient_evidence' }, mindset: { status: 'insufficient_evidence' }, problems: { status: 'insufficient_evidence' }, methods: { status: 'insufficient_evidence' }, efficiency: { status: 'descriptive_only', metrics: {} },
  } }, tasks: [], projects: [], materialStats: { available: true, assetTotal: 12, processedCount: 7, weeklyUploadedMaterials: 3,
    weekStart: '2026-11-02', weekEnd: '2026-11-08', days: Array.from({ length: 7 }, (_, index) => ({ date: `2026-11-0${index + 2}`, label: `周${index + 1}`, uploads: index === 0 ? 3 : 0 })) } });
  assert.equal(projection.dimensions.filter(item => item.status === 'unknown').length, 5);
  assert.match(projection.dimensions.find(item => item.key === 'efficiency').summary, /没有可评价样本/);
  assert.equal(projection.boundaries.noCompositeScore, true);
  assert.equal('score' in projection, false); assert.equal(projection.weeklyActions.length, 0);
  assert.equal(projection.loop.length, 6);
  assert.equal(projection.loop[0].metric, '已收录 12 份资料');
  assert.equal(projection.loop[1].metric, '已完成处理 7 份资料');
  assert.equal(projection.weeklyMaterials.weeklyUploadedMaterials, 3);
  assert.equal(projection.weeklyMaterials.days.length, 7);
});

test('learning workbench only marks efficiency observed when a comparable sample exists', () => {
  const projection = buildLearningWorkbenchProjection({ student: { id: 'a', name: 'A' }, learningState: {}, fiveDimensions: { dimensions: {
    goals: { status: 'insufficient_evidence' }, mindset: { status: 'insufficient_evidence' }, problems: { status: 'insufficient_evidence' }, methods: { status: 'insufficient_evidence' },
    efficiency: { status: 'descriptive_only', metrics: { independentCompletion: { numerator: 1, denominator: 1, sampleSize: 1 } } },
  } }, tasks: [], projects: [] });
  const efficiency = projection.dimensions.find(item => item.key === 'efficiency');
  assert.equal(efficiency.status, 'descriptive_only');
  assert.equal(efficiency.summary, '已有描述性效率记录。');
});

test('workbench and expert draft bridges are wired with retained-draft copy', () => {
  const root = path.resolve(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'electron/preload.cjs'), 'utf8');
  const runtime = fs.readFileSync(path.join(root, 'electron/cloud-report-runtime.cjs'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'src/main.tsx'), 'utf8');
  const panel = fs.readFileSync(path.join(root, 'src/CloudDocumentsPanel.tsx'), 'utf8');
  const workbench = fs.readFileSync(path.join(root, 'src/LearningWorkbenchPanel.tsx'), 'utf8');
  for (const value of ['cloudReportGetExpertConsultationDraft', 'cloudReportSaveExpertConsultationDraft', 'cloudReportClearExpertConsultationDraft']) {
    assert.match(main, new RegExp(value)); assert.match(preload, new RegExp(value));
  }
  assert.match(runtime, /expertConsultationDrafts/); assert.match(runtime, /delete state\.expertConsultationDrafts\[id\]/);
  assert.match(panel, /离开页面、关闭应用或撤权不会删除此草稿/);
  assert.match(app, /学情工作台/); assert.match(app, /getLearningWorkbenchProjection/);
  assert.match(workbench, /单学生资料统计/);
  assert.doesNotMatch(workbench, /更多快捷入口/);
});
