const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
const extract = name => source.slice(source.indexOf(`function ${name}(`), source.indexOf('\nfunction ', source.indexOf(`function ${name}(`) + 1));
function fixture() {
  const counts = { scans: 0, projects: 0, students: 0, resolves: 0 };
  const context = vm.createContext({ path, crypto: require('node:crypto'),
    requiresFixedReportEvidence: require('../electron/project-evidence-reference.cjs').requiresFixedReportEvidence,
    normalizeMaterialConfiguration: require('../electron/project-material-host.cjs').normalizeMaterialConfiguration,
    normalizeMaterialAutomation: require('../electron/project-material-automation.cjs').normalizeMaterialAutomation,
    isWorkspaceMaterialProject: require('../electron/project-material-host.cjs').isWorkspaceMaterialProject,
    readProjectMaterialIndexSync: () => ({ schema: 'edu-manager.project-materials.v1', projectId: 'p1', revision: 0,
      materials: [], categories: [], receipts: [], commits: [] }),
    projectStagingProjection: (_project, _index, items) => items,
    sanitizeName: value => String(value),
    projectPathsFor: (name, root) => ({ projectRootPath: root || '/project', contributionPath: '/project/contributions' }),
    projectWorkspaceTemplateFor: () => ({ id: 'default', name: 'Default' }),
    projectWorkspaceFoldersFor: () => [],
    readProjectDigestState: () => { counts.scans++; return { pendingCount: 9 }; },
    normalizeProjectStagingItem: value => value,
    readProjects: () => { counts.projects++; return [{ id: 'p1', name: 'P1', studentIds: ['s1'] }, { id: 'p2', name: 'P2', studentIds: ['s2'] }]; },
    readStudentsIndex: () => { counts.students++; return [{ id: 's1' }, { id: 's2' }]; },
    toHostStudent: value => value,
    growthIndexPath: student => student.id,
    safeReadJson: () => ({ evidence: Array.from({ length: 200 }, (_, i) => ({ id: String(i), sourcePath: '/allowed' })) }),
    reportEvidenceSourceResolver: (student, projects, sourcePath) => {
      counts.resolves++;
      assert.ok(projects.every(p => p.studentIds.includes(student.id)));
      return { available: sourcePath === '/allowed' };
    },
    validateReportDraftForAutoPublish: input => ({ valid: input.growthIndex.evidence.every(input.sourceAccessible) }),
  });
  for (const name of ['normalizeProject', 'normalizeProjectMetadata', 'reportProjectsForStudent', 'reportEvidenceSourceValues', 'reportEvidenceSourceAccessible', 'validateReportAutoPublication']) {
    vm.runInContext(extract(name), context);
  }
  return { context, counts };
}

test('metadata normalization never invokes raw-material hashing; digest normalization still does', () => {
  const { context, counts } = fixture();
  const project = { id: 'p1', name: 'P1', studentIds: ['s1'], digestState: { pendingCount: 2 } };
  assert.equal(context.normalizeProjectMetadata(project).digestState.pendingCount, 2);
  assert.equal(counts.scans, 0);
  assert.equal(context.normalizeProject(project).digestState.pendingCount, 9);
  assert.equal(counts.scans, 1);
});

test('project metadata is filtered by student before normalization', () => {
  const { context, counts } = fixture();
  const projects = context.reportProjectsForStudent({ id: 's1' });
  assert.equal(projects.length, 1); assert.equal(projects[0].id, 'p1');
  assert.equal(counts.scans, 0);
});

test('normalizing saved new-mode projects preserves their storage and classification rules', () => {
  const { context, counts } = fixture();
  const result = context.normalizeProjectMetadata({ id: 'p1', name: 'P1', materialStorageMode: 'workspace-v1',
    materialRegistryVersion: 1, inboxRelativePath: '待归类', materialMigrationState: 'partial',
    materialOrganizationPolicy: { mode: 'suggest', autoMoveRoots: ['待归类'] } });
  assert.equal(result.materialStorageMode, 'workspace-v1');
  assert.equal(result.inboxRelativePath, '待归类');
  assert.equal(result.materialMigrationState, 'partial');
  assert.equal(result.materialOrganizationPolicy.respectManualClassification, true);
  assert.equal(counts.scans, 0);
});

test('200 report citations share one metadata read, while every source is still checked', () => {
  const { context, counts } = fixture();
  assert.equal(context.validateReportAutoPublication({ sourceId: 's1' }, 'report').valid, true);
  assert.equal(counts.projects, 1); assert.equal(counts.students, 1);
  assert.equal(counts.scans, 0); assert.equal(counts.resolves, 200);
});

test('a mismatched student context cannot grant access and unavailable citations still fail', () => {
  const { context, counts } = fixture();
  const other = { student: { id: 's2' }, projects: [{ id: 'p2', studentIds: ['s2'] }] };
  assert.equal(context.reportEvidenceSourceAccessible({ sourceId: 's1' }, { sourcePath: '/denied' }, other), false);
  assert.equal(counts.students, 1); assert.equal(counts.projects, 1);
});

test('archive and Agent grant discovery use metadata; actual batches retain full content checks', () => {
  assert.match(extract('currentArchiveAccess'), /map\(normalizeProjectMetadata\)/);
  assert.match(extract('prepareAgentKnowledgeAccess'), /map\(normalizeProjectMetadata\)/);
  assert.match(extract('registerProjectDigestBatch'), /readProjectDigestState\(ensured\)/);
  assert.match(extract('readProjectDigestState'), /collectProjectRawFiles\(paths.rawPath\)/);
  assert.match(extract('collectProjectRawFiles'), /sha1: sha1File\(fullPath\)/);
});
