const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.resolve(__dirname, '..')
const source = path.join(repo, 'android-standalone-manager', 'app', 'src', 'main', 'java', 'com', 'qxmatrix', 'edumanager', 'standalone')
const read = (name) => fs.readFileSync(path.join(source, name), 'utf8')

test('phone and tablet navigation share five stable learning-loop destinations', () => {
  const navigation = read('StandaloneNavigation.kt')
  const main = read('MainActivity.kt')
  assert.match(navigation, /enum class PrimaryDestination/)
  assert.match(navigation, /HOME\(AppSection\.HOME\).*MATERIALS\(AppSection\.MATERIALS\).*REPORTS\(AppSection\.REPORTS\).*LEARNING\(AppSection\.LEARNING\).*PROJECTS\(AppSection\.PROJECTS\)/s)
  assert.match(main, /AppSection\.MATERIALS to "收集整理".*AppSection\.REPORTS to "教育档案".*AppSection\.LEARNING to "学习行动".*AppSection\.PROJECTS to "项目成果"/s)
  assert.match(main, /section\.displayLabel\(this@MainActivity\)/)
  assert.match(main, /contentDescription = label.*ellipsize = null.*minHeight = dp\(64\)/s)
  assert.match(main, /YouthUi\.applyButton\(button, palette,[^\n]+\)\s*if \(!wideLayout[^\n]+configurePortraitNavigationButton/)
  assert.match(main, /primarySections\(\)\.forEach/)
  assert.doesNotMatch(main, /themedButton\("全部"/)
})

test('home presents collection, digestion, reports and learning as one feedback loop', () => {
  const main = read('MainActivity.kt')
  for (const label of ['1　收集资料', '2　整理消化', '3　学情报告', '4　学习行动']) assert.ok(main.includes(label))
  assert.match(main, /学习作答、反馈和复测会保存为新证据/)
  assert.doesNotMatch(main.slice(main.indexOf('private fun renderHome'), main.indexOf('private fun renderArchives')), /模型任务诊断|已完成识别|知识更新|报告与档案/)
})

test('material workspace separates intake, progress and results and hides technical tools', () => {
  const main = read('MainActivity.kt')
  assert.match(main, /ADD\("添加资料"\), PROGRESS\("处理进度"\), RESULTS\("整理结果"\)/)
  assert.match(main, /if \(uiState\.materialAdvanced\)/)
  assert.match(main, /高级与诊断/)
  assert.match(main, /资料自动处理已开启/)
})

test('learning and report entries open the shared insights screen at the intended tab', () => {
  const main = read('MainActivity.kt')
  const insights = read('LearningInsightsActivity.kt')
  assert.match(main, /openLearningInsights\(LearningInsightsActivity\.TAB_MASTERY\)/)
  assert.match(main, /openLearningInsights\(LearningInsightsActivity\.TAB_REPORTS\)/)
  assert.match(insights, /EXTRA_INITIAL_TAB/)
  assert.match(insights, /TAB_TIMELINE/)
  assert.match(insights, /openTimelineSource/)
  assert.match(insights, /openReportRevision/)
})

test('student management and settings remain utility routes while growth stays in education archives', () => {
  const main = read('MainActivity.kt')
  const reportsStart = main.indexOf('private fun renderReports')
  const projectStart = main.indexOf('private fun renderProjects')
  const settingsStart = main.indexOf('private fun renderSettings')
  const reportsPage = main.slice(reportsStart, projectStart)
  const projectPage = main.slice(projectStart, settingsStart)
  assert.match(main, /setPositiveButton\("管理学生档案"/)
  assert.match(main, /contentDescription = "打开系统设置"/)
  assert.match(reportsPage, /addGrowthModelActions\(\)/)
  assert.doesNotMatch(projectPage, /addGrowthModelActions\(\)/)
  assert.match(projectPage, /规划与成果/)
})

test('utility routes survive process state saving before primary navigation normalization', () => {
  const state = read('StandaloneUiState.kt')
  const main = read('MainActivity.kt')
  assert.match(state, /saved\.get<String>\(KEY_SECTION\) \?: section\.name/)
  assert.match(main, /restoredSectionRaw == AppSection\.ARCHIVES\.name/)
  assert.match(main, /if \(reopenStudentManager\).*renderSection\(AppSection\.ARCHIVES\)/)
})
