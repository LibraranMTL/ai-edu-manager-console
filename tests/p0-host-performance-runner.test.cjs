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
  assert.match(script, /'agent-workbuddy','agent-codex'/);
  assert.match(script, /\$fixtureScenario\s*=\s*if \(\$scenario -match '\^agent-'\) \{ 'agent-project-task' \}/);
  assert.match(script, /"--agent-provider=\$agentProvider"/);
  assert.match(script, /"--source-workbuddy-auth=\$SourceWorkBuddyAuth"/);
  assert.match(script, /evidenceKind=\$runEvidenceKind/);
  assert.match(script, /agentBusinessCompleted/);
  assert.match(script, /tailQuietIntervals/);
  assert.match(script, /\$agentProvider -and \$tailQuietIntervals -ge 3/);
});
