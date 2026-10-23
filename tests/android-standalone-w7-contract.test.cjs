const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const repo = path.resolve(__dirname, '..');
const app = path.join(repo, 'android-standalone-manager', 'app');
const root = path.join(app, 'src', 'main', 'java', 'com', 'qxmatrix', 'edumanager', 'standalone');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const ocr = read('OcrVisionService.kt'); const tools = read('ControlledFileTools.kt'); const tasks = read('TaskRepository.kt'); const agent = read('AgentAdapter.kt');

test('W7 bundles the official Chinese ML Kit OCR model and supports images plus bounded PDFs', () => {
  const gradle = fs.readFileSync(path.join(app, 'build.gradle.kts'), 'utf8');
  assert.match(gradle, /com\.google\.mlkit:text-recognition-chinese:16\.0\.1/);
  assert.match(ocr, /ChineseTextRecognizerOptions/); assert.match(ocr, /PdfRenderer/); assert.match(ocr, /MAX_PDF_PAGES = 50/);
  assert.match(ocr, /mlkit-text-recognition-chinese-16\.0\.1/);
});

test('W7 keeps OCR local and sends only an explicit compressed preview for optional vision', () => {
  assert.match(ocr, /仅|candidateOnly|机器提取候选/);
  assert.match(ocr, /includeVision/); assert.match(ocr, /previewJpeg/); assert.match(agent, /executeVision/);
  assert.match(agent, /data:\$mimeType;base64/);
  assert.match(ocr, /不推断学生身份、人格、能力或诊断/);
});

test('W7 file tools require live task identity, exact student scope, operation and path authorization', () => {
  assert.match(tools, /tasks\.authorize/); assert.match(tools, /students\.requireExact/); assert.match(tools, /任务与学生范围不一致/);
  assert.match(tasks, /executionId.*executionId/); assert.match(tasks, /status.*running/); assert.match(tasks, /任务未授权操作/); assert.match(tasks, /文件工具目标超出任务授权范围/);
  assert.doesNotMatch(fs.readFileSync(path.join(app, 'src', 'main', 'AndroidManifest.xml'), 'utf8'), /MANAGE_EXTERNAL_STORAGE/);
});

test('W7 writes auditable OCR artifacts without directly publishing education claims', () => {
  assert.match(ocr, /edu-manager\.ocr-result\.v1/); assert.match(ocr, /sourceSha1/); assert.match(ocr, /ocrStatus/); assert.match(ocr, /candidateOnly/);
  assert.doesNotMatch(ocr, /upsertClaim|confirmed/);
  const digest = read('StudentDigestOrchestrator.kt');
  const policy = read('MaterialProcessingPolicy.kt');
  const resolver = read('MaterialDigestSourceResolver.kt');
  assert.match(digest, /MaterialProcessingPolicy::digestReady/);
  assert.match(policy, /ocrStatus"\) == "completed"/);
  assert.match(policy, /ocrPath[\s\S]*ocrMarkdownPath/);
  assert.match(digest, /MaterialDigestSourceResolver/);
  assert.match(resolver, /readLogicalBytes/);
  assert.match(digest, /status", "candidate"/);
});
