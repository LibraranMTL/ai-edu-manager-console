const assert = require('node:assert/strict');
const test = require('node:test');

const { createGbrainEvaluationAdapter } = require('../electron/gbrain-evaluation-adapter.cjs');

function transportRecorder() {
  const calls = [];
  return {
    calls,
    execute(operation, payload) {
      calls.push({ operation, payload });
      if (operation === 'get_page') return null;
      if (operation === 'search') return [];
      return { ok: true, operation, payload };
    },
  };
}

test('GBrain P0 adapter blocks non-synthetic writes before transport execution', () => {
  const transport = transportRecorder();
  const engine = createGbrainEvaluationAdapter({ transport });
  assert.throws(
    () => engine.importAsset({ id: 'source-real-001', uri: 'file:///student/private.md', content: '真实资料' }),
    (error) => error.code === 'REAL_DATA_BLOCKED',
  );
  assert.throws(
    () => engine.upsertClaim({ id: 'claim-real-001', subjectId: 'student-real', predicate: 'score', value: 99 }),
    (error) => error.code === 'REAL_DATA_BLOCKED',
  );
  assert.equal(transport.calls.length, 0);
});

test('GBrain P0 adapter scopes every operation to the isolated evaluation namespace', () => {
  const transport = transportRecorder();
  const engine = createGbrainEvaluationAdapter({ transport, namespace: 'edu-synthetic-eval-20260721', engineVersion: 'reference-current' });
  engine.health();
  engine.importAsset({ id: 'source-synthetic-001', uri: 'fixture://student-a/observation', content: '虚构观察', synthetic: true });
  engine.upsertClaim({
    id: 'claim-synthetic-001',
    subjectId: 'student-synthetic-a',
    predicate: 'completed_fixture_task',
    value: true,
    status: 'candidate',
    synthetic: true,
  });
  engine.search('虚构观察', { subjectId: 'student-synthetic-a' });
  engine.appendEvent({ id: 'event-synthetic-001', type: 'fixture_event', synthetic: true });
  engine.upsertRelationship({
    id: 'rel-synthetic-001',
    fromId: 'claim-synthetic-001',
    toId: 'source-synthetic-001',
    fromSlug: 'edu-synthetic-eval-20260721/claims/claim-synthetic-001',
    toSlug: 'edu-synthetic-eval-20260721/sources/source-synthetic-001',
    type: 'supported_by',
    synthetic: true,
  });
  engine.exportSnapshot({ exportId: 'eval-export-001' });

  assert.ok(transport.calls.length >= 9);
  assert.ok(transport.calls.every((call) => call.payload.namespace === 'edu-synthetic-eval-20260721'));
  assert.equal(transport.calls.find((call) => call.operation === 'search').payload.filters.pathPrefix, 'edu-synthetic-eval-20260721/claims/');
  assert.ok(transport.calls.some((call) => call.operation === 'append_event'));
  assert.ok(transport.calls.some((call) => call.operation === 'upsert_relationship'));
  assert.ok(transport.calls.filter((call) => call.operation === 'capture').every((call) => call.payload.slug.startsWith('edu-synthetic-eval-20260721/')));
});

test('GBrain P0 adapter rejects namespaces and relationship endpoints outside synthetic scope', () => {
  const transport = transportRecorder();
  assert.throws(
    () => createGbrainEvaluationAdapter({ transport, namespace: 'production-students' }),
    (error) => error.code === 'UNSAFE_NAMESPACE',
  );
  const engine = createGbrainEvaluationAdapter({ transport, namespace: 'edu-synthetic-eval-20260721' });
  assert.throws(
    () => engine.upsertRelationship({
      id: 'rel-synthetic-002',
      fromId: 'claim-synthetic-001',
      toId: 'source-synthetic-001',
      fromSlug: 'production/claims/claim-synthetic-001',
      toSlug: 'edu-synthetic-eval-20260721/sources/source-synthetic-001',
      type: 'supported_by',
      synthetic: true,
    }),
    (error) => error.code === 'CROSS_NAMESPACE_REFERENCE',
  );
});
