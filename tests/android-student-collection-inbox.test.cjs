const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const source = path.join(root, 'android-tablet-terminal', 'src', 'com', 'qxmatrix', 'eduterminal', 'StudentCollectionInbox.java');

function tool(name) {
  const suffix = process.platform === 'win32' ? '.exe' : '';
  for (const candidate of [
    process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', `${name}${suffix}`) : '',
    path.join(root, '.android-tools', 'jdk', 'jdk-21.0.11+10', 'bin', `${name}${suffix}`),
    path.resolve(root, '..', '..', '平板部署', 'edu-launcher-app', '.android-tools', 'jdk', 'jdk-21.0.11+10', 'bin', `${name}${suffix}`),
    `${name}${suffix}`,
  ].filter(Boolean)) {
    const probe = spawnSync(candidate, ['-version'], { encoding: 'utf8' });
    if (!probe.error && probe.status === 0) return candidate;
  }
  return '';
}

test('student collection inbox is atomic, hashed, restart-safe and student-isolated', (t) => {
  const javac = tool('javac');
  const java = tool('java');
  if (!javac || !java) return t.skip('JDK unavailable');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'student-inbox-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const pkg = path.join(temp, 'com', 'qxmatrix', 'eduterminal');
  fs.mkdirSync(pkg, { recursive: true });
  const harness = path.join(pkg, 'InboxHarness.java');
  fs.writeFileSync(harness, `
package com.qxmatrix.eduterminal;
import java.io.*;
import java.nio.charset.StandardCharsets;
public class InboxHarness {
  static void check(boolean v, String m) { if (!v) throw new AssertionError(m); }
  public static void main(String[] a) throws Exception {
    File root = new File(a[0]);
    StudentCollectionInbox box = new StudentCollectionInbox(root);
    StudentCollectionInbox.Entry one = box.collect(new ByteArrayInputStream("lesson evidence".getBytes(StandardCharsets.UTF_8)),
      new StudentCollectionInbox.Metadata("student-a", "manual", "note.txt", "text/plain", "picker"));
    check(one.sha256.matches("[0-9a-f]{64}"), "sha256");
    check(one.payloadFile().isFile(), "payload exists");
    check(box.ready("student-a").size() == 1, "same student sees item");
    StudentCollectionInbox.Entry duplicate = box.collect(new ByteArrayInputStream("lesson evidence".getBytes(StandardCharsets.UTF_8)),
      new StudentCollectionInbox.Metadata("student-a", "share", "renamed-note.txt", "text/plain", "share"));
    check(duplicate.collectionId.equals(one.collectionId), "same student and content reuses staged entry");
    check(box.ready("student-a").size() == 1, "same content is not staged twice");
    check(box.ready("student-b").isEmpty(), "other student isolated");
    box = new StudentCollectionInbox(root);
    check(box.ready("student-a").size() == 1, "restart recovery");
    check(!box.remove(one.collectionId, "student-b"), "other student cannot delete");
    check(box.markQueuedByPayloadPath(one.payloadPath, "request-1"), "handoff recorded");
    check(box.ready("student-a").isEmpty(), "successful handoff leaves ready list");
    check(!one.payloadFile().exists(), "payload released only after durable handoff");
    StudentCollectionInbox.Entry two = box.collect(new ByteArrayInputStream("retain".getBytes(StandardCharsets.UTF_8)),
      new StudentCollectionInbox.Metadata("student-a", "manual", "retain.txt", "text/plain", "picker"));
    check(!box.markQueuedByPayloadPath(new File(root, "missing").getPath(), "request-2"), "failed handoff rejected");
    check(two.payloadFile().isFile() && box.ready("student-a").size() == 1, "failed handoff retains original");
    StudentCollectionInbox.Entry tampered = box.collect(new ByteArrayInputStream("original".getBytes(StandardCharsets.UTF_8)),
      new StudentCollectionInbox.Metadata("student-a", "manual", "tampered.txt", "text/plain", "picker"));
    FileOutputStream changed = new FileOutputStream(tampered.payloadFile(), true); changed.write('x'); changed.close();
    check(box.ready("student-a").size() == 1, "tampered payload is quarantined by hash verification");
    File partial = new File(new File(root, "staging"), "crash.partial"); partial.createNewFile();
    partial.setLastModified(System.currentTimeMillis() - 11 * 60 * 1000L);
    box = new StudentCollectionInbox(root);
    check(!new File(new File(root, "staging"), "crash.partial").exists(), "partial cleaned on restart");
    check(box.remove(two.collectionId, "student-a") && !two.payloadFile().exists(), "confirmed delete removes payload");
    StudentCollectionInbox.Entry shared = box.collect(new ByteArrayInputStream("shared file".getBytes(StandardCharsets.UTF_8)),
      new StudentCollectionInbox.Metadata(StudentCollectionInbox.UNASSIGNED_SHARE, "android_system_share", "original.txt", "text/plain", "android-share"));
    box = new StudentCollectionInbox(root);
    check(box.ready(StudentCollectionInbox.UNASSIGNED_SHARE).size() == 1, "share survives restart before login");
    check(box.ready("student-a").isEmpty() && box.ready("student-b").isEmpty(), "unassigned share not silently attributed");
    StudentCollectionInbox.Entry assigned = box.assignSharedEntry(shared.collectionId, "student-a");
    check(assigned.metadata.fileName.equals("original.txt"), "original name survives assignment");
    check(box.ready(StudentCollectionInbox.UNASSIGNED_SHARE).isEmpty(), "assignment removes unassigned visibility");
    check(box.ready("student-a").size() == 1 && box.ready("student-b").isEmpty(), "assignment isolates students");
    boolean rejected = false;
    try { box.assignSharedEntry(shared.collectionId, "student-b"); } catch (Exception expected) { rejected = true; }
    check(rejected, "assigned share cannot be reassigned");
    check(box.findByPayloadPath("student-b", assigned.payloadPath) == null, "other student cannot resolve payload");
    check(box.findByPayloadPath("student-a", assigned.payloadPath) != null, "owner can resolve payload");
    check(box.markQueuedByPayloadPath(assigned.payloadPath, "share-request", true), "share handed to durable queue");
    check(box.ready("student-a").isEmpty(), "successful handoff removes share from inbox");
    box = new StudentCollectionInbox(root);
    check(assigned.payloadFile().isFile() && box.listForDisplay("student-a").get(0).state == StudentCollectionInbox.State.QUEUED, "queued original survives restart or failed upload");
    check(!box.completeQueued(assigned.collectionId, "student-b", "share-request"), "other student cannot complete");
    check(!box.completeQueued(assigned.collectionId, "student-a", "wrong-request"), "wrong receipt cannot complete");
    check(box.completeQueued(assigned.collectionId, "student-a", "share-request"), "matching receipt completes share");
    check(!assigned.payloadFile().exists(), "confirmed receipt releases retained copy");
    System.out.println("INBOX_HARNESS_OK");
  }
}`, 'utf8');
  const compile = spawnSync(javac, ['-encoding', 'UTF-8', '-d', temp, source, harness], { encoding: 'utf8' });
  assert.equal(compile.status, 0, `${compile.stdout}\n${compile.stderr}`);
  const run = spawnSync(java, ['-cp', temp, 'com.qxmatrix.eduterminal.InboxHarness', path.join(temp, 'data')], { encoding: 'utf8' });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /INBOX_HARNESS_OK/);
});

test('student UI hands inbox payload to durable queue before releasing the original', () => {
  const main = fs.readFileSync(path.join(root, 'android-tablet-terminal', 'src', 'com', 'qxmatrix', 'eduterminal', 'MainActivity.java'), 'utf8');
  assert.match(main, /projectMaterialUploadQueue\.enqueue\(input, metadata\)/);
  assert.match(main, /studentCollectionInbox\.markQueuedByPayloadPath\(uri\.getPath\(\), queuedEntry\.requestId\)/);
  assert.match(main, /shareCollectionInbox\.markQueuedByPayloadPath\(uri\.getPath\(\), queuedEntry\.requestId, true\)/);
});

test('system file shares enter a separate persistent inbox before student and target confirmation', () => {
  const main = fs.readFileSync(path.join(root, 'android-tablet-terminal', 'src', 'com', 'qxmatrix', 'eduterminal', 'MainActivity.java'), 'utf8');
  const manifest = fs.readFileSync(path.join(root, 'android-tablet-terminal', 'AndroidManifest.xml'), 'utf8');
  assert.match(manifest, /android\.intent\.action\.SEND_MULTIPLE/);
  assert.match(main, /if \(!uris\.isEmpty\(\)\) \{[\s\S]*receiveSharedFiles\(uris,/);
  assert.match(main, /"student-share-inbox"/);
  assert.match(main, /StudentCollectionInbox\.UNASSIGNED_SHARE/);
  assert.match(main, /assignSharedEntry\(entry\.collectionId, studentId\)/);
  assert.match(main, /chooseSharedDestination\(ids\)/);
  assert.match(main, /uploadMaterialsToTarget\(selected, true, target\)/);
  assert.match(main, /shareCollectionInbox\.completeQueued\(entry\.collectionId, studentId, upload\.requestId\)/);
  assert.match(main, /删除分享文件？/);
  assert.match(main, /学生空间已变化，请重新选择/);
});
