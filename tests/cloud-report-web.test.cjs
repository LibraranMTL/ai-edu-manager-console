const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('PDF preview uses an authenticated PDF Blob and a compatible native reader with download fallback', () => {
  const source = fs.readFileSync(path.join(__dirname, '../cloud-report-web/src/main.tsx'), 'utf8');
  assert.match(source, /const response = await api\(route\)/);
  assert.match(source, /showPreview && blob.type === 'application\/pdf'/);
  assert.match(source, /setPdfUrl\(URL.createObjectURL\(blob\)\)/);
  assert.match(source, /URL.revokeObjectURL\(pdfUrl\)/);
  const frame = source.match(/<iframe\b[^>]*title="PDF 只读预览"[^>]*\/>/)[0];
  assert.match(frame, /src=\{pdfUrl\}/);
  assert.match(frame, /referrerPolicy="no-referrer"/);
  assert.doesNotMatch(frame, /sandbox=/);
  assert.match(source, /若设备不支持预览/);
});
