const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');

test('student archive collaboration requires one-to-one id mapping and never falls back by name', () => {
  assert.match(main, /localAssignments\.length !== 1 \|\| allLocalStudentAssignments\.length !== 1/);
  assert.match(main, /peerStudentIds\.length !== 1/);
  const ingestStart = main.indexOf('function ingestImportedStudentArchives()');
  const ingestEnd = main.indexOf('function scanCollaborationInbox()', ingestStart);
  const ingest = main.slice(ingestStart, ingestEnd);
  assert.match(ingest, /findStudentByKey\(publication\.targetStudentId\)/);
  assert.doesNotMatch(ingest, /sourceStudentName[\s\S]*?matches/);
  assert.match(ingest, /validateExistingBinding\(\{[\s\S]*?rootPath: normalized\.rootPath/);
});

test('student archive collaboration can be paused and manually synchronized per student', () => {
  assert.match(main, /function setStudentArchiveSyncEnabled\(studentId, enabled\)/);
  assert.match(main, /function studentArchiveSyncStatus\(state = readCollaborationState\(\)\)/);
  assert.match(main, /bridge:setStudentArchiveSyncEnabled/);
  assert.match(main, /bridge:syncStudentArchiveNow/);
  assert.match(preload, /setStudentArchiveSyncEnabled\(studentId, enabled\)/);
  assert.match(preload, /syncStudentArchiveNow\(studentId\)/);
  assert.match(ui, /跨主机档案同步/);
  assert.match(ui, /原始资料与草稿不会同步/);
});
