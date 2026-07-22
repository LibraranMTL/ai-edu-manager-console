const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildTargetUploadPath,
  isTerminalUploadFile,
  normalizeHostUrl,
  projectsForStudent,
  stableUploadId,
} = require('../electron/terminal-upload.cjs');

test('terminal host URL normalization accepts plain LAN addresses', () => {
  assert.equal(normalizeHostUrl('192.168.1.8:18777/'), 'http://192.168.1.8:18777');
  assert.equal(normalizeHostUrl('file:///tmp/data'), '');
});

test('terminal only exposes projects bound to the selected student', () => {
  const projects = [
    { id: 'p1', studentIds: ['s1'] },
    { id: 'p2', studentIds: ['s2', 's3'] },
  ];
  assert.deepEqual(projectsForStudent(projects, 's1').map((item) => item.id), ['p1']);
});

test('terminal target path carries student, project and provenance metadata', () => {
  const result = buildTargetUploadPath(
    { type: 'project', id: 'project 1', studentId: 'student 1' },
    '课堂 笔记.pdf',
    { uploadId: 'u-1', sourceType: 'windows_terminal_auto_folder', captureSessionId: 'c-1' },
  );
  assert.match(result, /^\/api\/projects\/project%201\/materials\?/);
  assert.match(result, /studentId=student\+1/);
  assert.match(result, /uploadId=u-1/);
  assert.match(result, /captureSessionId=c-1/);
});

test('automatic delivery IDs are stable per file revision and target', () => {
  const file = { path: 'D:/drop/a.pdf', size: 12, mtimeMs: 34 };
  const target = { type: 'student', id: 's1' };
  assert.equal(stableUploadId(file, target), stableUploadId(file, target));
  assert.notEqual(stableUploadId(file, target), stableUploadId({ ...file, size: 13 }, target));
  assert.equal(isTerminalUploadFile(file.path), true);
  assert.equal(isTerminalUploadFile('D:/drop/a.exe'), false);
});
