const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const os = require('node:os');
const { createLlmWikiKnowledgeEngine } = require('../electron/llm-wiki-knowledge-engine.cjs');

test('P0 evaluation dataset contains ten synthetic, stable-ID scenarios', () => {
  const fixturePath = path.join(__dirname, 'fixtures', 'knowledge-engine', 'education-synthetic-v1.json');
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  assert.equal(fixture.synthetic, true);
  assert.equal(fixture.scenarios.length, 10);
  assert.equal(new Set(fixture.scenarios.map((item) => item.id)).size, 10);
  assert.ok(fixture.scenarios.every((item) => /^scenario-[0-9]{2}-[a-z-]+$/.test(item.id)));
  assert.ok(fixture.subjects.every((item) => item.id.includes('synthetic')));
  assert.match(fixture.notice, /均为虚构/);
});

test('current LLM Wiki engine completes all ten P0 scenarios without external dependencies', (t) => {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-p0-llm-wiki-'));
  t.after(() => fs.rmSync(rootPath, { recursive: true, force: true }));
  const engine = createLlmWikiKnowledgeEngine({ rootPath });
  const evidence = (id, sourceUri) => ({ id, sourceUri, excerpt: 'synthetic evidence', observedAt: '2026-07-21T00:00:00.000Z' });
  const confirmed = (id, subjectId, value, evidenceId) => ({ id, subjectId, predicate: 'education.test', value, status: 'confirmed', evidence: [evidence(evidenceId, `fixture://${subjectId}/${evidenceId}`)], synthetic: true });
  let passed = 0;

  const asset = { id: 'source-p0-synthetic', uri: 'fixture://p0/source', content: 'immutable synthetic source', synthetic: true };
  engine.importAsset(asset);
  assert.equal(engine.importAsset(asset).duplicate, true);
  assert.throws(() => engine.importAsset({ ...asset, content: 'changed' }), (error) => error.code === 'IMMUTABLE_SOURCE_CONFLICT');
  passed += 1;

  assert.throws(() => engine.upsertClaim({ id: 'claim-no-evidence', subjectId: 'student-synthetic-a', predicate: 'education.test', value: true, status: 'confirmed' }), (error) => error.code === 'CONFIRMED_WITHOUT_EVIDENCE');
  engine.upsertClaim(confirmed('claim-evidence', 'student-synthetic-a', 'evidence-required-token', 'evidence-required'));
  passed += 1;

  engine.upsertClaim(confirmed('claim-visible', 'student-synthetic-a', 'visibility-token confirmed', 'evidence-visible'));
  engine.upsertClaim({ id: 'claim-candidate', subjectId: 'student-synthetic-a', predicate: 'education.test', value: 'visibility-token candidate', status: 'candidate', evidence: [], synthetic: true });
  assert.deepEqual(engine.search('visibility-token', { subjectId: 'student-synthetic-a' }).results.map((item) => item.claim.id), ['claim-visible']);
  assert.deepEqual(engine.search('visibility-token', { subjectId: 'student-synthetic-a', statuses: ['candidate'] }).results.map((item) => item.claim.id), ['claim-candidate']);
  passed += 1;

  engine.upsertClaim(confirmed('claim-conflict-a', 'student-synthetic-a', 'conflict-token A', 'evidence-conflict-a'));
  engine.upsertClaim(confirmed('claim-conflict-b', 'student-synthetic-a', 'conflict-token B', 'evidence-conflict-b'));
  engine.upsertRelationship({ id: 'relationship-conflict', fromId: 'claim-conflict-a', toId: 'claim-conflict-b', type: 'conflicts_with' });
  assert.equal(engine.search('conflict-token', { subjectId: 'student-synthetic-a' }).results.length, 2);
  passed += 1;

  const temporal = confirmed('claim-temporal', 'student-synthetic-a', 'first revision', 'evidence-temporal-a');
  engine.upsertClaim(temporal);
  engine.upsertClaim({ ...temporal, value: 'second revision', evidence: [evidence('evidence-temporal-b', 'fixture://student-synthetic-a/revision-b')], updatedAt: '2026-07-22T00:00:00.000Z' });
  const historyDir = path.join(rootPath, '.edu-manager', 'knowledge-engine-v1', 'claim-history', temporal.id);
  assert.equal(fs.readdirSync(historyDir).filter((name) => name.endsWith('.json')).length, 1);
  passed += 1;

  engine.upsertRelationship({ id: 'relationship-project', fromId: 'student-synthetic-a', toId: 'project-synthetic-a', type: 'participates_in' });
  assert.ok(engine.exportSnapshot({ exportId: 'relationship-check' }).snapshot.relationships.some((item) => item.id === 'relationship-project'));
  passed += 1;

  engine.upsertClaim(confirmed('claim-isolation-a', 'student-synthetic-a', 'isolation-token A', 'evidence-isolation-a'));
  engine.upsertClaim(confirmed('claim-isolation-b', 'student-synthetic-b', 'isolation-token B', 'evidence-isolation-b'));
  assert.deepEqual(engine.search('isolation-token', { subjectId: 'student-synthetic-a' }).results.map((item) => item.claim.subjectId), ['student-synthetic-a']);
  assert.deepEqual(engine.search('isolation-token', { subjectId: 'student-synthetic-b' }).results.map((item) => item.claim.subjectId), ['student-synthetic-b']);
  passed += 1;

  engine.upsertClaim({ id: 'claim-sensitive', subjectId: 'student-synthetic-a', predicate: 'identity.sensitive', value: 'sensitive-token', status: 'candidate', evidence: [], synthetic: true });
  assert.equal(engine.search('sensitive-token', { subjectId: 'student-synthetic-a' }).results.length, 0);
  assert.equal(engine.search('sensitive-token', { subjectId: 'student-synthetic-a', statuses: ['candidate'] }).results.length, 1);
  passed += 1;

  engine.appendEvent({ id: 'event-correction', subjectId: 'student-synthetic-a', type: 'student_correction', synthetic: true });
  engine.appendEvent({ id: 'event-appeal', subjectId: 'student-synthetic-a', type: 'guardian_appeal', synthetic: true });
  assert.equal(engine.exportSnapshot({ exportId: 'event-check' }).snapshot.events.length, 2);
  passed += 1;

  const exported = engine.exportSnapshot({ exportId: 'portable-fallback' });
  const readOnly = createLlmWikiKnowledgeEngine({ rootPath, readOnly: true });
  assert.equal(readOnly.getClaim('claim-temporal').id, 'claim-temporal');
  assert.ok(fs.existsSync(path.join(exported.exportDir, 'README.md')));
  assert.ok(fs.existsSync(path.join(exported.exportDir, 'snapshot.json')));
  passed += 1;

  assert.equal(passed, 10);
});
