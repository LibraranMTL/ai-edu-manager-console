const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

test('idle digest and collaboration monitors use adaptive single-flight scheduling', () => {
  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /activeBeforeScan/);
  assert.match(main, /if \(!activeBeforeScan\.length\) return \{ ok: true, idle: true/);
  assert.match(main, /scheduleDigestWorkflowMonitor\(digestWorkflowMonitorHasActiveWork\(\) \? 10_000 : 60_000\)/);
  assert.doesNotMatch(main, /digestWorkflowTimer = setInterval\([^;]*5000/);
  assert.match(main, /scheduleDirectDeliveryMonitor\(directDeliveryMonitorHasPendingWork\(\) \? 15_000 : 60_000\)/);
  assert.doesNotMatch(main, /collaborationDirectDeliveryTimer = setInterval/);
});

test('renderer background refreshes are visibility-aware and avoid unrelated page scans', () => {
  const renderer = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');
  assert.match(renderer, /if \(document\.hidden\) return;/);
  assert.match(renderer, /activeSectionRef\.current === 'settings'/);
  assert.match(renderer, /activeSectionRef\.current === 'tasks'/);
  assert.match(renderer, /}, 10000\);/);
  assert.match(renderer, /}, 60000\);/);
  assert.match(renderer, /}, 30000\);/);
  assert.doesNotMatch(renderer, /setInterval\(refreshVisible, 15000\)/);
});
