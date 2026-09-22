const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { supplementCompletedDigestLearningEvents } = require('../electron/completed-digest-learning-events.cjs');
const { eventsPath } = require('../electron/learning-analytics.cjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-completed-digest-events-'));
  const rawRoot = path.join(root, 'raw');
  fs.mkdirSync(rawRoot);
  const hashFile = (file) => {
    try { return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex'); }
    catch { return ''; }
  };
  const files = ['one.jpg', 'two.jpg'].map((relativePath, index) => {
    fs.writeFileSync(path.join(rawRoot, relativePath), `original-${index}`);
    return { materialId: `material-${index + 1}`, relativePath, sha1: hashFile(path.join(rawRoot, relativePath)) };
  });
  const batch = { batchId: 'batch-1', scope: { type: 'student', id: 'student-1' }, status: 'completed', files };
  const materials = files.map((file) => ({ id: file.materialId, studentId: 'student-1', status: 'processed',
    digestBatchId: 'batch-1', sha1: file.sha1 }));
  const receipt = { batchId: 'batch-1', studentId: 'student-1', status: 'completed',
    processed: files.map((file) => file.materialId), learningEvents: [{
      studentId: 'student-1', knowledgePoint: 'stationary point', occurredAt: '2026-09-20T22:00:00+08:00',
      taskType: 'practice_problem', performance: { conceptualUnderstanding: 2 },
      evidenceRefs: [{ sourceType: 'digest_material', sourceId: 'material-1' }],
    }] };
  return { root, studentRootPath: root, rawRoot, hashFile, studentId: 'student-1', batch, materials, receipt };
}

test('completed batch supplements validated learning events once without changing material states', () => {
  const input = fixture();
  try {
    const preview = supplementCompletedDigestLearningEvents({ ...input, dryRun: true });
    assert.equal(preview.validCandidateCount, 1);
    assert.equal(fs.existsSync(eventsPath(input.root)), false);
    const first = supplementCompletedDigestLearningEvents(input);
    assert.equal(first.ok, true);
    assert.equal(first.accepted, 1);
    assert.equal(first.materialCount, 2);
    assert.equal(input.materials.every((item) => item.status === 'processed'), true);
    const second = supplementCompletedDigestLearningEvents(input);
    assert.equal(second.ok, true);
    assert.equal(second.accepted, 0);
    assert.equal(JSON.parse(fs.readFileSync(eventsPath(input.root), 'utf8')).events.length, 1);
  } finally { fs.rmSync(input.root, { recursive: true, force: true }); }
});

test('completed batch supplement rejects a different student or batch receipt', () => {
  const input = fixture();
  try {
    assert.equal(supplementCompletedDigestLearningEvents({ ...input, receipt: { ...input.receipt, studentId: 'student-2' } }).code, 'receipt_scope_mismatch');
    assert.equal(supplementCompletedDigestLearningEvents({ ...input, receipt: { ...input.receipt, batchId: 'batch-2' } }).code, 'receipt_scope_mismatch');
    assert.equal(supplementCompletedDigestLearningEvents({ ...input, batch: { ...input.batch, status: 'digesting' } }).code, 'completed_batch_required');
    assert.equal(fs.existsSync(eventsPath(input.root)), false);
  } finally { fs.rmSync(input.root, { recursive: true, force: true }); }
});

test('completed batch supplement rejects stale materials and changed source bytes', () => {
  const input = fixture();
  try {
    assert.equal(supplementCompletedDigestLearningEvents({ ...input, materials: input.materials.map((item) => ({ ...item, status: 'pending_digest' })) }).code, 'material_state_mismatch');
    fs.writeFileSync(path.join(input.rawRoot, 'one.jpg'), 'changed');
    assert.equal(supplementCompletedDigestLearningEvents(input).code, 'source_file_changed');
    assert.equal(fs.existsSync(eventsPath(input.root)), false);
  } finally { fs.rmSync(input.root, { recursive: true, force: true }); }
});

test('completed batch supplement rejects out-of-batch evidence before creating a ledger', () => {
  const input = fixture();
  try {
    input.receipt.learningEvents[0].evidenceRefs = [{ sourceType: 'digest_material', sourceId: 'other-material' }];
    const result = supplementCompletedDigestLearningEvents(input);
    assert.equal(result.code, 'no_valid_learning_events');
    assert.equal(result.rejected[0].code, 'evidence_ref_unauthorized');
    assert.equal(fs.existsSync(eventsPath(input.root)), false);
  } finally { fs.rmSync(input.root, { recursive: true, force: true }); }
});

test('completed batch supplement is reachable from the licensed Windows console bridge', () => {
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8');
  const ui = fs.readFileSync(path.join(__dirname, '../src/main.tsx'), 'utf8');
  const card = fs.readFileSync(path.join(__dirname, '../src/DigestStatusCard.tsx'), 'utf8');
  assert.match(main, /ipcMain\.handle\('bridge:supplementCompletedStudentDigestLearningEvents'[\s\S]*?licensedInvoke\('已完成批次学习事件补录'/);
  assert.match(preload, /supplementCompletedStudentDigestLearningEvents\(studentId\)[\s\S]*?ipcRenderer\.invoke\('bridge:supplementCompletedStudentDigestLearningEvents'/);
  assert.match(ui, /onSupplementLearningEvents=\{isWindows \?/);
  assert.match(card, /status\.userStatus === 'completed' && onSupplementLearningEvents/);
});
