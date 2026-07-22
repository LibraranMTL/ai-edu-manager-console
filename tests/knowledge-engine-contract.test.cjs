const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const {
  KNOWLEDGE_ENGINE_CONTRACT_VERSION,
  KnowledgeEngineContractError,
  assertKnowledgeEngine,
} = require('../electron/knowledge-engine-contract.cjs');
const { createLlmWikiKnowledgeEngine } = require('../electron/llm-wiki-knowledge-engine.cjs');

function syntheticFixture() {
  return {
    asset: {
      id: 'source-math-observation-001',
      uri: 'fixture://education/student-a/math-observation-001',
      title: '虚构学生 A 的数学学习观察',
      mediaType: 'text/markdown',
      content: '在三次虚构练习中，学生 A 会画图整理条件；一次未完成，不能据此形成永久能力标签。',
      synthetic: true,
    },
    claim: {
      id: 'claim-student-a-uses-diagram-001',
      subjectId: 'student-synthetic-a',
      predicate: 'uses_diagram_to_structure_problem',
      value: '在指定的三次虚构数学练习中使用画图方法整理条件',
      status: 'confirmed',
      confidence: 'medium',
      evidence: [{
        id: 'evidence-math-observation-001',
        sourceUri: 'fixture://education/student-a/math-observation-001',
        excerpt: '三次虚构练习中使用画图整理条件；另有一次未完成',
        observedAt: '2026-07-01T00:00:00.000Z',
      }],
      synthetic: true,
    },
  };
}

test('KnowledgeEngine contract rejects incomplete or mismatched engines', () => {
  assert.throws(() => assertKnowledgeEngine({}), (error) => error.code === 'CONTRACT_VERSION_MISMATCH');
  assert.throws(() => assertKnowledgeEngine({ contractVersion: KNOWLEDGE_ENGINE_CONTRACT_VERSION, engineId: 'partial', engineVersion: '1' }), (error) => error.code === 'MISSING_METHODS');
});

test('LLM Wiki engine preserves immutable sources and supports idempotent import', (t) => {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-llm-wiki-contract-'));
  t.after(() => fs.rmSync(rootPath, { recursive: true, force: true }));
  const engine = createLlmWikiKnowledgeEngine({ rootPath });
  const fixture = syntheticFixture();
  const first = engine.importAsset(fixture.asset);
  const second = engine.importAsset(fixture.asset);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.throws(
    () => engine.importAsset({ ...fixture.asset, content: '被替换的内容' }),
    (error) => error instanceof KnowledgeEngineContractError && error.code === 'IMMUTABLE_SOURCE_CONFLICT',
  );
});

test('LLM Wiki engine writes traceable claims, history, relationships, events and portable export', (t) => {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-llm-wiki-contract-'));
  t.after(() => fs.rmSync(rootPath, { recursive: true, force: true }));
  const engine = createLlmWikiKnowledgeEngine({ rootPath });
  const fixture = syntheticFixture();
  engine.importAsset(fixture.asset);
  const created = engine.upsertClaim(fixture.claim);
  assert.equal(created.claim.id, fixture.claim.id);
  assert.equal(engine.getClaim(fixture.claim.id).evidence[0].sourceUri, fixture.asset.uri);

  const search = engine.search('画图', { subjectId: 'student-synthetic-a' });
  assert.equal(search.results.length, 1);
  assert.deepEqual(search.results[0].citations, [{ evidenceId: 'evidence-math-observation-001', sourceUri: fixture.asset.uri }]);

  engine.upsertClaim({ ...fixture.claim, value: '更新后的虚构观察', updatedAt: '2026-07-02T00:00:00.000Z' });
  const historyDir = path.join(rootPath, '.edu-manager', 'knowledge-engine-v1', 'claim-history', fixture.claim.id);
  assert.equal(fs.readdirSync(historyDir).filter((name) => name.endsWith('.json')).length, 1);

  engine.appendEvent({ id: 'event-observation-001', type: 'observation_recorded', subjectId: 'student-synthetic-a' });
  engine.upsertRelationship({ id: 'rel-claim-source-001', fromId: fixture.claim.id, toId: fixture.asset.id, type: 'supported_by' });
  const exported = engine.exportSnapshot({ exportId: 'synthetic-contract-export' });
  assert.equal(exported.snapshot.claims.length, 1);
  assert.equal(exported.snapshot.events.length, 1);
  assert.equal(exported.snapshot.relationships.length, 1);
  assert.ok(fs.existsSync(path.join(exported.exportDir, 'README.md')));
  assert.ok(fs.existsSync(path.join(exported.exportDir, 'snapshot.json')));
});

test('confirmed claims require evidence and IDs cannot traverse paths', (t) => {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-llm-wiki-contract-'));
  t.after(() => fs.rmSync(rootPath, { recursive: true, force: true }));
  const engine = createLlmWikiKnowledgeEngine({ rootPath });
  assert.throws(() => engine.upsertClaim({ id: '../escape', subjectId: 'student-a', predicate: 'test', value: true }), (error) => error.code === 'INVALID_ID');
  assert.throws(() => engine.upsertClaim({ id: 'claim-no-evidence', subjectId: 'student-a', predicate: 'test', value: true, status: 'confirmed' }), (error) => error.code === 'CONFIRMED_WITHOUT_EVIDENCE');
});
