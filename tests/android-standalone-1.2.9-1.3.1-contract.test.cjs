const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = path.join(__dirname, '..', 'android-standalone-manager', 'app');
const java = path.join(app, 'src', 'main', 'java', 'com', 'qxmatrix', 'edumanager', 'standalone');
const read = (name) => fs.readFileSync(path.join(java, name), 'utf8');

test('1.3.5 code 39 keeps assistant and gateway removed while preserving conversation intake', () => {
  const build = fs.readFileSync(path.join(app, 'build.gradle.kts'), 'utf8');
  const main = read('MainActivity.kt');
  const manifest = fs.readFileSync(path.join(app, 'src', 'main', 'AndroidManifest.xml'), 'utf8');
  assert.match(build, /versionCode = 39/);
  assert.match(build, /versionName = "1\.3\.5"/);
  assert.doesNotMatch(main, /AI助手问答|AppSection\.ASSISTANT|renderAssistant|Agent 工具适配|getLaunchIntentForPackage/);
  assert.doesNotMatch(manifest, /com\.palmclaw|com\.openai\.chatgpt|QUERY_ALL_PACKAGES/);
  assert.match(manifest, /<queries>[\s\S]*android\.media\.action\.IMAGE_CAPTURE[\s\S]*<\/queries>/);
  assert.doesNotMatch(main, /受控模型网关|知识与协作|showGatewaySettings/);
  assert.ok(!fs.existsSync(path.join(java, 'ModelGatewayProvider.kt')));
  assert.ok(!fs.existsSync(path.join(java, 'ModelGatewaySessionClient.kt')));
  assert.match(main, /renderSection\(AppSection\.MATERIALS\)\s*\n\s*showConversationImportMenu/);
  for (const file of ['ConversationImportService.kt', 'ConversationDigestService.kt', 'ConversationKnowledgeActivity.kt', 'ConversationKnowledgeGovernanceService.kt']) {
    assert.ok(fs.existsSync(path.join(java, file)), `${file} must be retained`);
  }
});

test('learning insights require cross-time reviewed evidence and archive report sets append-only', () => {
  const insights = read('LearningInsightsStore.kt');
  const growth = read('GrowthModelService.kt');
  assert.match(insights, /correctDates\.size >= 2 -> "较稳定"/);
  assert.match(insights, /related\.isNotEmpty\(\) -> "学习中"/);
  assert.match(insights, /else -> "待验证"/);
  assert.match(insights, /studentId.*sourceId.*time/s);
  assert.match(insights, /contentFingerprint/);
  assert.match(insights, /report-revisions-/);
  assert.match(growth, /archiveReportSet/);
});

test('cloud sync defaults to reports and keeps five categories independently scoped', () => {
  const cloud = read('CloudReportSync.kt');
  const ui = read('CloudSyncActivity.kt');
  assert.match(cloud, /defaultMaterialCategories = listOf\("learning_report"\)/);
  for (const category of ['learning_report', 'learning_material', 'topic_suggestion', 'competition_recommendation', 'learning_card']) {
    assert.match(cloud, new RegExp(category));
  }
  assert.match(cloud, /setUploadScope/);
  assert.match(cloud, /selectRawMaterial/);
  assert.match(cloud, /LearningStudioPolicy\.questionsOnly/);
  assert.match(ui, /逐项选择学习资料原件/);
  assert.match(ui, /等待发送|网络恢复|已送达|撤回|需要帮助/);
});

test('remote Agent uses a separate viewer identity and commits only a scoped candidate', () => {
  const cloud = read('CloudReportSync.kt');
  const ui = read('CloudSyncActivity.kt');
  const repo = read('ScopedContentRepository.kt');
  assert.match(cloud, /INBOX_SIGNING_ALIAS/);
  assert.match(cloud, /enableCloudInbox/);
  assert.match(cloud, /issueRemoteAgentSession/);
  assert.match(cloud, /15 \* 60 \* 1000/);
  assert.match(repo, /insertInboxCandidate/);
  assert.match(repo, /"inbox_candidate"/);
  assert.match(ui, /未直接修改成长模型、报告或已确认知识/);
});

test('report scheduling and project closure remain constrained and reviewable', () => {
  const schedule = read('ReportSchedule.kt');
  const policy = read('BackgroundWorkPolicy.kt');
  const project = read('ProjectDashboardService.kt');
  const center = read('TaskCenterActivity.kt');
  assert.match(schedule, /"reminder"/);
  assert.match(schedule, /BackgroundWorkPolicy\.unmeteredChargingConstraints/);
  assert.match(policy, /NetworkType\.UNMETERED/);
  assert.match(policy, /setRequiresCharging\(true\)/);
  for (const item of ['待处理资料', '未确认知识', '成果未确认', '同步状态待核对', '备份未确认']) assert.match(project, new RegExp(item));
  assert.match(center, /"active" to "处理中"/);
  assert.match(center, /"help" to "归属待确认"/);
  assert.match(center, /"history" to "历史记录"/);
  assert.match(center, /高级详情（技术回执与安全上限）/);
});

test('1.3.1 centralizes high-growth Room indexes, bounded network and performance gates', () => {
  const room = read('HighGrowthRoomStore.kt');
  const network = read('UnifiedNetworkClient.kt');
  const scoped = read('ScopedContent.kt');
  const profile = fs.readFileSync(path.join(app, 'src', 'main', 'baseline-prof.txt'), 'utf8');
  const benchmark = fs.readFileSync(path.join(app, '..', 'benchmark', 'src', 'main', 'java', 'com', 'qxmatrix', 'edumanager', 'standalone', 'benchmark', 'StandaloneMacrobenchmark.kt'), 'utf8');
  for (const kind of ['GROWTH_EVIDENCE', 'GROWTH_SNAPSHOT', 'REPORT_REVISION', 'CONVERSATION_CANDIDATE', 'LEARNING_EVENT', 'SYNC_RECEIPT']) assert.match(room, new RegExp(kind));
  assert.match(room, /迁移数量校验失败/);
  assert.match(scoped, /LIMIT :limit OFFSET :offset/);
  assert.match(network, /maxResponseBytes/);
  assert.match(network, /followRedirects/);
  assert.match(network, /NetworkFailureKind/);
  assert.match(profile, /MainActivity/);
  assert.match(benchmark, /StartupTimingMetric/);
  assert.match(benchmark, /FrameTimingMetric/);
});
