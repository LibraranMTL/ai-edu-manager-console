const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  GOVERNANCE_SCHEMA,
  buildKnowledgeGovernanceRun,
  collectRecentKnowledgeArtifacts,
  persistKnowledgeGovernanceRun,
} = require('../electron/knowledge-governance-pipeline.cjs');

test('traceable knowledge assets complete the automatic governance chain and stay hidden by default', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-governance-'));
  try {
    const artifact = path.join(root, '摘要库', '课程摘要.md');
    fs.mkdirSync(path.dirname(artifact), { recursive: true });
    fs.writeFileSync(artifact, '来源：课程资料/第一课.md\n这是知识摘要。', 'utf8');
    const run = buildKnowledgeGovernanceRun({
      scopeType: 'student',
      scopeId: 'student-1',
      scopeName: '测试学生',
      batchId: 'batch-1',
      knowledgeRoot: root,
      resolvedFiles: [{ materialId: 'material-1', relativePath: '课程资料/第一课.md', sha1: 'abc', artifacts: [artifact] }],
      artifacts: [artifact],
    });
    assert.equal(run.schema, GOVERNANCE_SCHEMA);
    assert.equal(run.status, 'completed');
    assert.equal(run.stages.map((stage) => stage.id).join(','), 'receipt_validation,knowledge_asset_registration,digest_analysis,quality_gate');
    assert.equal(run.analysis.coverage, 100);
    assert.equal(run.artifacts[0].decision, 'accepted_internal');
    assert.equal(run.artifacts[0].hiddenFromDefault, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('missing or out-of-scope artifacts become visible attention items instead of silent success', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-governance-root-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-governance-outside-'));
  try {
    const artifact = path.join(outside, 'unexpected.md');
    fs.writeFileSync(artifact, 'content', 'utf8');
    const run = buildKnowledgeGovernanceRun({
      scopeType: 'project',
      scopeId: 'project-1',
      batchId: 'batch-2',
      knowledgeRoot: root,
      resolvedFiles: [{ materialId: 'material-2', relativePath: 'source.md', sha1: 'def', artifacts: [artifact] }],
      artifacts: [artifact],
    });
    assert.equal(run.status, 'attention');
    assert.equal(run.quality.attentionCount, 1);
    assert.equal(run.artifacts[0].riskLevel, 'high');
    assert.equal(run.artifacts[0].decision, 'needs_attention');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('recent artifact collection is bounded and governance receipts persist as current and historical views', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-governance-persist-'));
  try {
    fs.writeFileSync(path.join(root, 'a.md'), 'source.md', 'utf8');
    fs.writeFileSync(path.join(root, 'b.json'), '{}', 'utf8');
    const artifacts = collectRecentKnowledgeArtifacts(root, '', 1);
    assert.equal(artifacts.length, 1);
    const run = buildKnowledgeGovernanceRun({
      scopeType: 'student',
      scopeId: 'student-2',
      batchId: 'batch-3',
      knowledgeRoot: root,
      resolvedFiles: [],
      artifacts,
    });
    const persisted = persistKnowledgeGovernanceRun(path.join(root, '.edu-manager'), run);
    const persistedAgain = persistKnowledgeGovernanceRun(path.join(root, '.edu-manager'), run);
    assert.equal(fs.existsSync(persisted.latestPath), true);
    assert.equal(fs.existsSync(persisted.reportPath), true);
    assert.equal(persistedAgain.latestPath, persisted.latestPath);
    assert.equal(JSON.parse(fs.readFileSync(persisted.latestPath, 'utf8')).runId, run.runId);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ignored or invalid only batches close quietly without a false missing-artifact warning', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-governance-empty-'));
  try {
    const run = buildKnowledgeGovernanceRun({
      scopeType: 'student',
      scopeId: 'student-3',
      batchId: 'batch-invalid-only',
      knowledgeRoot: root,
      resolvedFiles: [],
      artifacts: [],
    });
    assert.equal(run.status, 'completed');
    assert.equal(run.quality.attentionCount, 0);
    assert.equal(run.stages.find((stage) => stage.id === 'knowledge_asset_registration').status, 'completed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('knowledge artifact collection excludes indexes, logs, bindings and Markdown digest receipts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-governance-support-files-'));
  try {
    fs.writeFileSync(path.join(root, 'index.md'), 'index', 'utf8');
    fs.writeFileSync(path.join(root, 'log.md'), 'log', 'utf8');
    fs.writeFileSync(path.join(root, '绑定学生.md'), 'student', 'utf8');
    fs.writeFileSync(path.join(root, '消化回执_第一课.md'), 'receipt', 'utf8');
    fs.writeFileSync(path.join(root, '课程摘要.md'), 'knowledge', 'utf8');
    const artifacts = collectRecentKnowledgeArtifacts(root, '', 20);
    assert.deepEqual(artifacts.map((item) => path.basename(item.path)), ['课程摘要.md']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
