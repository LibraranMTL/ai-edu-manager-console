'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  displayChanges, displayDisclaimer, displayGap, displayStatement, displayStatus,
  friendlyMaterialTitle, reportTypeLabel,
} = require('../electron/project-report-presentation.cjs');
const { projectReportProjection } = require('../electron/project-report-access.cjs');

test('legacy report wording is converted to customer language without changing its meaning', () => {
  assert.equal(displayStatement('当前登记状态：进行中。'), '项目目前正在进行。');
  assert.equal(displayStatement('截至 2026-11-02T08:00:00.000Z，已登记 46 份项目资料，46 份进入本次快照。'),
    '截至 2026年11月2日，本报告参考了 46 份项目资料。');
  assert.equal(displayStatement('已采用 Geography_IA_Sections_1_and_2.docx（版本 1）；修改原因和效果仍以测试或反馈为准。'),
    '已使用《Geography IA Sections 1 and 2》第 1 版；修改效果还需要测试或反馈确认。');
  assert.equal(displayStatement('代表材料：最终成果/demo_file.pdf（版本 2）；选择理由是其已采用且处于当前证据快照。'),
    '主要成果：《demo file》第 2 版。');
  assert.equal(displayStatus('observed'), '已看到');
  assert.equal(reportTypeLabel('completion'), '结项成果报告');
  assert.equal(displayChanges('首次七栏项目总体报告。'), '首次生成项目进展与成果报告。');
  assert.equal(displayGap('M1 只确认登记事实，目标达成仍需结构化测试或明确评价。'),
    '当前报告只汇总已记录的信息；是否完成目标还需要测试结果或明确评价。');
  assert.equal(displayDisclaimer('从阶段摘要到结项报告均绑定固定证据快照；归档成功后冻结唯一结项版本。', 'completion'),
    '这是项目结项时保留的成果报告；后续订正会作为补充说明，不会改写本报告。');
});

test('friendly material titles remove only paths, extensions and separator noise', () => {
  assert.equal(friendlyMaterialTitle('D:\\private\\最终成果\\Geography_IA__Final.docx'), 'Geography IA Final');
  assert.equal(friendlyMaterialTitle('作品集项目 v2-3'), '作品集项目 v2-3');
});

test('read projection adds display fields while leaving the stored report unchanged', () => {
  const snapshot = {
    projectId: 'project-1', snapshotId: 'snapshot-1', asOf: '2026-11-02T08:00:00.000Z', authorizationVersion: 'auth-1',
    project: { name: '测试项目', status: 'active', objective: '' }, members: [],
    coverage: { materials: { total: 46, analyzed: 46, unavailable: 0, pending: 0 }, knowledge: { total: 3, analyzed: 3, pending: 0 }, contributions: { confirmed: 0, unconfirmed: 0 } },
    evidence: [{ evidenceId: 'e1', citationId: 'c1', sourceType: 'project_material', sourceId: 'm1', revision: '1',
      contentHash: 'a'.repeat(64), availability: 'active', audience: ['admin', 'student', 'teacher'], title: '最终成果/demo_file.pdf', locator: { kind: 'file' } }],
  };
  const report = {
    reportType: 'overall', policyVersion: 'project-report-m2-v1',
    summary: { currentStage: '进行中', changes: '首次七栏项目总体报告。', nextAction: '补充可比较的测试记录或已确认评价，再核对目标达成。',
      representativeResults: [{ title: '最终成果/demo_file.pdf', statement: '代表材料：最终成果/demo_file.pdf（版本 1）；选择理由是其已采用且处于当前证据快照。', evidenceId: 'e1', citationId: 'c1' }] },
    claims: [{ claimKey: 'registered', section: 'stage_change', kind: 'fact', status: 'fact',
      statement: '截至 2026-11-02T08:00:00.000Z，已登记 46 份项目资料，46 份进入本次快照。', evidenceIds: ['e1'], audience: ['admin', 'student', 'teacher'] }],
    sections: [], changes: { added: [], revised: [], withdrawn: [], unchanged: [] },
    gaps: ['M1 只确认登记事实，目标达成仍需结构化测试或明确评价。'], personalContributions: [],
    disclaimer: '待验证项不是达成结论；团队成果不自动等同于个人贡献。',
  };
  const before = structuredClone(report);
  const projection = projectReportProjection({ role: 'admin', readerId: 'admin', allowedStudentIds: [], authorizationVersion: 'auth-1' }, snapshot, report,
    { versionId: 'version-1', generation: 26, createdAt: '2026-11-03T01:13:41.685Z' });
  const teacherProjection = projectReportProjection({ role: 'teacher', readerId: 'teacher', allowedStudentIds: [], authorizationVersion: 'auth-1' }, snapshot, report,
    { versionId: 'version-1', generation: 26, createdAt: '2026-11-03T01:13:41.685Z' });

  assert.deepEqual(report, before);
  assert.equal(projection.reportTypeLabel, '项目进展与成果');
  assert.equal(projection.updatedAt, '2026-11-03T01:13:41.685Z');
  assert.equal(projection.dataGeneration, 26);
  assert.equal(projection.claims[0].statement, before.claims[0].statement);
  assert.equal(projection.claims[0].displayStatement, '截至 2026年11月2日，本报告参考了 46 份项目资料。');
  assert.equal(projection.summary.representativeResults[0].title, '最终成果/demo_file.pdf');
  assert.equal(projection.summary.representativeResults[0].displayTitle, 'demo file');
  assert.doesNotMatch(projection.summary.representativeResults[0].displayTitle, /[\\/]|^[A-Za-z]:/);
  assert.doesNotMatch(projection.summary.representativeResults[0].displayStatement, /快照|已采用|选择理由/);
  assert.equal(teacherProjection.claims[0].displayStatement, projection.claims[0].displayStatement);
  assert.equal(teacherProjection.summary.representativeResults[0].displayTitle, projection.summary.representativeResults[0].displayTitle);
});
