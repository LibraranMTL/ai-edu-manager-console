const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');

test('student archive collaboration requires one-to-one id mapping and never falls back by name', () => {
  assert.match(main, /peersForStudentMappings\(state, state\.node\.nodeId, localStudentId\)/);
  assert.match(main, /localAssignments\.length !== 1 \|\| allLocalStudentAssignments\.length !== 1/);
  assert.match(main, /peerStudentIds\.length !== 1/);
  const ingestStart = main.indexOf('function ingestImportedStudentArchives()');
  const ingestEnd = main.indexOf('function scanCollaborationInbox()', ingestStart);
  const ingest = main.slice(ingestStart, ingestEnd);
  assert.match(ingest, /findStudentByKey\(publication\.targetStudentId\)/);
  assert.doesNotMatch(ingest, /sourceStudentName[\s\S]*?matches/);
  assert.match(ingest, /validateStudentArchiveTargetRoots\(roots\)/);
  assert.doesNotMatch(ingest, /requiredPaths:\s*\[roots\.knowledgeRoot,\s*roots\.rawRoot\]/);
});

test('collaboration state derives device trust and student maps without dropping legacy bindings', () => {
  assert.match(main, /deriveCollaborationRelationships\(\{/);
  assert.match(main, /deviceBindings: relationships\.deviceBindings/);
  assert.match(main, /studentMaps: relationships\.studentMaps/);
  assert.match(main, /bindings,/);
  assert.match(ui, /协作设备/);
  assert.match(ui, /共享学生/);
  assert.doesNotMatch(ui.slice(ui.indexOf('<summary>协作设备'), ui.indexOf('跨主机档案同步')), /学生资料权威/);
  assert.match(main, /function createCollaborationDeviceInvitation\(\)/);
  assert.match(main, /function createCollaborationStudentMappingOffer\(deviceBindingId, studentId\)/);
  assert.match(main, /function acceptCollaborationStudentMappingClipboard\(studentId\)/);
  assert.match(main, /function collaborationStudentByExactId\(studentId\)/);
  const nativeMappingStart = main.indexOf('function createCollaborationStudentMappingOffer(deviceBindingId, studentId)');
  const legacyInvitationStart = main.indexOf('function createManualCollaborationInvitation(studentId, localRole)', nativeMappingStart);
  assert.doesNotMatch(main.slice(nativeMappingStart, legacyInvitationStart), /findStudentByKey\(/);
  assert.match(main, /deviceBindings: current\.deviceBindings\.filter\(\(item\) => !removedDeviceIds\.has\(item\.deviceBindingId\)\)/);
  assert.match(main, /studentMaps: current\.studentMaps\.filter\(\(item\) => !removedDeviceIds\.has\(item\.deviceBindingId\)\)/);
});

test('student archive collaboration can be paused and manually synchronized per student', () => {
  assert.match(main, /function setStudentArchiveSyncEnabled\(studentId, enabled\)/);
  assert.match(main, /function studentArchiveSyncStatus\(state = readCollaborationState\(\)\)/);
  assert.match(main, /bridge:setStudentArchiveSyncEnabled'[\s\S]*?licensedIpc\(event, '更新学生档案同步策略'/);
  assert.match(main, /bridge:syncStudentArchiveNow'[\s\S]*?licensedIpc\(event, '同步学生档案'/);
  assert.doesNotMatch(main, /licensedSync\s*\(/);
  assert.match(preload, /setStudentArchiveSyncEnabled\(studentId, enabled\)/);
  assert.match(preload, /syncStudentArchiveNow\(studentId\)/);
  assert.match(ui, /跨主机档案同步/);
  assert.match(ui, /原始资料与草稿不会同步/);
});
