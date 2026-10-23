const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

function javaTool(name) {
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const candidates = [
    process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', `${name}${suffix}`) : '',
    path.join(root, '.android-tools', 'jdk', 'jdk-21.0.11+10', 'bin', `${name}${suffix}`),
    `${name}${suffix}`,
  ].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['-version'], { encoding: 'utf8' });
    if (!probe.error && probe.status === 0) return candidate;
  }
  return '';
}

test('Android student terminal routes manual project materials through the private durable queue', () => {
  const main = read('android-tablet-terminal', 'src', 'com', 'qxmatrix', 'eduterminal', 'MainActivity.java');
  const worker = read('android-tablet-terminal', 'src', 'com', 'qxmatrix', 'eduterminal', 'ProjectMaterialUploadJobService.java');
  const queue = read('android-tablet-terminal', 'src', 'com', 'qxmatrix', 'eduterminal', 'ProjectMaterialUploadQueue.java');
  const manifest = read('android-tablet-terminal', 'AndroidManifest.xml');
  const build = read('android-tablet-terminal', 'build.ps1');

  assert.match(main, /new ProjectMaterialUploadQueue\([\s\S]*getFilesDir\(\)/);
  assert.match(main, /new EnqueueProjectMaterialsTask/);
  assert.match(main, /projectMaterialUploadQueue\.enqueue\(input, metadata\)/);
  assert.doesNotMatch(main, /Integer\.toHexString\(\(uri\.toString\(\)/);
  assert.match(queue, /edu-manager\.android-project-material-queue\.v1/);
  assert.match(queue, /stable private payload/);
  assert.match(queue, /private static final Object PROCESS_LOCK/);
  assert.match(worker, /\/api\/uploads\/receipt\?targetType=/);
  assert.match(worker, /requestJson\(base \+ "\/api\/health", "", null, null\)/);
  assert.match(worker, /observedHostId\.equals\(credentialHostId\)/);
  assert.match(worker, /if \(clean\(token\)\.length\(\) > 0\)[\s\S]*setRequestProperty\("Authorization"/);
  assert.doesNotMatch(worker, /optString\("dataGeneration", entry\.dataGeneration\)/);
  assert.match(worker, /X-Edu-Content-Sha256/);
  assert.match(worker, /X-Edu-Data-Generation/);
  assert.match(worker, /ProjectMaterialUploadQueue\.Action\.QUERY_RECEIPT/);
  assert.match(worker, /entry\.requestId\.equals\(returnedRequestId\)/);
  assert.match(worker, /receipt\.optLong\("size", -1L\) != entry\.byteSize/);
  assert.match(worker, /\.setPersisted\(true\)/);
  assert.ok(worker.indexOf('Action.QUERY_RECEIPT') < worker.indexOf('Action.UPLOAD'), 'receipt branch must precede retransmission');
  assert.match(manifest, /\.ProjectMaterialUploadJobService/);
  assert.match(manifest, /android\.permission\.RECEIVE_BOOT_COMPLETED/);
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(main, /remove\(PREF_HOST_DEVICE_ID\)[\s\S]*remove\(PREF_HOST_DATA_GENERATION\)/);
  assert.match(build, /ProjectMaterialUploadQueue\.java/);
  assert.match(build, /ProjectMaterialUploadJobService\.java/);
});

test('durable queue preserves immutable scope and enforces receipt-first crash and generation recovery', (t) => {
  const javac = javaTool('javac');
  const java = javaTool('java');
  if (!javac || !java) return t.skip('JDK is unavailable');

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-android-material-queue-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const packageDir = path.join(temp, 'com', 'qxmatrix', 'eduterminal');
  fs.mkdirSync(packageDir, { recursive: true });
  const harness = path.join(packageDir, 'QueueHarness.java');
  fs.writeFileSync(harness, `
package com.qxmatrix.eduterminal;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;

public final class QueueHarness {
  static void check(boolean value, String message) {
    if (!value) throw new AssertionError(message);
  }

  public static void main(String[] args) throws Exception {
    File root = new File(args[0]);
    ProjectMaterialUploadQueue queue = new ProjectMaterialUploadQueue(root);
    ProjectMaterialUploadQueue.Metadata metadata = new ProjectMaterialUploadQueue.Metadata(
      "host-1", "generation-1", "device-1", "student-1", "project", "project-1",
      "evidence.txt", "android_terminal_file", "courseId=c-1", "content://source/evidence");
    ProjectMaterialUploadQueue.Entry entry = queue.enqueue(
      new ByteArrayInputStream("stable evidence".getBytes(StandardCharsets.UTF_8)), metadata);
    check(entry.requestId.startsWith("android-material-"), "stable request id prefix");
    check(entry.contentSha256.matches("[0-9a-f]{64}"), "sha256 fixed");
    check(entry.payloadFile().isFile(), "private payload exists");
    check(entry.hostId.equals("host-1") && entry.deviceId.equals("device-1"), "host and device fixed");
    check(entry.studentId.equals("student-1") && entry.targetId.equals("project-1"), "student/project fixed");
    ProjectMaterialUploadQueue.Entry duplicate = queue.enqueue(
      new ByteArrayInputStream("stable evidence".getBytes(StandardCharsets.UTF_8)), metadata);
    check(duplicate.requestId.equals(entry.requestId), "same scoped content reuses durable queue entry");
    check(queue.list().size() == 1, "same scoped content is not queued twice");

    File itemFile = new File(new File(root, "items"), entry.requestId + ".properties");
    File backupFile = new File(new File(root, "items"), entry.requestId + ".properties.bak");
    check(itemFile.renameTo(backupFile), "simulate crash after metadata backup rename");
    ProjectMaterialUploadQueue restarted = new ProjectMaterialUploadQueue(root);
    List<ProjectMaterialUploadQueue.Entry> restored = restarted.list();
    check(restored.size() == 1 && restored.get(0).requestId.equals(entry.requestId),
      "restart restores atomic metadata artifact and reloads queue");
    restarted.markUploading(entry.requestId);
    restarted = new ProjectMaterialUploadQueue(root);
    ProjectMaterialUploadQueue.Entry recovered = restarted.recoverInterrupted().get(0);
    check(recovered.state == ProjectMaterialUploadQueue.State.RECEIPT_UNKNOWN, "crash becomes receipt unknown");
    ProjectMaterialUploadQueue.RuntimeScope original = new ProjectMaterialUploadQueue.RuntimeScope(
      "host-1", "generation-1", "device-1", "student-1", true);
    check(restarted.nextAction(recovered, original) == ProjectMaterialUploadQueue.Action.QUERY_RECEIPT,
      "restart must query receipt before retransmit");
    recovered = restarted.applyReceipt(entry.requestId, "not_found", "", "generation-1");
    check(restarted.nextAction(recovered, original) == ProjectMaterialUploadQueue.Action.UPLOAD,
      "same-generation not-found allows retransmit");
    check(restarted.nextAction(recovered, new ProjectMaterialUploadQueue.RuntimeScope(
      "host-2", "generation-1", "device-1", "student-1", true)) == ProjectMaterialUploadQueue.Action.HOLD_SCOPE,
      "host switch holds original target");
    check(restarted.nextAction(recovered, new ProjectMaterialUploadQueue.RuntimeScope(
      "host-1", "generation-1", "device-1", "student-2", true)) == ProjectMaterialUploadQueue.Action.HOLD_SCOPE,
      "student switch holds original target");
    check(restarted.get(entry.requestId).targetId.equals("project-1"), "scope checks never rewrite target");

    ProjectMaterialUploadQueue.Entry second = restarted.enqueue(
      new ByteArrayInputStream("generation guard".getBytes(StandardCharsets.UTF_8)), metadata);
    ProjectMaterialUploadQueue.RuntimeScope newGeneration = new ProjectMaterialUploadQueue.RuntimeScope(
      "host-1", "generation-2", "device-1", "student-1", true);
    check(restarted.nextAction(second, newGeneration) == ProjectMaterialUploadQueue.Action.QUERY_RECEIPT,
      "generation mismatch queries receipt instead of holding silently");
    second = restarted.applyReceipt(second.requestId, "not_found", "", "generation-2");
    check(second.state == ProjectMaterialUploadQueue.State.PAUSED_RECEIPT,
      "old-generation not-found pauses for human review");
    check(second.payloadFile().isFile(), "old-generation paused item retains its only stable payload");
    check(restarted.nextAction(second, newGeneration) == ProjectMaterialUploadQueue.Action.NONE,
      "old-generation entry cannot upload into new generation");

    recovered = restarted.markUploading(entry.requestId);
    restarted.markTransportUncertain(entry.requestId, "socket_closed_after_send");
    recovered = restarted.get(entry.requestId);
    check(restarted.nextAction(recovered, original) == ProjectMaterialUploadQueue.Action.QUERY_RECEIPT,
      "uncertain response queries before retry");
    recovered = restarted.applyReceipt(entry.requestId, "received_verified", entry.contentSha256, "generation-1");
    check(recovered.state == ProjectMaterialUploadQueue.State.RECEIVED, "matching verified receipt completes item");
    check(!recovered.payloadFile().exists(), "verified receipt releases the temporary private payload");

    ProjectMaterialUploadQueue.Entry third = restarted.enqueue(
      new ByteArrayInputStream("permission pause".getBytes(StandardCharsets.UTF_8)), metadata);
    restarted.pausePermission(third.requestId, "authorization_expired");
    check(restarted.nextAction(restarted.get(third.requestId), original) == ProjectMaterialUploadQueue.Action.HOLD_PERMISSION,
      "expired permission pauses transmission");
    third = restarted.resumePermission(third.requestId);
    check(third.state == ProjectMaterialUploadQueue.State.RECEIPT_UNKNOWN,
      "permission recovery is receipt-first");

    FileOutputStream changed = new FileOutputStream(third.payloadFile(), true);
    changed.write('x');
    changed.close();
    third = restarted.applyReceipt(third.requestId, "not_found", "", "generation-1");
    third = restarted.markUploading(third.requestId);
    check(third.state == ProjectMaterialUploadQueue.State.PAUSED_PERMISSION,
      "changed private payload is never uploaded");

    final ProjectMaterialUploadQueue firstInstance = restarted;
    final ProjectMaterialUploadQueue secondInstance = new ProjectMaterialUploadQueue(root);
    final ProjectMaterialUploadQueue.Entry fourth = firstInstance.enqueue(
      new ByteArrayInputStream("cross instance recovery".getBytes(StandardCharsets.UTF_8)), metadata);
    firstInstance.markUploading(fourth.requestId);
    final Throwable[] failures = new Throwable[2];
    Thread receiptWriter = new Thread(new Runnable() {
      @Override public void run() {
        try {
          firstInstance.applyReceipt(fourth.requestId, "received_verified", fourth.contentSha256, "generation-1");
        } catch (Throwable error) { failures[0] = error; }
      }
    });
    Thread restartRecovery = new Thread(new Runnable() {
      @Override public void run() {
        try { secondInstance.recoverInterrupted(); }
        catch (Throwable error) { failures[1] = error; }
      }
    });
    receiptWriter.start();
    restartRecovery.start();
    receiptWriter.join();
    restartRecovery.join();
    check(failures[0] == null && failures[1] == null, "cross-instance operations complete");
    check(firstInstance.get(fourth.requestId).state == ProjectMaterialUploadQueue.State.RECEIVED,
      "cross-instance restart recovery cannot downgrade a verified receipt");

    ProjectMaterialUploadQueue.Entry fifth = firstInstance.enqueue(
      new ByteArrayInputStream("stale transition guard".getBytes(StandardCharsets.UTF_8)), metadata);
    secondInstance.markUploading(fifth.requestId);
    secondInstance.applyReceipt(fifth.requestId, "received_verified", fifth.contentSha256, "generation-1");
    check(firstInstance.markTransportUncertain(fifth.requestId, "stale_worker_error").state
        == ProjectMaterialUploadQueue.State.RECEIVED,
      "a stale worker cannot downgrade a verified receipt");
    System.out.println("QUEUE_HARNESS_OK");
  }
}
`, 'utf8');

  const queueSource = path.join(root, 'android-tablet-terminal', 'src', 'com', 'qxmatrix', 'eduterminal', 'ProjectMaterialUploadQueue.java');
  const compile = spawnSync(javac, ['-encoding', 'UTF-8', '-d', temp, queueSource, harness], { encoding: 'utf8' });
  assert.equal(compile.status, 0, `${compile.stdout}\n${compile.stderr}`);
  const queueRoot = path.join(temp, 'queue-state');
  const run = spawnSync(java, ['-cp', temp, 'com.qxmatrix.eduterminal.QueueHarness', queueRoot], { encoding: 'utf8' });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /QUEUE_HARNESS_OK/);
});
