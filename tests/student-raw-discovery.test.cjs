const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { discoverStudentRawMaterials, isTransientFile } = require('../electron/student-raw-discovery.cjs');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'edu-raw-discovery-'));
}

test('discovers a directly copied stable file exactly once', () => {
  const root = tempRoot();
  const file = path.join(root, '学习记录.md');
  fs.writeFileSync(file, '本周完成了二位数除法。', 'utf8');
  const nowMs = Date.now() + 5000;
  const first = discoverStudentRawMaterials({
    studentId: 'student-1',
    rawRoot: root,
    isAllowedFile: (name) => name.endsWith('.md'),
    nowMs,
  });
  assert.equal(first.discovered.length, 1);
  assert.equal(first.discovered[0].sourceType, 'filesystem_discovery');
  assert.equal(first.discovered[0].status, 'pending_digest');

  const second = discoverStudentRawMaterials({
    studentId: 'student-1',
    rawRoot: root,
    existingMaterials: first.discovered.map((item) => ({ ...item, status: 'processed' })),
    previousState: first.state,
    isAllowedFile: (name) => name.endsWith('.md'),
    nowMs: nowMs + 5000,
  });
  assert.equal(second.discovered.length, 0);
});

test('same path with changed content becomes a new revision', () => {
  const root = tempRoot();
  const file = path.join(root, '进展.md');
  fs.writeFileSync(file, '第一版', 'utf8');
  const first = discoverStudentRawMaterials({
    studentId: 'student-2',
    rawRoot: root,
    nowMs: Date.now() + 5000,
  });
  fs.writeFileSync(file, '第二版，补充了新内容', 'utf8');
  const second = discoverStudentRawMaterials({
    studentId: 'student-2',
    rawRoot: root,
    existingMaterials: first.discovered.map((item) => ({ ...item, status: 'processed' })),
    previousState: first.state,
    nowMs: Date.now() + 10000,
  });
  assert.equal(second.discovered.length, 1);
  assert.equal(second.discovered[0].revisionOf, first.discovered[0].id);
  assert.notEqual(second.discovered[0].sha1, first.discovered[0].sha1);
});

test('ignores manager, hidden, temporary, empty and incomplete files', () => {
  const root = tempRoot();
  fs.mkdirSync(path.join(root, '.edu-manager'));
  fs.writeFileSync(path.join(root, '.edu-manager', 'materials.json'), '{}');
  fs.writeFileSync(path.join(root, '~$编辑中.docx'), 'temp');
  fs.writeFileSync(path.join(root, '下载中.pdf.part'), 'temp');
  fs.writeFileSync(path.join(root, '空文件.md'), '');
  fs.writeFileSync(path.join(root, '刚写入.md'), 'unstable');
  const result = discoverStudentRawMaterials({
    studentId: 'student-3',
    rawRoot: root,
    nowMs: Date.now(),
  });
  assert.equal(result.discovered.length, 0);
  assert.equal(isTransientFile('x.crdownload'), true);
});

test('uses a bounded incremental window for large directories', () => {
  const root = tempRoot();
  for (let index = 0; index < 20; index += 1) {
    fs.writeFileSync(path.join(root, `${String(index).padStart(2, '0')}.md`), `资料-${index}`, 'utf8');
  }
  const first = discoverStudentRawMaterials({
    studentId: 'student-4',
    rawRoot: root,
    maxFilesPerRun: 5,
    nowMs: Date.now() + 5000,
  });
  assert.equal(first.discovered.length, 5);
  assert.equal(first.remaining, 15);
  assert.equal(first.state.cursor, 5);
});
