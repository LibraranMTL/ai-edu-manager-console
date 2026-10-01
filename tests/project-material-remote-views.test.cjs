const test = require('node:test');
const assert = require('node:assert/strict');
const { projectMaterialRemoteView } = require('../electron/project-material-remote-views.cjs');

function material(materialId, studentId, categoryId = 'reference') {
  return { materialId, projectId: 'p1', version: 2, recordRevision: 3,
    location: { kind: 'workspace', rootId: 'workspace', relativePath: `参考资料/${materialId}.txt` },
    size: 12, availability: 'available', adoption: { state: 'accepted' },
    organizationState: 'classified', classification: { categoryId, tags: [] }, processing: { state: 'processed' },
    sources: [{ type: 'terminal_upload', studentId, hostSourcePath: `D:\\secret\\${materialId}.txt` }],
    links: { knowledge: [{ knowledgeId: `k-${materialId}`, version: 1 }] }, versions: [] };
}

const project = { id: 'p1', studentEvidence: [
  { studentId: 's1', ability: '研究', observation: '本人证据', status: 'verified', sourceBinding: { bindingId: 'b1' } },
  { studentId: 's2', ability: '表达', observation: '他人证据', status: 'verified', sourceBinding: { bindingId: 'b2' } },
] };
const index = { projectId: 'p1', revision: 8, updatedAt: '2026-09-30T00:00:00Z',
  categories: [{ categoryId: 'reference', name: '参考资料', active: true, relativePath: 'D:\\not-public' }],
  materials: [material('m1', 's1'), material('m2', 's2')],
  knowledge: [
    { knowledgeId: 'k1', relativePath: '概念库/本人主题.md', status: 'committed', sources: [{ materialId: 'm1', version: 2, sha256: 'a'.repeat(64) }] },
    { knowledgeId: 'k2', relativePath: '概念库/他人主题.md', status: 'committed', sources: [{ materialId: 'm2', version: 2, sha256: 'b'.repeat(64) }] },
  ], evidenceBindings: [
    { bindingId: 'b1', materials: [{ materialId: 'm1', version: 2, sha256: 'a'.repeat(64) }] },
    { bindingId: 'b2', materials: [{ materialId: 'm2', version: 2, sha256: 'b'.repeat(64) }] },
  ] };

test('student four-view projection hides other students titles counts paths knowledge and contributions', () => {
  const auth = { type: 'student_session', studentId: 's1', allowedStudentIds: ['s1'] };
  const materials = projectMaterialRemoteView(project, index, auth, { view: 'materials' });
  const knowledge = projectMaterialRemoteView(project, index, auth, { view: 'knowledge' });
  const contributions = projectMaterialRemoteView(project, index, auth, { view: 'contributions' });
  assert.deepEqual(materials.items.map((item) => item.materialId), ['m1']);
  assert.equal(materials.counts.materials, 1);
  assert.deepEqual(knowledge.items.map((item) => item.knowledgeId), ['k1']);
  assert.deepEqual(contributions.items.map((item) => item.studentId), ['s1']);
  assert.match(contributions.items[0].evidenceRevision, /^[a-f0-9]{64}$/);
  const serialized = JSON.stringify({ materials, knowledge, contributions });
  assert.equal(serialized.includes('m2.txt'), false);
  assert.equal(serialized.includes('他人'), false);
  assert.equal(serialized.includes('D:\\secret'), false);
  assert.equal(serialized.includes('not-public'), false);
});

test('teacher view sees project-scoped items while invalid pagination and view fail closed', () => {
  const teacher = { type: 'device', deviceRole: 'teacher', deviceId: 't1' };
  assert.equal(projectMaterialRemoteView(project, index, teacher, { view: 'materials' }).total, 2);
  assert.equal(projectMaterialRemoteView(project, index, teacher, { view: 'knowledge' }).total, 2);
  assert.equal(projectMaterialRemoteView(project, index, teacher, { view: 'contributions' }).total, 2);
  assert.throws(() => projectMaterialRemoteView(project, index, teacher, { view: 'private' }), { code: 'invalid_view' });
  assert.throws(() => projectMaterialRemoteView(project, index, teacher, { limit: 101 }), { code: 'invalid_pagination' });
});
