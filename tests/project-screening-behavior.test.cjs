const assert = require('node:assert/strict');
const test = require('node:test');

const {
  PROJECT_SCREENING_PARSER_VERSION,
  buildProjectScreeningPreview,
  parseProjectScreeningReceipt,
} = require('../electron/project-screening.cjs');

test('Agent screening accepts JSON and fenced Markdown without mutating the project', () => {
  const project = {
    id: 'project-1',
    name: '物理研究',
    stagingItems: [{ id: 'staging-1', filename: '实验数据.xlsx', path: 'D:/work/实验数据.xlsx', sha1: 'abc', status: 'collected', sourceStrategy: 'reference_only' }],
  };
  const before = JSON.stringify(project);
  const raw = '说明文字\n```json\n{"recommendations":[{"id":"staging-1","status":"selected","saveStrategy":"full_copy","reason":"核心实验数据"}]}\n```';
  const preview = buildProjectScreeningPreview(project, raw);
  assert.equal(preview.parserVersion, PROJECT_SCREENING_PARSER_VERSION);
  assert.equal(preview.parsedCount, 1);
  assert.equal(preview.matchedCount, 1);
  assert.equal(preview.unmatchedCount, 0);
  assert.equal(preview.changes[0].matchBasis, 'id');
  assert.equal(preview.changes[0].toStatus, 'selected');
  assert.equal(preview.changes[0].toStrategy, 'full_copy');
  assert.equal(JSON.stringify(project), before);
  assert.deepEqual(parseProjectScreeningReceipt('[{"id":"staging-1"}]'), [{ id: 'staging-1' }]);
});

test('screening preview reports unmatched and duplicate recommendations explicitly', () => {
  const preview = buildProjectScreeningPreview({
    id: 'project-2',
    stagingItems: [{ id: 'one', filename: '资料.pdf', path: 'D:/资料.pdf', sha1: 'hash-1', status: 'screened' }],
  }, JSON.stringify({ recommendations: [
    { sha1: 'hash-1', status: 'selected' },
    { filename: '资料.pdf', status: 'discarded' },
    { filename: '不存在.pdf', status: 'discarded' },
  ] }));
  assert.equal(preview.matchedCount, 1);
  assert.equal(preview.unmatchedCount, 2);
  assert.match(preview.unmatched[0].reason, /重复匹配/);
  assert.match(preview.unmatched[1].reason, /未匹配/);
});
