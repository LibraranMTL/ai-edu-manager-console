'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');

function section(startText, endText) {
  const start = main.indexOf(startText);
  assert.notEqual(start, -1, `missing section: ${startText}`);
  const end = main.indexOf(endText, start + startText.length);
  assert.notEqual(end, -1, `missing section end: ${endText}`);
  return main.slice(start, end);
}

test('user connection checks carry a transient user origin and no longer pre-block on every child process', () => {
  const workBuddy = section('async function detectWorkBuddyBackgroundAuthorization', 'async function detectCodexBackgroundAuthorization');
  const codex = section('async function detectCodexBackgroundAuthorization', 'function currentStudentAgentStatus');
  const center = section('async function agentControlAction', 'function classificationAuth');
  assert.match(workBuddy, /acquireUserAgentProbe\('workbuddy-probe'/);
  assert.doesNotMatch(workBuddy, /taskChildProcesses\.size \|\| captureHeavyWorkGate\.state\(\)\.length/);
  assert.match(codex, /acquireUserAgentProbe\('codex-probe'/);
  for (const marker of ['cli-contract-', '-research-center', 'builtin-contract-', 'llm-api-center', 'agent-center']) {
    assert.match(center, new RegExp(marker));
  }
  assert.doesNotMatch(center, /if \(taskChildProcesses\.size \|\| captureHeavyWorkGate\.state\(\)\.length\) throw Error\('后台任务运行中/);
});

test('manual dispatch origin stays in the call chain while scheduler and retry paths remain background work', () => {
  assert.match(main, /bridge:executeTask[\s\S]{0,240}dispatchOrigin: 'user'/);
  assert.match(main, /function launchCommandAdapter[\s\S]{0,900}requestOrigin: processOptions\.dispatchOrigin === 'user'/);
  assert.match(main, /function resumeResourceDeferredTask[\s\S]{0,1600}dispatchOrigin: 'retry'/);
  assert.match(main, /async function resumeAutomaticTaskWake[\s\S]{0,2200}dispatchOrigin: 'scheduler'/);
  assert.match(main, /selectedAdapter\.submit\(routedTask, command,[\s\S]{0,300}dispatchOrigin/);
  assert.doesNotMatch(main, /task\.dispatchOrigin\s*=/);
  assert.doesNotMatch(main, /dispatchOrigin:\s*task\.dispatchOrigin/);
});

