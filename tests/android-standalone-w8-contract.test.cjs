const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const repo = path.resolve(__dirname, '..');
const root = path.join(repo, 'android-standalone-manager', 'app', 'src', 'main', 'java', 'com', 'qxmatrix', 'edumanager', 'standalone');
const source = fs.readFileSync(path.join(root, 'GrowthModelService.kt'), 'utf8');
const activity = fs.readFileSync(path.join(root, 'MainActivity.kt'), 'utf8');
const evidencePolicy = fs.readFileSync(path.join(root, 'GrowthEvidencePolicy.kt'), 'utf8');
const publicationPolicy = fs.readFileSync(path.join(root, 'EducationPublicationPolicy.kt'), 'utf8');
const reportPolicy = fs.readFileSync(path.join(root, 'ReportDraftPolicy.kt'), 'utf8');
const studentDigest = fs.readFileSync(path.join(root, 'StudentDigestOrchestrator.kt'), 'utf8');
const conversationDigest = fs.readFileSync(path.join(root, 'ConversationDigestService.kt'), 'utf8');
const windowsMain = fs.readFileSync(path.join(repo, 'electron', 'main.cjs'), 'utf8');

test('W8 preserves growth-model v2 and the Windows growth-model files', () => {
  assert.match(source, /edu-manager\.growth-model\.v2/);
  for (const file of ['能力画像.md', '项目贡献.md', '成长证据.md', '成长证据草稿.md', 'growth-index.json', 'growth-index.md', '成长证据审核.json']) {
    assert.match(windowsMain, new RegExp(file.replace('.', '\\.')));
    assert.match(source, new RegExp(file.replace('.', '\\.')));
  }
});

test('W8 keeps evidence candidate, review states and local governance audit fields', () => {
  assert.match(source, /edu-manager\.growth-evidence\.v1/);
  for (const status of ['pending', 'confirmed', 'watching', 'rejected']) assert.match(source, new RegExp(`"${status}"`));
  assert.match(source, /reviewerRole.*administrator/s); assert.match(source, /reviewerId.*local-user/s); assert.match(source, /reviewHistory/);
  assert.match(source, /sourceUri/); assert.match(source, /originalSourcePath/);
});

test('W8 retains all four reports and the weekly-title versus legacy-filename compatibility', () => {
  for (const file of ['整体画像.md', '历史变化.md', '每日行动建议.md', '阶段总结.md']) assert.match(source, new RegExp(file.replace('.', '\\.')));
  assert.match(source, /每周行动建议/); assert.match(source, /weekly_action/);
  assert.match(source, /presentation_only: true/); assert.match(source, /source_layer: growth_model/);
});

test('W8 directly publishes evidence-bound reports and protects existing report content', () => {
  assert.match(source, /fun generateAndPublishReports/); assert.match(source, /reportHeader\(student, d, "active"/);
  assert.match(activity, /找到已有报告，未自动覆盖/); assert.match(activity, /确认更新并发布/);
  assert.match(source, /只引用给定的已确认证据/); assert.match(source, /当前没有已确认的成长证据/);
  for (const status of ['published', 'current', 'updated', 'active']) assert.match(publicationPolicy, new RegExp(`"${status}"`));
});

test('W8 report output chooser renders selectable rows without a competing message panel', () => {
  const chooser = activity.slice(activity.indexOf('private fun chooseReportForPublication'), activity.indexOf('private fun confirmReportGeneration'));
  assert.match(chooser, /选择报告（\$\{definitions\.size\} 份）/);
  assert.match(chooser, /setItems\(definitions\.map \{ it\.title \}/);
  assert.doesNotMatch(chooser, /已找到 \$\{definitions\.size\} 份可输出报告/);
});

test('W8 growth and report surfaces keep user-facing states readable and print after page readiness', () => {
  assert.match(activity, /growthStatusLabel/);
  assert.match(activity, /已关联原始资料/);
  assert.match(activity, /暂无学情报告/);
  assert.doesNotMatch(activity, /证据状态已更新为 \$status/);
  const publication = fs.readFileSync(path.join(root, 'EducationPublicationActivity.kt'), 'utf8');
  assert.match(publication, /prepareWebViewForOutput\([^)]*\) \{/);
  assert.match(publication, /record\.sourceTitle/);
  assert.match(publication, /prepareWebViewForOutput\("pdf"\)/);
  const printFlow = publication.slice(publication.indexOf('private fun printDocument'), publication.indexOf('private fun chooseSaveDestination'));
  assert.doesNotMatch(printFlow, /format = "pdf"/);
  assert.doesNotMatch(publication, /postDelayed\(\{[\s\S]*printManager\.print/);
});

test('W8 repairs legacy source fields without confirming a historical report as primary evidence', () => {
  assert.match(evidencePolicy, /sourcePath.*migratedFrom.*originalSourcePath/s);
  assert.match(evidencePolicy, /historical_secondary_source/);
  assert.match(evidencePolicy, /requiresPrimarySource/);
  assert.match(source, /attachCandidateSource/);
  assert.match(activity, /历史报告不能作为自身证据/);
  assert.match(activity, /选择支撑这条证据的原始资料/);
  assert.match(activity, /选择资料并确认/);
  assert.doesNotMatch(activity, /来源 URI\/文件标识（必填）/);
});

test('W8 automatically registers deduplicated digest evidence as pending review', () => {
  assert.match(source, /fun addAutomaticCandidate/);
  assert.match(source, /automaticId/);
  assert.match(source, /status", "pending"/);
  for (const digest of [studentDigest, conversationDigest]) {
    assert.match(digest, /growthEvidence/);
    assert.match(digest, /addAutomaticCandidate/);
  }
  assert.match(activity, /审核待确认成长证据/);
  assert.match(activity, /高级：手工添加成长证据/);
});

test('W8 direct report publication uses conservative complete-section fallbacks', () => {
  assert.match(reportPolicy, /complete\(/);
  assert.match(reportPolicy, /资料不足/);
  assert.match(reportPolicy, /未确认依据/);
  assert.doesNotMatch(source, /草稿缺少章节/);
  assert.match(source, /fallbackSectionCount/);
  assert.match(activity, /生成并发布报告/);
});
