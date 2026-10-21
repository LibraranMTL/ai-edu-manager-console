const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'android-standalone-manager', 'app', 'src', 'main', 'java', 'com', 'qxmatrix', 'edumanager', 'standalone');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('1.2.1 exposes archive categories and explicit student removal', () => {
  const activity = read('MainActivity.kt');
  const index = read('StudentIndexRepository.kt');
  const store = read('SafWorkspaceStore.kt');
  assert.match(activity, /themedButton\("更多管理"[\s\S]*showStudentManagement\(student\)/);
  assert.match(activity, /"资料摘要", "综合汇总", "问答精华"/);
  assert.match(activity, /"原始资料", "全部文件"/);
  assert.match(activity, /removeStudent\(student, true\)/);
  assert.match(index, /fun remove\(studentId: String\)/);
  assert.match(store, /fun deleteDirectoryTree\(/);
});

test('1.2.1 filters digest candidates and keeps auditable digest history', () => {
  const activity = read('MainActivity.kt');
  const orchestrator = read('StudentDigestOrchestrator.kt');
  const assets = read('FileAssetRepository.kt');
  assert.match(activity, /filter \{ materialPending\(it\) && digestEligible\(it\) \}/);
  assert.match(activity, /digestArtifactPath/);
  assert.match(activity, /digestAttemptedAt/);
  assert.match(orchestrator, /digestResult/);
  assert.match(orchestrator, /digestError/);
  assert.match(assets, /alreadyDigested/);
});

test('1.2.1 schedules constrained daily automatic digestion', () => {
  const worker = read('AutoDigestWorker.kt');
  const activity = read('MainActivity.kt');
  assert.match(worker, /PeriodicWorkRequestBuilder<AutoDigestWorker>/);
  assert.match(worker, /NetworkType\.CONNECTED/);
  assert.match(worker, /setRequiresCharging\(value\.chargingOnly\)/);
  assert.match(worker, /StudentDigestOrchestrator\(applicationContext\)\.digestSelected/);
  assert.match(activity, /AutoDigestSettingsStore/);
  assert.match(activity, /showAutoDigestSettings/);
});

test('1.2.1 reuses governed conversation import from material collection', () => {
  const activity = read('MainActivity.kt');
  const matches = activity.match(/YouthAction\([^\n]*showConversationImportMenu\(\)/g) || [];
  assert.equal(matches.length, 1, 'conversation import should remain in material collection after assistant removal');
  assert.match(activity, /对话资料与候选知识/);
});

test('1.2.1 vision diagnostics use a non-student image accepted by common model limits', () => {
  const adapter = read('AgentAdapter.kt');
  assert.match(adapter, /128x128 application-generated PNG/);
  assert.match(adapter, /Bitmap\.createBitmap\(128, 128/);
  assert.match(adapter, /contains no user data/);
});
