'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildProjectReportSnapshot } = require('../electron/project-report-snapshot.cjs');

const AS_OF = '2026-11-02T08:00:00.000Z';

function project(revision = 7) {
  return {
    id: 'project-demo', revision, name: '虚构云台支架', type: '设计项目', status: 'active',
    objective: '完成俯仰范围验证', description: '虚构测试项目', studentIds: ['student-a', 'student-b'],
    studentEvidence: [
      { studentId: 'student-a', status: 'verified', ability: '测试记录', observation: '完成 T1 记录',
        sourceBinding: { bindingId: 'binding-a' } },
      { studentId: 'student-b', status: 'draft', ability: '结构设计', observation: '尚未确认',
        sourceBinding: { bindingId: 'binding-b' } },
    ],
  };
}

function registry(revision = 11) {
  const materials = Array.from({ length: 650 }, (_, index) => ({
    materialId: `material-${String(index + 1).padStart(4, '0')}`, version: index === 649 ? 2 : 1,
    recordRevision: 1, sha256: `${index + 1}`.padStart(64, '0'), size: 100 + index,
    location: { kind: 'workspace', rootId: 'workspace', relativePath: index === 649 ? '最终成果/T1-尾部反例.csv' : `过程文档/记录-${index + 1}.md` },
    availability: index === 648 ? 'missing' : 'available', adoption: { state: 'accepted' },
    processing: { state: 'completed', processedVersion: 1 }, sources: [{ type: 'workspace' }], links: { knowledge: [] },
  }));
  const knowledge = Array.from({ length: 520 }, (_, index) => ({
    knowledgeId: `knowledge-${index + 1}`, relativePath: `摘要库/摘要-${index + 1}.md`, status: 'verified',
    committedAt: AS_OF, sources: [{ materialId: materials[index % materials.length].materialId,
      version: 1, sha256: materials[index % materials.length].sha256 }],
  }));
  return { schema: 'project-materials.v1', projectId: 'project-demo', revision, updatedAt: AS_OF,
    materials, knowledge, evidenceBindings: [
      { bindingId: 'binding-a', materials: [{ materialId: 'material-0650', version: 2, sha256: materials[649].sha256 }] },
      { bindingId: 'binding-b', materials: [{ materialId: 'material-0001', version: 1, sha256: materials[0].sha256 }] },
    ] };
}

test('snapshot paginates the complete registered set and retains the tail evidence', async () => {
  const value = project();
  const index = registry();
  const snapshot = await buildProjectReportSnapshot({
    projectId: value.id, asOf: AS_OF, timezone: 'Asia/Shanghai', authorizationVersion: 'auth-7', pageSize: 100,
    loadProject: async () => structuredClone(value), loadRegistry: async () => structuredClone(index),
  });
  assert.equal(snapshot.coverage.materials.total, 650);
  assert.equal(snapshot.coverage.materials.analyzed, 650);
  assert.equal(snapshot.coverage.knowledge.total, 520);
  assert.equal(snapshot.coverage.knowledge.analyzed, 520);
  assert.equal(snapshot.coverage.materials.unavailable, 1);
  assert.ok(snapshot.evidence.some((item) => item.sourceId === 'material-0650'));
  assert.equal(snapshot.confirmedContributions.length, 1);
  assert.equal(snapshot.confirmedContributions[0].studentId, 'student-a');
  assert.ok(snapshot.evidence.some((item) => item.sourceType === 'project_material_registry'));
  assert.ok(snapshot.evidence.some((item) => item.sourceType === 'project_contribution_confirmation' && item.studentId === 'student-a'));
  assert.equal(snapshot.confirmedContributions[0].evidenceIds.length, 2);
  assert.ok(!JSON.stringify(snapshot).includes('C:\\'));
});

test('snapshot is deterministic and rejects a project or registry changed during the read', async () => {
  const value = project();
  const index = registry();
  const first = await buildProjectReportSnapshot({ projectId: value.id, asOf: AS_OF,
    loadProject: async () => structuredClone(value), loadRegistry: async () => structuredClone(index) });
  const second = await buildProjectReportSnapshot({ projectId: value.id, asOf: AS_OF,
    loadProject: async () => structuredClone(value), loadRegistry: async () => structuredClone(index) });
  assert.equal(first.inputFingerprint, second.inputFingerprint);
  let reads = 0;
  await assert.rejects(() => buildProjectReportSnapshot({ projectId: value.id, asOf: AS_OF,
    loadProject: async () => project(++reads === 1 ? 7 : 8), loadRegistry: async () => structuredClone(index) }),
  (error) => error.code === 'project_report_snapshot_changed');
  let registryReads = 0;
  await assert.rejects(() => buildProjectReportSnapshot({ projectId: value.id, asOf: AS_OF,
    loadProject: async () => structuredClone(value), loadRegistry: async () => {
      const changed = structuredClone(index); if (++registryReads > 1) changed.materials[649].version = 3; return changed;
    } }), (error) => error.code === 'project_report_snapshot_changed');
});

