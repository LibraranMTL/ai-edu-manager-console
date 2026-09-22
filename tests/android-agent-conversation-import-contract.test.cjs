const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { normalizeAgentConversationSubmission } = require('../electron/agent-conversation-submission.cjs');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const student = read('android-tablet-terminal/src/com/qxmatrix/eduterminal/MainActivity.java');
const teacher = read('android-teacher-terminal/src/com/qxmatrix/eduteacher/MainActivity.java');
const studentManifest = read('android-tablet-terminal/AndroidManifest.xml');
const teacherManifest = read('android-teacher-terminal/AndroidManifest.xml');
const host = read('electron/main.cjs');

test('student and teacher terminals expose one lightweight conversation-import entry', () => {
  for (const source of [student, teacher]) {
    assert.match(source, /collapsiblePanel\("导入智能体对话"/u);
    assert.match(source, /conversationImportButton = button\("粘贴智能体对话", true\)/u);
    assert.match(source, /setTitle\("发送智能体对话"\)/u);
    assert.match(source, /setPositiveButton\("发送到主机"/u);
    assert.doesNotMatch(source, /REQUEST_PICK_CONVERSATION|ConversationImportQueue|WorkManager/u);
  }
});

test('pure ACTION_SEND text is accepted without changing ordinary shared-file handling', () => {
  for (const [source, manifest] of [[student, studentManifest], [teacher, teacherManifest]]) {
    assert.match(manifest, /android\.intent\.action\.SEND/u);
    assert.match(source, /intent\.getCharSequenceExtra\(Intent\.EXTRA_TEXT\)/u);
    assert.match(source, /if \(uris\.size\(\) == 0 && sharedText != null/u);
    assert.match(source, /pendingSharedUris\.addAll\(uris\)/u);
    assert.match(source, /当前分享只有链接，请复制对话正文后再粘贴/u);
  }
});

test('conversation imports use the dedicated host endpoint and preserve one immutable original message', () => {
  for (const source of [student, teacher]) {
    const submit = source.slice(source.indexOf('void submitConversation'), source.indexOf('void applyConversationSubmissionResult'));
    assert.match(submit, /edu-manager\.agent-conversation-submission\.v1/u);
    assert.match(submit, /\/api\/agent\/conversation\/submit/u);
    assert.match(submit, /message\.put\("role", "unknown"\)/u);
    assert.match(submit, /message\.put\("content", text\)/u);
    assert.match(source, /text\.length\(\) > MAX_CONVERSATION_CHARS/u);
    assert.match(submit, /idempotencyKey/u);
    assert.doesNotMatch(submit, /\/materials/u);
  }
  assert.match(host, /pathname === '\/api\/agent\/conversation\/submit'/u);
  assert.match(host, /normalizeAgentConversationSubmission\(incoming\)/u);
});

test('targets default to the selected student archive and only expose linked projects', () => {
  for (const source of [student, teacher]) {
    const confirm = source.slice(source.indexOf('void showConversationConfirmDialog'), source.indexOf('void submitConversation'));
    assert.match(confirm, /targets\.add\(new UploadTarget\("student", selectedStudent\.id/u);
    assert.match(confirm, /for \(LearningProject project : projectsForSelectedStudent\(\)\)/u);
    const submit = source.slice(source.indexOf('void submitConversation'), source.indexOf('void applyConversationSubmissionResult'));
    assert.match(submit, /selectedStudent\.id\.equals\(target\.studentId\)/u);
    assert.match(submit, /project\.id\.equals\(target\.id\)/u);
    assert.match(submit, /payload\.put\("studentHint", target\.studentId\)/u);
  }
});

test('a failed request keeps one restart-safe draft and a successful receipt clears it', () => {
  for (const source of [student, teacher]) {
    assert.match(source, /PREF_PENDING_CONVERSATION_TEXT/u);
    assert.match(source, /对话草稿已保留，可点击重试/u);
    assert.match(source, /"deduplicated"\.equals\(receiptStatus\)/u);
    assert.match(source, /"awaiting_attribution"\.equals\(receiptStatus\)/u);
    assert.match(source, /remove\(PREF_PENDING_CONVERSATION_TEXT\)/u);
  }
});

test('release versions advance only the two Android terminals', () => {
  assert.match(student, /VERSION_NAME = "0\.6\.17"/u);
  assert.match(student, /VERSION_CODE = 87/u);
  assert.match(studentManifest, /android:versionName="0\.6\.17"/u);
  assert.match(teacher, /VERSION_NAME = "0\.1\.2"/u);
  assert.match(teacher, /VERSION_CODE = 3/u);
  assert.match(teacherManifest, /android:versionName="0\.1\.2"/u);
});

test('the minimal Android payload is accepted by the live host normalizer', () => {
  const submission = normalizeAgentConversationSubmission({
    schema: 'edu-manager.agent-conversation-submission.v1',
    sourceAgent: 'android-teacher-import',
    sourceNodeId: 'teacher-device-1',
    sessionId: 'android-conversation-1234',
    scopeType: 'student',
    scopeId: 'student-1',
    studentHint: 'student-1',
    messages: [{ messageId: 'android-message-1234', role: 'unknown', content: '完整原始对话正文' }],
    submittedAt: '2026-08-29T12:00:00.000Z',
    idempotencyKey: 'android-conversation-test-1234',
  });
  assert.equal(submission.messages.length, 1);
  assert.equal(submission.messages[0].role, 'unknown');
  assert.equal(submission.messages[0].content, '完整原始对话正文');
  assert.equal(submission.scopeId, 'student-1');
  assert.equal(submission.idempotencyKey, 'android-conversation-test-1234');
});
