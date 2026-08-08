const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repo = path.resolve(__dirname, '..');
const sourceRoot = path.join(repo, 'android-standalone-manager', 'app', 'src', 'main', 'java', 'com', 'qxmatrix', 'edumanager', 'standalone');
const androidEngine = fs.readFileSync(path.join(sourceRoot, 'LlmWikiKnowledgeEngine.kt'), 'utf8');
const studentService = fs.readFileSync(path.join(sourceRoot, 'StudentWorkspaceService.kt'), 'utf8');
const windowsEngine = fs.readFileSync(path.join(repo, 'electron', 'llm-wiki-knowledge-engine.cjs'), 'utf8');
const { REQUIRED_METHODS, KNOWLEDGE_ENGINE_CONTRACT_VERSION } = require('../electron/knowledge-engine-contract.cjs');

test('W3 implements every authoritative KnowledgeEngine v1 operation', () => {
  assert.match(androidEngine, /ProtocolBaseline\.KNOWLEDGE_ENGINE_CONTRACT_VERSION/);
  assert.equal(KNOWLEDGE_ENGINE_CONTRACT_VERSION, 'edu-manager.knowledge-engine.v1');
  for (const method of REQUIRED_METHODS) {
    assert.match(androidEngine, new RegExp(`fun ${method}\\(`));
  }
});

test('W3 preserves the Windows engine directory and schema contracts', () => {
  for (const name of ['knowledge-engine-v1', 'sources', 'claims', 'claim-history', 'relationships', 'events.jsonl', 'exports']) {
    assert.match(windowsEngine, new RegExp(name.replace('.', '\\.')));
    assert.match(androidEngine, new RegExp(name.replace('.', '\\.')));
  }
  for (const schema of ['edu-manager.source.v1', 'edu-manager.claim.v1', 'edu-manager.knowledge-event.v1', 'edu-manager.relationship.v1', 'edu-manager.knowledge-export.v1']) {
    assert.match(androidEngine, new RegExp(schema.replaceAll('.', '\\.')));
  }
});

test('W3 preserves immutable sources, claim history, evidence gates and portable IDs', () => {
  assert.match(androidEngine, /IMMUTABLE_SOURCE_CONFLICT/);
  assert.match(androidEngine, /CONFIRMED_WITHOUT_EVIDENCE/);
  assert.match(androidEngine, /CLAIM_HISTORY/);
  assert.match(androidEngine, /candidate.*confirmed.*rejected.*superseded/s);
  assert.match(androidEngine, /\^\[A-Za-z0-9\]\[A-Za-z0-9\._:-\]/);
});

test('W3 binds one engine to one exact student id and AGENT rules prohibit cross-student reads', () => {
  assert.match(studentService, /students\.requireExact\(studentId\)/);
  assert.match(studentService, /只处理本学生档案范围内的资料，不读取其他学生目录/);
  assert.match(androidEngine, /SUBJECT_SCOPE_MISMATCH/);
  assert.match(androidEngine, /不得跨学生检索知识声明/);
});
