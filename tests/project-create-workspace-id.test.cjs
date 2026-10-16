const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const source = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
function extract(name) {
  const match = new RegExp(`(?:async )?function ${name}\\(`).exec(source);
  assert.ok(match, name);
  const end = source.slice(match.index + match[0].length).search(/\n(?:async )?function /);
  return source.slice(match.index, end < 0 ? undefined : match.index + match[0].length + end);
}

test('new workspace-v1 project uses its generated id for the first digest and registry reads', () => {
  const observed = { digest: '', registry: '' };
  const paths = {
    projectRootPath: 'D:\\synthetic-project', managerPath: 'D:\\synthetic-project\\.edu-manager',
    workspacePath: 'D:\\synthetic-project\\workspace', stagingPath: 'D:\\synthetic-project\\staging',
    knowledgeRootPath: 'D:\\synthetic-project\\knowledge', rawPath: 'D:\\synthetic-project\\raw',
    conceptPath: 'D:\\synthetic-project\\concept', entityPath: 'D:\\synthetic-project\\entity',
    summaryPath: 'D:\\synthetic-project\\summary', qaPath: 'D:\\synthetic-project\\qa',
    synthesisPath: 'D:\\synthetic-project\\synthesis', reportPath: 'D:\\synthetic-project\\report',
    contributionPath: 'D:\\synthetic-project\\contribution', agentPath: 'D:\\synthetic-project\\AGENTS.md',
    outputPath: 'D:\\synthetic-project\\output',
  };
  const context = vm.createContext({
    crypto, path,
    sanitizeName: (value) => String(value),
    projectPathsFor: () => paths,
    projectWorkspaceTemplateFor: () => ({ id: 'general', name: '通用' }),
    projectWorkspaceFoldersFor: () => [],
    readProjectDigestState: (project) => { observed.digest = project.id; return { projectId: project.id, pendingCount: 0 }; },
    normalizeProjectStagingItem: (value) => value,
    isWorkspaceMaterialProject: (project) => project.materialStorageMode === 'workspace-v1',
    projectStagingProjection: () => [],
    readProjectMaterialIndexSync: (project) => { observed.registry = project.id; return { materials: [] }; },
    normalizeMaterialConfiguration: (project) => ({ materialStorageMode: project.materialStorageMode, materialRegistryVersion: 1 }),
    sourceBindingRef: (value) => value,
  });
  vm.runInContext(extract('normalizeProject'), context);
  const project = context.normalizeProject({ name: '海康萤石OPC项目', materialStorageMode: 'workspace-v1', automation: { enabled: true } });
  assert.match(project.id, /^project-/);
  assert.equal(observed.digest, project.id);
  assert.equal(observed.registry, project.id);
  assert.equal(project.digestState.projectId, project.id);
  assert.equal(project.automation.enabled, true);
});

test('new project creation inherits global automation and explicitly pins workspace-v1', () => {
  const createSource = extract('createProject');
  assert.match(createSource, /materialStorageMode: 'workspace-v1'/);
  assert.match(createSource, /automation: \{ enabled: taskAutomationEnabled\(\)/);
});
