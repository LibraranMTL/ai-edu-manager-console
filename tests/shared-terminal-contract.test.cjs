const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const host = read('electron', 'main.cjs');
const android = read('android-tablet-terminal', 'src', 'com', 'qxmatrix', 'eduterminal', 'MainActivity.java');
const terminalMain = read('electron', 'terminal-main.cjs');
const terminalUi = read('src', 'terminal-main.tsx');
const hostUi = read('src', 'main.tsx');

test('host scopes shared-terminal data routes to the active student session', () => {
  assert.match(host, /studentSessions = new Map\(\)/);
  assert.match(host, /function activeStudentIdForDevice/);
  assert.match(host, /request\.authContext\?\.type === 'student_session'/);
  assert.match(host, /function requireStudentAccess/);
  assert.match(host, /pathname === '\/api\/student-session\/login'/);
  assert.match(host, /pathname === '\/api\/student-session\/logout'/);
  assert.match(host, /pathname === '\/api\/device\/mode'/);
});

test('Android shared mode supports ID and QR entry without exposing a student list', () => {
  assert.match(android, /studentLoginInput/);
  assert.match(android, /REQUEST_CAPTURE_STUDENT_QR/);
  assert.match(android, /class StudentLoginTask/);
  assert.match(android, /class StudentLogoutTask/);
  assert.match(android, /String dataToken\(\)/);
  assert.match(android, /capture_student_id/);
  assert.doesNotMatch(android, /base \+ "\/api\/students"/);
});

test('Windows student terminal requires a session before loading student data', () => {
  assert.match(terminalMain, /loginStudent/);
  assert.match(terminalMain, /autoLoginStudent/);
  assert.match(terminalMain, /\/api\/student-session\/me/);
  assert.match(terminalMain, /\/api\/student-session\/logout/);
  assert.match(terminalUi, /请输入学生 ID/);
  assert.match(terminalUi, /共享终端不会持续监测文件夹/);
});

test('usage mode configuration lives in host system settings', () => {
  assert.match(hostUi, /changeHostUsageMode\('host'\)/);
  assert.match(hostUi, /changeHostUsageMode\('host_terminal'\)/);
  assert.match(hostUi, /管理使用模式/);
  assert.match(hostUi, /activeSection === 'settings'/);
});
