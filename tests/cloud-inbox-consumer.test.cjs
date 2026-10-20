'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { CONTRACT_VERSION } = require('../electron/project-execution-scope.cjs');
const { OUTPUT_FOLDER, processCloudInbox } = require('../electron/cloud-inbox-consumer.cjs');
const { sha256, stableJson } = require('../cloud-report-service/v2-contract.cjs');

function fixture(root, suffix = '1') {
  const fingerprint = suffix.repeat(64).slice(0, 64);
  const item = {
    submissionId: `submission_${suffix.repeat(32).slice(0, 32)}`,
    sessionId: `agent_session_${suffix.repeat(32).slice(0, 32)}`,
    taskId: `task:project:${suffix.padEnd(3, '0')}`,
    executionId: `execution:project:${suffix.padEnd(3, '0')}`,
    taskType: 'project_digest.v2', provider: 'codex', projectId: `project:test:${suffix}`,
    scopeFingerprint: fingerprint, cloudStudentIds: ['cloud_student_a', 'cloud_student_b'],
    status: 'available', leaseExpiresAt: 0,
  };
  item.payload = {
    schema: 'edu-manager.remote-project-result.v2', taskId: item.taskId, executionId: item.executionId, taskType: item.taskType,
    projectId: item.projectId, scopeFingerprint: fingerprint, status: 'completed', title: '云端项目成果',
    content: '经过项目范围和资料来源校验的正文。', sources: [{ materialId: 'material:test:001',
      revisionId: `material_rev_${'a'.repeat(48)}`, contentSha256: 'b'.repeat(64) }],
  };
  item.contentSha256 = sha256(stableJson(item.payload));
  const scope = { contractVersion: CONTRACT_VERSION, scopeType: 'project', projectId: item.projectId,
    studentIds: ['local-a', 'local-b'], knowledgeRootPath: root, readRoots: [root], writeRoots: [root],
    globalPolicyRevision: 1, taskProfile: item.taskType, scopeFingerprint: fingerprint };
  return { item, scope };
}

function fakeRuntime(item) {
  const settlements = [];
  return {
    settlements,
    async listCloudInbox() { return { submissions: [item], nextCursor: '' }; },
    async leaseCloudInboxSubmission() { return { ...item, status: 'leased', leaseId: 'lease_test_001' }; },
    async settleCloudInboxSubmission(submissionId, input) {
      settlements.push({ submissionId, ...input });
      return { submissionId, status: input.status, duplicate: false };
    },
  };
}

test('cloud inbox consumer validates, rechecks and commits a project result inside project knowledge space', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-inbox-consumer-'));
  try {
    const { item, scope } = fixture(root);
    const runtime = fakeRuntime(item);
    const result = await processCloudInbox({ runtime, resolveScope: async () => ({ scope,
      cloudStudentIds: ['cloud_student_b', 'cloud_student_a'], authorizedProvider: true }) });
    assert.equal(result.results[0].status, 'committed');
    const target = path.join(root, OUTPUT_FOLDER, `${item.submissionId}.md`);
    const content = fs.readFileSync(target, 'utf8');
    assert.match(content, /经过项目范围和资料来源校验的正文/);
    assert.match(content, /material_rev_/);
    assert.equal(runtime.settlements[0].status, 'committed');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('cloud inbox consumer quarantines scope changes before writing', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-inbox-scope-before-'));
  try {
    const { item, scope } = fixture(root, '2');
    const runtime = fakeRuntime(item);
    await processCloudInbox({ runtime, resolveScope: async () => ({ scope: { ...scope, scopeFingerprint: 'f'.repeat(64) },
      cloudStudentIds: item.cloudStudentIds, authorizedProvider: true }) });
    assert.equal(runtime.settlements[0].status, 'quarantined');
    assert.equal(fs.existsSync(path.join(root, OUTPUT_FOLDER, `${item.submissionId}.md`)), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('cloud inbox consumer quarantines a result from an obsolete local execution batch', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-inbox-execution-changed-'));
  try {
    const { item, scope } = fixture(root, '5');
    const runtime = fakeRuntime(item);
    await processCloudInbox({ runtime, resolveScope: async () => ({ scope,
      cloudStudentIds: item.cloudStudentIds, authorizedProvider: true, taskCurrent: false }) });
    assert.equal(runtime.settlements[0].status, 'quarantined');
    assert.equal(fs.existsSync(path.join(root, OUTPUT_FOLDER, `${item.submissionId}.md`)), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('cloud inbox consumer removes its exact write and quarantines when scope changes at commit', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-inbox-scope-after-'));
  try {
    const { item, scope } = fixture(root, '3');
    const runtime = fakeRuntime(item);
    let checks = 0;
    await processCloudInbox({ runtime, resolveScope: async () => {
      checks += 1;
      return { scope: checks >= 3 ? { ...scope, scopeFingerprint: 'e'.repeat(64) } : scope,
        cloudStudentIds: item.cloudStudentIds, authorizedProvider: true };
    } });
    assert.equal(runtime.settlements[0].status, 'quarantined');
    assert.match(runtime.settlements[0].reason, /项目范围/);
    assert.equal(fs.existsSync(path.join(root, OUTPUT_FOLDER, `${item.submissionId}.md`)), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('cloud inbox consumer reuses the exact local result after an unknown settle response', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-inbox-settle-retry-'));
  try {
    const { item, scope } = fixture(root, '4');
    const runtime = fakeRuntime(item);
    let settleAttempts = 0;
    runtime.settleCloudInboxSubmission = async (submissionId, input) => {
      settleAttempts += 1;
      if (settleAttempts === 1) throw new Error('网络响应未知');
      runtime.settlements.push({ submissionId, ...input });
      return { submissionId, status: input.status, duplicate: false };
    };
    const resolveScope = async () => ({ scope, cloudStudentIds: item.cloudStudentIds, authorizedProvider: true });
    const first = await processCloudInbox({ runtime, resolveScope });
    assert.equal(first.results[0].status, 'deferred');
    const second = await processCloudInbox({ runtime, resolveScope });
    assert.equal(second.results[0].status, 'committed');
    assert.equal(second.results[0].duplicate, true);
    assert.equal(settleAttempts, 2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
