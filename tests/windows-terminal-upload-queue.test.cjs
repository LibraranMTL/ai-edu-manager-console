const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  publicTerminalUploadQueue,
  readTerminalUploadQueue,
  recoverTerminalUploadQueue,
  sha256File,
  stageTerminalUpload,
  terminalUploadAcknowledgement,
  terminalUploadNextAction,
  verifyTerminalStagedCopy,
  writeTerminalUploadQueue,
} = require('../electron/terminal-upload.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-windows-upload-queue-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return {
    root,
    source: path.join(root, '课堂笔记.txt'),
    queuePath: path.join(root, 'terminal-upload-queue.json'),
    stagingDir: path.join(root, 'terminal-upload-staging'),
  };
}

function stageOptions(f, overrides = {}) {
  return {
    sourcePath: f.source,
    queuePath: f.queuePath,
    stagingDir: f.stagingDir,
    target: { type: 'project', id: 'project-1', studentId: 'student-1', name: '测试项目' },
    hostId: 'host-1',
    dataGeneration: 'generation-1',
    hostUrl: 'http://127.0.0.1:18777',
    deviceId: 'terminal-1',
    studentId: 'student-1',
    uploadId: 'upload-1',
    sourceType: 'windows_terminal_file',
    now: '2026-09-30T00:00:00.000Z',
    ...overrides,
  };
}

test('Windows terminal stages immutable bytes and persists the fixed host, generation and target', (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.source, 'first revision', 'utf8');
  const item = stageTerminalUpload(stageOptions(f));
  assert.equal(item.state, 'queued');
  assert.equal(item.hostId, 'host-1');
  assert.equal(item.dataGeneration, 'generation-1');
  assert.equal(item.target.id, 'project-1');
  assert.equal(item.studentId, 'student-1');
  assert.equal(fs.readFileSync(item.stagingPath, 'utf8'), 'first revision');
  assert.equal(item.sha256, sha256File(item.stagingPath));

  fs.writeFileSync(f.source, 'second revision', 'utf8');
  assert.equal(fs.readFileSync(item.stagingPath, 'utf8'), 'first revision', 'later source edits must not change queued bytes');
  const persisted = readTerminalUploadQueue(f.queuePath).items[0];
  assert.equal(persisted.sha256, item.sha256);
  assert.equal(persisted.stagingPath, item.stagingPath);
});

test('restart changes an in-flight upload to receipt_unknown and keeps its only staged copy', (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.source, 'stable bytes', 'utf8');
  const item = stageTerminalUpload(stageOptions(f));
  const queue = readTerminalUploadQueue(f.queuePath);
  queue.items[0] = { ...queue.items[0], state: 'uploading', attempt: 1 };
  writeTerminalUploadQueue(f.queuePath, queue, '2026-09-30T00:01:00.000Z');

  const recovered = recoverTerminalUploadQueue(f.queuePath, '2026-09-30T00:02:00.000Z');
  assert.equal(recovered.items[0].state, 'receipt_unknown');
  assert.equal(recovered.items[0].pauseCode, 'restart_receipt_check');
  assert.equal(fs.existsSync(item.stagingPath), true);
  assert.equal(fs.readFileSync(item.stagingPath, 'utf8'), 'stable bytes');
});

test('staged bytes are checked by size and SHA-256 before every send decision', (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.source, 'stable bytes', 'utf8');
  const item = stageTerminalUpload(stageOptions(f));
  assert.deepEqual(verifyTerminalStagedCopy(item), { ok: true, code: 'verified' });
  fs.writeFileSync(item.stagingPath, 'changed bytes', 'utf8');
  assert.equal(verifyTerminalStagedCopy(item).code, 'staging_copy_changed');
  assert.equal(fs.existsSync(item.stagingPath), true, 'tampered copy remains for diagnosis and is not silently deleted');
});

test('incomplete legacy queue records remain visible and paused instead of being silently discarded', (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.queuePath, JSON.stringify({ version: 1, items: [
    { id: 'old-1', state: 'queued', filename: '旧资料.pdf', path: 'D:\\old\\only-copy.pdf' },
  ] }), 'utf8');
  const queue = readTerminalUploadQueue(f.queuePath);
  assert.equal(queue.items.length, 1);
  assert.equal(queue.items[0].state, 'receipt_unknown');
  assert.equal(queue.items[0].pauseCode, 'legacy_queue_incomplete');
  assert.ok(queue.items[0].migrationIssues.includes('hostId'));
  assert.ok(queue.items[0].migrationIssues.includes('dataGeneration'));
  const visible = publicTerminalUploadQueue(queue);
  assert.equal(visible.items[0].filename, '旧资料.pdf');
  assert.equal(JSON.stringify(visible).includes('D:\\old'), false, 'renderer projection must not expose local staging paths');
});

test('corrupt queue metadata is backed up and orphan stable copies stay visible but never auto replay', (t) => {
  const f = fixture(t);
  fs.mkdirSync(f.stagingDir, { recursive: true });
  const orphanPath = path.join(f.stagingDir, 'queue-crash-copy.pdf');
  fs.writeFileSync(orphanPath, 'only stable bytes', 'utf8');
  fs.writeFileSync(f.queuePath, '{not valid json', 'utf8');

  const recovered = recoverTerminalUploadQueue(f.queuePath, '2026-09-30T00:03:00.000Z', {
    stagingDir: f.stagingDir,
  });
  const corruption = recovered.items.find((item) => item.pauseCode === 'queue_metadata_corrupt');
  const orphan = recovered.items.find((item) => item.pauseCode === 'orphan_staging_copy');
  assert.ok(corruption, 'metadata corruption remains visible');
  assert.ok(orphan, 'orphan stable copy is recovered into a paused record');
  assert.equal(orphan.state, 'receipt_unknown');
  assert.equal(orphan.size, Buffer.byteLength('only stable bytes'));
  assert.equal(orphan.sha256, sha256File(orphanPath));
  assert.equal(fs.existsSync(orphanPath), true);
  assert.ok(recovered.corruptionBackup);
  assert.equal(fs.readFileSync(recovered.corruptionBackup, 'utf8'), '{not valid json');
  const publicQueue = publicTerminalUploadQueue(recovered);
  assert.equal(JSON.stringify(publicQueue).includes(f.stagingDir), false, 'renderer never receives recovery paths');
  assert.equal(terminalUploadNextAction(orphan, { hostId: 'host-1', dataGeneration: 'generation-1' }).action,
    'pause');
});

function strictItem() {
  return {
    state: 'receipt_unknown', attempt: 1, hostId: 'host-1', dataGeneration: 'generation-1',
    studentId: 'student-1', target: { type: 'project', id: 'project-1', studentId: 'student-1' },
    uploadId: 'upload-1', size: 12, sha256: 'a'.repeat(64),
  };
}

function strictReceipt(overrides = {}) {
  const base = {
    status: 'received_verified', receiptStatus: 'received_verified',
    hostId: 'host-1', dataGeneration: 'generation-1',
    targetType: 'project', targetId: 'project-1', studentId: 'student-1',
    uploadId: 'upload-1', receiptId: 'upload-1',
    receipt: { size: 12, sha256: 'a'.repeat(64), receivedAt: '2026-09-30T00:00:00.000Z' },
  };
  return { ...base, ...overrides, receipt: { ...base.receipt, ...(overrides.receipt || {}) } };
}

test('new upload protocol only settles a complete matching per-file acknowledgement', () => {
  const item = strictItem();
  const upload = strictReceipt();
  delete upload.status;
  assert.equal(terminalUploadAcknowledgement(item, upload, { source: 'upload' }).ok, true);

  const missingHost = strictReceipt({ hostId: '' });
  assert.equal(terminalUploadAcknowledgement(item, missingHost, { source: 'upload' }).code, 'receipt_host_missing');
  const wrongStudent = strictReceipt({ studentId: 'student-2' });
  assert.equal(terminalUploadAcknowledgement(item, wrongStudent, { source: 'upload' }).code, 'receipt_student_mismatch');
  const wrongId = strictReceipt({ uploadId: 'other-upload', receiptId: 'other-upload' });
  assert.equal(terminalUploadAcknowledgement(item, wrongId, { source: 'upload' }).code, 'receipt_identifier_mismatch');
  const wrongBytes = strictReceipt({ receipt: { size: 12, sha256: 'b'.repeat(64) } });
  assert.equal(terminalUploadAcknowledgement(item, wrongBytes, { source: 'upload' }).code, 'receipt_sha256_mismatch');

  const arbitrary2xxBody = terminalUploadAcknowledgement(item, { ok: true }, { source: 'upload' });
  assert.equal(arbitrary2xxBody.ok, false);
  assert.equal(arbitrary2xxBody.code, 'legacy_upload_result_unverifiable');
});

test('receipt decision never replays to another host, generation or incomplete receipt scope', () => {
  const item = {
    state: 'receipt_unknown', attempt: 1, hostId: 'host-1', dataGeneration: 'generation-1',
    studentId: 'student-1', target: { type: 'project', id: 'project-1', studentId: 'student-1' },
    uploadId: 'upload-1', size: 12, sha256: 'a'.repeat(64),
  };
  const notFound = {
    status: 'not_found', hostId: 'host-1', dataGeneration: 'generation-1',
    targetType: 'project', targetId: 'project-1', studentId: 'student-1',
    uploadId: 'upload-1', receiptId: 'upload-1',
  };
  assert.deepEqual(terminalUploadNextAction(item, { hostId: 'host-2', dataGeneration: 'generation-1' }, null),
    { action: 'pause', code: 'host_identity_changed' });
  assert.deepEqual(terminalUploadNextAction(item, { hostId: 'host-1', dataGeneration: 'generation-2' }, {
    ...notFound, dataGeneration: 'generation-2',
  }),
    { action: 'pause', code: 'host_data_generation_changed' }, 'not_found from a new generation must not trigger replay');
  assert.deepEqual(terminalUploadNextAction(item, { hostId: 'host-1', dataGeneration: 'generation-1' }, notFound),
    { action: 'upload', code: 'receipt_not_found' });
  const missingStudent = { ...notFound };
  delete missingStudent.studentId;
  assert.deepEqual(terminalUploadNextAction(item, { hostId: 'host-1', dataGeneration: 'generation-2' }, {
    ...strictReceipt(), dataGeneration: 'generation-2',
  }), { action: 'pause', code: 'host_data_generation_changed' }, 'a different generation cannot settle the old item');
  assert.deepEqual(terminalUploadNextAction(item, { hostId: 'host-1', dataGeneration: 'generation-1' }, missingStudent),
    { action: 'wait', code: 'receipt_student_missing' }, 'incomplete not_found cannot authorize retransmission');
  assert.deepEqual(terminalUploadNextAction(item, { hostId: 'host-1', dataGeneration: 'generation-1' }, strictReceipt()),
    { action: 'received', code: 'received_verified' });
});

test('Windows terminal queue wiring hashes staged bytes, sends generation, queries receipts and exposes no delete path', () => {
  const main = fs.readFileSync(path.join(__dirname, '../electron/terminal-main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '../electron/terminal-preload.cjs'), 'utf8');
  const ui = fs.readFileSync(path.join(__dirname, '../src/terminal-main.tsx'), 'utf8');
  assert.match(main, /terminal-upload-queue\.json/);
  assert.match(main, /terminal-upload-staging/);
  assert.match(main, /'X-Edu-Content-Sha256'/);
  assert.match(main, /'X-Edu-Data-Generation'/);
  assert.match(main, /verifyQueuedUploadReceipt/);
  assert.match(main, /verifyTerminalStagedCopy\(item\)/);
  assert.match(main, /terminalUploadNextAction/);
  assert.doesNotMatch(main, /receiptStatus \|\| 'received_verified'/);
  assert.doesNotMatch(main, /terminal:delete-upload|terminal:clear-upload/);
  assert.match(preload, /getUploadQueue/);
  assert.match(preload, /onUploadQueueChanged/);
  assert.match(ui, /资料上传记录/);
  assert.match(ui, /旧记录已停止自动重放/);
});
