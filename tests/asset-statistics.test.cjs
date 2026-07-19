const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeAssetReferences, recentAssetTrend } = require('../electron/asset-statistics.cjs');

test('recentAssetTrend counts assets and references by local calendar day', () => {
  const trend = recentAssetTrend([
    {
      uploadedAt: '2026-07-19T08:00:00+08:00',
      references: [
        { linkedAt: '2026-07-18T10:00:00+08:00' },
        { linkedAt: '2026-07-19T11:00:00+08:00' },
      ],
    },
    {
      uploadedAt: '2026-07-17T12:00:00+08:00',
      references: [{ linkedAt: '2026-07-19T12:00:00+08:00' }],
    },
    {
      uploadedAt: '2026-07-01T12:00:00+08:00',
      references: [{ linkedAt: '2026-07-01T12:00:00+08:00' }],
    },
  ], new Date('2026-07-19T18:00:00+08:00'));

  assert.equal(trend.days.length, 7);
  assert.equal(trend.addedTotal, 2);
  assert.equal(trend.referenceTotal, 3);
  assert.deepEqual(trend.days.slice(-3).map((day) => [day.date, day.added, day.references]), [
    ['2026-07-17', 1, 0],
    ['2026-07-18', 0, 1],
    ['2026-07-19', 1, 2],
  ]);
});

test('recentAssetTrend reports records without usable timestamps', () => {
  const trend = recentAssetTrend([
    { references: [{}, { linkedAt: 'not-a-date' }] },
  ], new Date('2026-07-19T18:00:00+08:00'));

  assert.equal(trend.undatedAssets, 1);
  assert.equal(trend.undatedReferences, 2);
  assert.equal(trend.addedTotal, 0);
  assert.equal(trend.referenceTotal, 0);
});

test('mergeAssetReferences preserves the first linked time when rebuilding the index', () => {
  const references = mergeAssetReferences([
    { spaceType: 'student', spaceId: 's1', role: 'raw', path: 'A.pdf', linkedAt: '2026-07-13T08:00:00.000Z', source: '首次导入' },
    { spaceType: 'student', spaceId: 's1', role: 'raw', path: 'A.pdf', linkedAt: '2026-07-19T08:00:00.000Z', source: '索引重建' },
  ]);

  assert.equal(references.length, 1);
  assert.equal(references[0].linkedAt, '2026-07-13T08:00:00.000Z');
  assert.equal(references[0].source, '索引重建');
});
