const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const host = read('electron/main.cjs');
const collaboration = read('electron/student-collaboration.cjs');
const student = read('android-tablet-terminal/src/com/qxmatrix/eduterminal/MainActivity.java');
const teacher = read('android-teacher-terminal/src/com/qxmatrix/eduteacher/MainActivity.java');
const studentDrafts = read('android-tablet-terminal/src/com/qxmatrix/eduterminal/ConversationDraftStore.java');
const teacherDrafts = read('android-teacher-terminal/src/com/qxmatrix/eduteacher/ConversationDraftStore.java');
const windowsMain = read('electron/terminal-main.cjs');
const windowsUi = read('src/terminal-main.tsx');

test('host advertises and routes all collaboration capabilities without changing pairing routes', () => {
  for (const capability of ['conversationImport', 'conversationSubmissionStatus', 'learningStatus', 'projectComprehensiveReport', 'weeklyKnowledgeGrowthImage']) {
    assert.match(host, new RegExp(`${capability}: true`));
  }
  for (const route of [
    '/api/student-session/learning-status',
    '/api/student-session/knowledge-growth/weeks',
    '/api/conversation-import/link-preview',
    '/api/conversation-import/preview-confirmation',
  ]) assert.ok(host.includes(route), `missing ${route}`);
  assert.match(host, /teacher-session\\\/students\\\//);
  assert.match(host, /student-session\\\/projects\\\//);
  assert.match(host, /conversation-submissions\\\//);
  assert.match(host, /pathname === '\/api\/pair\/request'/);
  assert.match(host, /pathname === '\/api\/student-session\/auto'/);
  assert.match(host, /pathname === '\/api\/device\/mode'/);
});

test('student and teacher Android clients submit the same learning-status business fields', () => {
  const fields = ['overallState', 'currentContent', 'completed', 'difficulties', 'nextPlan', 'helpNeeded', 'notes'];
  for (const field of fields) {
    assert.ok(student.includes(`body.put("${field}"`), `student missing ${field}`);
    assert.ok(teacher.includes(`body.put("${field}"`), `teacher missing ${field}`);
  }
  assert.match(teacher, /教师根据与学生的谈话代为记录。表单内容与学生端完全一致。/);
  assert.doesNotMatch(teacher, /body\.put\("(?:teacherObservation|guidanceSuggestion|followUp)"/);
  assert.match(collaboration, /recordingMode: recordedByRole === 'teacher' \? 'teacher_assisted' : 'self_report'/);
});

test('Android system shares become independent durable drafts before update checks', () => {
  for (const drafts of [studentDrafts, teacherDrafts]) {
    assert.match(drafts, /conversation-draft-/);
    assert.match(drafts, /Intent\.ACTION_SEND_MULTIPLE/);
    assert.match(drafts, /intent\.getClipData\(\)/);
    assert.match(drafts, /intent\.getParcelableArrayListExtra\(Intent\.EXTRA_STREAM\)/);
    assert.match(drafts, /if \(uri != null && !values\.contains\(uri\)\)/);
    assert.match(drafts, /writeAtomic\(new File\(folder, "draft\.json"\)/);
  }
  assert.ok(student.indexOf('handleIncomingShare(getIntent())') < student.indexOf('checkForUpdate(true)'));
  assert.ok(teacher.indexOf('handleIncomingShare(getIntent())') < teacher.indexOf('checkForUpdate(true)'));
  assert.match(student, /ConversationDraftStore\.pending\(this\)/);
  assert.match(teacher, /ConversationDraftStore\.pending\(this\)/);
});

test('teacher confirmation is bound to device, target, content and current authorization revision', () => {
  assert.match(host, /\['deviceId', 'studentId', 'projectId', 'contentDigest', 'authorizationRevision'\]/);
  assert.match(host, /authorizationRevision: hostDataGenerationId\(\)/);
  assert.match(host, /同一提交号不能更换内容或目标/);
  assert.match(host, /pendingVerification: record\.status === 'processing'/);
});

test('Windows student exposes the same collaboration functions and confirms updates before download', () => {
  for (const fragment of ['terminal:choose-conversation-file', 'terminal:preview-conversation-link', 'terminal:submit-conversation',
    '/api/student-session/learning-status', '/comprehensive-report', '/knowledge-growth/weeks']) assert.ok(windowsMain.includes(fragment), `missing ${fragment}`);
  for (const label of ['导入对话', '学习状态与成长', '当前在学内容', '已完成事项', '遇到的困难', '下一步计划', '需要的帮助', '补充说明']) {
    assert.ok(windowsUi.includes(label), `missing ${label}`);
  }
  assert.match(windowsUi, /window\.confirm/);
});

test('candidate versions are local while public manifests stay on formal releases', () => {
  assert.match(read('android-tablet-terminal/AndroidManifest.xml'), /versionCode="97"[\s\S]*versionName="0\.6\.27"/);
  assert.match(read('android-teacher-terminal/AndroidManifest.xml'), /versionCode="6"[\s\S]*versionName="0\.1\.5"/);
  const terminalVersion = JSON.parse(read('windows-terminal-version.json'));
  const candidate = JSON.parse(read('package.json'));
  const formal = JSON.parse(read('release/edu-manager-version.json'));
  assert.deepEqual(terminalVersion, { versionCode: 237, versionName: '0.18.7', releaseStatus: 'candidate' });
  assert.equal(candidate.version, '0.22.9');
  assert.equal(formal.windowsVersionName, '0.21.6');
  assert.equal(formal.tabletTerminalVersionName, '0.6.27');
  assert.equal(formal.teacherTerminalVersionName, '0.1.5');
});

test('teacher project knowledge is a read-only file dialog and collaboration 404 is explained', () => {
  const projectFlow = teacher.slice(teacher.indexOf('void openProjectMaterialsProject'), teacher.indexOf('void selectStudentArchiveSource'));
  assert.match(projectFlow, /openProjectKnowledgeDialog\(project\)/);
  assert.doesNotMatch(projectFlow, /ProjectMaterialsDialog\.open/);
  assert.match(teacher, /showReadOnlyFilePicker\(project\.name \+ " · 项目知识"/);
  assert.match(teacher, /showReadOnlyFilePicker\(studentName \+ " · 学情档案"/);
  assert.match(teacher, /showCollaborationTextDialog\("成长模型"/);
  assert.match(teacher, /class LearningReportResultTask implements Runnable/);
  assert.match(teacher, /applyLearningReportDialog\(title, content, error, studentId, path, status, updatedAt, viewGeneration\)/);
  const reportFlow = teacher.slice(teacher.indexOf('void loadLearningReport(String reportId)'), teacher.indexOf('void updateReportButtonSelection()'));
  assert.doesNotMatch(reportFlow, /archiveCard\.setVisibility|scrollToView\(archiveCard\)/);
  assert.ok(teacher.indexOf('Button projectReportButton = button("项目综合报告"') < teacher.indexOf('educationContent.addView(collapsiblePanel("项目知识库"'));
  for (const client of [student, teacher]) {
    assert.match(client, /当前 Windows 主机未包含此功能，请启动与本客户端匹配的新版主机候选/);
    assert.match(client, /shareKnowledgeGrowthImage\(week, imageBase64, mimeType\)/);
  }
});

test('student project materials, comprehensive reports, and student archive use the same read-only dialog path', () => {
  const projectFlow = student.slice(student.indexOf('void openProjectMaterialsProject'), student.indexOf('void selectStudentArchiveSource'));
  assert.match(projectFlow, /openProjectKnowledgeDialog\(project\)/);
  assert.doesNotMatch(projectFlow, /ProjectMaterialsDialog\.open/);
  assert.match(student, /void openStudentArchiveDialog\(\)/);
  assert.match(student, /showReadOnlyFilePicker\(studentName \+ " · 学情档案"/);
  assert.match(student, /showReadOnlyFilePicker\(project\.name \+ " · 项目资料"/);
  assert.match(student, /showCollaborationTextDialog\(title, "只读内容 · 来自 Windows 主机"/);
  assert.ok(student.indexOf('Button projectReportButton = button("项目综合报告"') < student.indexOf('archivePage.addView(collapsiblePanel("项目资料"'));
  assert.doesNotMatch(student.slice(student.indexOf('void openProjectMaterialsProject'), student.indexOf('void selectStudentArchiveSource')), /supportsMaterialViews\(\)/);
});
