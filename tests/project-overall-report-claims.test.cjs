'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildM1ProjectReport } = require('../electron/project-report-claims.cjs');
const { projectReportProjection, citationProjection } = require('../electron/project-report-access.cjs');

function snapshot() {
  return {
    snapshotId: 'snapshot-1', projectId: 'project-demo', asOf: '2026-11-02T08:00:00.000Z',
    timezone: 'Asia/Shanghai', policyVersion: 'project-report-m1-v1', authorizationVersion: 'auth-1',
    inputFingerprint: 'a'.repeat(64), project: { name: '虚构云台支架', type: '设计项目', status: 'active',
      objective: '俯仰 ±30° 全程不碰线', description: '用于验证证据边界' },
    members: [{ studentId: 'student-a' }, { studentId: 'student-b' }],
    coverage: { materials: { total: 2, analyzed: 2, unavailable: 0, pending: 0 },
      knowledge: { total: 1, analyzed: 1, pending: 0 }, contributions: { confirmed: 1, unconfirmed: 1 } },
    evidence: [
      { evidenceId: 'e-project', citationId: 'c-project', sourceType: 'project_metadata', sourceId: 'project-demo', revision: '7', contentHash: 'b'.repeat(64), availability: 'active', audience: ['admin','student','teacher'], locator: { kind: 'record' } },
      { evidenceId: 'e-registry', citationId: 'c-registry', sourceType: 'project_material_registry', sourceId: 'project-demo', revision: '11', contentHash: 'e'.repeat(64), availability: 'active', audience: ['admin','student','teacher'], locator: { kind: 'record' } },
      { evidenceId: 'e-cad', citationId: 'c-cad', sourceType: 'project_material', sourceId: 'material-cad', revision: '1', contentHash: 'c'.repeat(64), availability: 'active', audience: ['admin','student','teacher'], locator: { kind: 'file', logicalPath: '过程文档/云台-v2.cad' }, title: '云台-v2.cad' },
      { evidenceId: 'e-t1', citationId: 'c-t1', sourceType: 'project_material', sourceId: 'material-t1', revision: '1', contentHash: 'd'.repeat(64), availability: 'active', audience: ['admin','student','teacher'], locator: { kind: 'file', logicalPath: '最终成果/T1.csv' }, title: 'T1.csv' },
      { evidenceId: 'e-confirm-a', citationId: 'c-confirm-a', sourceType: 'project_contribution_confirmation', sourceId: 'project-demo:student-a', revision: '7', contentHash: 'f'.repeat(64), availability: 'active', audience: ['admin','student','teacher'], locator: { kind: 'record' }, studentId: 'student-a' },
    ],
    representativeEvidenceIds: ['e-cad', 'e-t1'],
    confirmedContributions: [{ studentId: 'student-a', ability: '测试记录', observation: '完成 T1 记录', evidenceIds: ['e-confirm-a', 'e-t1'], status: 'verified' }],
  };
}

test('M1 emits evidence-bound facts, gaps and next action without inventing achievement', () => {
  const report = buildM1ProjectReport(snapshot());
  assert.equal(report.reportType, 'stage_summary');
  assert.ok(report.claims.length >= 4);
  assert.ok(report.claims.every((claim) => claim.kind === 'suggestion' || claim.evidenceIds.length > 0));
  assert.deepEqual(report.claims.find((claim) => claim.claimKey === 'registered-evidence').evidenceIds, ['e-registry']);
  assert.ok(report.claims.every((claim) => !['achieved', 'partially_achieved'].includes(claim.status)));
  assert.match(report.summary.currentStage, /进行中/);
  assert.equal(report.summary.representativeResults.length, 2);
  assert.ok(report.summary.nextAction);
  assert.match(report.disclaimer, /阶段摘要/);
});

test('access projection keeps team facts separate and reveals only confirmed personal contribution to an allowed reader', () => {
  const source = snapshot();
  const report = buildM1ProjectReport(source);
  const studentA = projectReportProjection({ role: 'student', readerId: 'student-a', allowedStudentIds: ['student-a'], authorizationVersion: 'auth-1' }, source, report);
  const studentB = projectReportProjection({ role: 'student', readerId: 'student-b', allowedStudentIds: ['student-b'], authorizationVersion: 'auth-1' }, source, report);
  assert.equal(studentA.personalContributions.length, 1);
  assert.equal(studentB.personalContributions.length, 0);
  assert.ok(studentA.claims.every((claim) => claim.subjectType !== 'student'));
  const citation = citationProjection({ role: 'student', readerId: 'student-a', allowedStudentIds: ['student-a'], authorizationVersion: 'auth-1' }, source, 'c-t1');
  assert.equal(citation.locator.logicalPath, '最终成果/T1.csv');
  assert.ok(!('absolutePath' in citation.locator));
  assert.throws(() => citationProjection({ role: 'student', readerId: 'student-b', allowedStudentIds: ['student-b'], authorizationVersion: 'auth-1' }, source, 'c-confirm-a'),
    (error) => error.code === 'subject_scope_forbidden');
});

