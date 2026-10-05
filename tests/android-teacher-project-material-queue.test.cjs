const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const teacherRoot = path.join(root, 'android-teacher-terminal');
const sourceRoot = path.join(teacherRoot, 'src', 'com', 'qxmatrix', 'eduteacher');
const queueSource = fs.readFileSync(path.join(sourceRoot, 'ProjectMaterialUploadQueue.java'), 'utf8');
const activitySource = fs.readFileSync(path.join(sourceRoot, 'MainActivity.java'), 'utf8');
const buildSource = fs.readFileSync(path.join(teacherRoot, 'build.ps1'), 'utf8');
const manifestSource = fs.readFileSync(path.join(teacherRoot, 'AndroidManifest.xml'), 'utf8');

function javaTool(name) {
  const bundled = path.join(root, '.android-tools', 'jdk', 'jdk-21.0.11+10', 'bin', `${name}.exe`);
  return fs.existsSync(bundled) ? bundled : name;
}

test('teacher project material queue fixes request scope and owns stable private payloads', () => {
  assert.match(queueSource, /hostId = value\.getProperty\("hostId"/);
  assert.match(queueSource, /hostBaseUrl = value\.getProperty\("hostBaseUrl"/);
  assert.match(queueSource, /dataGeneration = value\.getProperty\("dataGeneration"/);
  assert.match(queueSource, /deviceId = value\.getProperty\("deviceId"/);
  assert.match(queueSource, /studentId = value\.getProperty\("studentId"/);
  assert.match(queueSource, /targetType = value\.getProperty\("targetType"/);
  assert.match(queueSource, /targetId = value\.getProperty\("targetId"/);
  assert.match(queueSource, /sha256 = value\.getProperty\("sha256"/);
  assert.match(activitySource, /project-material-upload-queue-v1/);
  assert.match(activitySource, /materialUploadQueue\.enqueue\(request/);
  assert.match(activitySource, /request\.studentId = target\.studentId/);
  assert.match(activitySource, /request\.targetId = target\.id/);
  assert.match(queueSource, /fixedScope \? STATE_PENDING : STATE_RECEIPT_UNKNOWN/);
  assert.match(queueSource, /host_scope_missing/);
  assert.doesNotMatch(activitySource, /activity\.postFile\(legacyUrl/);
  assert.match(buildSource, /ProjectMaterialUploadQueue\.java/);
});

test('teacher queue requires complete per-file receipt scope and fingerprint', () => {
  const query = queueSource.indexOf('receipt = transport.queryReceipt(querying)');
  const upload = queueSource.indexOf('transport.upload(uploading, stablePayload)');
  assert.ok(query >= 0 && upload > query);
  assert.match(queueSource, /receiptScopeProblem\(querying, receipt/);
  assert.match(queueSource, /item\.requestId\.equals\(result\.receiptId\)/);
  assert.match(queueSource, /item\.size != result\.size \|\| !item\.sha256\.equals\(result\.sha256\)/);
  assert.match(queueSource, /RECEIPT_VERIFIED\.equals\(result\.receiptStatus\)/);
  assert.match(activitySource, /\/api\/uploads\/receipt\?targetType=/);
  assert.match(activitySource, /X-Edu-Data-Generation/);
  assert.match(activitySource, /X-Edu-Content-Sha256/);
  assert.match(queueSource, /receipt_query_unsupported/);
});

test('teacher queue validates live runtime before network and never sends current token to an item old URL', () => {
  assert.match(activitySource, /verifyMaterialRuntimeScope\(base, token\)/);
  assert.match(activitySource, /getJson\(currentBase \+ "\/api\/health", ""\)/);
  assert.match(activitySource, /observedHostId\.equals\(credentialHostId\)/);
  assert.match(activitySource, /new TeacherMaterialQueueTransport\(MainActivity\.this, runtime, token\), runtime/);
  assert.match(queueSource, /if \(!sameRuntimeScope\(item, runtime\)\)/);
  assert.match(activitySource, /runtime\.baseUrl \+ "\/api\/uploads\/receipt/);
  assert.match(activitySource, /legacyCompatibleUploadUrl\(runtime\.baseUrl/);
  assert.doesNotMatch(activitySource, /item\.hostBaseUrl \+ "\/api\/uploads\/receipt/);
});

test('teacher queue preserves per-item results and requires non-empty host for authorization resume', () => {
  assert.match(queueSource, /STATE_PAUSED_AUTH/);
  assert.match(queueSource, /stoppedForAuthorization = true/);
  assert.match(queueSource, /if \(result\.received\) batch\.received\+\+/);
  assert.match(queueSource, /else if \(result\.unknown\) batch\.unknown\+\+/);
  assert.match(activitySource, /主机已接收 " \+ success/);
  assert.match(activitySource, /其余 " \+ unresolved \+ " 个保留在本机队列等待核对/);
  assert.match(queueSource, /if \(clean\(hostId\)\.length\(\) == 0 \|\| clean\(deviceId\)\.length\(\) == 0\) return 0/);
  assert.match(queueSource, /return response\.length\(\) > 0 && item\.hostId\.length\(\) > 0 && item\.hostId\.equals\(response\)/);
});

test('teacher queued student bytes are excluded from Android system cloud backup', () => {
  assert.match(manifestSource, /<application[\s\S]*android:allowBackup="false"/);
  assert.doesNotMatch(manifestSource, /android:allowBackup="true"/);
});

test('teacher upload results are scoped to the original student project host and credential', () => {
  assert.match(activitySource, /new ProjectMaterialUploadQueue\.UiScope\(/);
  assert.match(activitySource, /invalidateUploadUiScopeIfStudentChanged\(\);/);
  assert.match(activitySource, /uiScope\.bindRuntime\(verifiedRuntime\)/);
  assert.match(activitySource, /applyUploadResult\(success, total, failed, failureLabels, target, uiScope\)/);
  assert.match(activitySource, /boolean uiScopeCurrent = isUploadUiScopeCurrent\(uiScope\)/);
  assert.match(activitySource, /if \(!uiScopeCurrent\)/);
  assert.match(activitySource, /new StatusTask\(activity,[\s\S]*uiScope\)/);
  assert.match(activitySource, /new StartLoadStudentsTask\(activity, uiScope\)/);
});

test('pure Java teacher queue survives restart, lost receipts, partial success, auth loss and generation changes', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-teacher-queue-test-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const queue = path.join(sourceRoot, 'ProjectMaterialUploadQueue.java');
  const harness = path.join(teacherRoot, 'test', 'com', 'qxmatrix', 'eduteacher', 'ProjectMaterialUploadQueueHarness.java');
  const compile = spawnSync(javaTool('javac'), [
    '-encoding', 'UTF-8', '-source', '8', '-target', '8', '-d', temp, queue, harness,
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(compile.status, 0, `${compile.stdout}\n${compile.stderr}`);
  const run = spawnSync(javaTool('java'), ['-cp', temp, 'com.qxmatrix.eduteacher.ProjectMaterialUploadQueueHarness'], {
    cwd: root, encoding: 'utf8',
  });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /teacher queue assertions=\d+/);
});
