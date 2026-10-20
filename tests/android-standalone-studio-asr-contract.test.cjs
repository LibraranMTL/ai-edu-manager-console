const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', 'android-standalone-manager', 'app', 'src', 'main', 'java', 'com', 'qxmatrix', 'edumanager', 'standalone');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('research update is separately consented, monthly/profile-keyed and records unknown before sending', () => {
  const research = read('ResearchUpdateService.kt');
  assert.match(research, /studio-auto:research:/);
  assert.match(research, /optBoolean\("enabled", false\)/);
  assert.ok(research.indexOf('started.toString()') < research.indexOf('service.generate('));
  assert.match(read('StudioAutomation.kt'), /ResearchUpdateService\(applicationContext\).check/);
});
test('cloud summary previews, checks trash, persists unknown and signs exact raw bytes', () => {
  const summary = read('CloudSummaryService.kt');
  assert.match(summary, /findRemote\(true\)/); assert.match(summary, /UnknownOutcomePolicy.retryAllowed\(previous\)/);
  assert.match(summary, /prepare\(preview.studentId, preview.versionId\) == preview/);
  assert.match(read('CloudReportSync.kt'), /ScopedContentPolicy.hash\(bytes\)/);
  assert.match(read('LearningStudioActivity.kt'), /核对实际上传摘要/);
});
test('ordinary digest saves successful response before deterministic idempotent output writes', () => {
  const digest = read('StudentDigestOrchestrator.kt');
  assert.ok(digest.indexOf('content.saveCheckpoint(') < digest.indexOf('store.writeBytesSafely(artifactPath'));
  assert.match(digest, /digest-request:/); assert.match(digest, /claim-\$identity/);
  assert.match(digest, /previousIndex.contains\(artifactPath\)/);
});

test('manual generation previews actual bounded input and detects post-preview changes', () => {
  assert.match(read('LearningStudioActivity.kt'), /StudioInputFactory\(this\)\.prepare/);
  assert.match(read('LearningStudioActivity.kt'), /input\.toString\(2\)/);
  assert.match(read('LearningStudioService.kt'), /expectedPreviewFingerprint/);
  assert.match(read('StudioInputFactory.kt'), /validatePublishedReport/);
});
test('drafts return to explicit project creation and pending audio blocks both complete exports', () => {
  assert.match(read('MainActivity.kt'), /showProjectInputDialog\(false, input\)/);
  assert.match(read('MainActivity.kt'), /row.kind == "draft"/);
  for (const file of ['BackupRestoreService.kt', 'StandaloneDeviceMigrationService.kt']) {
    assert.match(read(file), /PendingAudioBackupGuard.requireArchived/);
  }
  assert.match(read('ProjectDigestQueue.kt'), /write\(root\); return@synchronized null/);
});
test('new scoped content uses additive Room migration and literal student-bound queries', () => {
  const db = read('BusinessDatabase.kt'), content = read('ScopedContent.kt');
  assert.match(db, /version = 3/); assert.match(db, /MIGRATION_2_3/);
  assert.doesNotMatch(db, /fallbackToDestructiveMigration/);
  assert.match(content, /studentId = :studentId/); assert.match(content, /ESCAPE/);
  assert.match(read('ScopedContentRepository.kt'), /masteryConclusion.*JSONObject.NULL/);
});
test('studio separates publication, immutable candidates, pending answers and questions-only print', () => {
  const studio = read('LearningStudioService.kt');
  assert.match(studio, /recentPublished/); assert.match(studio, /studio-review-v1/);
  assert.match(studio, /fieldSources/); assert.match(studio, /response.sources.isNotEmpty/);
  assert.match(read('QuestionsPrintAdapter.kt'), /LearningStudioPolicy.questionsOnly/);
  assert.match(read('LearningStudioActivity.kt'), /QuestionsPrintAdapter/);
});
test('audio is foreground opt-in with independent encrypted configuration and no unknown retry', () => {
  const audio = read('AudioTranscriptionService.kt'), ui = read('AudioIntakeActivity.kt');
  assert.match(audio, /AgentConfigurationStore\(context, "local_asr"\)/);
  assert.match(audio, /local \|\| cloudConsent/); assert.match(audio, /instanceFollowRedirects = false/);
  assert.match(audio, /hasPossibleResult/); assert.match(audio, /machine_observed/);
  assert.match(ui, /onPause\(\).*stopRecording\(\)/);
  assert.match(ui, /授权本次发送/);
});
test('original intake records intent before write and reuses the same event', () => {
  const intake = read('FileAssetService.kt');
  assert.ok(intake.indexOf('prepareIntent(it)') < intake.indexOf('store.writeBytesSafely(logicalPath, bytes, mime)'));
  assert.match(intake, /sourceEventId.ifBlank \{ hash \}/); assert.match(intake, /put\("reused", true\)/);
  assert.match(intake, /compareAndSetIntent/); assert.match(intake, /readBytesBounded/);
});
test('automation defaults off, reserves quota and uses shared student serialization', () => {
  const automation = read('StudioAutomation.kt');
  assert.match(automation, /\?: false/); assert.match(automation, /DAILY_CAP = 6/);
  assert.match(automation, /setRequiresBatteryNotLow\(true\)/);
  assert.match(read('LearningStudioService.kt'), /StudentWorkLocks.forStudent/);
  assert.match(read('BusinessDatabaseBackup.kt'), /restoreRequiresConsent/);
});
test('backup includes safe settings and inert collaboration history, not old device credentials', () => {
  for (const file of ['BackupRestoreService.kt', 'StandaloneDeviceMigrationService.kt']) {
    assert.match(read(file), /PublicSettingsSnapshot.exportBytes/); assert.match(read(file), /CollaborationArchiveSnapshot.exportBytes/);
  }
  assert.match(read('CollaborationArchiveSnapshot.kt'), /inert-history-repair-pairing-required/);
  assert.match(read('CollaborationArchiveSnapshot.kt'), /encryptedsecret/);
  assert.match(read('BusinessRestoreRecovery.kt'), /prefs.optJSONObject\("asr"\)/);
});
