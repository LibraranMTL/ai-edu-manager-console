const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { markUploadRecordsRemoved } = require('../electron/upload-record-governance.cjs');

test('removing a new upload record keeps the physical file and audit fields', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-upload-remove-'));
  const source = path.join(root, '数学练习.pdf');
  fs.writeFileSync(source, 'synthetic material', 'utf8');
  try {
    const result = markUploadRecordsRemoved([
      { id: 'upload-1', studentId: 'student-1', filename: '数学练习.pdf', path: source, status: 'pending_digest' },
    ], { studentId: 'student-1', recordIds: ['upload-1'], removedAt: '2026-07-22T08:00:00.000Z' });
    assert.equal(result.removed.length, 1);
    assert.equal(result.records[0].status, 'removed');
    assert.equal(result.records[0].removalMode, 'record_only');
    assert.equal(fs.existsSync(source), true);
    assert.equal(fs.readFileSync(source, 'utf8'), 'synthetic material');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('submitted, digesting and processed records cannot be removed from the audit chain', () => {
  const records = ['submitted', 'digesting', 'processed'].map((status, index) => ({ id: `upload-${index}`, studentId: 'student-1', status }));
  const result = markUploadRecordsRemoved(records, { studentId: 'student-1', recordIds: records.map((record) => record.id) });
  assert.equal(result.removed.length, 0);
  assert.equal(result.blocked.length, 3);
  assert.deepEqual(result.records.map((record) => record.status), ['submitted', 'digesting', 'processed']);
});

test('material record removal is connected across main, preload and renderer', () => {
  const root = path.resolve(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');
  assert.match(main, /bridge:removeMaterialImportRecords/);
  assert.match(preload, /removeMaterialImportRecords\(studentId, recordIdsJson\)/);
  assert.match(ui, /从列表移除/);
  assert.match(ui, /物理文件和文件资产都会保留/);
});
