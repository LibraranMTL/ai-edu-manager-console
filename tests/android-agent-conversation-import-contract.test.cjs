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

test('student exposes one governed conversation import entry while teacher keeps its lightweight import entry', () => {
  const studentAssembly = student.slice(student.indexOf('collectionPage = workspacePage'), student.indexOf('FrameLayout.LayoutParams topParams'));
  assert.doesNotMatch(studentAssembly, /教育管家对话|Agent 对话/u);
  assert.equal((studentAssembly.match(/button\("导入对话", false\)/gu) || []).length, 1);
  assert.match(student, /"粘贴对话文字", "导入 \.md \/ \.txt \/ \.json 文件", "导入公开 HTTPS 对话链接"/u);
  assert.match(student, /REQUEST_IMPORT_CONVERSATION_FILE/u);
  assert.match(teacher, /collapsiblePanel\("导入智能体对话"/u);
  assert.match(teacher, /conversationImportButton = button\("粘贴智能体对话", true\)/u);
  assert.doesNotMatch(student, /ConversationImportQueue|WorkManager/u);
  assert.doesNotMatch(teacher, /REQUEST_PICK_CONVERSATION|ConversationImportQueue|WorkManager/u);
});

test('ACTION_SEND text enters governed conversation import while generic shared files use offline staging', () => {
  assert.match(studentManifest, /android\.intent\.action\.SEND/u);
  assert.match(student, /acceptConversationDraft\(sharedText\.toString\(\)\)/u);
  assert.match(student, /receiveSharedFiles\(uris, sharedText/u);
  assert.match(teacherManifest, /android\.intent\.action\.SEND/u);
  assert.match(teacher, /pendingSharedUris\.addAll\(uris\)/u);
  assert.match(student, /previewConversationLink\(text\)/u);
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

test('student public link preview is host mediated and bounded before submit', () => {
  assert.match(student, /\/api\/student-session\/conversation-link\/preview/u);
  assert.match(student, /对话文件超过 5 MB/u);
  assert.match(host, /previewConversationShareUrl/u);
  assert.match(host, /仅支持公开 HTTPS 对话链接/u);
  assert.match(host, /dns\.promises\.lookup/u);
  assert.match(host, /readBoundedResponseText\(response, 5 \* 1024 \* 1024\)/u);
});

test('student candidate and teacher release expose their expected Android versions', () => {
  assert.match(student, /VERSION_NAME = "0\.6\.34"/u);
  assert.match(student, /VERSION_CODE = 104/u);
  assert.match(studentManifest, /android:versionName="0\.6\.34"/u);
  assert.match(studentManifest, /android:versionCode="104"/u);
  assert.match(teacher, /VERSION_NAME = "0\.1\.5"/u);
  assert.match(teacher, /VERSION_CODE = 6/u);
  assert.match(teacherManifest, /android:versionName="0\.1\.5"/u);
  assert.match(teacherManifest, /android:versionCode="6"/u);
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
