const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const capability = fs.readFileSync(path.join(root, 'electron', 'agent-capability-contract.cjs'), 'utf8');
const planning = fs.readFileSync(path.join(root, 'electron', 'planning-guidance.cjs'), 'utf8');

test('Windows v1.2 exposes exactly eight fixed first-level menu labels', () => {
  const labels = ['首页', '收集与整理', '学情与学习', '项目与成果', '规划与指导', '知识与协作', '精选课程', '系统设置'];
  labels.forEach((label) => assert.match(renderer, new RegExp(`label: '${label}'|>${label}<`)));
  assert.match(renderer, /v12-fixed-navigation/);
  assert.match(renderer, /项目知识管理/);
});

test('page tabs preserve requested information architecture and construction states', () => {
  ['收集总览', '资料导入', '拍照上传', '屏幕采集', '录音采集', '对话收集', '会话自动采集', '分享采集', '资料整理'].forEach((label) => assert.match(renderer, new RegExp(label)));
  ['学情报告', '云端文档', '知识点掌握', '学习资料', '学习卡片'].forEach((label) => assert.match(renderer, new RegExp(label)));
  ['选题建议', '新建项目', '项目知识管理', '成长模型'].forEach((label) => assert.match(renderer, new RegExp(label)));
  ['规划总览', '升学路径', '择校建议', '专业探索', '职业发展', '更新记录与设置'].forEach((label) => assert.match(renderer, new RegExp(label)));
  assert.match(renderer, /请先选择或新建学生档案/);
  assert.match(renderer, /没有选定学生时不提供操作按钮/);
  assert.match(renderer, /CaptureInboxPanel/);
  assert.match(renderer, /PracticeCardsPanel/);
});

test('review corrections keep page responsibilities isolated', () => {
  assert.match(renderer, /materials-organize', label: '资料整理', section: 'tasks'/);
  assert.match(renderer, /knowledge-mastery', label: '知识点掌握', section: 'knowledge-mastery'/);
  assert.match(renderer, /growth-model'[\s\S]{0,180}topic-suggestions'[\s\S]{0,180}competition-recommendations'/);
  assert.match(renderer, /activePageTab === 'screen-capture'/);
  assert.match(renderer, /activePageTab === 'materials-import'/);
  assert.match(renderer, /collection-channel-grid/);
  assert.match(renderer, /archiveSubjectFilter/);
  ['全部', '实体', '概念', '综合', '摘要', '问答精华'].forEach((label) => assert.match(renderer, new RegExp(`label: '${label}'`)));
});

test('student dock and agent settings expose the requested management surfaces', () => {
  assert.match(renderer, /current-student-dock/);
  assert.match(renderer, /查看编辑当前档案/);
  assert.match(renderer, /新建学生档案/);
  ['Agent问答设置', 'Agent工具控制', 'Agent规则管理', 'Agent记忆管理', 'Agent人设管理', 'Agent调用能力设置'].forEach((label) => assert.match(renderer, new RegExp(label)));
  assert.match(renderer, /settings-update-section/);
});

test('student overview is read-only and planning adoption prepares existing project draft', () => {
  assert.match(renderer, /学生总览/);
  assert.match(renderer, /只读聚合/);
  assert.match(renderer, /prepareProjectDraftFromSuggestion/);
  assert.match(renderer, /setProjectDraft/);
  assert.doesNotMatch(renderer, /prepareProjectDraftFromSuggestion[\s\S]{0,300}createProject\(/);
});

test('all planning APIs are asynchronous end to end', () => {
  const methods = ['getTopicSuggestions', 'refreshTopicSuggestions', 'prepareProjectDraftFromSuggestion', 'getGuidancePlan', 'refreshGuidancePlan', 'getGuidanceHistory', 'saveGuidancePreferences', 'getResearchCapabilityStatus'];
  methods.forEach((method) => {
    assert.match(preload, new RegExp(`${method}\\([^)]*\\) \\{[\\s\\S]{0,180}ipcRenderer\\.invoke`));
    assert.match(main, new RegExp(`ipcMain\\.handle\\('bridge:${method}'`));
  });
});

test('research routing is explicit and QClaw is not assumed to support it', () => {
  assert.match(main, /webResearch: false/);
  assert.match(main, /\['workbuddy', 'codex', 'openclaw'\]\.map/);
  assert.doesNotMatch(main, /\['workbuddy', 'codex', 'openclaw', 'qclaw'\]\.map/);
  assert.match(capability, /'research\.search'/);
  assert.match(main, /RESEARCH_CAPABILITY_UNAVAILABLE/);
});

test('planning tasks are represented in the existing task center contract', () => {
  assert.match(main, /topic_suggestion_refresh/);
  assert.match(main, /guidance_research_check/);
  assert.match(planning, /guidance_plan_refresh/);
  assert.match(main, /每月日常任务时间后的首次可用调度/);
});
