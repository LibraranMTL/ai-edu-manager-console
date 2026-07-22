const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');
const card = fs.readFileSync(path.join(root, 'src', 'DigestStatusCard.tsx'), 'utf8');

test('one-click digest workflow crosses renderer, preload and main process', () => {
  for (const method of ['startDigestWorkflow', 'getDigestWorkflowStatus', 'getDigestWorkflowCommand', 'retryDigestWorkflow', 'importDigestWorkflowResultText']) {
    assert.match(preload, new RegExp(method));
    assert.match(main, new RegExp(`bridge:${method}`));
    assert.match(renderer, new RegExp(method));
  }
  assert.match(main, /createDigestOrchestrator/);
  assert.match(main, /startDigestWorkflowMonitor/);
  assert.match(main, /setInterval\(\(\) => reconcileDigestWorkflows\(\), 5000\)/);
});

test('digest command copy uses the current frozen batch and reports clipboard feedback', () => {
  assert.match(main, /function getDigestWorkflowCommand\(scopeType, scopeId\)/);
  assert.match(main, /attachDigestBatchToTask/);
  assert.match(renderer, /copyDigestWorkflowCommandFromPage/);
  assert.match(renderer, /复制当前批次指令/);
  assert.match(renderer, /await copyText\(result\.command/);
  assert.match(renderer, /showActionNotice\(false, '复制失败'/);
});

test('digest execution respects the bound Agent and terminal failures can be retried', () => {
  assert.match(main, /configuredDigestExecutor\(scopeType, scopeId, requestedExecutor\)/);
  assert.match(main, /requestedCandidate\?\.available \? requestedCandidate/);
  assert.match(main, /business\.pendingCount > 0 \|\| Number\(business\.submittedCount \|\| 0\) > 0/);
  assert.match(main, /app\.asar\.unpacked/);
});

test('student digest freezes a strict batch and settles only exact receipt entries', () => {
  assert.match(main, /function registerStudentDigestBatch/);
  assert.match(main, /buildDigestBatch\(/);
  assert.match(main, /studentDigestBatchPath/);
  assert.match(main, /validateDigestResult\(\{/);
  assert.match(main, /requireMaterialId: true/);
  assert.match(main, /status: 'processed'/);
  assert.match(main, /status: 'pending_digest'/);
  assert.match(main, /artifacts_not_updated/);
});

test('validated digest results auto-accept while other task reviews remain intact', () => {
  assert.match(main, /function commitValidatedTaskResult/);
  assert.match(main, /shouldAutoAccept\(task, validation\)/);
  assert.match(main, /digest_result_auto_accepted/);
  assert.match(main, /completionPolicy: 'auto_after_validation'/);
  assert.match(main, /if \(task\.status === 'reviewing'\)/);
  assert.match(main, /digest_completion_policy_migrated/);
  assert.match(main, /digest_business_state_reconciled/);
  assert.match(main, /businessAlreadySettled/);
});

test('ordinary digest UI has one main action and technical tools are folded away', () => {
  assert.match(renderer, /<DigestStatusCard/);
  assert.match(card, /开始处理/);
  assert.match(card, /重试未完成项/);
  assert.match(card, /查看新增知识/);
  assert.match(card, /<details className="digest-advanced">/);
  assert.match(renderer, /digest-advanced-audit/);
});
