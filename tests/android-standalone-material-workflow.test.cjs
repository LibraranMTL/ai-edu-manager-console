const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.resolve(__dirname, '..')
const source = path.join(repo, 'android-standalone-manager', 'app', 'src', 'main', 'java', 'com', 'qxmatrix', 'edumanager', 'standalone')
const read = (name) => fs.readFileSync(path.join(source, name), 'utf8')

test('course and general captures use the same raw-material registration pipeline', () => {
  const capture = read('CourseCaptureService.kt')
  const assets = read('FileAssetService.kt')
  assert.match(capture, /FileAssetService\(this\)\.registerCapturedFile\(/)
  assert.doesNotMatch(capture, /if \(captureKind == "material"\) FileAssetService/)
  for (const field of ['courseId', 'courseProvider', 'courseUrl']) {
    assert.ok(capture.includes(`${field} = ${field}`))
    assert.ok(assets.includes(`.put("${field}", ${field})`))
  }
  assert.match(assets, /course_screen_capture/)
  assert.match(assets, /PENDING_DIGEST/)
})

test('legacy migrated student IDs are mapped to stable portable knowledge subject IDs', () => {
  const identity = read('KnowledgeSubjectIdentity.kt')
  const workspace = read('StudentWorkspaceService.kt')
  const digest = read('StudentDigestOrchestrator.kt')
  assert.match(identity, /student-legacy-/)
  assert.match(identity, /MessageDigest\.getInstance\("SHA-256"\)/)
  assert.match(workspace, /subject-map\.json/)
  assert.match(workspace, /KnowledgeSubjectIdentity\.mapping\(student\.id\)/)
  assert.match(digest, /"subjectId", engine\.subjectId/)
})

test('home cards preserve an exact actionable or needs-help material filter', () => {
  const activity = read('MainActivity.kt')
  assert.match(activity, /renderSection\(AppSection\.MATERIALS, MaterialQueueFilter\.ACTION_REQUIRED\)/)
  assert.match(activity, /renderSection\(AppSection\.MATERIALS, MaterialQueueFilter\.NEEDS_HELP\)/)
  assert.match(activity, /MaterialStatus\.FAILED/)
  assert.match(activity, /visionStatus"\) in setOf\("failed", "unavailable"\)/)
  assert.match(activity, /captureSessionId/)
})

test('material processing supports bounded multi-select, batch OCR, digest and retry', () => {
  const activity = read('MainActivity.kt')
  const repository = read('FileAssetRepository.kt')
  assert.match(activity, /setMultiChoiceItems/)
  assert.match(activity, /MAX_BATCH_SELECTION = 200/)
  assert.match(activity, /private fun runBatchOcr/)
  assert.match(activity, /private fun runBatchDigest/)
  assert.match(activity, /private fun retryFailedMaterials/)
  assert.match(activity, /digestSelected/)
  assert.doesNotMatch(repository, /items\.take\(1000\)|assets\.take\(5000\)/)
  assert.match(repository, /MAX_MATERIAL_RECORDS = 20_000/)
})

test('raw material browser is read-only, student-rooted and registered in the manifest', () => {
  const browser = read('RawMaterialBrowserActivity.kt')
  const manifest = fs.readFileSync(path.join(repo, 'android-standalone-manager', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8')
  assert.match(browser, /requireExact\(requireNotNull\(intent\.getStringExtra\(EXTRA_STUDENT_ID\)\)\)/)
  assert.match(browser, /student\.paths\.rawPath/)
  assert.match(browser, /store\.listDirectory/)
  assert.match(browser, /FLAG_GRANT_READ_URI_PERMISSION/)
  assert.doesNotMatch(browser, /delete\(|writeBytes|ACTION_EDIT/)
  assert.match(manifest, /\.RawMaterialBrowserActivity/)
})

test('Agent diagnostics independently exercise text and multimodal models without student data', () => {
  const activity = read('MainActivity.kt')
  const adapter = read('AgentAdapter.kt')
  assert.match(activity, /testConnection\(\)/)
  assert.match(activity, /testVisionConnection\(\)/)
  assert.match(activity, /文本模型/)
  assert.match(activity, /视觉模型/)
  assert.match(adapter, /1x1 opaque PNG generated for connectivity checks/)
  assert.match(adapter, /executeVision/)
})
