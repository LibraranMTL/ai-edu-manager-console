const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const activity = read('android-tablet-terminal/src/com/qxmatrix/eduterminal/MainActivity.java');
const learning = read('android-shared/src/com/qxmatrix/terminallearning/TerminalLearningDialog.java');
const host = read('electron/main.cjs');

test('student terminal exposes five primary actions, with project content separated from education archive', () => {
  const dashboard = activity.slice(activity.indexOf('private LinearLayout buildStudentDashboard'), activity.indexOf('private View addDashboardAction'));
  assert.equal((dashboard.match(/addDashboardAction\(/g) || []).length, 5);
  for (const label of ['搜集上传', '主机连接', '教育档案', '项目管理', '学习行动']) assert.match(dashboard, new RegExp(label));
  assert.doesNotMatch(dashboard, /资料收集|资料上传|课程学习/);
  const assembly = activity.slice(activity.indexOf('collectionPage = workspacePage'), activity.indexOf('FrameLayout.LayoutParams topParams'));
  const archivePage = assembly.slice(assembly.indexOf('archivePage = workspacePage'), assembly.indexOf('projectPage = workspacePage'));
  const projectPage = assembly.slice(assembly.indexOf('projectPage = workspacePage'), assembly.indexOf('learningActionPage = workspacePage'));
  const learningPage = assembly.slice(assembly.indexOf('learningActionPage = workspacePage'), assembly.indexOf('morePage = workspacePage'));
  const morePage = assembly.slice(assembly.indexOf('morePage = workspacePage'));
  assert.match(archivePage, /知识点跟踪/);
  assert.doesNotMatch(archivePage, /项目资料与知识/);
  assert.match(projectPage, /项目资料与知识/);
  assert.match(projectPage, /项目综合报告/);
  assert.match(projectPage, /项目导师/);
  assert.match(learningPage, /精选课程/);
  assert.match(learningPage, /学习卡片/);
  assert.match(learningPage, /学习导师/);
  assert.doesNotMatch(learningPage, /collapsiblePanel\("知识点跟踪"/);
  assert.doesNotMatch(morePage, /精选课程|学习卡片与规划|项目知识/);
});

test('student space remains exact ID or QR only and does not expose teacher directory search', () => {
  assert.match(activity, /studentLoginInput = input\(/);
  assert.match(activity, /studentScanButton = button\(/);
  assert.doesNotMatch(activity, /输入姓名、学生 ID 或年级/);
  const login = host.slice(host.indexOf('async function handleStudentSessionLogin'), host.indexOf('function handleStudentSessionAuto'));
  assert.match(login, /isValidStudentLoginId\(loginId\)/);
  assert.match(login, /normalizeStudentLoginId\(item\.loginId\) === loginId/);
});

test('student learning trajectory endpoint is session scoped and returns summary fields only', () => {
  assert.match(host, /learningTrajectory: true/);
  assert.match(host, /pathname === '\/api\/student-session\/learning-trajectory'/);
  const handler = host.slice(host.indexOf('function handleTerminalLearningTrajectory'), host.indexOf('function handleTerminalPlanning'));
  assert.match(handler, /terminalLearningStudent\(request, response\)/);
  assert.match(handler, /request\.authContext\?\.type !== 'student_session'/);
  assert.match(handler, /queryLearningTrajectory/);
  for (const field of ['knowledgePoint', 'evidenceCount', 'lastPracticedAt', 'reviewPriority', 'recommendedReviewAt', 'retentionNote']) {
    assert.match(handler, new RegExp(field));
  }
  assert.doesNotMatch(handler, /historyCandidatePath|historyMarkdown|rejections:/);
});

test('Android learning action handles old hosts, isolated cache and bounded knowledge wording', () => {
  assert.match(learning, /capabilities\.optBoolean\("learningTrajectory"\)/);
  assert.match(learning, /\/api\/student-session\/learning-trajectory/);
  assert.match(learning, /scopeKey\(transport, studentId\) \+ ":trajectory"/);
  assert.match(learning, /当前主机尚未提供知识点跟踪接口；请先更新主机端/);
  assert.match(learning, /近期证据较稳定/);
  assert.match(learning, /不等于考试成绩、确定性掌握结论或已确认遗忘/);
});

test('education archive exposes topic, competition and three structured guidance sections', () => {
  for (const action of ['topics', 'competitions', 'guidance:pathways', 'guidance:majors', 'guidance:careers']) {
    assert.match(activity, new RegExp(action.replace(':', '\\:')));
  }
  const planningHandler = host.slice(host.indexOf('function handleTerminalPlanning'), host.indexOf('async function handleTerminalPlanningFavorites'));
  assert.match(planningHandler, /pathways/);
  assert.match(planningHandler, /majors/);
  assert.match(planningHandler, /careers/);
  assert.match(learning, /appendGuidanceSection/);
  assert.match(learning, /候选建议不代表能力证明、录取保证、职业结果或比赛结果预测/);
});
