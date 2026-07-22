const test = require('node:test');
const assert = require('node:assert/strict');
const { completionBlockers, knowledgeRiskReasons, singleStudentEvidenceDraft } = require('../electron/project-completion.cjs');

test('knowledge risk focuses on new, low-confidence, missing-source and conflict records', () => {
  assert.deepEqual(knowledgeRiskReasons({ status: 'ai_generated', confidence: 'low', sourceAssets: [], conflict: true }), ['new_content', 'low_confidence', 'missing_source', 'conflict']);
  assert.deepEqual(knowledgeRiskReasons({ status: 'verified', confidence: 'high', sourceAssets: ['A-1'] }), []);
});

test('single-student evidence is drafted from traceable reviewed sources only', () => {
  const draft = singleStudentEvidenceDraft({ project: { name: '物理项目', growthStrategy: '数据分析', studentEvidence: [] }, students: [{ id: 's1' }], knowledge: [{ status: 'verified', path: 'concept.md' }], staging: [] });
  assert.equal(draft.studentId, 's1');
  assert.deepEqual(draft.sourcePaths, ['concept.md']);
  assert.equal(draft.status, 'draft');
  assert.equal(singleStudentEvidenceDraft({ project: { studentEvidence: [] }, students: [{ id: 's1' }, { id: 's2' }] }), null);
});

test('completion blockers are actionable and source-less evidence is a hard stop', () => {
  const blockers = completionBlockers({ students: [{ id: 's1', name: '学生甲' }], digestState: { status: 'idle', pendingCount: 0 }, evidence: [{ studentId: 's1', status: 'verified', sourcePaths: [] }] });
  assert.equal(blockers[0].code, 'evidence_source:s1');
  assert.equal(blockers[0].target, 'evidence');
  assert.equal(blockers[0].severity, 'high');
  assert.equal(blockers[0].blocking, true);
});
