'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const script = fs.readFileSync(path.join(__dirname, '../scripts/run-p0-host-performance.ps1'), 'utf8');
const cadencePath = path.join(__dirname, '../scripts/sample-p0-file-cadence.ps1');

test('formal performance runner separates stabilization from measurement and can select idle only', () => {
  assert.match(script, /\[int\]\$WarmupSeconds\s*=\s*120/);
  assert.match(script, /\[string\[\]\]\$Scenarios\s*=/);
  assert.match(script, /Start-Sleep -Seconds \$WarmupSeconds/);
  assert.match(script, /warmupSeconds=\$WarmupSeconds/);
  assert.match(script, /measurementWindow='post_warmup'/);
  assert.match(script, /invalid_performance_scenario/);
});

test('formal performance fixtures stay on the evidence drive unless an explicit root is supplied', () => {
  assert.match(script, /\[string\]\$FixtureRoot\s*=\s*''/);
  assert.match(script, /\$fixtureBase\s*=\s*if\s*\(\$FixtureRoot\)/);
  assert.match(script, /Join-Path \$output 'fixtures'/);
  assert.match(script, /"--allowed-root=\$fixtureBase"/);
  assert.doesNotMatch(script, /\$fixture\s*=\s*Join-Path \(\[IO\.Path\]::GetTempPath\(\)\)/);
});

test('performance summary expects exactly selected scenarios times repeats', () => {
  assert.match(script, /\$expectedRuns\s*=\s*@\(\$Scenarios\)\.Count\s*\*\s*\$Repeats/);
  assert.doesNotMatch(script, /@\(\$results\)\.Count -eq 9/);
});

test('formal performance runner captures repeated writes during the measured window', () => {
  assert.equal(fs.existsSync(cadencePath), true, 'file cadence sampler must exist');
  const cadence = fs.readFileSync(cadencePath, 'utf8');
  assert.match(cadence, /maxConsecutiveChanges/);
  assert.match(cadence, /continuousWriteDetected/);
  assert.match(script, /sample-p0-file-cadence\.ps1/);
  assert.match(script, /fileCadenceSummary/);
  assert.match(script, /-not \$cadence\.continuousWriteDetected/);
});

test('formal performance runner supports isolated real WorkBuddy and Codex workloads', () => {
  assert.match(script, /\[string\]\$SourceWorkBuddyAuth/);
  assert.match(script, /'agent-workbuddy','agent-codex','agent-backlog-workbuddy'/);
  assert.match(script, /\$fixtureScenario\s*=\s*if \(\$scenario -eq 'agent-backlog-workbuddy'\) \{ 'agent-backlog-workbuddy' \} elseif \(\$scenario -eq 'agent-research-codex'\) \{ 'agent-research-codex' \} elseif \(\$scenario -match '\^agent-'\) \{ 'agent-project-task' \}/);
  assert.match(script, /"--agent-provider=\$agentProvider"/);
  assert.match(script, /"--source-workbuddy-auth=\$SourceWorkBuddyAuth"/);
  assert.match(script, /evidenceKind=\$runEvidenceKind/);
  assert.match(script, /agentBusinessCompleted/);
  assert.match(script, /tailQuietIntervals/);
  assert.match(script, /\$agentProvider -and \$tailQuietIntervals -ge 6 -and \$tailChangedIntervals -le 1/);
});

test('formal performance runner exercises Codex research through the production scheduler', () => {
  assert.match(script, /'agent-research-codex'/);
  assert.match(script, /\$scenario -eq 'agent-research-codex'\) \{ 'agent-research-codex' \}/);
  assert.match(script, /agent-0228-research-result\.cjs/);
  assert.match(script, /researchBusinessCompleted/);
  assert.match(script, /\$scenario -eq 'agent-research-codex' -and \$SourceWorkBuddyAuth/);
  assert.match(script, /prepare-p0-workbuddy-research-qualification\.cjs/);
  assert.match(script, /workbuddy-research-qualification\.json/);
  assert.match(script, /Start-Sleep -Seconds 30/);
});

test('performance runner resolves the real Electron main process instead of sampling the portable launcher', () => {
  assert.match(script, /function Resolve-ElectronMainProcess/);
  assert.match(script, /Name\s+-eq\s+'AI Education Manager Console\.exe'/);
  assert.match(script, /CommandLine\s+-notmatch\s+'--type='/);
  assert.match(script, /-MainProcessId \$mainProcessId/);
  assert.doesNotMatch(script, /-MainProcessId \$process\.Id/);
});

test('performance runner exits nonzero when any measured run fails', () => {
  assert.match(script, /if\s*\(-not \$report\.passed\)\s*\{\s*exit 1\s*\}/);
});
