const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');
const mainProcess = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');

test('desktop uses a single instance to prevent cross-version state races', () => {
  assert.match(mainProcess, /app\.requestSingleInstanceLock\(\)/);
  assert.match(mainProcess, /app\.on\('second-instance'/);
  assert.match(mainProcess, /mainWindow\.focus\(\)/);
});

test('Windows student index is restored into the current renderer immediately', () => {
  assert.match(mainProcess, /function getStudentsIndex\(\)/);
  assert.match(preload, /getStudents\(\)/);
  assert.match(renderer, /bridge\(\)\?\.getStudents\?\.\(\)/);
  assert.match(mainProcess, /studentRecords: restoredStudentRecords/);
  assert.match(renderer, /normalizeStudents\(result\.studentRecords\)/);
  assert.match(renderer, /refreshAssets\(\)/);
  assert.match(renderer, /refreshProjects\(\)/);
});

test('host backups receive complete renderer student records', () => {
  assert.match(renderer, /backupHostData\?\.\(JSON\.stringify\(students\)\)/);
  assert.match(mainProcess, /function backupHostData\(studentsJson\)/);
  assert.match(mainProcess, /backupStudents = parsedStudents/);
  assert.match(mainProcess, /return \{\s*\.\.\.student,/);
});

test('host restore rebases managed paths onto the current machine storage root', () => {
  assert.match(mainProcess, /parsed\.storage\?\.studentBaseDir/);
  assert.match(mainProcess, /remapStorageTree\(/);
  assert.match(mainProcess, /const restoredSettings = remapValue\(parsed\.settings\)/);
  assert.match(mainProcess, /studentBaseDir: currentStudentBaseDir/);
  assert.match(mainProcess, /studentRecords: restoredStudentRecords/);
  assert.match(mainProcess, /pathRemap:/);
  assert.match(renderer, /result\.message \|\| `已从备份恢复：\$\{result\.path\}`/);
});
