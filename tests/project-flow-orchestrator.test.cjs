const assert = require('node:assert/strict');
const test = require('node:test');

const { buildProjectReviewPackage } = require('../electron/project-flow-orchestrator.cjs');

test('one review package separates safe automatic items from human judgments', () => {
  const result = buildProjectReviewPackage({
    id: 'project-1',
    stagingItems: [
      { id: 'm1', filename: 'final.pdf', status: 'selected', sourcePath: 'D:/final.pdf' },
      { id: 'm2', filename: 'unknown.png', status: 'collected', sourcePath: 'D:/unknown.png' },
    ],
    studentEvidence: [{ studentId: 's1', ability: '研究能力', status: 'draft' }],
    digestState: { pendingCount: 0 },
  }, [
    { id: 'k1', title: '实验设计', status: 'pending_review', confidence: 'high', sourceAssets: ['a1'] },
    { id: 'k2', title: '不明结论', status: 'pending_review', confidence: 'low', sourceAssets: [] },
  ]);
  assert.deepEqual(result.ready.materialIds, ['m1']);
  assert.deepEqual(result.ready.knowledgeIds, ['k1']);
  assert.equal(result.attention.materials.length, 1);
  assert.equal(result.attention.knowledge.length, 1);
  assert.equal(result.attention.evidence.length, 1);
  assert.equal(result.primaryAction, 'approve_ready');
});

test('growth evidence never enters the automatic approval set', () => {
  const result = buildProjectReviewPackage({ id: 'p', studentEvidence: [{ studentId: 's', status: 'draft', confidence: 'high', sourcePaths: ['x.md'] }] }, []);
  assert.equal(result.ready.count, 0);
  assert.equal(result.attention.evidence.length, 1);
  assert.equal(result.primaryAction, 'review_evidence');
});

