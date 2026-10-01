const test = require('node:test');
const assert = require('node:assert/strict');
const { projectMaterialWorkspaceView, pendingReasons } = require('../electron/project-material-views.cjs');

const project = { id: 'p1', inboxRelativePath: '收件箱', workspaceFolders: ['参考资料', '方案设计'],
  studentEvidence: [{ studentId: 's1', ability: '研究设计', observation: '提出方案', status: 'verified',
    sourceBinding: { bindingId: 'binding-1' } }] };
const material = (id, patch = {}) => ({ projectId: 'p1', materialId: id, version: 1, recordRevision: 2,
  location: { kind: 'workspace', rootId: 'workspace', relativePath: `收件箱/${id}.txt` },
  size: 10, adoption: { state: 'accepted' }, classification: { categoryId: '', tags: [] },
  organizationState: 'unclassified', processing: { state: 'pending' }, availability: 'available',
  sources: [{ type: 'terminal_upload' }], links: { knowledge: [] }, ...patch });

test('four-view projection keeps logical relationships without exposing host absolute paths', () => {
  const index = { projectId: 'p1', revision: 7, categories: [],
    materials: [material('m1'), material('m2', { classification: { categoryId: 'workspace-slot-02', tags: [], source: 'manual', manualLocked: true }, organizationState: 'classified' })],
    knowledge: [{ knowledgeId: 'k1', relativePath: '摘要库/摘要.md', status: 'committed',
      sources: [{ materialId: 'm2', version: 1, sha256: 'a'.repeat(64) }] }],
    evidenceBindings: [{ bindingId: 'binding-1', materials: [{ materialId: 'm2', version: 1, sha256: 'a'.repeat(64) }] }] };
  const view = projectMaterialWorkspaceView(project, index, { view: 'materials', limit: 20 });
  assert.deepEqual(view.counts, { materials: 2, pending: 1, knowledge: 1, contributions: 1,
    candidates: 0, unclassified: 1, pathClassified: 0, unavailable: 0 });
  assert.equal(view.categories[1].categoryId, 'workspace-slot-02');
  assert.equal(view.items[1].classification.categoryName, '方案设计');
  assert.equal(view.items[1].evidence[0].studentId, 's1');
  assert.equal(view.knowledge[0].sources[0].materialId, 'm2');
  assert.equal(view.contributions[0].sourceStatus, 'fixed');
  assert.equal(JSON.stringify(view).includes(':\\'), false);
});

test('pending view groups independent adoption classification availability and processing reasons', () => {
  const items = [
    material('candidate', { adoption: { state: 'candidate' } }),
    material('missing', { availability: 'missing', classification: { categoryId: 'workspace-slot-01', tags: [] }, organizationState: 'classified' }),
    material('failed', { processing: { state: 'failed' }, classification: { categoryId: 'workspace-slot-01', tags: [] }, organizationState: 'classified' }),
  ];
  assert.deepEqual(pendingReasons(items[0]), ['needs_adoption', 'needs_classification']);
  const view = projectMaterialWorkspaceView(project, { projectId: 'p1', revision: 1,
    categories: [], materials: items }, { view: 'pending', limit: 10 });
  assert.equal(view.total, 3);
  assert.deepEqual(view.items[1].pendingReasons, ['source_missing']);
  assert.deepEqual(view.items[2].pendingReasons, ['processing_failed']);
});

test('known workspace folders provide an immediate inherited classification without hiding adoption review', () => {
  const nested = material('nested', { adoption: { state: 'candidate' },
    location: { kind: 'workspace', rootId: 'workspace', relativePath: '方案设计/2026年9月/draft.txt' } });
  const unknown = material('unknown', { location: { kind: 'workspace', rootId: 'workspace',
    relativePath: '临时目录/unknown.txt' } });
  const view = projectMaterialWorkspaceView(project, { projectId: 'p1', revision: 1,
    categories: [], materials: [nested, unknown] }, { view: 'materials', limit: 10 });
  assert.equal(view.items[0].classification.categoryId, 'workspace-slot-02');
  assert.equal(view.items[0].classification.categoryName, '方案设计');
  assert.equal(view.items[0].classification.source, 'workspace_path');
  assert.equal(view.items[0].classification.inferredFromPath, true);
  assert.deepEqual(view.items[0].pendingReasons, ['needs_adoption']);
  assert.deepEqual(view.items[1].pendingReasons, ['needs_classification']);
  assert.equal(view.counts.pathClassified, 1);
  assert.equal(view.counts.unclassified, 1);
});
