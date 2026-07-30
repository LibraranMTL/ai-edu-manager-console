const assert = require('assert');
const test = require('node:test');

const { duplicateKnowledgeRawFiles } = require('../electron/project-publication-reconciliation.cjs');

test('selects historical knowledge copies from raw materials without touching authoritative raw files', () => {
  const rawFiles = [
    { path: 'raw/source.md', sha256: 'raw-hash' },
    { path: 'raw/summary.md', sha256: 'knowledge-hash' },
    { path: 'raw/summary-conflict.md', sha256: 'knowledge-hash' },
    { path: 'raw/local.md', sha256: 'local-hash' },
  ];
  const selected = duplicateKnowledgeRawFiles({
    rawFiles,
    verifiedKnowledgeFiles: [{ path: 'knowledge/summary.md', sha256: 'knowledge-hash' }],
    authoritativeRawHashes: ['raw-hash'],
  });
  assert.deepEqual(selected.map((item) => item.path), ['raw/summary.md', 'raw/summary-conflict.md']);
});

test('keeps a file when the sender publication declares the same content as raw material', () => {
  const selected = duplicateKnowledgeRawFiles({
    rawFiles: [{ path: 'raw/source.md', sha256: 'same-hash' }],
    verifiedKnowledgeFiles: [{ path: 'knowledge/source.md', sha256: 'same-hash' }],
    authoritativeRawHashes: ['same-hash'],
  });
  assert.equal(selected.length, 0);
});
