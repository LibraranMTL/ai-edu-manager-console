const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');

test('idle QClaw synchronization does not rewrite the task store', () => {
  const syncBody = main.match(/function syncQClawTaskResults\(\) \{([\s\S]*?)\n\}\n\nfunction/)?.[1] || '';
  assert.match(syncBody, /if \(imported \|\| claimed \|\| rejected\) writeTaskStore\(store\);/);
});

test('manual submission persists without referring to QClaw synchronization counters', () => {
  const manualBody = main.match(/function submitManualTask\([^)]*\) \{([\s\S]*?)\n\}\n\nfunction/)?.[1] || '';
  assert.match(manualBody, /writeTaskStore\(store\);/);
  assert.doesNotMatch(manualBody, /imported|claimed|rejected/);
});

test('digest polling uses the mtime-aware project lookup cache', () => {
  assert.match(main, /function readProjectsForDigestLookup\(\)/);
  assert.match(main, /const project = readProjectsForDigestLookup\(\)\.find/);
  assert.match(main, /projectDigestLookupCache = \{ mtimeMs: -1, size: -1, projects: \[\] \};/);
});

test('non-real-time renderer polling is throttled while capture polling stays responsive', () => {
  assert.match(renderer, /\}, 3000\);\s*const hostTimer = window\.setInterval\(refreshHostServiceStatus, 10000\);/);
  assert.match(renderer, /const timer = window\.setInterval\(refreshVisible, 15000\);/);
  assert.match(renderer, /const timer = window\.setInterval\(refreshCaptureCenter, 2000\);/);
});

test('host status reads upload records once per refresh', () => {
  const functionBody = main.match(/function hostStudentStats\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.equal((functionBody.match(/readUploadRecords\(\)/g) || []).length, 1);
});
