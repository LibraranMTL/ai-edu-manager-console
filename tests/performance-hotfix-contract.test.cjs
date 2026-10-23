const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');

test('idle Agent synchronization does not rewrite the task store', () => {
  const syncBody = main.match(/function consumeAgentTaskResults\([^)]*\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(syncBody, /if \(imported \|\| claimed \|\| rejected\) await taskStoreGuard.flush\(\);/);
  assert.ok(syncBody.indexOf('await writeTaskStoreDurably(store)') < syncBody.indexOf('await archiveAgentPayload'));
});

test('manual submission persists without referring to QClaw synchronization counters', () => {
  const manualBody = main.match(/function submitManualTask\([^)]*\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(manualBody, /await writeTaskStoreDurably\(store\)/);
  assert.ok(manualBody.indexOf('await writeTaskStoreDurably') < manualBody.indexOf('writeTaskPacket'));
  assert.doesNotMatch(manualBody, /imported|claimed|rejected/);
});

test('digest polling uses the mtime-aware project lookup cache', () => {
  assert.match(main, /function readProjectsForDigestLookup\(\)/);
  assert.match(main, /const project = readProjectsForDigestLookup\(\)\.find/);
  assert.match(main, /projectDigestLookupCache = \{ mtimeMs: -1, size: -1, projects: \[\] \};/);
});

test('non-real-time renderer polling is throttled and capture updates are event driven', () => {
  assert.match(renderer, /if \(document\.hidden\) return;/);
  assert.match(renderer, /const statusVisible = \['init', 'settings', 'memory', 'capture', 'qa', 'soul', 'rules', 'conversation', 'tasks'\]\.includes\(visibleSection\)/);
  assert.match(renderer, /\}, 60000\);\s*const hostTimer = window\.setInterval/);
  assert.match(renderer, /activeSectionRef\.current === 'settings'/);
  assert.match(renderer, /\}, 60000\);/);
  assert.match(renderer, /const timer = window\.setInterval\(\(\) => \{\s*if \(!document\.hidden\) refreshVisible\(\);\s*\}, 30000\);/);
  assert.doesNotMatch(renderer, /setInterval\(refreshCaptureCenter/);
  assert.match(main, /kind: 'capture_delta'/);
  assert.match(main, /sessions: \(store\.sessions \|\| \[\]\).*\.map\(captureSessionSummary\)/s);
  assert.match(main, /appendCaptureSessionItem\(session\.id, appendedItem\)/);
  assert.match(renderer, /memo\(function CaptureTimelineCard/);
  assert.match(renderer, /new IntersectionObserver/);
  assert.match(renderer, /rootMargin: '320px 0px'/);
  assert.match(renderer, /startCaptureTimelineTransition/);
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
