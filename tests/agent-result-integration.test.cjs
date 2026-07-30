const assert = require('node:assert/strict');
const test = require('node:test');

const { normalizeProjectStudentEvidencePayload } = require('../electron/project-student-evidence-adapter.cjs');
const { parseProjectScreeningReceipt } = require('../electron/project-screening.cjs');
const { validateDigestResult } = require('../electron/digest-result.cjs');

test('student evidence adapter accepts pasted fenced output and reports partial imports', () => {
  const result = normalizeProjectStudentEvidencePayload('```json\n{"projectId":"p1","students":[{"studentId":"s1","ability":"写作","observation":"完成初稿"},{"studentId":"s2"}]}\n```');
  assert.equal(result.ok, true);
  assert.equal(result.partial, true);
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.invalidItems.length, 1);
});

test('screening parser accepts embedded JSON and structured Markdown', () => {
  assert.equal(parseProjectScreeningReceipt('结果： {"recommendations":[{"id":"one"}]} 完成').recommendations[0].id, 'one');
  const markdown = parseProjectScreeningReceipt('文件名: a.pdf\n状态: selected');
  assert.equal(Array.isArray(markdown.items), true);
});

test('digest compatibility parsing trusts a unique material id despite stale receipt hash fields', () => {
  const batch = { batchId: 'b1', scope: { type: 'project', id: 'p1' }, files: [{ materialId: 'm1', relativePath: 'a.pdf', sha1: '111' }] };
  const raw = '```json\n{"status":"completed","projectId":"p1","batchId":"b1","processedFiles":[{"materialId":"m1","filename":"a.pdf","sha1":"wrong"}]}\n```';
  const result = validateDigestResult({ batch, receipt: raw, currentFiles: batch.files, requireMaterialId: true });
  assert.equal(result.ok, true);
  assert.deepEqual(result.confirmed.map((file) => file.materialId), ['m1']);
  assert.ok(result.compatibility.matchModes.includes('materialId'));
});
