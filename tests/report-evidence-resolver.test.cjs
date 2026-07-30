const assert = require('node:assert/strict');
const test = require('node:test');
const { resolveReportEvidence, splitEvidenceSources } = require('../electron/report-evidence-resolver.cjs');

test('report evidence resolves stable IDs into concise read-only cards', () => {
  const result = resolveReportEvidence({
    content: '本周阅读更稳定。[依据:ev-1]',
    growthIndex: {
      evidence: [{
        id: 'ev-1',
        title: '阅读记录',
        content: '连续完成三次阅读摘要',
        status: 'confirmed',
        projectName: '阅读项目',
        updatedAt: '2026-07-24T00:00:00.000Z',
        sourcePath: 'D:/students/a/knowledge.md',
      }],
    },
    resolveSource: (source) => ({ available: true, location: source, title: 'knowledge.md', kind: 'file' }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.cards.length, 1);
  assert.equal(result.cards[0].evidenceId, 'ev-1');
  assert.equal(result.cards[0].sources[0].available, true);
});

test('missing or unavailable sources degrade safely without changing the report', () => {
  const missing = resolveReportEvidence({
    content: '结论。[依据:ev-missing]',
    growthIndex: { evidence: [] },
  });
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.missingIds, ['ev-missing']);

  const unavailable = resolveReportEvidence({
    content: '结论。[依据:ev-2]',
    growthIndex: { evidence: [{ id: 'ev-2', title: '证据', sourcePath: 'D:/moved.md' }] },
    resolveSource: () => ({ available: false }),
  });
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.unavailableCount, 1);
});

test('historical reports without evidence markers remain readable', () => {
  const result = resolveReportEvidence({ content: '# 历史报告\n\n旧版内容', growthIndex: { evidence: [] } });
  assert.equal(result.ok, true);
  assert.equal(result.legacy, true);
  assert.equal(result.cards.length, 0);
});

test('source lists accept URI and semicolon-separated legacy paths idempotently', () => {
  assert.deepEqual(
    splitEvidenceSources({ sourceUri: 'edu://student/a/knowledge/x.md', sourcePath: 'D:/a.md；D:/b.md;D:/a.md' }),
    ['edu://student/a/knowledge/x.md', 'D:/a.md', 'D:/b.md'],
  );
});
