const assert = require('node:assert/strict');
const test = require('node:test');

const { buildGrowthEvidenceBatchPlan, classifyGrowthEvidenceRisk } = require('../electron/growth-evidence-risk.cjs');

const candidate = (overrides = {}) => ({
  id: 'evidence-safe-1',
  studentId: 'student-synthetic-a',
  projectId: 'project-synthetic-a',
  title: '完成虚构项目作品',
  content: '作品中包含两种解法',
  sourcePath: 'fixture://student-a/project/work',
  sourceType: 'learning_artifact',
  status: 'pending',
  confidence: 'high',
  ability: '问题解决',
  ...overrides,
});

test('traceable project evidence is low risk and hidden from the default attention queue', () => {
  const result = classifyGrowthEvidenceRisk(candidate());
  assert.equal(result.level, 'low');
  assert.equal(result.defaultHidden, true);
  assert.equal(result.suggestedAction, 'confirm');
});

test('an unavailable source is escalated instead of being automatically confirmed', () => {
  const result = classifyGrowthEvidenceRisk(candidate({ automationAttentionReason: 'source_unavailable' }));
  assert.equal(result.level, 'high');
  assert.equal(result.requiresIndividualReview, true);
  assert.ok(result.reasons.some((reason) => reason.code === 'source_unavailable'));
});

test('missing source, sensitive content, conflicts, agent inference and legacy audit gaps require individual review', () => {
  const cases = [
    candidate({ id: 'e-missing', sourcePath: '' }),
    candidate({ id: 'e-sensitive', title: '学生心理诊断' }),
    candidate({ id: 'e-conflict', conflict: true }),
    candidate({ id: 'e-agent', sourceType: 'agent_inference' }),
    candidate({ id: 'e-legacy', status: 'confirmed' }),
  ];
  const options = { legacyReviewIds: ['e-legacy'] };
  for (const item of cases) {
    const result = classifyGrowthEvidenceRisk(item, options);
    assert.equal(result.level, 'high');
    assert.equal(result.requiresIndividualReview, true);
  }
});

test('one batch plan confirms low risk, watches medium risk and leaves high risk untouched', () => {
  const items = [
    candidate(),
    candidate({ id: 'e-medium', projectId: '', confidence: '待确认' }),
    candidate({ id: 'e-high', sourcePath: '' }),
    candidate({ id: 'e-done', status: 'watching' }),
  ];
  const plan = buildGrowthEvidenceBatchPlan(items);
  assert.deepEqual(plan.confirmIds, ['evidence-safe-1']);
  assert.deepEqual(plan.watchIds, ['e-medium']);
  assert.deepEqual(plan.individualIds, ['e-high']);
  assert.equal(plan.summary.batchProcessable, 2);
  assert.equal(plan.summary.high, 1);
  assert.equal(plan.summary.alreadyProcessed, 1);
});
