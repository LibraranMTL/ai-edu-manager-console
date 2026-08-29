const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { SCHEMA, createStudentPortableMigrationManager, isInside, safeId } = require('../electron/student-portable-migration.cjs');

async function waitUntilReady(manager, sessionId, studentId) {
  for (let count = 0; count < 100; count += 1) {
    const session = manager.requireSession(sessionId, studentId);
    if (session.status === 'ready' || session.status === 'failed') return session;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('migration session timed out');
}

test('portable migration creates an exact-student package with associated project and hashes', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-student-portable-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const studentRoot = path.join(root, 'student');
  const projectRoot = path.join(root, 'project');
  fs.mkdirSync(path.join(studentRoot, '原始资料'), { recursive: true });
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(path.join(studentRoot, '原始资料', 'lesson.md'), '# lesson\n', 'utf8');
  fs.writeFileSync(path.join(projectRoot, 'project.md'), '# project\n', 'utf8');
  const manager = createStudentPortableMigrationManager({
    rootDir: path.join(root, 'sessions'),
    resolveStudentRoot: () => studentRoot,
    resolveProjectRoot: () => projectRoot,
  });
  const created = manager.create(
    { id: 'student-001', name: 'Test Student', grade: '7' },
    [{ id: 'project-001', name: 'Science', studentIds: ['student-001'], projectRootPath: projectRoot }],
  );
  const ready = await waitUntilReady(manager, created.sessionId, 'student-001');
  assert.equal(ready.status, 'ready', ready.message);
  assert.equal(manager.requireSession(created.sessionId, 'another-student'), null);
  assert.match(ready.sha256, /^[a-f0-9]{64}$/);
  assert.ok(ready.bytes > 0);
  const entries = execFileSync('tar.exe', ['-tf', ready.filePath], { encoding: 'utf8' }).replaceAll('\\', '/');
  assert.match(entries, /migration\.json/);
  assert.match(entries, /manifest\.json/);
  assert.match(entries, /workspace\/[^\r\n]+\/lesson\.md/);
  assert.match(entries, /projects\/project-001\/project\.md/);
});

test('portable migration contract rejects traversal-like IDs and identifies contained paths', () => {
  assert.equal(SCHEMA, 'edu-manager.student-portable-package.v1');
  assert.throws(() => safeId('../student'), /ID/);
  assert.equal(isInside('C:/workspace/student', 'C:/workspace/student/raw/file.md'), true);
  assert.equal(isInside('C:/workspace/student', 'C:/workspace/another/file.md'), false);
});

test('three current candidate clients expose the one-click upgrade contract', () => {
  const repo = path.join(__dirname, '..');
  const host = fs.readFileSync(path.join(repo, 'electron', 'main.cjs'), 'utf8');
  const student = fs.readFileSync(path.join(repo, 'android-tablet-terminal', 'src', 'com', 'qxmatrix', 'eduterminal', 'MainActivity.java'), 'utf8');
  const standalone = fs.readFileSync(path.join(repo, 'android-standalone-manager', 'app', 'src', 'main', 'java', 'com', 'qxmatrix', 'edumanager', 'standalone', 'StudentPortableMigrationService.kt'), 'utf8');
  assert.match(host, /requireStudentAccess\(request, response, studentId\)/);
  assert.match(host, /auth\.type === 'device' && auth\.terminalMode === 'shared'/);
  assert.match(host, /auth\.allowedStudentIds\.includes\(String\(studentId\)\)/);
  assert.match(host, /portable-migrations/);
  assert.match(student, /从 Windows 主机升级到单机版（少量资料）/);
  assert.match(student, /VERSION_NAME = "0\.6\.15"/);
  assert.match(student, /VERSION_CODE = 85/);
  assert.match(student, /!student\.fileStatsReady/);
  assert.match(student, /student\.rawFileCount >= 1000/);
  assert.match(student, /student\.rawTotalBytes >= 3L \* 1024L \* 1024L \* 1024L/);
  assert.match(student, /导出到 Android 单机版（U盘）/);
  assert.match(student, /"personal"\.equals\(terminalMode\) \? apiToken\(\) : dataToken\(\)/);
  assert.match(student, /session\.optString\("bearerToken", dataToken\(\)\)/);
  assert.match(student, /state\.put\("bearerToken", token\)/);
  assert.match(student, /setPackage\(STANDALONE_PACKAGE\)/);
  assert.match(standalone, /studentRepository\.validateAdd\(preliminary\)/);
  assert.match(standalone, /require\(sha256\(zip\)\.equals\(pending\.sha256/);
  assert.match(standalone, /studentJson\.getString\("id"\) == pending\.studentId/);
});
