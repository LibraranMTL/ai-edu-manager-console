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
  assert.match(renderer, /if \(document\.hidden\) return;/);
  assert.match(renderer, /\}, 10000\);\s*const hostTimer = window\.setInterval/);
  assert.match(renderer, /activeSectionRef\.current === 'settings'/);
  assert.match(renderer, /\}, 60000\);/);
  assert.match(renderer, /const timer = window\.setInterval\(\(\) => \{\s*if \(!document\.hidden\) refreshVisible\(\);\s*\}, 30000\);/);
  assert.match(renderer, /const timer = window\.setInterval\(refreshCaptureCenter, 2000\);/);
});

test('host status reads upload records once per refresh', () => {
  const functionBody = main.match(/function hostStudentStats\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.equal((functionBody.match(/readUploadRecords\(\)/g) || []).length, 1);
});

test('host status uses cached directory counts and cached student QR payloads', () => {
  assert.match(main, /hostDirectoryCountCache\.count\(rawPath, 'all'\)/);
  assert.match(main, /hostDirectoryCountCache\.count\(summaryPath, 'markdown'/);
  assert.match(renderer, /studentLoginQrDataUrlCache\.get\(payload\)/);
  assert.match(renderer, /\[studentLoginQrSignature\]/);
});

test('collaboration status and recovery skip terminal history before opening package manifests', () => {
  const transport = fs.readFileSync(path.join(root, 'electron', 'collaboration-transport.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
  const recoveryBody = main.match(/function repairCompletedDirectPackages\(\) \{([\s\S]*?)\n\}\n\nfunction exportCollaborationStudentStats/)?.[1] || '';
  assert.match(main, /transport\.discoverPackages\(state\.node\.nodeId, \{ ignoredManifestIds: terminalManifestIds \}\)/);
  assert.match(transport, /discoverPackages\(targetNodeId, options = \{\}\)/);
  assert.match(transport, /discoverCollaborationPackages\(root\(\), targetNodeId, options\)/);
  assert.doesNotMatch(recoveryBody, /\.sort\(\(left, right\) => fs\.statSync\(right\)\.mtimeMs - fs\.statSync\(left\)\.mtimeMs\)/);
  assert.match(recoveryBody, /let compactionBudget = 10;/);
  assert.match(preload, /scanCollaborationInbox\(\) \{\s*return ipcRenderer\.invoke\('bridge:scanCollaborationInbox'\);/);
  assert.match(main, /ipcMain\.handle\('bridge:scanCollaborationInbox'/);
});
