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
  assert.match(main, /pathInside,[\s\S]*?require\('\.\/collaboration-sync\.cjs'\)/);
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

test('manual archive sync explains when an unvalidated report is intentionally excluded', () => {
  assert.match(main, /function pendingStudentArchiveReports\(student\)/);
  assert.match(main, /frontmatterValueFromFile\(file, 'status', 8192\)/);
  assert.doesNotMatch(main, /frontmatterValue\(readSmallTextFile\(file, 8192\), 'status'\)/);
  assert.match(main, /isPublishableLearningReportStatus\(status\)/);
  assert.match(main, /尚未通过自动校验发布，未纳入知识同步；其余学生知识档案无实质变化/);
});

test('student archive sync reports delivery state even when content is unchanged', () => {
  assert.match(main, /function studentArchiveLatestDelivery\(peers, store = readDirectDeliveryStore\(\)\)/);
  assert.match(main, /latestDeliveryForLineages/);
  assert.match(main, /学生知识档案无实质变化/);
  assert.match(main, /最新同步包尚未送达/);
  assert.match(main, /正在等待网络恢复并自动重试/);
  assert.match(main, /latestDelivery,/);
  assert.match(ui, /最新同步状态：/);
  assert.match(ui, /archiveSync\.latestDelivery\.statusLabel/);
  assert.match(ui, /下次自动重试/);
  assert.match(ui, /pendingCollaborationDeliveryManifestRef/);
  assert.match(ui, /event\.manifestId === pendingCollaborationDeliveryManifestRef\.current/);
  assert.match(ui, /学生知识档案同步包已送达；主机与目标设备状态已一致/);
  assert.match(ui, /全部协作设备发送队列/);
});
