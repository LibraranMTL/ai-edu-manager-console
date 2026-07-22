const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');
const screening = fs.readFileSync(path.join(root, 'electron', 'project-screening.cjs'), 'utf8');

test('project page exposes one four-step primary workflow', () => {
  const add = ui.indexOf("title: '添加资料'");
  const organize = ui.indexOf("title: 'AI 整理建议'");
  const digest = ui.indexOf("title: '确认并消化'");
  const complete = ui.indexOf("title: '完成项目'");
  assert.ok(add > 0);
  assert.ok(add < organize && organize < digest && digest < complete);
  assert.match(ui, /系统建议下一步/);
  assert.match(ui, /runSelectedProjectNextStep/);
  assert.match(ui, /projectStageCounts\.pendingStaging/);
  assert.doesNotMatch(ui, /title: '暂存治理'/);
});

test('resolved analyzed staging items are not counted as pending work', () => {
  assert.match(ui, /!\['analyzed', 'promoted', 'discarded'\]\.includes\(String\(item\.status\)\)/);
});

test('material organization is a guided workflow with advanced tools kept available', () => {
  assert.match(ui, /project-organize-wizard/);
  assert.match(ui, /复制 Agent 评估指令/);
  assert.match(ui, /粘贴 Agent 评估结果/);
  assert.match(ui, /从文件导入/);
  assert.match(ui, /应用建议保存策略/);
  assert.match(ui, /确认并加入项目知识库/);
  assert.match(ui, /高级筛选、保存策略与批量操作/);
  assert.match(ui, /projectStageFeedback\.assets/);
});

test('Agent material assessment is paste-first, previewed, and auditable', () => {
  for (const method of ['previewProjectStagingAiScreening', 'applyProjectStagingAiScreening', 'importProjectStagingAiScreening']) {
    assert.match(preload, new RegExp(method));
    assert.match(ui, new RegExp(method));
  }
  assert.match(ui, /粘贴 Agent 评估结果/);
  assert.match(ui, /预览匹配/);
  assert.match(ui, /确认应用/);
  assert.match(ui, /从文件导入/);
  assert.match(main, /project_staging_screening_receipt/);
  assert.match(main, /parserVersion: PROJECT_SCREENING_PARSER_VERSION/);
  assert.match(main, /rawText: String\(rawText/);
  assert.match(main, /operator:/);
  assert.match(screening, /matchBasis/);
});

test('staging review and promotion remain one guarded backend operation', () => {
  assert.match(main, /function approveAndPromoteProjectStagingItems/);
  assert.match(main, /reviewProjectStagingItems\(projectId, itemIdsJson, 'accepted'/);
  assert.match(main, /promoteProjectStagingItems\(projectId, itemIdsJson\)/);
  assert.match(main, /bridge:approveAndPromoteProjectStagingItems/);
  assert.match(preload, /approveAndPromoteProjectStagingItems/);
});

test('digest receipt advances project and staging lifecycle automatically', () => {
  assert.match(main, /status: digestCompleted && item\.status === 'active' \? 'pending_review' : item\.status/);
  assert.match(main, /stagingItem\.status === 'promoted'[\s\S]*status: 'analyzed'/);
  assert.match(main, /\['promoted', 'analyzed', 'discarded'\]\.includes/);
  assert.match(ui, /DigestStatusCard/);
  assert.match(ui, /startDigestWorkflowFromPage\('project'/);
  assert.match(ui, /projectStageFeedback\.digest/);
});

test('AI student evidence remains student-specific and requires confirmation', () => {
  assert.match(main, /edu-manager-project-student-evidence/);
  assert.match(main, /function getProjectStudentEvidencePrompt/);
  assert.match(main, /function importProjectStudentEvidenceSuggestions/);
  assert.match(main, /item\.studentId && item\.studentId !== String\(student\.id\)/);
  assert.match(preload, /getProjectStudentEvidencePrompt/);
  assert.match(preload, /importProjectStudentEvidenceSuggestions/);
  assert.match(ui, /生成 AI 证据草稿/);
  assert.match(ui, /确认该学生证据/);
  assert.match(ui, /const targetStatus = draft\.status === 'draft' \? 'verified' : draft\.status/);
  assert.match(ui, /projectStudentEvidenceFeedbacks\[studentId\]/);
  assert.match(ui, /showActionNotice\(Boolean\(result\.ok\), result\.ok \? '证据操作成功' : '证据操作失败'/);
  assert.match(main, /project_student_evidence_updated/);
  assert.match(main, /该学生成长证据\$\{statusLabel\}/);
  assert.match(main, /verifiedStudentEvidenceForPublication\(ensured, student\.id\)/);
});

test('project completion remains a unified gated workflow', () => {
  assert.match(ui, /const prepareProjectCompletion/);
  assert.match(ui, /getProjectCompletionWizard\?\.\(selectedProjectId\)/);
  assert.match(main, /function getProjectCompletionWizard/);
  assert.match(ui, /projectCompletionBlockers/);
  assert.match(ui, /task\.status === 'reviewing' && decision === 'approved'/);
  assert.match(ui, /setActiveSection\('projects-existing'\)/);
  assert.match(ui, /开始完成项目/);
  assert.match(ui, /projectStageFeedback\.promotion/);
});
