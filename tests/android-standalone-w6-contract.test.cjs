const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const repo = path.resolve(__dirname, '..');
const root = path.join(repo, 'android-standalone-manager', 'app', 'src', 'main', 'java', 'com', 'qxmatrix', 'edumanager', 'standalone');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const protocol = read('TaskProtocol.kt'); const repository = read('TaskRepository.kt'); const agent = read('AgentAdapter.kt'); const digest = read('StudentDigestOrchestrator.kt');
const windowsProtocol = require('../electron/task-protocol.cjs');

test('W6 preserves Task Protocol 1.2 and all Windows status transitions', () => {
  assert.equal(windowsProtocol.TASK_PROTOCOL_VERSION, '1.2');
  assert.match(protocol, /const val VERSION = "1\.2"/);
  for (const [from, targets] of Object.entries(windowsProtocol.TASK_STATUS_TRANSITIONS)) {
    assert.match(protocol, new RegExp(`"${from}"`));
    for (const target of targets) assert.match(protocol, new RegExp(`"${target}"`));
  }
  assert.match(protocol, /任务成功前必须进入 reviewing/);
});

test('W6 validates protocol, task and execution identity before accepting Agent results', () => {
  assert.match(protocol, /PROTOCOL_MISMATCH/); assert.match(protocol, /TASK_ID_MISMATCH/); assert.match(protocol, /EXECUTION_ID_MISMATCH/); assert.match(protocol, /TASK_STATUS_MISMATCH/);
  assert.match(repository, /validateExternalResult/); assert.match(repository, /"reviewing"/); assert.match(repository, /"succeeded"/);
  assert.match(repository, /task-center\/tasks\.json/); assert.match(repository, /task-center\/events\.jsonl/);
});

test('W6 adapts permissions to SAF logical paths and keeps high-risk approval governance', () => {
  assert.match(protocol, /WorkspacePath::segments/); assert.match(protocol, /高风险任务必须声明写入范围和操作/);
  assert.match(repository, /高风险任务必须先由用户批准/);
  assert.match(repository, /reviewerRole.*administrator/s); assert.match(repository, /reviewerId.*local-user/s);
  assert.doesNotMatch(repository, /host|tailscale|pair/i);
});

test('W6 keeps education orchestration in the Education Manager and Agent only produces candidates', () => {
  assert.match(digest, /StudentDigestOrchestrator/); assert.match(digest, /status", "candidate"/); assert.match(digest, /不得输出学生人格、能力或诊断性标签/);
  assert.match(digest, /knowledgeEngine\(student\.id\)/); assert.match(digest, /transitionMaterial/);
  assert.match(agent, /OpenAiCompatibleAgentAdapter/); assert.match(agent, /AndroidKeyStore/); assert.match(agent, /AES\/GCM\/NoPadding/);
  assert.doesNotMatch(agent, /println|Log\.|printStackTrace/);
});
