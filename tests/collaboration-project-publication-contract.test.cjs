const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');

test('D3 publishes projects through the existing direct queue and exposes a one-click bridge', () => {
  assert.match(main, /function publishCollaborationProject/);
  assert.match(main, /queueDirectCollaborationDelivery\(published\)/);
  assert.match(main, /bridge:publishCollaborationProject/);
  assert.match(preload, /publishCollaborationProject\(optionsJson\)/);
  assert.match(ui, /发布项目/);
  assert.match(ui, /transferResponsibility: 'direct'/);
});

test('D3 only includes raw materials and verified knowledge, and imports publications automatically', () => {
  assert.match(main, /\['verified', 'published'\]\.includes\(String\(record\.status\)\)/);
  assert.match(main, /kind: 'raw_material'/);
  assert.match(main, /kind: 'knowledge_snapshot'/);
  assert.match(main, /function ingestImportedProjectPublications/);
  assert.match(main, /const projectImport = await ingestImportedProjectPublications\(\)/);
  assert.match(main, /projectLineageId/);
});

test('D3 receiver deduplicates known SHA-256 objects and isolates path conflicts without deletion', () => {
  assert.match(main, /String\(known\.sha256 \|\| ''\) !== String\(file\.sha256 \|\| ''\)/);
  assert.match(main, /publicationImportDisposition/);
  assert.match(main, /disposition\.action === 'isolate'/);
  assert.doesNotMatch(main.slice(main.indexOf('function ingestImportedProjectPublications'), main.indexOf('function selectCollaborationTaskFiles')), /rmSync/);
});

test('D3 receiver repairs old directory-only imports and refreshes project counts automatically', () => {
  const ingestion = main.slice(main.indexOf('function ingestImportedProjectPublications'), main.indexOf('function selectCollaborationTaskFiles'));
  const duplicateBranch = ingestion.slice(
    ingestion.indexOf("if (disposition.action === 'skip')"),
    ingestion.indexOf('} else {', ingestion.indexOf("if (disposition.action === 'skip')")),
  );
  assert.match(main, /contentComplete === true/);
  assert.match(main, /materializationVersion >= 6/);
  assert.match(main, /targetsStillComplete/);
  assert.match(main, /store\.lineages\[publication\.lineageId\]\?\.localProjectId/);
  assert.match(ingestion, /canonicalIsPathInside\(targetRoot, targetPath\)/);
  assert.match(ingestion, /canonicalIsPathInside\(targetRoot, finalPath\)/);
  assert.doesNotMatch(ingestion, /canonicalIsPathInside\(targetPath, targetRoot\)/);
  assert.doesNotMatch(ingestion, /canonicalIsPathInside\(finalPath, targetRoot\)/);
  assert.match(main, /publicationResolved === publication\.entries\.length/);
  assert.match(main, /contentComplete \? 'imported' : 'partial'/);
  assert.match(ingestion, /if \(!importedPath && !targetPathValid\) continue/);
  assert.doesNotMatch(duplicateBranch, /continue;/);
  assert.match(ingestion, /if \(entry\.kind === 'raw_material'\) \{[\s\S]{0,200}upsertAssetFromFile/);
  assert.match(ingestion, /else if \(entry\.kind === 'knowledge_snapshot'\)/);
  assert.match(ui, /onNativeCollaborationChanged[\s\S]{0,400}refreshProjects\(\)/);
  assert.match(main, /function repairCompletedDirectPackages/);
  assert.match(main, /const directRecovery = repairCompletedDirectPackages\(\)/);
});

test('D3 preserves workspace screening state across a relocated synchronized directory', () => {
  assert.match(main, /function projectPublicationWorkspaceBaseline/);
  assert.match(main, /collaborationWorkspaceBaseline: publication\.project\.workspaceBaseline/);
  assert.match(main, /baselineRestored/);
  assert.match(main, /canRestoreBaseline/);
});

test('D3 carries digest completion and suppresses deleted collaboration lineages', () => {
  assert.match(main, /function projectPublicationDigestBaseline/);
  assert.match(main, /function restoreProjectPublicationDigestBaseline/);
  assert.match(main, /digestBaseline: projectPublicationDigestBaseline\(project, sourceFiles\)/);
  assert.match(main, /isProjectLineageDismissed\(store, publication\.lineageId\)/);
  assert.match(main, /dismissProjectLineage\(/);
  assert.match(main, /restoreProjectLineage\(/);
  assert.match(main, /function repairMisplacedProjectKnowledge/);
  assert.match(main, /function repairCompletedProjectPublication/);
  assert.match(main, /const completedMaintenance = repairCompletedProjectPublication\(project, publication\)/);
  assert.match(main, /verifiedKnowledgeOnlyHashes/);
  assert.match(main, /authoritativeRawHashes/);
  assert.match(main, /sha256CollaborationFile\(rawFile\.path\)/);
  assert.doesNotMatch(main, /const completedMaintenance = targetsStillComplete\s*\?/);
  assert.match(main, /repairedMisplacedKnowledge \+= completedMaintenance\.repairedMisplacedKnowledge/);
  assert.match(main, /sha256CollaborationFile\(candidate\) !== entry\.sha256/);
  assert.match(main, /versionedConflictPath\(entry\.relativePath, publication\.publicationId\)/);
  assert.match(main, /versionedConflictPath\(logicalRelativePath, publication\.publicationId\)/);
  assert.match(main, /isVersionedConflictPath\(rawFile\.relativePath\)/);
  assert.match(main, /Number\(current\.pendingCount \|\| 0\) === pendingCount/);
  assert.match(main, /修正 \$\{projectImport\.repairedMisplacedKnowledge\} 份误入原始资料库的知识/);
  assert.match(main, /projectImport\.importedPublications \|\| projectImport\.repairedMisplacedKnowledge/);
});

test('D3 keeps Syncthing compatibility out of the default project publishing path', () => {
  assert.match(main, /Syncthing 仅保留为高级兼容方案/);
  assert.match(main, /transferResponsibility === 'syncthing_compat' \? 'syncthing_compat' : 'direct'/);
  assert.match(ui, /局域网优先、Tailscale 备用的内置直传/);
});

test('D3 prefers a direct-ready transport for an exact mapped peer and treats a legacy exchange package as queued instead of unreachable', () => {
  assert.match(main, /projectPeersForStudentMappings\(collaboration, localNodeId, project\.studentIds \|\| \[\]\)/);
  assert.match(main, /Number\(Boolean\(collaborationDirectSecret\(right\)\)/);
  assert.match(main, /fallbackQueued: Boolean\(published\.packageRoot\)/);
  assert.match(main, /已进入兼容交换队列/);
  assert.match(main, /无需重复发布/);
  assert.doesNotMatch(main, /项目发布包已生成，但对端当前不可达/);
});

test('S2-S4 only offers exact student-mapped recipients and requires an explicit target', () => {
  assert.match(main, /code: 'project_has_no_students'/);
  assert.match(main, /code: peers\.length \? 'ready' : 'student_mapping_required'/);
  assert.match(main, /const requestedTargetNodeId = String\(options\.targetNodeId \|\| ''\)\.trim\(\)/);
  assert.match(main, /const peer = peers\.find\(\(item\) => item\.peerNodeId === requestedTargetNodeId\)/);
  assert.doesNotMatch(main, /peers\.find\(\(item\) => item\.related\)\s*\|\|\s*peers\[0\]/);
  assert.match(ui, /if \(peers\.length === 1\)/);
  assert.match(ui, /setProjectPublicationChooserOpen\(true\)/);
  assert.match(ui, /for \(const targetNodeId of targets\)/);
  assert.match(ui, /targetNodeId,/);
  assert.match(ui, /每个接收方会生成独立发布包/);
});

test('S1 searches the full loaded asset index before applying the display cap', () => {
  const searchStart = ui.indexOf('const projectCandidateAssetMatches = useMemo');
  const capStart = ui.indexOf('const projectCandidateAssets = projectCandidateAssetMatches.slice(0, 120)');
  assert.ok(searchStart >= 0);
  assert.ok(capStart > searchStart);
  assert.match(ui.slice(searchStart, capStart), /assetIndex\.assets/);
  assert.match(ui, /placeholder="文件名、学生、来源、类型或 SHA-1"/);
  assert.match(ui, /不复制原始文件/);
  assert.match(ui, /引用所选资产/);
});

test('D3 upgrades legacy bindings and promotes only the latest project package to native direct delivery', () => {
  assert.match(main, /function rememberDiscoveredCollaborationHost/);
  assert.match(main, /mergeBindingDirectOffer\(binding, peerNodeId/);
  assert.match(main, /function latestCompatibilityProjectManifestIds/);
  assert.match(main, /function promoteCompatibilityQueueForPeer/);
  assert.match(main, /promoteCompatibilityDeliveries\(current/);
  assert.match(main, /setImmediate\(\(\) => \{ void processDirectDeliveryQueue\(\); \}\)/);
  assert.match(main, /tailscaleUrls: info\.tailscaleUrls/);
  assert.match(main, /collaboration\.bindings\.some\(\(item\) => item\.status === 'active'/);
  assert.match(main, /startHostService\(\{ preserveUsageMode: true \}\)/);
});
