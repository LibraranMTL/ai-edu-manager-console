const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

test('idle digest and collaboration monitors use adaptive single-flight scheduling', () => {
  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /activeBeforeScan/);
  assert.match(main, /if \(!activeBeforeScan\.length\) return \{ ok: true, idle: true/);
  assert.match(main, /function digestReceiptMonitorTasks\(\)/);
  assert.match(main, /receiptReconcileDelay\(recoveryBudget\(task\)\.receiptQueries\)/);
  assert.match(main, /scheduleDigestWorkflowMonitor\(undefined, 'bounded_backoff'\)/);
  assert.match(main, /scheduleDigestWorkflowMonitor\(2_500, 'startup_recovery'\)/);
  assert.doesNotMatch(main, /digestWorkflowTimer = setInterval\([^;]*5000/);
  assert.match(main, /scheduleDirectDeliveryMonitor\(directDeliveryMonitorDelay\(\)\)/);
  assert.match(main, /nextDeliveryWakeDelay\(readDirectDeliveryStore\(\), now/);
  assert.doesNotMatch(main, /scheduleDirectDeliveryMonitor\(directDeliveryMonitorHasPendingWork\(\) \? 15_000 : 60_000\)/);
  assert.doesNotMatch(main, /collaborationDirectDeliveryTimer = setInterval/);
});

test('renderer background refreshes are visibility-aware and avoid unrelated page scans', () => {
  const renderer = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');
  assert.match(renderer, /if \(document\.hidden\) return;/);
  assert.match(renderer, /activeSectionRef\.current === 'settings'/);
  assert.match(renderer, /activeSectionRef\.current === 'tasks'/);
  assert.match(renderer, /const statusVisible = \['init', 'settings', 'memory', 'capture', 'qa', 'soul', 'rules', 'conversation', 'tasks'\]\.includes\(visibleSection\)/);
  assert.match(renderer, /}, 60000\);/);
  assert.match(renderer, /}, 30000\);/);
  assert.doesNotMatch(renderer, /setInterval\(refreshVisible, 15000\)/);
});

test('startup Agent configuration and student archive reconciliation avoid a synchronized heavy burst', () => {
  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
  const hostStart = main.slice(main.indexOf('function startHostService('), main.indexOf('function stopHostService('));
  assert.doesNotMatch(hostStart, /prepareAllAgentKnowledgeAccess\(\)/);
  assert.match(main, /function writeExternalConnectionRuntimeConfig[\s\S]*sourceBytes\.equals\(targetBytes\)/);
  assert.match(main, /function scheduleStudentArchiveSync[\s\S]*resourceCoordinator\.run\(\['disk', 'cpu'\]/);
  assert.match(main, /scheduleStudentArchiveSync\(student\.id, 5 \* 60_000 \+ index \* 2 \* 60_000\)/);
  assert.doesNotMatch(main, /scheduleStudentArchiveSync\(student\.id, 15_000 \+ index \* 250\)/);
});
