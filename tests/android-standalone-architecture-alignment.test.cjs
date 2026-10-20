const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const repo = path.resolve(__dirname, '..');
const app = path.join(repo, 'android-standalone-manager', 'app');
const root = path.join(app, 'src/main/java/com/qxmatrix/edumanager/standalone');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('alignment ledger freezes nullable usage and privacy-preserving Room schema without destructive migration', () => {
  const database = read('BusinessDatabase.kt');
  const schema = JSON.parse(fs.readFileSync(path.join(app, 'schemas/com.qxmatrix.edumanager.standalone.BusinessDatabase/1.json'), 'utf8'));
  assert.equal(schema.database.version, 1);
  const calls = schema.database.entities.find((entity) => entity.tableName === 'model_calls');
  assert.ok(calls);
  const fields = new Map(calls.fields.map((field) => [field.columnName, field]));
  for (const key of ['inputTokens', 'outputTokens', 'totalTokens']) assert.equal(fields.get(key).notNull, false);
  for (const secret of ['apiKey', 'prompt', 'answer', 'studentName', 'endpoint']) assert.equal(fields.has(secret), false);
  assert.ok(fields.has('processSession'));
  assert.match(database, /processSession != :session/);
  assert.doesNotMatch(database, /allowMainThreadQueries|fallbackToDestructiveMigration/);
  assert.ok(schema.database.entities.some((entity) => entity.tableName === 'file_operation_intents'));
});

test('alignment student index recovery stops before writes and remains explicitly user controlled', () => {
  const repository = read('StudentIndexRepository.kt');
  const store = read('StudentIndexStore.kt');
  const main = read('MainActivity.kt');
  assert.match(repository, /StudentIndexStore/);
  assert.doesNotMatch(repository, /catch[^]*emptyList/);
  assert.match(store, /archiveDamaged\(damaged\)[^]*storage.write\(encode\(next\)\)/);
  assert.match(store, /当前学生索引可正常读取，不能覆盖恢复/);
  assert.match(main, /恢复前复核/);
  assert.match(main, /if \(!checkStudentIndex\(\)\) return/);
});

test('alignment categories come from actual SAF folders and keep independent digest status', () => {
  const service = read('LocalProjectMaterialService.kt');
  const ui = read('ProjectMaterialsActivity.kt');
  assert.match(service, /listDirectory\(project\.paths\.workspacePath\)/);
  assert.match(service, /adoptExplicitDirectory/);
  assert.match(service, /digestPending/);
  assert.match(service, /persisted == registry.optInt\("revision"\)/);
  assert.match(ui, /service.categories\(project.id\)/);
  assert.doesNotMatch(ui, /LocalProjectMaterialPolicy.categories/);
  assert.match(ui, /undoLatestOrganization/);
  assert.match(ui, /recoverOrganization/);
});

test('alignment provider is used by existing digest, OCR, and publication pipelines', () => {
  const adapter = read('AgentAdapter.kt');
  assert.match(adapter, /CompatibleModelProvider/);
  assert.match(adapter, /mayReuseCredential/);
  for (const name of ['ConversationDigestService.kt', 'StudentDigestOrchestrator.kt', 'OcrVisionService.kt']) {
    assert.match(read(name), /OpenAiCompatibleAgentAdapter\([^]*context, student/);
  }
  assert.match(read('EducationPublicationActivity.kt'), /OpenAiCompatibleAgentAdapter\(configuration, this, student.id\)/);
  const provider = read('ModelProvider.kt');
  assert.match(provider, /search_info/);
  assert.match(provider, /sources.isNotEmpty/);
  assert.match(provider, /timeout_unknown/);
});
