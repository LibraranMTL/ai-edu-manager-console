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
    new File(new File(root, "staging"), "crash.partial").createNewFile();
    box = new StudentCollectionInbox(root);
    check(!new File(new File(root, "staging"), "crash.partial").exists(), "partial cleaned on restart");
    check(box.remove(two.collectionId, "student-a") && !two.payloadFile().exists(), "confirmed delete removes payload");
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
});
